import type { Json } from "@/core/agent/json";

/**
 * Bytes as every tool that reads them shows them — `read`, and a node's bytes read out of the
 * buffer a compressed section opened to — so the two answers look alike: rows as the dump
 * draws them, text, or integers.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentBytes.swift#AgentBytes
 */

/** The formats a read takes. @upstream Packages/AgentKit/Sources/AgentKit/AgentBytes.swift#AgentBytes.formats */
export const AGENT_FORMATS = ["hex", "ascii", "utf16le", "u8", "u16", "u32", "u64"] as const;
export type AgentFormat = (typeof AGENT_FORMATS)[number];

const upper = (value: number, width: number) =>
  value.toString(16).toUpperCase().padStart(width, "0");

/** The answer's members for `bytes` read at `address`, in `format`. */
export function shownBytes(
  bytes: Uint8Array,
  address: number,
  format: AgentFormat,
  bigEndian: boolean
): { [key: string]: Json } {
  const answer: { [key: string]: Json } = { format };
  switch (format) {
    case "hex":
      answer.rows = hexRows(bytes, address);
      break;
    case "ascii":
      answer.text = printable(bytes);
      break;
    case "utf16le":
      answer.text = utf16leText(bytes);
      break;
    default: {
      const width = { u8: 1, u16: 2, u32: 4, u64: 8 }[format];
      answer.values = integers(bytes, width, bigEndian);
      if (width > 1) answer.endian = bigEndian ? "big" : "little";
    }
  }
  return answer;
}

/** @upstream Packages/AgentKit/Sources/AgentKit/AgentBytes.swift#AgentBytes.printable */
export function printable(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
  return text;
}

/** @upstream Packages/AgentKit/Sources/AgentKit/AgentBytes.swift#AgentBytes.utf16le */
export function utf16leText(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    text += String.fromCharCode((bytes[index] ?? 0) | ((bytes[index + 1] ?? 0) << 8));
  }
  return text;
}

/**
 * Rows as the dump draws them — address, sixteen bytes, their text — counted from `address`
 * rather than from a row boundary, so the first row starts with the byte asked for.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentBytes.swift#AgentBytes.hexRows
 */
export function hexRows(bytes: Uint8Array, address: number): string[] {
  const rows: string[] = [];
  for (let start = 0; start < bytes.length; start += 16) {
    const row = bytes.subarray(start, Math.min(start + 16, bytes.length));
    const hex = [...row].map((byte) => upper(byte, 2)).join(" ");
    rows.push(`${upper(address + start, 8)}  ${hex.padEnd(16 * 3 - 1, " ")}  |${printable(row)}|`);
  }
  return rows;
}

/** @upstream Packages/AgentKit/Sources/AgentKit/AgentBytes.swift#AgentBytes.integers */
export function integers(bytes: Uint8Array, width: number, bigEndian: boolean): string[] {
  const values: string[] = [];
  for (let start = 0; start + width <= bytes.length; start += width) {
    let value = 0n;
    for (let index = 0; index < width; index++) {
      const byte = bytes[start + (bigEndian ? index : width - 1 - index)] ?? 0;
      value = (value << 8n) | BigInt(byte);
    }
    values.push(
      `0x${value
        .toString(16)
        .toUpperCase()
        .padStart(width * 2, "0")}`
    );
  }
  return values;
}

/** Bytes as hex pairs, `DE AD BE EF`. @upstream Packages/AgentKit/Sources/AgentKit/AgentBytes.swift#AgentBytes.hexText */
export const hexText = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => upper(byte, 2)).join(" ");
