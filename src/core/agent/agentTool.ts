import type { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, jsonText } from "@/core/agent/json";

/**
 * One thing an agent can ask the app to do: its name, what it says about itself, the arguments
 * it takes, and the code that answers.
 *
 * The name, the description and the schema are read by a model, not by the person at the
 * bench. They stay in English and do not go through the localization lookup (`Design/LOCALIZATION.md`): what a
 * tool is called is an interface, and an interface that changed with the language of the
 * machine it ran on would be two interfaces.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.annotations
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.description
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.inputSchema
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.listing
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.name
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.run
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.title
 */
export interface AgentTool {
  /** Letters, digits, `_`, `-` and `.`, unique within the server. */
  readonly name: string;
  /** What a client may show a person in place of the name. */
  readonly title?: string | undefined;
  /**
   * What the tool does and when to use it — the only thing a model knows about it besides the
   * schema, so it says what comes back as well as what goes in.
   */
  readonly description: string;
  /** A JSON Schema object for the arguments. */
  readonly inputSchema: Json;
  readonly annotations: AgentToolAnnotations;
  readonly run: (call: AgentCall) => Promise<AgentAnswer>;
}

/**
 * What a tool does to the world, as hints a client may use to decide whether to ask the person
 * first. Hints, not guarantees.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.Annotations
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.Annotations.destructive
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.Annotations.edit
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.Annotations.idempotent
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.Annotations.init
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.Annotations.readOnly
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.Annotations.view
 */
export interface AgentToolAnnotations {
  /** Changes nothing: a read, a query. */
  readonly readOnly: boolean;
  /**
   * May change something it cannot take back. An edit here goes onto the undo stack and
   * nothing is saved, so this stays false even for the tools that write.
   */
  readonly destructive: boolean;
  /** Calling it twice with the same arguments does what calling it once did. */
  readonly idempotent: boolean;
}

/** A query: reads, changes nothing, the same answer twice. */
export const READ_ONLY: AgentToolAnnotations = {
  readOnly: true,
  destructive: false,
  idempotent: true,
};
/** Moves the view, selects, marks: changes what is on screen, not the file. */
export const VIEW: AgentToolAnnotations = { readOnly: false, destructive: false, idempotent: true };
/** Writes into an open file, through its undo. */
export const EDIT: AgentToolAnnotations = {
  readOnly: false,
  destructive: false,
  idempotent: false,
};

/** @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.init */
export function agentTool(
  tool: Pick<AgentTool, "name" | "description" | "run"> & Partial<AgentTool>
): AgentTool {
  return {
    title: undefined,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
    ...tool,
  };
}

/** The tool as `tools/list` describes it. */
export function toolListing(tool: AgentTool): Json {
  return {
    name: tool.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: tool.annotations.readOnly,
      destructiveHint: tool.annotations.destructive,
      idempotentHint: tool.annotations.idempotent,
      // Every tool here works on the app and the files on this machine.
      openWorldHint: false,
    },
  };
}

/**
 * What a tool's code is handed: the arguments, the way to say how far it has got, and the
 * signal that says the client withdrew the call.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentCall
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentCall.arguments
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentCall.init
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentCall.progress
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentCall.tool
 */
export interface AgentCall {
  readonly tool: string;
  readonly arguments: AgentArguments;
  /**
   * Reports progress on a long call, when the client asked for it; does nothing otherwise.
   * `progress` must grow from one report to the next and a report that does not is dropped, as
   * the protocol requires.
   */
  readonly progress: (progress: number, total?: number, message?: string) => void;
  /** Aborted when the client cancels the call or goes; a long tool checks it between steps. */
  readonly signal: CancelSignal;
}

/**
 * What a tool reads to know its call was withdrawn. A structural type of its own: `AbortSignal`
 * is a DOM global, which `src/core` may not reach (D1).
 *
 * @web-only upstream has Swift's task cancellation
 */
export interface CancelSignal {
  readonly aborted: boolean;
}

/** The side that cancels: held by the connection, its signal handed to the tool. */
export class CancelSource implements CancelSignal {
  aborted = false;

  get signal(): CancelSignal {
    return this;
  }

  cancel(): void {
    this.aborted = true;
  }
}

/** Thrown by a tool that noticed its call was cancelled. */
export class AgentCancelled extends Error {
  constructor() {
    super("The call was cancelled.");
    this.name = "AgentCancelled";
  }
}

/** Stops a long tool between two steps when its call has been cancelled. */
export function throwIfCancelled(signal: CancelSignal): void {
  if (signal.aborted) throw new AgentCancelled();
}

/**
 * What a tool answers with: data, sent as compact JSON text — what almost every tool returns —
 * or a sentence, for a tool whose answer is one.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentAnswer
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentAnswer.text
 */
export type AgentAnswer =
  | { readonly kind: "json"; readonly value: Json }
  | { readonly kind: "text"; readonly text: string };

export const jsonAnswer = (value: Json): AgentAnswer => ({ kind: "json", value });
export const textAnswer = (text: string): AgentAnswer => ({ kind: "text", text });

export const answerText = (answer: AgentAnswer): string =>
  answer.kind === "json" ? jsonText(answer.value) : answer.text;

/**
 * A call that could not be answered for a reason the agent can act on: a missing argument, an
 * offset past the end, a panel that is not open.
 *
 * Sent as a tool result marked as an error, not as a protocol failure, so the model reads the
 * message and tries again differently — which is the whole difference the protocol draws
 * between the two.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentToolError
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentToolError.init
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentToolError.message
 */
export class AgentToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentToolError";
  }
}
