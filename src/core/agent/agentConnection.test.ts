import { describe, expect, it } from "vitest";
import { AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentConnection } from "@/core/agent/agentConnection";
import { type AgentCallRecord, type AgentLimits, AgentServer } from "@/core/agent/agentServer";
import { type AgentTool, agentTool, jsonAnswer, textAnswer } from "@/core/agent/agentTool";
import { isObject, type Json, jsonText, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";

/** Ported from `AgentConnectionTests.swift`: a whole conversation driven as lines. */

/** What the server wrote, one parsed message per line, and the calls the log heard about. */
class Wire {
  readonly messages: Json[] = [];
  readonly calls: AgentCallRecord[] = [];
  malformed = 0;

  send = (data: Uint8Array): void => {
    // Exactly one newline, at the end: the framing every client relies on.
    const text = decodeUtf8(data);
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n")) {
      this.malformed += 1;
      return;
    }
    this.messages.push(parseJson(text.slice(0, -1)));
  };

  record = (record: AgentCallRecord): void => {
    this.calls.push(record);
  };
}

/** Opens when told to; what a slow tool waits on. */
class Gate {
  private open = false;
  private waiters: (() => void)[] = [];

  wait(): Promise<void> {
    if (this.open) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    this.open = true;
    for (const resolve of this.waiters) resolve();
    this.waiters = [];
  }
}

const info = { name: "ByteRipper", version: "1.0" };

const echo: AgentTool = agentTool({
  name: "echo",
  description: "Says back what it is given.",
  inputSchema: AgentSchema.object({ text: AgentSchema.string("What to say.") }, ["text"]),
  run: async (call) => jsonAnswer({ said: call.arguments.string("text") }),
});

function connection(tools: AgentTool[] = [echo], limits: Partial<AgentLimits> = {}) {
  const wire = new Wire();
  const server = new AgentServer({ info, instructions: "Ask about the dump.", tools, limits });
  return { connection: new AgentConnection(server, wire.send, wire.record), wire };
}

async function send(connection: AgentConnection, ...lines: string[]): Promise<void> {
  for (const line of lines) connection.receive(encodeUtf8(`${line}\n`));
  await connection.waitUntilIdle();
}

const modernMeta =
  '"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"test-client","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}';

const result = (message: Json | undefined) => member(message, "result");
const errorOf = (message: Json | undefined) => member(message, "error");

describe("the legacy handshake", () => {
  // The order a handshake-era client opens with: `initialize`, the `initialized` notification,
  // the list, a call. The shape follows the 2025-06-18 schema.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testALegacyClientShakesHandsListsAndCalls
  it("shakes hands, lists and calls", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{"roots":{}},"clientInfo":{"name":"claude-code","version":"2.1.0"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hi"}}}'
    );
    const messages = wire.messages;
    expect(messages.length).toBe(3); // the notification is not answered
    expect(messages[0]).toEqual({
      jsonrpc: "2.0",
      id: 0,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ByteRipper", version: "1.0" },
        instructions: "Ask about the dump.",
      },
    });
    const tools = member(result(messages[1]), "tools") as Json[];
    expect(tools.map((tool) => member(tool, "name"))).toEqual(["echo"]);
    expect(member(member(tools[0], "annotations"), "readOnlyHint")).toBe(true);
    expect(member(member(tools[0], "inputSchema"), "required")).toEqual(["text"]);
    expect(member(result(messages[1]), "resultType")).toBeUndefined(); // a legacy result carries no resultType
    expect(member(result(messages[1]), "ttlMs")).toBeUndefined(); // nor a cache hint
    expect(messages[2]).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { content: [{ type: "text", text: '{"said":"hi"}' }], isError: false },
    });
    expect(wire.malformed).toBe(0);
    expect(c.clientName).toBe("claude-code");
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAnUnknownLegacyVersionIsAnsweredWithTheNewestOne
  it("answers an unknown legacy version with the newest one", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2023-01-01","capabilities":{},"clientInfo":{"name":"old","version":"0"}}}'
    );
    expect(member(result(wire.messages[0]), "protocolVersion")).toBe("2025-11-25");
  });
});

describe("the modern era", () => {
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAModernClientDiscoversListsAndCallsWithoutAHandshake
  it("discovers, lists and calls without a handshake", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      `{"jsonrpc":"2.0","id":"d","method":"server/discover","params":{${modernMeta}}}`,
      `{"jsonrpc":"2.0","id":"l","method":"tools/list","params":{${modernMeta}}}`,
      `{"jsonrpc":"2.0","id":"c","method":"tools/call","params":{"name":"echo","arguments":{"text":"hi"},${modernMeta}}}`
    );
    const messages = wire.messages;
    expect(messages.length).toBe(3);
    const discover = result(messages[0]);
    expect(member(discover, "resultType")).toBe("complete");
    expect(member(discover, "supportedVersions")).toEqual([
      "2026-07-28",
      "2025-11-25",
      "2025-06-18",
      "2025-03-26",
      "2024-11-05",
    ]);
    expect(member(discover, "capabilities")).toEqual({ tools: {} });
    expect(member(discover, "instructions")).toBe("Ask about the dump.");
    expect(
      member(member(member(discover, "_meta"), "io.modelcontextprotocol/serverInfo"), "name")
    ).toBe("ByteRipper");

    expect(member(result(messages[1]), "resultType")).toBe("complete");
    expect((member(result(messages[1]), "tools") as Json[]).length).toBe(1);
    // Required on both: a client that validates refuses the list without them, and is then left
    // with no tools.
    for (const one of [discover, result(messages[1])]) {
      expect(member(one, "ttlMs")).toBe(300_000);
      expect(member(one, "cacheScope")).toBe("public");
    }

    expect(member(messages[2], "id")).toBe("c");
    expect(member(result(messages[2]), "resultType")).toBe("complete");
    expect(member(result(messages[2]), "content")).toEqual([
      { type: "text", text: '{"said":"hi"}' },
    ]);
    expect(wire.calls[0]?.client).toBe("test-client");
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAModernRequestForAnUnknownVersionListsTheOnesSpoken
  it("lists the versions it speaks to a request for an unknown one", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2099-01-01","io.modelcontextprotocol/clientCapabilities":{}}}}'
    );
    expect(member(errorOf(wire.messages[0]), "code")).toBe(-32022);
    expect(member(member(errorOf(wire.messages[0]), "data"), "requested")).toBe("2099-01-01");
    expect((member(member(errorOf(wire.messages[0]), "data"), "supported") as Json[])[0]).toBe(
      "2026-07-28"
    );
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAModernRequestWithoutCapabilitiesIsMalformed
  it("takes a modern request without capabilities for malformed", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'
    );
    expect(member(errorOf(wire.messages[0]), "code")).toBe(-32602);
  });
});

describe("errors", () => {
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAnUnknownToolIsAProtocolErrorAndAToolsOwnFailureIsAnAnswer
  it("makes an unknown tool a protocol error and a tool's own failure an answer", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"nope"}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{}}}'
    );
    const messages = wire.messages;
    expect(member(errorOf(messages[0]), "code")).toBe(-32602);
    expect(member(errorOf(messages[0]), "message")).toBe("Unknown tool: nope");
    expect(result(messages[1])).toEqual({
      content: [{ type: "text", text: "Argument `text` is required." }],
      isError: true,
    });
    expect(wire.calls.map((call) => call.outcome)).toEqual([
      { kind: "toolError", message: "Argument `text` is required." },
    ]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testWhatIsNotARequestIsAnsweredWithTheRightCode
  it("answers what is not a request with the right code", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      "{not json",
      "[1,2]",
      '{"jsonrpc":"2.0","id":1,"method":"resources/list"}',
      '{"jsonrpc":"2.0","id":true,"method":"ping"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":"x"}'
    );
    expect(wire.messages.map((one) => member(errorOf(one), "code"))).toEqual([
      -32700, -32600, -32601, -32600, -32602,
    ]);
    expect(wire.messages.map((one) => member(one, "id"))).toEqual([null, null, 1, null, 2]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAResponseAndANotificationAreNeverAnswered
  it("never answers a response or a notification", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      '{"jsonrpc":"2.0","id":9,"result":{}}',
      '{"jsonrpc":"2.0","method":"notifications/whatever","params":{}}'
    );
    expect(wire.messages).toEqual([]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testPingIsAnswered
  it("answers a ping", async () => {
    const { connection: c, wire } = connection();
    await send(c, '{"jsonrpc":"2.0","id":"p","method":"ping"}');
    expect(wire.messages).toEqual([{ jsonrpc: "2.0", id: "p", result: {} }]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testALineOverTheBoundIsRefusedAndTheConnectionGoesOn
  it("refuses a line over the bound and goes on", async () => {
    const { connection: c, wire } = connection([echo], { maxLineBytes: 64 });
    await send(
      c,
      `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"padding":"${"x".repeat(100)}"}}`,
      '{"jsonrpc":"2.0","id":2,"method":"ping"}'
    );
    expect(wire.messages.map((one) => member(errorOf(one), "code"))).toEqual([-32600, undefined]);
    expect(member(wire.messages.at(-1), "id")).toBe(2);
  });
});

describe("bounds", () => {
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAnAnswerOverTheBoundIsNotSentAndTheModelIsToldWhy
  it("does not send an answer over the bound, and says why", async () => {
    const big = agentTool({
      name: "big",
      description: "Too much.",
      run: async () => textAnswer("a".repeat(2000)),
    });
    const { connection: c, wire } = connection([big], { maxAnswerBytes: 1000 });
    await send(c, '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"big"}}');
    const answered = result(wire.messages[0]);
    expect(member(answered, "isError")).toBe(true);
    const text = member((member(answered, "content") as Json[])[0], "text") as string;
    expect(text.startsWith("The answer is 2000 bytes, over the 1000-byte bound")).toBe(true);
    expect(wire.calls[0]?.outcome).toEqual({ kind: "overBound" });
    expect(wire.calls[0]?.answerBytes).toBe(2000);
  });
});

describe("calls that take time", () => {
  // A slow call does not hold up what comes after it.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAPingIsAnsweredWhileACallIsStillRunning
  it("answers a ping while a call is still running", async () => {
    const gate = new Gate();
    const slow = agentTool({
      name: "slow",
      description: "Waits.",
      run: async () => {
        await gate.wait();
        return textAnswer("done");
      },
    });
    const { connection: c, wire } = connection([slow]);
    c.receive(
      encodeUtf8('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"slow"}}\n')
    );
    c.receive(encodeUtf8('{"jsonrpc":"2.0","id":2,"method":"ping"}\n'));
    expect(wire.messages.map((one) => member(one, "id"))).toEqual([2]);
    gate.release();
    await c.waitUntilIdle();
    expect(wire.messages.map((one) => member(one, "id"))).toEqual([2, 1]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testACancelledCallIsStoppedAndNeverAnswered
  it("stops a cancelled call and never answers it", async () => {
    const started = new Gate();
    const gate = new Gate();
    let sawCancel = false;
    const slow = agentTool({
      name: "slow",
      description: "Waits until cancelled.",
      run: async (call) => {
        started.release();
        await gate.wait();
        sawCancel = call.signal.aborted;
        return textAnswer("too late");
      },
    });
    const { connection: c, wire } = connection([slow]);
    c.receive(
      encodeUtf8('{"jsonrpc":"2.0","id":"s","method":"tools/call","params":{"name":"slow"}}\n')
    );
    await started.wait();
    c.receive(
      encodeUtf8(
        '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"s","reason":"user"}}\n'
      )
    );
    gate.release();
    await c.waitUntilIdle();
    expect(sawCancel).toBe(true);
    expect(wire.messages).toEqual([]);
    expect(wire.calls.map((call) => call.outcome)).toEqual([{ kind: "cancelled" }]);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testACallStillRunningWhenTheClientGoesIsNotAnswered
  it("does not answer a call still running when the client goes", async () => {
    const gate = new Gate();
    const slow = agentTool({
      name: "slow",
      description: "Waits.",
      run: async () => {
        await gate.wait();
        return textAnswer("nobody listening");
      },
    });
    const { connection: c, wire } = connection([slow]);
    c.receive(
      encodeUtf8('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"slow"}}\n')
    );
    c.close();
    gate.release();
    await send(c, '{"jsonrpc":"2.0","id":2,"method":"ping"}');
    for (let turn = 0; turn < 10; turn++) await Promise.resolve();
    expect(wire.messages).toEqual([]);
  });

  // Progress goes out only when asked for, carries the client's token, and never goes backwards.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testProgressIsReportedWithTheTokenAndOnlyForwards
  it("reports progress with the token, and only forwards", async () => {
    const counting = agentTool({
      name: "count",
      description: "Counts.",
      run: async (call) => {
        call.progress(1, 3, "one");
        call.progress(2, 3);
        call.progress(2, 3, "again");
        call.progress(1, 3, "backwards");
        call.progress(3, 3, "done");
        return textAnswer("ok");
      },
    });
    const { connection: c, wire } = connection([counting]);
    await send(
      c,
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"count","_meta":{"progressToken":"t1"}}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"count"}}'
    );
    const progress = wire.messages.filter(
      (one) => member(one, "method") === "notifications/progress"
    );
    expect(progress.map((one) => member(member(one, "params"), "progress"))).toEqual([1, 2, 3]);
    expect(progress.map((one) => member(member(one, "params"), "progressToken"))).toEqual([
      "t1",
      "t1",
      "t1",
    ]);
    expect(member(member(progress[0], "params"), "message")).toBe("one");
    expect(member(member(progress[1], "params"), "message")).toBeUndefined();
    expect(wire.messages.filter((one) => isObject(one) && one.result !== undefined).length).toBe(2);
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentConnectionTests.swift#AgentConnectionTests.testAStringIdAndAnIntegerIdAreTwoRequests
  it("takes a string id and an integer id for two requests", async () => {
    const { connection: c, wire } = connection();
    await send(
      c,
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"text":"a"}}}',
      '{"jsonrpc":"2.0","id":"1","method":"tools/call","params":{"name":"echo","arguments":{"text":"b"}}}'
    );
    expect(new Set(wire.messages.map((one) => jsonText(member(one, "id"))))).toEqual(
      new Set(["1", '"1"'])
    );
  });
});

// Kept so the argument type is used where a tool reads it.
void AgentArguments;
