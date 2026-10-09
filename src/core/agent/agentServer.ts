import type { AgentTool } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import type { AgentServerInfo } from "@/core/agent/mcpProtocol";

/**
 * What a connection serves: who the server is, what it tells a model about itself, the tools,
 * and the bounds on what goes over the wire.
 *
 * A value, shared by every connection. The list of tools does not change while the app runs —
 * a panel that is closed does not take its tools away, it makes them answer that the panel is
 * closed — so the server never has to tell a client that its list went stale, and says so:
 * `listChanged` is false.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.info
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.instructions
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.limits
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.tool
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.tools
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.Limits.init
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.Limits.maxAnswerBytes
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.Limits.maxLineBytes
 */
export interface AgentLimits {
  /**
   * The longest line read from a client. A request is a few hundred bytes; this is room for a
   * large write and no more.
   */
  readonly maxLineBytes: number;
  /**
   * The longest answer a tool may give. Every byte of it lands in a model's context, and one
   * answer that fills the context costs more than the server saves — so an answer over this
   * is not sent, and the model is told to ask for less.
   */
  readonly maxAnswerBytes: number;
}

/** @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.Limits */
export const DEFAULT_LIMITS: AgentLimits = { maxLineBytes: 4 << 20, maxAnswerBytes: 24 << 10 };

export class AgentServer {
  readonly info: AgentServerInfo;
  /** Guidance for the model on how to use the tools together; sent in `initialize` and `server/discover`. */
  readonly instructions: string | undefined;
  readonly tools: readonly AgentTool[];
  readonly limits: AgentLimits;
  private readonly byName = new Map<string, AgentTool>();

  /** @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentServer.init */
  constructor(options: {
    readonly info: AgentServerInfo;
    readonly instructions?: string | undefined;
    readonly tools: readonly AgentTool[];
    readonly limits?: Partial<AgentLimits> | undefined;
  }) {
    this.info = options.info;
    this.instructions = options.instructions;
    this.tools = options.tools;
    this.limits = { ...DEFAULT_LIMITS, ...options.limits };
    // Two tools with one name is a mistake in the code that built the list; the first one wins
    // and the second is never reachable, which a test of the list will show.
    for (const tool of options.tools)
      if (!this.byName.has(tool.name)) this.byName.set(tool.name, tool);
  }

  tool(name: string): AgentTool | undefined {
    return this.byName.get(name);
  }
}

/**
 * One call, as the Agent window's log shows it.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.answerBytes
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.arguments
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.client
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.duration
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.finished
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.id
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.outcome
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.tool
 */
export interface AgentCallRecord {
  /** Which call this is, so a list that drops its oldest rows can still find the one a reader selected. */
  readonly id: number;
  /** The client's own name for itself, when it gave one. */
  readonly client: string | undefined;
  readonly tool: string;
  readonly arguments: Json;
  readonly durationMilliseconds: number;
  /** When the call ended, by this machine's clock. */
  readonly finished: Date;
  /** The size of the answer as the tool produced it, sent or not. */
  readonly answerBytes: number;
  readonly outcome: AgentCallOutcome;
}

/** @upstream Packages/AgentKit/Sources/AgentKit/AgentServer.swift#AgentCallRecord.Outcome */
export type AgentCallOutcome =
  | { readonly kind: "answered" }
  /** The tool said why it could not answer; the message went to the model. */
  | { readonly kind: "toolError"; readonly message: string }
  /** The answer was over `maxAnswerBytes` and was not sent. */
  | { readonly kind: "overBound" }
  /** The client withdrew the request; nothing was sent. */
  | { readonly kind: "cancelled" };
