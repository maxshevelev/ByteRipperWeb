import { guidEquals, guidFromText } from "@/firmware/uefi/efiGuid";
import { AMI_HASH_FILE, PHOENIX_HASH_FILE } from "@/firmware/uefi/knownGuids";
import {
  type RowRole,
  type ToolRowMark,
  type ToolRowMarks,
  worstProblem,
} from "@/tools/toolRowMarks";
import type { WireDiagnostic, WireNode } from "@/workers/protocol";

/**
 * What a row of the UEFI tree wears besides its name
 * (`Design/ROW_MARKS.md` §5.1), decided here so it is tested without a window.
 *
 * The rail for every node inside a compressed section and for the section itself
 * while its row is open, the compressed badge on a compressed section, the badge
 * on what holds a list of protected ranges, and the problem icon for a wrong
 * checksum or a section that did not decompress.
 *
 * **Not drawn in this port yet:** the Boot Guard background, the
 * partly-protected badge, the badge on a protected range whose hash does not
 * match, and the range-holder's own words (G3). Without the ranges there is no
 * protection to tint a row for.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks
 * @upstream-differs no Boot Guard background and no protected-range marks: G3
 * is not ported
 */
export const UEFI_TREE_MARKS = {
  /**
   * Every mark this tree draws — what its legend lists.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.legendMarks
   * @upstream-differs the Boot Guard marks are not listed: this tree draws none
   * of them, and a mark the panel never draws is not in the legend
   * (`Design/ROW_MARKS.md` §6)
   */
  legendMarks: [
    "decompressed",
    "error",
    "caution",
    "compressed",
    "compressedUndecoded",
    "holdsChecks",
  ] as readonly ToolRowMark[],
} as const;

/**
 * What one row wears.
 *
 * The checksums are passed in rather than asked for, because the parse reports
 * them as diagnostics and the panel already holds the list — reading them twice
 * would be two places that can disagree about a bad sum.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.marks
 * @upstream-differs `badChecksums`, a set of fields, becomes the parse's own
 * diagnostics, which carry the stored and computed values as well as the
 * structure — the port has no `UEFIChecksumField` (see `checksumProblems`)
 */
export function uefiTreeMarks(options: {
  readonly node: WireNode;
  readonly diagnostics: readonly WireDiagnostic[];
  /** The tree, for the name of the section a node inside was decompressed from. */
  readonly roots?: readonly WireNode[] | undefined;
  /**
   * The node's row is open in the outline — state of the view, not of the tree,
   * which keeps a branch it has read after the row shuts.
   */
  readonly isOpen?: boolean | undefined;
}): ToolRowMarks {
  const { node, diagnostics } = options;
  const errors = checksumProblems(node, diagnostics);
  const cautions: string[] = [];
  const roles: RowRole[] = [];
  let opens = false;

  const compression = node.compression;
  if (compression !== undefined) {
    // Opened, or still closed and openable. A section that decodes and is
    // neither did not decompress — unless it had no body to try.
    const opened = node.children.some((child) => child.space.length !== node.space.length);
    const open = node.isExpandable || opened;
    const failed = compression.decodes && !open && node.body[1] > node.body[0];
    roles.push({
      kind: "compressed",
      algorithm: compression.algorithm,
      decoded: compression.decodes && !failed,
    });
    // The rail starts here while the row is open on what came out of the
    // section, so the reader sees the section and its subtree as one bracket.
    // Shut, or with nothing decompressed under it, there is nothing to tie it
    // to.
    opens = options.isOpen === true && opened;
    if (failed) {
      cautions.push(
        decompressionFailure(node, diagnostics) ??
          `${compression.algorithm} data did not decompress`
      );
    }
  }

  const holds = holdsChecks(node);
  if (holds !== undefined) roles.push({ kind: "holdsChecks", words: holds });

  const from = decompressedFrom(node, options.roots ?? []);
  return {
    ...(from === undefined ? {} : { decompressedFrom: from }),
    ...(opens ? { opensDecompressed: true } : {}),
    problem: worstProblem(errors, cautions),
    roles,
  };
}

/**
 * The rail's words: which section the node's bytes came out of.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.decompressedFrom
 */
function decompressedFrom(node: WireNode, roots: readonly WireNode[]): string | undefined {
  const outermost = node.space[0];
  if (outermost === undefined) return undefined;
  const section = sectionNamed(roots, outermost) ?? "a compressed section";
  const deeper = node.space.length > 1 ? `, ${node.space.length} compressed sections deep` : "";
  return `Decompressed from ${section} at ${hex(outermost)}${deeper}`;
}

/** The name of the file-space node whose header starts at `offset`. */
function sectionNamed(roots: readonly WireNode[], offset: number): string | undefined {
  let nodes = roots;
  let innermost: WireNode | undefined;
  for (;;) {
    const found = nodes.find(
      (one) =>
        one.space.length === 0 &&
        offset >= one.header[0] &&
        offset < Math.max(one.header[1], one.body[1], one.tail[1])
    );
    if (found === undefined) break;
    innermost = found;
    nodes = found.children;
  }
  return innermost?.header[0] === offset ? innermost.name : undefined;
}

/**
 * What the parse said when this section did not decompress, found where the
 * parse put it: at the section in the file, or inside the buffer the section
 * itself sits in.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.decompressionFailure
 */
function decompressionFailure(
  node: WireNode,
  diagnostics: readonly WireDiagnostic[]
): string | undefined {
  return diagnostics.find((one) => {
    if (!one.message.includes("decompress")) return false;
    if (node.space.length === 0) {
      return one.inside === undefined && one.offset === node.header[0];
    }
    return (
      one.inside !== undefined &&
      one.inside.offset === node.header[0] &&
      one.inside.space.length === node.space.length &&
      one.inside.space.every((offset, index) => offset === node.space[index])
    );
  })?.message;
}

const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;

/**
 * The checksum diagnostics about this node, since "invalid" alone leaves the
 * reader to open the detail to find out which sum and what it should read.
 *
 * Located by offset, because that is how a diagnostic locates itself and the
 * node's own range is the only thing that says it is about this one. A file's
 * sum is reported at its own header, so the header's start is inside the range;
 * a volume body's is reported where the volume begins.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.checksumText
 * @upstream-differs the diagnostic's own sentence, naming both values, rather
 * than a list of field labels — this port reports checksums as diagnostics and
 * has no `UEFIChecksumField` to name
 */
export function checksumProblems(node: WireNode, diagnostics: readonly WireDiagnostic[]): string[] {
  const end = Math.max(node.header[1], node.body[1]);
  return diagnostics
    .filter(
      (one) => one.message.includes("checksum") && one.offset >= node.header[0] && one.offset < end
    )
    .map((one) => one.message);
}

/**
 * The words on the badge of a node that holds a list of protected ranges —
 * nothing for every other node.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.holdsChecks
 * @upstream-differs the Insyde flash device map has no arm: this port parses no
 * Insyde NVRAM store yet (G6)
 */
export function holdsChecks(node: WireNode): string | undefined {
  if (node.space.length !== 0) return undefined;
  if (node.kind !== "file" || node.guid === undefined) return undefined;
  const guid = guidFromText(node.guid);
  if (guid === undefined) return undefined;
  if (guidEquals(guid, AMI_HASH_FILE)) {
    return "Holds the AMI vendor hash table: ranges the firmware checks at boot";
  }
  if (guidEquals(guid, PHOENIX_HASH_FILE)) {
    return "Holds the Phoenix vendor hash table: ranges the firmware checks at boot";
  }
  return undefined;
}
