import { type MaskedPattern, maskedPattern, parseHexPattern } from "@/core/search/maskedSearch";

/**
 * One way of reading what the Contents search's field asks for, and what it is called once it has
 * found something.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolPatternQuery.swift#ToolPatternAttempt
 */
export interface ContentAttempt {
  readonly pattern: MaskedPattern;
  readonly encoding: "hex" | "ascii" | "utf16LE";
}

/**
 * What the field asks for, in the order to look: hex bytes where the text reads as them, then the
 * text as ASCII and as UTF-16 LE, any case — the first that finds anything is the answer, as in the
 * dump's Smart Search. Nothing for an empty field.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.contentAttempts
 * @upstream-differs the field's own reading, which upstream keeps for a host without the Find
 * bar's pattern controls
 */
export function contentAttempts(field: string): ContentAttempt[] | undefined {
  const text = field.trim();
  if (text.length === 0) return undefined;
  const attempts: ContentAttempt[] = [];
  const hexLike = text.split(" ").every((word) => word.length === 2 || word.length % 2 === 0);
  if (hexLike) {
    try {
      attempts.push({ pattern: parseHexPattern(text), encoding: "hex" });
    } catch {
      // Not bytes: read as text below.
    }
  }
  const codes = [...text].map((one) => one.codePointAt(0) ?? 0x3f);
  if (codes.every((code) => code <= 0x7f)) {
    attempts.push({
      pattern: maskedPattern(codes, { folding: { kind: "asciiBytes" } }),
      encoding: "ascii",
    });
  }
  const units: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    units.push(unit & 0xff, unit >> 8);
  }
  attempts.push({
    pattern: maskedPattern(units, { folding: { kind: "utf16", littleEndian: true } }),
    encoding: "utf16LE",
  });
  return attempts;
}
