import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";

/**
 * One JSON value, as it crosses the wire in either direction.
 *
 * A plain TypeScript value rather than a class: an integer is a number with no
 * fraction, and every offset an agent is told fits the 2^53 a number keeps
 * exactly — a dump is a few gigabytes at the most.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.arrayValue
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.boolValue
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.count
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.doubleValue
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.encode
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.init
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.isNull
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.objectValue
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.stringValue
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.uint
 * @upstream-differs a structural type over the language's own values, where upstream has an enum
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** An object member's value: absent members are `undefined` and are left out when written. */
export type JsonMembers = { [key: string]: Json | undefined };

/**
 * The member named `key` of an object; undefined for a missing member and for a
 * value that is not an object at all.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.subscript
 */
export function member(value: Json | undefined, key: string): Json | undefined {
  return isObject(value) ? value[key] : undefined;
}

export const isObject = (value: Json | undefined): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.int64Value */
export function integerValue(value: Json | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && Math.abs(value) < 9.2e15
    ? value
    : undefined;
}

/**
 * An object from members, absent ones left out — what a tool's answer is built with.
 */
export function object(members: JsonMembers): { [key: string]: Json } {
  const result: { [key: string]: Json } = {};
  for (const [key, value] of Object.entries(members)) if (value !== undefined) result[key] = value;
  return result;
}

function write(
  value: Json | undefined,
  out: string[],
  indent: string | undefined,
  depth: number
): void {
  if (value === undefined || value === null) {
    out.push("null");
  } else if (typeof value === "boolean") {
    out.push(value ? "true" : "false");
  } else if (typeof value === "number") {
    // JSON has no NaN and no infinity; a handler that computed one has computed nothing,
    // and null says so without failing the whole answer.
    out.push(Number.isFinite(value) ? String(value) : "null");
  } else if (typeof value === "string") {
    out.push(JSON.stringify(value));
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push("[]");
      return;
    }
    out.push("[");
    value.forEach((one, index) => {
      if (index > 0) out.push(",");
      if (indent !== undefined) out.push(`\n${indent.repeat(depth + 1)}`);
      write(one, out, indent, depth + 1);
    });
    if (indent !== undefined) out.push(`\n${indent.repeat(depth)}`);
    out.push("]");
  } else {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    if (keys.length === 0) {
      out.push("{}");
      return;
    }
    out.push("{");
    keys.forEach((key, index) => {
      if (index > 0) out.push(",");
      if (indent !== undefined) out.push(`\n${indent.repeat(depth + 1)}`);
      out.push(JSON.stringify(key), indent === undefined ? ":" : ": ");
      write(value[key], out, indent, depth + 1);
    });
    if (indent !== undefined) out.push(`\n${indent.repeat(depth)}`);
    out.push("}");
  }
}

/**
 * The value as compact JSON with its keys sorted.
 *
 * Sorted because the same answer must be the same bytes: an agent's client may cache a tool
 * list, and two answers that differ only in the order an object happened to iterate are two
 * answers to compare. Compact because every byte of an answer is read by a model. Never holds
 * a newline — a string's own newlines are escaped — which is what lets one line carry one
 * message.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.jsonText
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.encoded
 */
export function jsonText(value: Json | undefined): string {
  const out: string[] = [];
  write(value, out, undefined, 0);
  return out.join("");
}

/** @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.encoded */
export const jsonBytes = (value: Json | undefined): Uint8Array => encodeUtf8(jsonText(value));

/**
 * The value laid out for a person to read and paste into a file: one member per line,
 * indented, keys sorted. Never sent over the wire — a message is one line.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.prettyText
 */
export function prettyText(value: Json | undefined): string {
  const out: string[] = [];
  write(value, out, "  ", 0);
  return out.join("");
}

/** The length of a string in UTF-8, counted without making the bytes. */
export function utf8Length(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) length += 1;
    else if (code < 0x800) length += 2;
    else if (code >= 0xd800 && code < 0xdc00 && index + 1 < text.length) {
      length += 4;
      index++;
    } else length += 3;
  }
  return length;
}

/** What the value takes on the wire. */
export const jsonByteCount = (value: Json | undefined): number => utf8Length(jsonText(value));

/**
 * Parses one JSON text. Throws on anything that is not exactly one value.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/JSONValue.swift#JSONValue.parse
 */
export function parseJson(data: Uint8Array | string): Json {
  return JSON.parse(typeof data === "string" ? data : decodeUtf8(data)) as Json;
}
