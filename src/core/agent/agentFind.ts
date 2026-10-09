import type { AgentArguments } from "@/core/agent/agentArguments";
import { hexText, printable, utf16leText } from "@/core/agent/agentBytes";
import { AgentToolError } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import {
  type MaskedPattern,
  MaskedPatternError,
  maskedPattern,
  parseHexPattern,
} from "@/core/search/maskedSearch";
import type { CaseFolding } from "@/core/search/searchPattern";

/**
 * What `find_bytes` looks for: a text as ASCII, as UTF-16LE or both, or a hex pattern with holes,
 * and what a match says of itself.
 *
 * The search is the find bar's own engine, so an agent and a person find the same; it is given holes
 * in a hex pattern and, when asked, matches that overlap.
 *
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.Wanted
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.patterns
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.maxContext
 */

/** The most bytes a preview takes on either side of a match. @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.maxContext */
export const MAX_CONTEXT = 64;

export type FindEncoding = "hex" | "ascii" | "utf16le";

/** One pattern the search runs, and what its matches are called. */
export interface WantedPattern {
  readonly pattern: MaskedPattern;
  readonly encoding: FindEncoding;
}

/** @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.patterns */
export function wantedPatterns(args: AgentArguments): WantedPattern[] {
  const text = args.optionalString("text");
  const hex = args.optionalString("hex");
  if ((text === undefined) === (hex === undefined)) {
    throw new AgentToolError("Give `text` or `hex`, one of them.");
  }
  if (hex !== undefined) {
    try {
      return [{ pattern: parseHexPattern(hex), encoding: "hex" }];
    } catch (error) {
      if (!(error instanceof MaskedPatternError)) throw error;
      throw new AgentToolError(
        "`hex` is not a byte pattern. Give pairs of hex digits and `??` for any byte, " +
          'e.g. "24 ?? 4D 49"; a pattern of `??` alone matches everywhere.'
      );
    }
  }
  if (text === undefined || text === "") throw new AgentToolError("`text` is empty.");
  const encoding = args.choice("encoding", ["ascii", "utf16le", "both"] as const, "both");
  const ignoreCase = args.bool("ignore_case", false);
  const wanted: WantedPattern[] = [];
  if (encoding !== "utf16le") {
    const codes = [...text].map((one) => one.codePointAt(0) ?? 0x3f);
    if (codes.some((one) => one > 0x7f)) {
      throw new AgentToolError('`text` is not ASCII; look for it with `encoding` "utf16le".');
    }
    wanted.push({
      pattern: maskedPattern(codes, {
        folding: ignoreCase ? { kind: "asciiBytes" } : { kind: "exact" },
      }),
      encoding: "ascii",
    });
  }
  if (encoding !== "ascii") {
    const units: number[] = [];
    for (let index = 0; index < text.length; index++) {
      const unit = text.charCodeAt(index);
      units.push(unit & 0xff, unit >> 8);
    }
    wanted.push({
      pattern: maskedPattern(units, {
        folding: ignoreCase ? { kind: "utf16", littleEndian: true } : { kind: "exact" },
      }),
      encoding: "utf16le",
    });
  }
  return wanted;
}

/** A pattern as it crosses to the worker that holds a node's bytes. */
export interface WirePattern {
  readonly bytes: readonly number[];
  readonly wild: readonly boolean[];
  readonly folding: "exact" | "asciiBytes" | "utf16le";
  readonly encoding: FindEncoding;
}

export function toWire(wanted: WantedPattern): WirePattern {
  const folding = wanted.pattern.folding;
  return {
    bytes: [...wanted.pattern.bytes],
    wild: [...wanted.pattern.isWild],
    folding: folding.kind === "utf16" ? "utf16le" : folding.kind,
    encoding: wanted.encoding,
  };
}

export function fromWire(wire: WirePattern): WantedPattern {
  const folding: CaseFolding =
    wire.folding === "utf16le"
      ? { kind: "utf16", littleEndian: true }
      : wire.folding === "asciiBytes"
        ? { kind: "asciiBytes" }
        : { kind: "exact" };
  return {
    pattern: maskedPattern(wire.bytes, { isWild: wire.wild, folding }),
    encoding: wire.encoding,
  };
}

/** What a match's `preview` says: the bytes around it. @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.find */
export function previewJson(bytes: Uint8Array, encoding: FindEncoding, before: number): Json {
  return {
    hex: hexText(bytes),
    text: encoding === "utf16le" ? utf16leText(bytes) : printable(bytes),
    before,
  };
}

/** The `context` argument, clamped. */
export function contextArgument(args: AgentArguments): number {
  return args.has("context") ? Math.max(0, Math.min(MAX_CONTEXT, args.integer("context"))) : 0;
}
