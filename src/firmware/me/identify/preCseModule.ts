import { has, tag, u16, u32 } from "@/firmware/me/bytes";
import type {
  MCPHeader,
  MMEModule,
  MMEModuleDirectory,
} from "@/firmware/me/models/firmwareAnalysis";

/**
 * The classic ME 2–10 `$MME` module directory — the rows after an R0 manifest
 * that inventory its engine modules — and the `$MCP` that follows it where there
 * is one. Upstream walks these rows only for its region-size arithmetic and
 * prints no table, so the directory is surfaced as it stands.
 *
 * - the list starts at the manifest base plus its header length plus 0xC;
 * - `$MN2` (ME 6–10) rows are the new header, 0x60 each; `$MAN` (ME 2–5) rows the
 *   old one, 0x50 each;
 * - rows are read until the declared count or a row whose tag is not `$MME`;
 * - `$MCP` sits one padding row past the declared directory, after `$MN2` only.
 *
 * Module content offsets are recorded as stored and never resolved: upstream
 * makes no uniqueness promise for them, and several rows routinely share one.
 *
 * Ported from `Packages/MEFirmware/Identify/PreCSEModule.swift`.
 */

export function decodeMmeDirectory(options: {
  readonly bytes: Uint8Array;
  readonly manifestBase: number;
  readonly headerLengthBytes: number;
  readonly manifestTag: string;
  readonly declaredModules: number;
  readonly baseOffset?: number;
}): MMEModuleDirectory | undefined {
  const { bytes, manifestBase, headerLengthBytes, manifestTag, declaredModules } = options;
  const baseOffset = options.baseOffset ?? 0;
  if (declaredModules <= 0) return undefined;
  const isNew = manifestTag === "$MN2";
  const stride = isNew ? 0x60 : 0x50;
  const head = manifestBase + headerLengthBytes + 0xc;
  if (head < 0 || head + stride > bytes.length) return undefined;

  const modules: MMEModule[] = [];
  for (let cursor = head; modules.length < declaredModules; cursor += stride) {
    if (cursor + stride > bytes.length || tag(bytes, cursor) !== "$MME") break;
    modules.push(isNew ? newRow(bytes, cursor) : oldRow(bytes, cursor));
  }
  if (modules.length === 0) return undefined;

  let mcp: MCPHeader | undefined;
  if (isNew) {
    const base = head + declaredModules * stride + stride;
    if (base + 0x34 <= bytes.length && tag(bytes, base) === "$MCP") {
      mcp = {
        offset: baseOffset + base,
        headerSize: u32(bytes, base + 0x04),
        codeSize: u32(bytes, base + 0x08),
        offsetCodeMN2: u32(bytes, base + 0x0c),
        offsetPartFPT: u32(bytes, base + 0x10),
        hashHex: hexOf(bytes, base + 0x14, 0x20),
      };
    }
  }
  return {
    offset: baseOffset + head,
    manifestTag,
    declaredModules,
    modules,
    mcp,
  };
}

/** `MME_Header_New`, 0x60. */
function newRow(bytes: Uint8Array, at: number): MMEModule {
  return {
    name: asciiName(bytes, at + 0x04, 16),
    hashHex: hexOf(bytes, at + 0x14, 0x20),
    guidHex: undefined,
    modBase: u32(bytes, at + 0x34),
    offsetMN2: u32(bytes, at + 0x38),
    sizeUncompressed: u32(bytes, at + 0x3c),
    sizeCompressed: u32(bytes, at + 0x40),
    memorySize: u32(bytes, at + 0x44),
    preUmaSize: u32(bytes, at + 0x48),
    entryPoint: u32(bytes, at + 0x4c),
    flags: u32(bytes, at + 0x50),
    majorVersion: undefined,
    minorVersion: undefined,
    hotfixVersion: undefined,
    buildVersion: undefined,
    size: undefined,
  };
}

/** `MME_Header_Old`, 0x50. */
function oldRow(bytes: Uint8Array, at: number): MMEModule {
  return {
    name: asciiName(bytes, at + 0x1c, 16),
    hashHex: hexOf(bytes, at + 0x2c, 0x14),
    guidHex: hexOf(bytes, at + 0x04, 0x10),
    modBase: undefined,
    offsetMN2: undefined,
    sizeUncompressed: undefined,
    sizeCompressed: undefined,
    memorySize: undefined,
    preUmaSize: undefined,
    entryPoint: undefined,
    flags: u32(bytes, at + 0x44),
    majorVersion: u16(bytes, at + 0x14),
    minorVersion: u16(bytes, at + 0x16),
    hotfixVersion: u16(bytes, at + 0x18),
    buildVersion: u16(bytes, at + 0x1a),
    size: u32(bytes, at + 0x40),
  };
}

function hexOf(bytes: Uint8Array, at: number, count: number): string {
  if (!has(bytes, at, count)) return "";
  let text = "";
  for (let index = at; index < at + count; index++) {
    text += (bytes[index] ?? 0).toString(16).toUpperCase().padStart(2, "0");
  }
  return text;
}

/** The name with every NUL dropped, as upstream filters them. */
function asciiName(bytes: Uint8Array, at: number, count: number): string {
  let text = "";
  for (let index = at; index < at + count; index++) {
    const byte = bytes[index] ?? 0;
    if (byte !== 0) text += String.fromCharCode(byte);
  }
  return text;
}
