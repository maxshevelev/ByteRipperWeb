import type { AgentArguments } from "@/core/agent/agentArguments";
import { isObject, type Json, jsonText } from "@/core/agent/json";

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

/**
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.init
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.refuseUnknownArguments
 */
export function agentTool(
  tool: Pick<AgentTool, "name" | "description" | "run"> & Partial<AgentTool>
): AgentTool {
  const inputSchema: Json = tool.inputSchema ?? {
    type: "object",
    properties: {},
    additionalProperties: false,
  };
  const run = tool.run;
  return {
    title: undefined,
    annotations: READ_ONLY,
    ...tool,
    inputSchema,
    // Every way in — a client's call, `survey` asking on a model's behalf — meets the same
    // check, so an argument the tool does not take is a refusal and never a call that silently
    // did something else.
    run: (call) => {
      refuseUnknownArguments(call.arguments, tool.name, inputSchema);
      return run(call);
    },
  };
}

/**
 * Throws when `args` names an argument the schema does not.
 *
 * The schema says `additionalProperties: false`, but a client may not hold a model to it: one
 * that drops what it does not know sends the call on without it, and the tool answers as if
 * the argument had never been given — `open_part` with `decoded: true` opened the block still
 * encoded, and the answer looked like success. The refusal names what the tool does take and,
 * when it can tell, what was meant.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.refuseUnknownArguments
 */
export function refuseUnknownArguments(args: AgentArguments, tool: string, schema: Json): void {
  const properties = schemaProperties(schema);
  const unknown = Object.keys(args.values)
    .filter((key) => !Object.hasOwn(properties, key))
    .sort(compareStrings);
  const first = unknown[0];
  if (first === undefined) return;
  const names = unknown.map((name) => `\`${name}\``).join(", ");
  let message = `\`${tool}\` takes no argument ${names}.`;
  const meant = meaning(first, properties);
  if (meant !== undefined) message += ` Perhaps ${meant}.`;
  const taken = Object.keys(properties).sort(compareStrings);
  message += taken.length === 0 ? " It takes no arguments." : ` It takes: ${taken.join(", ")}.`;
  throw new AgentToolError(message);
}

const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function schemaProperties(schema: Json): { readonly [key: string]: Json } {
  const properties = isObject(schema) ? schema.properties : undefined;
  return isObject(properties) ? properties : {};
}

/**
 * What a model most likely meant by an argument the tool does not take: a value of one it does
 * (`decoded` for `part: "decoded"`), or one whose name is a slip away from it.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentTool.swift#AgentTool.meaning
 */
export function meaning(
  name: string,
  properties: { readonly [key: string]: Json }
): string | undefined {
  const lower = name.toLowerCase();
  const keys = Object.keys(properties).sort(compareStrings);
  for (const key of keys) {
    const property = properties[key];
    const options = isObject(property) && Array.isArray(property.enum) ? property.enum : [];
    const choice = options.find((c) => typeof c === "string" && c.toLowerCase() === lower);
    if (typeof choice === "string") return `\`${key}: "${choice}"\``;
  }
  const bound = Math.max(1, Math.min(2, Math.floor([...name].length / 3)));
  let best: { key: string; distance: number } | undefined;
  for (const key of keys) {
    const distance = editDistance(lower, key.toLowerCase());
    if (distance > bound) continue;
    if (best === undefined || distance < best.distance) best = { key, distance };
  }
  return best === undefined ? undefined : `\`${best.key}\``;
}

function editDistance(first: string, second: string): number {
  const a = [...first];
  const b = [...second];
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0] as number;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j] as number;
      row[j] =
        a[i - 1] === b[j - 1] ? previous : 1 + Math.min(previous, kept, row[j - 1] as number);
      previous = kept;
    }
  }
  return row[b.length] as number;
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
