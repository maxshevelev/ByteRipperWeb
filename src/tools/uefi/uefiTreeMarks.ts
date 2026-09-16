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
 * The compressed badge on a compressed section, the badge on what holds a list
 * of protected ranges, and the problem icon for a wrong checksum.
 *
 * **Not drawn in this port yet**, for two reasons that are separate gaps:
 *
 * - The rail for a node read out of compressed data, and for the compressed
 *   section while its row is open (G1). Nothing here decompresses, so no node's
 *   bytes came out of anywhere, and a compressed section is the leaf it looks
 *   like rather than a container with rows under it. `decompressedFrom` and
 *   `opensDecompressed` are therefore never set — and `decompressed` is left out
 *   of {@link legendMarks} for the same reason, because a mark the tree never
 *   draws has no business in the legend that explains the tree.
 * - The Boot Guard background, the partly-protected badge, the badge on a
 *   protected range whose hash does not match, and the range-holder's own words
 *   (G3). Without the ranges there is no protection to tint a row for.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks
 * @upstream-differs no rail and no background: G1 and G3 are not ported
 */
export const UEFI_TREE_MARKS = {
  /**
   * Every mark this tree draws — what its legend lists.
   *
   * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeMarks.swift#UEFITreeMarks.legendMarks
   * @upstream-differs the Boot Guard marks and `decompressed` are not listed:
   * this tree draws none of them, and a mark the panel never draws is not in
   * the legend (`Design/ROW_MARKS.md` §6)
   */
  legendMarks: [
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
}): ToolRowMarks {
  const { node, diagnostics } = options;
  const errors = checksumProblems(node, diagnostics);
  const cautions: string[] = [];
  const roles: RowRole[] = [];

  const compression = node.compression;
  if (compression !== undefined) {
    roles.push({ kind: "compressed", algorithm: compression.algorithm, decoded: false });
  }

  const holds = holdsChecks(node);
  if (holds !== undefined) roles.push({ kind: "holdsChecks", words: holds });

  return {
    problem: worstProblem(errors, cautions),
    roles,
  };
}

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
