/**
 * What a firmware panel says about one row besides its text
 * (`Design/ROW_MARKS.md`): a value, decided in a tool-module's pure code and
 * handed to the panel to draw.
 *
 * One vocabulary for every panel, because a reader moves between the UEFI
 * tree, the FIT table and the ME tree on the same image, and a rose row has to
 * mean the same thing in each.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks
 */

/**
 * Background: what an edit to the row's bytes breaks.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Protection
 */
export type RowProtection = "ibb" | "firmware";

/**
 * The row's problems, as one icon: an error when any of them is one, a caution
 * otherwise. Every line is in the icon's tooltip.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Problem
 */
export interface RowProblem {
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Problem.isError */
  readonly isError: boolean;
  /**
   * The lines the pointer reads, errors first.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Problem.lines
   */
  readonly lines: readonly string[];
}

/**
 * A badge: what the row is to the others.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Role
 */
export type RowRole =
  /**
   * Holds compressed data — `decoded` when this project opens it.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Role.compressed
   */
  | {
      readonly kind: "compressed";
      readonly algorithm: string;
      readonly decoded: boolean;
    }
  /**
   * Holds what other structures are checked against: protected ranges, or the
   * hashes of other structures. The words say which.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Role.holdsChecks
   */
  | { readonly kind: "holdsChecks"; readonly words: string }
  /**
   * Partly covered by protected ranges.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Role.partlyProtected
   */
  | { readonly kind: "partlyProtected" };

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks */
export interface ToolRowMarks {
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.protection */
  readonly protection?: RowProtection | undefined;
  /**
   * Where the row's bytes were decompressed from, in the words the tooltip
   * uses — nothing for bytes of the file. A value here draws the rail.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.decompressedFrom
   */
  readonly decompressedFrom?: string | undefined;
  /**
   * The row is the compressed data, open on the decompressed rows under it:
   * its bytes are the file's, and it starts their rail, so the rail ties the
   * subtree to its parent. A panel sets it only while the row is open.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.opensDecompressed
   */
  readonly opensDecompressed?: boolean | undefined;
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.problem */
  readonly problem?: RowProblem | undefined;
  /**
   * At most two are drawn, in this order.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.roles
   */
  readonly roles?: readonly RowRole[] | undefined;
}

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.none */
export const NO_ROW_MARKS: ToolRowMarks = {};

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.roles */
export const rowRoles = (marks: ToolRowMarks): readonly RowRole[] => marks.roles ?? [];

/**
 * Whether the row wears the rail.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.hasRail
 */
export const hasRail = (marks: ToolRowMarks): boolean =>
  marks.decompressedFrom !== undefined || marks.opensDecompressed === true;

/**
 * The row's background and rail in words, for the row's tooltip — so that
 * nothing a row says is said by colour alone. Nothing when it wears neither.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.summary
 */
export function rowMarksSummary(marks: ToolRowMarks): string | undefined {
  const parts: string[] = [];
  switch (marks.protection) {
    case "ibb":
      parts.push("Inside the Boot Guard IBB");
      break;
    case "firmware":
      parts.push("Inside a range the firmware checks at boot");
      break;
    default:
      break;
  }
  if (marks.decompressedFrom !== undefined) parts.push(marks.decompressedFrom);
  if (marks.opensDecompressed === true) {
    parts.push("Compressed: what it holds is listed under it, decompressed");
  }
  return parts.length === 0 ? undefined : parts.join(" · ");
}

/**
 * The worst of what a row has: nothing when it has nothing, errors first in
 * the tooltip when it has both.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMarks.Problem.worst
 */
export function worstProblem(
  errors: readonly string[],
  cautions: readonly string[]
): RowProblem | undefined {
  if (errors.length > 0) return { isError: true, lines: [...errors, ...cautions] };
  if (cautions.length > 0) return { isError: false, lines: [...cautions] };
  return undefined;
}

/**
 * Every mark a row can wear, as the legend lists them — one catalogue, so the
 * legend and the rows it explains cannot disagree.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMark
 */
export type ToolRowMark =
  | "protectedIBB"
  | "protectedFirmware"
  | "decompressed"
  /** Verdict: the newest revision known for this board. */
  | "newest"
  /** Verdict: a newer revision is known, and it serves this board. */
  | "newerListed"
  /** Verdict: a newer revision is known, and it may or may not serve this board. */
  | "newerMaybe"
  | "error"
  | "caution"
  | "compressed"
  | "compressedUndecoded"
  | "holdsChecks"
  | "partlyProtected";

/**
 * The channels of `ROW_MARKS.md` §1, in the order a legend lists them.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMark.Channel
 */
export type RowMarkChannel = "background" | "rail" | "verdict" | "problem" | "role";

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMark.Channel */
export const ROW_MARK_CHANNELS: readonly RowMarkChannel[] = [
  "background",
  "rail",
  "verdict",
  "problem",
  "role",
];

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMark.channel */
export const ROW_MARK_CHANNEL: Readonly<Record<ToolRowMark, RowMarkChannel>> = {
  protectedIBB: "background",
  protectedFirmware: "background",
  decompressed: "rail",
  newest: "verdict",
  newerListed: "verdict",
  newerMaybe: "verdict",
  error: "problem",
  caution: "problem",
  compressed: "role",
  compressedUndecoded: "role",
  holdsChecks: "role",
  partlyProtected: "role",
};

/**
 * Every mark, in the order of the catalogue — what a panel asks for a legend
 * entry for when it draws all of them. Upstream gets this list from the enum's
 * `CaseIterable` conformance and its declaration order; `ToolRowMark` is the
 * declaration that fixes both, so it is the anchor.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMark
 */
export const ALL_ROW_MARKS: readonly ToolRowMark[] = [
  "protectedIBB",
  "protectedFirmware",
  "decompressed",
  "newest",
  "newerListed",
  "newerMaybe",
  "error",
  "caution",
  "compressed",
  "compressedUndecoded",
  "holdsChecks",
  "partlyProtected",
];

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMark.channel */
export const rowMarkChannel = (mark: ToolRowMark): RowMarkChannel => ROW_MARK_CHANNEL[mark];

/** Where a channel falls in the order a legend lists its lines. */
export const channelOrder = (channel: RowMarkChannel): number => ROW_MARK_CHANNELS.indexOf(channel);

/**
 * What the legend says the mark means.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMark.meaning
 */
export const ROW_MARK_MEANING: Readonly<Record<ToolRowMark, string>> = {
  protectedIBB: "Inside the Boot Guard IBB: an edit stops the platform booting",
  protectedFirmware: "Inside a range the firmware checks at boot",
  decompressed: "Read out of compressed data, and the compressed data open on it",
  newest: "The newest revision the catalogue lists for this processor and platform",
  newerListed: "The catalogue lists a newer revision for this board",
  newerMaybe: "The catalogue lists a newer revision that may not serve this board",
  error: "Something is wrong: the pointer says what",
  caution: "Could not be checked, or wants a second look",
  compressed: "Holds compressed data that opens here",
  compressedUndecoded: "Holds compressed data that does not open here",
  holdsChecks: "Holds what other structures are checked against",
  partlyProtected: "Partly inside protected ranges",
};

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarks.swift#ToolRowMark.meaning */
export const rowMarkMeaning = (mark: ToolRowMark): string => ROW_MARK_MEANING[mark];

/**
 * The mark a role wears.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMarks.Role.mark
 */
export const roleMark = (role: RowRole): ToolRowMark => {
  switch (role.kind) {
    case "compressed":
      return role.decoded ? "compressed" : "compressedUndecoded";
    case "holdsChecks":
      return "holdsChecks";
    case "partlyProtected":
      return "partlyProtected";
  }
};

/**
 * What the pointer reads on the badge.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMarks.Role.toolTip
 */
export const roleTooltip = (role: RowRole): string => {
  switch (role.kind) {
    case "compressed":
      return role.decoded
        ? `${role.algorithm} compressed data that opens here`
        : `${role.algorithm} compressed data that does not open here`;
    case "holdsChecks":
      return role.words;
    case "partlyProtected":
      return ROW_MARK_MEANING.partlyProtected;
  }
};

/**
 * The mark a protection is drawn as.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolRowMarkStyle.swift#ToolRowMarks.Protection.mark
 */
export const protectionMark = (protection: RowProtection): ToolRowMark =>
  protection === "ibb" ? "protectedIBB" : "protectedFirmware";
