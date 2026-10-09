import { AgentToolError } from "@/core/agent/agentTool";
import { integerValue, isObject, type Json } from "@/core/agent/json";

/**
 * The most an answer to a call may be, in bytes, when nothing says otherwise — the server's
 * bound (`AgentServer.Limits.maxAnswerBytes`).
 */
export const DEFAULT_ANSWER_BOUND = 24 << 10;

/**
 * A tool's arguments, read the way every tool reads them.
 *
 * Each reader throws an `AgentToolError` that names the argument and says what was expected, so
 * a handler is a list of reads and never a ladder of `if`s with a message apiece that drift
 * apart.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.bool
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.choice
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.has
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.integer
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.optionalOffset
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.optionalString
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.string
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.strings
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.subscript
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.values
 */
export class AgentArguments {
  /**
   * The most an answer to this call may be, in bytes, so a list can stop short of it
   * (`AgentPage`) instead of being refused whole. Not an argument the agent gives: the
   * connection sets it.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.answerBound
   */
  answerBound: number;
  readonly values: { readonly [key: string]: Json };

  /** @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.init */
  constructor(values: { readonly [key: string]: Json } = {}, answerBound = DEFAULT_ANSWER_BOUND) {
    this.values = values;
    this.answerBound = answerBound;
  }

  /** The argument as given; a null is an absent one. */
  get(name: string): Json | undefined {
    const value = this.values[name];
    return value === undefined || value === null ? undefined : value;
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  // MARK: Strings

  string(name: string): string {
    const value = this.get(name);
    if (value === undefined) throw missing(name);
    if (typeof value !== "string") throw wrong(name, "a string");
    return value;
  }

  optionalString(name: string): string | undefined {
    return this.has(name) ? this.string(name) : undefined;
  }

  /** One of a fixed set of words. */
  choice<T extends string>(name: string, choices: readonly T[], fallback?: T): T {
    if (!this.has(name)) {
      if (fallback !== undefined) return fallback;
      throw missing(name);
    }
    const word = this.string(name);
    if (!(choices as readonly string[]).includes(word)) {
      throw new AgentToolError(
        `Argument \`${name}\`: expected one of ${choices.join(", ")}, got "${word}".`
      );
    }
    return word as T;
  }

  /** A list of strings; empty when the argument was not given. */
  strings(name: string): string[] {
    const value = this.get(name);
    if (value === undefined) return [];
    if (!Array.isArray(value) || !value.every((one) => typeof one === "string")) {
      throw wrong(name, "a list of strings");
    }
    return value as string[];
  }

  // MARK: Numbers

  integer(name: string): number {
    const value = this.get(name);
    if (value === undefined) throw missing(name);
    const number = integerValue(value);
    if (number === undefined) throw wrong(name, "an integer");
    return number;
  }

  bool(name: string, fallback: boolean): boolean {
    const value = this.get(name);
    if (value === undefined) return fallback;
    if (typeof value !== "boolean") throw wrong(name, "true or false");
    return value;
  }

  /**
   * An address or a length in the file.
   *
   * Taken as an integer, or as a string in hex (`"0x7F3000"`) or decimal — a model reads
   * addresses in hex from every tool, the panel and the dump itself, and would otherwise have
   * to convert each one to decimal before handing it back, which is where a digit goes
   * missing.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.offset
   */
  offset(name: string): number {
    const value = this.get(name);
    if (value === undefined) throw missing(name);
    const number = integerValue(value);
    if (number !== undefined) {
      if (number < 0) throw new AgentToolError(`Argument \`${name}\`: must not be negative.`);
      return number;
    }
    if (typeof value === "string") {
      const parsed = parseOffset(value);
      if (parsed !== undefined) return parsed;
    }
    throw wrong(name, 'an integer, or a string such as "0x7F3000"');
  }

  optionalOffset(name: string): number | undefined {
    return this.has(name) ? this.offset(name) : undefined;
  }

  /**
   * How many items a list may return: the argument, clamped to `1...maximum`, or `fallback`
   * when it was not given.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.limit
   */
  limit(fallback: number, maximum: number, name = "limit"): number {
    if (!this.has(name)) return Math.min(fallback, maximum);
    return Math.max(1, Math.min(maximum, this.integer(name)));
  }

  /** The arguments as an object, for a log. */
  json(): Json {
    return { ...this.values };
  }
}

/** @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentArguments.parseOffset */
export function parseOffset(text: string): number | undefined {
  const lower = text.trim().replaceAll("_", "").toLowerCase();
  if (/^0x[0-9a-f]+$/.test(lower)) return Number.parseInt(lower.slice(2), 16);
  if (/^[0-9]+$/.test(lower)) return Number.parseInt(lower, 10);
  return undefined;
}

const missing = (name: string) => new AgentToolError(`Argument \`${name}\` is required.`);
const wrong = (name: string, expected: string) =>
  new AgentToolError(`Argument \`${name}\`: expected ${expected}.`);

/**
 * The few shapes of JSON Schema the tools here are described with.
 *
 * Enough to say what an argument is and what it means; validation is the readers' in
 * `AgentArguments`, which give a model a sentence it can act on rather than a schema path.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.after
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.boolean
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.choice
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.integer
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.limit
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.object
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.offset
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.string
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentArguments.swift#AgentSchema.strings
 */
export const AgentSchema = {
  /** An object with the given properties, and no others. */
  object(properties: { [key: string]: Json }, required: string[] = []): Json {
    return {
      type: "object",
      properties,
      additionalProperties: false,
      ...(required.length > 0 ? { required } : {}),
    };
  },
  string: (description: string): Json => ({ type: "string", description }),
  choice: (choices: readonly string[], description: string): Json => ({
    type: "string",
    enum: [...choices],
    description,
  }),
  strings: (description: string): Json => ({
    type: "array",
    items: { type: "string" },
    description,
  }),
  integer: (description: string): Json => ({ type: "integer", description }),
  boolean: (description: string): Json => ({ type: "boolean", description }),
  /** An address or a length: an integer, or a string in hex or decimal (`AgentArguments.offset`). */
  offset: (description: string): Json => ({ type: ["integer", "string"], description }),
  /** The `limit` every list takes. */
  limit: (fallback: number, maximum: number): Json => ({
    type: "integer",
    minimum: 1,
    maximum,
    description:
      "The most items one page holds — a ceiling: a page stops sooner when the answer would pass " +
      `the size bound, and says so with \`truncated: "size"\`. Default ${fallback}, at most ${maximum}.`,
  }),
  /** The `after` every paged list takes. */
  get after(): Json {
    return AgentSchema.string("The `next` of the page before, to go on from where it stopped.");
  },
};

export { isObject };
