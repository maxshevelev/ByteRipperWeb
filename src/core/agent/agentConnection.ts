import { AgentArguments } from "@/core/agent/agentArguments";
import type { AgentCallOutcome, AgentCallRecord, AgentServer } from "@/core/agent/agentServer";
import {
  type AgentAnswer,
  AgentCancelled,
  AgentToolError,
  answerText,
  CancelSource,
  toolListing,
} from "@/core/agent/agentTool";
import { isObject, type Json, jsonBytes, member, parseJson, utf8Length } from "@/core/agent/json";
import { LineFramer } from "@/core/agent/lineFramer";
import {
  ErrorCode,
  MCPProtocol,
  Meta,
  RPCError,
  RPCMessage,
  serverInfoJson,
  supportedVersions,
} from "@/core/agent/mcpProtocol";

/** Which era a request is served in. */
type Era = { readonly kind: "modern" | "legacy"; readonly version: string };

interface InFlight {
  readonly controller: CancelSource;
  readonly done: Promise<void>;
  readonly progressToken: Json | undefined;
  lastProgress: number | undefined;
}

/** A request id as a key: JSON-RPC allows a string or an integer, and `1` and `"1"` are two different requests. */
const requestKey = (id: Json): string | undefined =>
  typeof id === "number" && Number.isInteger(id)
    ? `i:${id}`
    : typeof id === "string"
      ? `s:${id}`
      : undefined;

let nextRecordId = 1;

/**
 * One client, from the bytes it sends to the bytes it is sent.
 *
 * The transport — a pipe in the shell, an array in a test — hands every chunk it reads to
 * `receive` and writes whatever `send` is given; everything between is here: the framing, which
 * era a request belongs to, the answer, and the calls still running. Nothing here knows what the
 * transport is, which is what lets a test drive a whole conversation as lines.
 *
 * A tool call runs on its own, so a survey that takes a minute does not hold up a `ping` or a
 * second call behind it; everything else is answered in the order it arrived. A call the client
 * cancels is told to stop and is never answered, as the protocol requires.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.clientName
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.legacyVersion
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.server
 */
export class AgentConnection {
  readonly server: AgentServer;
  private readonly send: (line: Uint8Array) => void;
  private readonly observer: (record: AgentCallRecord) => void;
  private readonly onFirstMessage: () => void;
  /** Whether the client has sent anything yet. */
  private hasSpoken = false;
  private readonly framer: LineFramer;
  /**
   * The version an `initialize` agreed on. Undefined until a legacy client shakes hands; a modern
   * client never does.
   */
  legacyVersion: string | undefined;
  /** What the client called itself — in `initialize`, or in the `_meta` of its latest modern request. */
  clientName: string | undefined;
  private readonly inFlight = new Map<string, InFlight>();
  /**
   * Calls that were cancelled and have not stopped yet. Nobody will hear their answer, but they
   * are still work in progress, and `waitUntilIdle` must wait for them like any other.
   */
  private stopping = new Set<Promise<void>>();
  private closed = false;

  /**
   * `send` is given one message at a time, a complete line with its newline. `observer` hears
   * about every tool call once it is over. `onFirstMessage` is called once, when the first complete
   * message arrives: until then the other end is a transport, not yet a client — a relay a client
   * started and then abandoned before its handshake holds a connection open and never says a word.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.init
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.onFirstMessage
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.hasSpoken
   */
  constructor(
    server: AgentServer,
    send: (line: Uint8Array) => void,
    observer: (record: AgentCallRecord) => void = () => undefined,
    onFirstMessage: () => void = () => undefined
  ) {
    this.server = server;
    this.send = send;
    this.observer = observer;
    this.onFirstMessage = onFirstMessage;
    this.framer = new LineFramer(server.limits.maxLineBytes);
  }

  /** The next piece of what the client wrote. @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.receive */
  receive(chunk: Uint8Array): void {
    if (this.closed) return;
    for (const line of this.framer.append(chunk)) {
      if (line.kind === "message") {
        if (!this.hasSpoken) {
          this.hasSpoken = true;
          this.onFirstMessage();
        }
        this.handle(line.bytes);
      } else {
        this.write(
          RPCMessage.error(
            null,
            new RPCError(
              ErrorCode.invalidRequest,
              `Message longer than ${this.server.limits.maxLineBytes} bytes`
            )
          )
        );
      }
    }
  }

  /**
   * The client has gone. Every call still running is told to stop, and nothing more is written.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.close
   */
  close(): void {
    this.closed = true;
    for (const entry of this.inFlight.values()) {
      entry.controller.cancel();
      this.stopping.add(entry.done);
    }
    this.inFlight.clear();
  }

  /**
   * Returns once no tool call is running. For a test, and for a transport that wants to finish
   * what it was asked before it closes.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentConnection.swift#AgentConnection.waitUntilIdle
   */
  async waitUntilIdle(): Promise<void> {
    for (;;) {
      const pending = [...[...this.inFlight.values()].map((entry) => entry.done), ...this.stopping];
      if (pending.length === 0) return;
      await Promise.all(pending);
      this.stopping = new Set([...this.stopping].filter((done) => !pending.includes(done)));
    }
  }

  // MARK: - One message

  private handle(bytes: Uint8Array): void {
    let message: Json;
    try {
      message = parseJson(bytes);
    } catch {
      this.write(RPCMessage.error(null, new RPCError(ErrorCode.parseError, "Parse error")));
      return;
    }
    if (!isObject(message) || message.jsonrpc !== "2.0") {
      this.write(
        RPCMessage.error(null, new RPCError(ErrorCode.invalidRequest, "Not a JSON-RPC 2.0 message"))
      );
      return;
    }
    const method = message.method;
    if (typeof method !== "string") {
      // A response. The server sends no requests, so there is nothing it could be a response
      // to, and a response is never answered.
      if (message.result !== undefined || message.error !== undefined) return;
      this.write(
        RPCMessage.error(message.id ?? null, new RPCError(ErrorCode.invalidRequest, "No method"))
      );
      return;
    }
    const params = message.params ?? {};
    const id = message.id;
    if (id === undefined) {
      this.handleNotification(method, params);
      return;
    }
    const key = requestKey(id);
    if (key === undefined) {
      this.write(
        RPCMessage.error(
          null,
          new RPCError(ErrorCode.invalidRequest, "The id must be a string or an integer")
        )
      );
      return;
    }
    if (!isObject(params)) {
      this.write(RPCMessage.error(id, RPCError.invalidParams("params must be an object")));
      return;
    }
    try {
      this.handleRequest(method, id, key, params);
    } catch (error) {
      if (error instanceof RPCError) this.write(RPCMessage.error(id, error));
      else
        this.write(
          RPCMessage.error(id, new RPCError(ErrorCode.internalError, `${(error as Error).message}`))
        );
    }
  }

  private handleNotification(method: string, params: Json): void {
    if (method !== "notifications/cancelled") return;
    // `notifications/initialized` says nothing this server waits for; anything else is not
    // addressed to it.
    const id = member(params, "requestId");
    const key = id === undefined ? undefined : requestKey(id);
    const entry = key === undefined ? undefined : this.inFlight.get(key);
    if (key === undefined || entry === undefined) return;
    // Removed first: whatever the task does from here, its answer finds no entry and is not
    // written.
    this.inFlight.delete(key);
    entry.controller.cancel();
    this.stopping.add(entry.done);
  }

  private handleRequest(
    method: string,
    id: Json,
    key: string,
    params: { [key: string]: Json }
  ): void {
    let era: Era;
    const meta = params._meta;
    const version = member(meta, Meta.protocolVersion);
    if (version !== undefined) {
      era = this.modernEra(version, meta);
    } else if (method === "initialize") {
      this.write(RPCMessage.result(id, this.initialize(params)));
      return;
    } else {
      // No handshake and no `_meta`: a legacy client that skipped `initialize`, or one that sent
      // it on an earlier connection. Served rather than refused — the specification asks
      // clients not to do it, and refusing would help nobody.
      era = {
        kind: "legacy",
        version: this.legacyVersion ?? (MCPProtocol.legacyVersions[0] as string),
      };
    }
    switch (method) {
      case "server/discover":
        this.write(RPCMessage.result(id, this.wrap(this.discovery(), era, true)));
        break;
      case "ping":
        this.write(RPCMessage.result(id, this.wrap({}, era)));
        break;
      case "tools/list":
        this.write(
          RPCMessage.result(id, this.wrap({ tools: this.server.tools.map(toolListing) }, era, true))
        );
        break;
      case "tools/call":
        this.startCall(id, key, params, era);
        break;
      default:
        throw new RPCError(ErrorCode.methodNotFound, `Method not found: ${method}`);
    }
  }

  // MARK: - Eras

  private modernEra(version: Json, meta: Json | undefined): Era {
    if (typeof version !== "string") {
      throw RPCError.invalidParams(`${Meta.protocolVersion} must be a string`);
    }
    if (!MCPProtocol.modernVersions.includes(version)) {
      throw new RPCError(ErrorCode.unsupportedProtocolVersion, "Unsupported protocol version", {
        supported: supportedVersions(),
        requested: version,
      });
    }
    if (!isObject(member(meta, Meta.clientCapabilities))) {
      throw RPCError.invalidParams(`${Meta.clientCapabilities} is required`);
    }
    const name = member(member(meta, Meta.clientInfo), "name");
    if (typeof name === "string") this.clientName = name;
    return { kind: "modern", version };
  }

  private initialize(params: { [key: string]: Json }): Json {
    const requested = params.protocolVersion;
    if (typeof requested !== "string") throw RPCError.invalidParams("protocolVersion is required");
    // The client's version when it is one this server speaks; otherwise the newest one it does,
    // and the client decides whether that will do — the handshake's rule.
    const agreed = MCPProtocol.legacyVersions.includes(requested)
      ? requested
      : (MCPProtocol.legacyVersions[0] as string);
    this.legacyVersion = agreed;
    const name = member(params.clientInfo, "name");
    this.clientName = typeof name === "string" ? name : undefined;
    return {
      protocolVersion: agreed,
      capabilities: { tools: { listChanged: false } },
      serverInfo: serverInfoJson(this.server.info),
      ...(this.server.instructions === undefined ? {} : { instructions: this.server.instructions }),
    };
  }

  private discovery(): { [key: string]: Json } {
    return {
      supportedVersions: supportedVersions(),
      capabilities: { tools: {} },
      ...(this.server.instructions === undefined ? {} : { instructions: this.server.instructions }),
    };
  }

  /**
   * A result as its era writes it: a modern one says what kind of result it is and who sent it,
   * because the client holds nothing from earlier to know either by; a legacy one is left as the
   * handshake versions define it.
   *
   * A modern `server/discover` and `tools/list` must also say how long the answer may be kept and
   * by whom — the specification requires it, and a client that validates the result refuses one
   * without (Claude Code 2.1.292 does, and then has no tools). The list does not change while the
   * app runs, and is the same for whoever asks.
   */
  private wrap(result: { [key: string]: Json }, era: Era, cacheable = false): Json {
    if (era.kind !== "modern") return result;
    return {
      ...result,
      resultType: "complete",
      _meta: { [Meta.serverInfo]: serverInfoJson(this.server.info) },
      ...(cacheable ? { ttlMs: MCPProtocol.listTTLMilliseconds, cacheScope: "public" } : {}),
    };
  }

  // MARK: - Tool calls

  private startCall(id: Json, key: string, params: { [key: string]: Json }, era: Era): void {
    const name = params.name;
    if (typeof name !== "string") throw RPCError.invalidParams("name is required");
    const tool = this.server.tool(name);
    if (tool === undefined) throw RPCError.invalidParams(`Unknown tool: ${name}`);
    let args: { [key: string]: Json };
    const given = params.arguments;
    if (given === undefined || given === null) args = {};
    else if (isObject(given)) args = given;
    else throw RPCError.invalidParams("arguments must be an object");
    if (this.inFlight.has(key)) {
      throw new RPCError(ErrorCode.invalidRequest, "A request with this id is still running");
    }

    const controller = new CancelSource();
    const call = {
      tool: name,
      arguments: new AgentArguments(args, this.server.limits.maxAnswerBytes),
      progress: (progress: number, total?: number, message?: string) =>
        this.reportProgress(key, progress, total, message),
      signal: controller.signal,
    };
    const client = this.clientName;
    const started = Date.now();
    // Started a turn later, so the entry below exists when the tool first reports progress.
    const done = Promise.resolve().then(async (): Promise<void> => {
      let outcome: CallOutcome;
      try {
        outcome = { kind: "answer", answer: await tool.run(call) };
      } catch (error) {
        if (error instanceof AgentCancelled) outcome = { kind: "cancelled" };
        else if (error instanceof AgentToolError)
          outcome = { kind: "toolError", message: error.message };
        else
          outcome = { kind: "toolError", message: `The tool failed: ${(error as Error).message}` };
      }
      this.finishCall(id, key, era, outcome, {
        client,
        tool: name,
        arguments: args,
        durationMilliseconds: Date.now() - started,
      });
    });
    this.inFlight.set(key, {
      controller,
      done,
      progressToken: member(params._meta, Meta.progressToken),
      lastProgress: undefined,
    });
  }

  private finishCall(
    id: Json,
    key: string,
    era: Era,
    outcome: CallOutcome,
    record: {
      readonly client: string | undefined;
      readonly tool: string;
      readonly arguments: Json;
      readonly durationMilliseconds: number;
    }
  ): void {
    const log = (result: AgentCallOutcome, bytes: number) =>
      this.observer({
        id: nextRecordId++,
        client: record.client,
        tool: record.tool,
        arguments: record.arguments,
        durationMilliseconds: record.durationMilliseconds,
        finished: new Date(),
        answerBytes: bytes,
        outcome: result,
      });
    // Gone from the table means the client cancelled it, or went: either way nobody is waiting,
    // and the protocol forbids writing to them about it.
    const wasWaited = this.inFlight.delete(key);
    if (!wasWaited || this.closed) {
      log({ kind: "cancelled" }, 0);
      return;
    }
    let text: string;
    let isError: boolean;
    switch (outcome.kind) {
      case "answer": {
        const answerString = answerText(outcome.answer);
        const size = utf8Length(answerString);
        if (size > this.server.limits.maxAnswerBytes) {
          text =
            `The answer is ${size} bytes, over the ${this.server.limits.maxAnswerBytes}-byte bound, ` +
            "and was not sent. Ask for less: a lower `limit`, a narrower range, " +
            "or one node instead of its parent.";
          isError = true;
          log({ kind: "overBound" }, size);
        } else {
          text = answerString;
          isError = false;
          log({ kind: "answered" }, size);
        }
        break;
      }
      case "toolError":
        text = outcome.message;
        isError = true;
        log({ kind: "toolError", message: outcome.message }, utf8Length(outcome.message));
        break;
      case "cancelled":
        // The tool stopped itself with a cancellation nobody asked for — a bug in the tool, but
        // the client is still owed an answer.
        text = "The call was cancelled before it finished.";
        isError = true;
        log({ kind: "toolError", message: text }, utf8Length(text));
        break;
    }
    this.write(
      RPCMessage.result(id, this.wrap({ content: [{ type: "text", text }], isError }, era))
    );
  }

  private reportProgress(key: string, progress: number, total?: number, message?: string): void {
    const entry = this.inFlight.get(key);
    if (this.closed || entry === undefined || entry.progressToken === undefined) return;
    if (entry.lastProgress !== undefined && progress <= entry.lastProgress) return;
    entry.lastProgress = progress;
    this.write(
      RPCMessage.notification("notifications/progress", {
        progressToken: entry.progressToken,
        progress,
        ...(total === undefined ? {} : { total }),
        ...(message === undefined ? {} : { message }),
      })
    );
  }

  // MARK: - Writing

  private write(message: Json): void {
    if (this.closed) return;
    const bytes = jsonBytes(message);
    const line = new Uint8Array(bytes.length + 1);
    line.set(bytes);
    line[bytes.length] = 0x0a;
    this.send(line);
  }
}

type CallOutcome =
  | { readonly kind: "answer"; readonly answer: AgentAnswer }
  | { readonly kind: "toolError"; readonly message: string }
  | { readonly kind: "cancelled" };
