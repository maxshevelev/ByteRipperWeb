import type {
  CodePartition,
  CPDModuleRow,
  FirmwareAnalysis,
} from "@/firmware/me/models/firmwareAnalysis";
import {
  NO_ROW_MARKS,
  type RowRole,
  type ToolRowMark,
  type ToolRowMarks,
  worstProblem,
} from "@/tools/toolRowMarks";

/**
 * What a row of the ME Full Info tree wears besides its text
 * (`Design/ROW_MARKS.md` §5.3), decided here so it is tested without a window,
 * in the icons of the one catalogue every firmware panel draws from.
 *
 * - the compressed badge on a `$CPD` module stored compressed — indigo where
 *   this panel shows what came out of it (the `pm` / `rbe` metadata table),
 *   grey everywhere else, and for a module that is encrypted as well;
 * - the rail on the RBE/PM Metadata rows when the module they were read out of
 *   is stored compressed;
 * - the holds-checks badge on the manifest, which carries the hashes the
 *   modules are checked against;
 * - a problem on a row whose own checksum or signature does not check out.
 *
 * No background: the Boot Guard ranges lie in the BIOS region, and an ME row
 * never sits inside one.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks
 */
export const MEA_TREE_MARKS = {
  /**
   * Every mark this tree draws — what its legend lists.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.legendMarks
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
 * How a module is stored, from its directory row and its `.met` companion's
 * Module Attributes block.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.Storage
 */
export interface MEAStorage {
  /**
   * "Huffman" or "LZMA"; nothing for a module stored as it is.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.Storage.compression
   */
  readonly compression: string | undefined;
  /** @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.Storage.isEncrypted */
  readonly isEncrypted: boolean;
}

/** @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.storage */
export function storage(of: CPDModuleRow, inPartition: CodePartition): MEAStorage {
  const attributes = inPartition.modules
    .find((one) => one.name === `${of.name}.met`)
    ?.extensions?.flatMap((one) =>
      one.moduleAttributes === undefined ? [] : [one.moduleAttributes]
    )[0];
  let compression: string | undefined;
  switch (attributes?.compression) {
    case 1:
      compression = "Huffman";
      break;
    case 2:
      compression = "LZMA";
      break;
    default:
      compression = of.isHuffman ? "Huffman" : undefined;
  }
  return { compression, isEncrypted: (attributes?.encryption ?? 0) !== 0 };
}

/**
 * The modules the RBE/PM Metadata table is read out of.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.metadataModules
 */
const metadataModules = new Set(["pm", "rbe"]);

/**
 * A `$CPD` module's row: the compressed badge when it is stored compressed — it
 * opens here only when it is the module the panel's metadata table was read out
 * of, and it is not encrypted — and what the engine's module checks said about
 * it (`Issue.module`): an error for an error, a caution for the rest. They stay
 * in the Issues group too.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.module
 */
export function moduleMarks(
  module: CPDModuleRow,
  inPartition: CodePartition,
  analysis: FirmwareAnalysis
): ToolRowMarks {
  const errors: string[] = [];
  const cautions: string[] = [];
  for (const issue of analysis.issues) {
    if (issue.module !== module.name) continue;
    if (issue.severity === "error") errors.push(issue.message);
    else cautions.push(issue.message);
  }
  const roles: RowRole[] = [];
  const stored = storage(module, inPartition);
  if (stored.compression !== undefined) {
    const opens =
      !stored.isEncrypted &&
      metadataModules.has(module.name) &&
      (analysis.rbePmMetadata ?? []).length > 0;
    roles.push({
      kind: "compressed",
      algorithm: stored.isEncrypted ? `Encrypted ${stored.compression}` : stored.compression,
      decoded: opens,
    });
  }
  return { problem: worstProblem(errors, cautions), roles };
}

/**
 * The code partition's row: its directory checksum.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.codePartition
 */
export function codePartitionMarks(partition: CodePartition): ToolRowMarks {
  if (partition.checksumValid !== false) return NO_ROW_MARKS;
  const kind = partition.headerVersion === 1 ? "Checksum-8" : "CRC-32";
  return { problem: { isError: true, lines: [`Invalid $CPD ${kind} checksum`] } };
}

/**
 * The manifest's row: it holds the hashes the modules are checked against, and
 * its own signature may not check out.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.manifest
 */
export function manifestMarks(analysis: FirmwareAnalysis): ToolRowMarks {
  return {
    ...(analysis.rsaSignatureValid === false
      ? { problem: { isError: true, lines: ["The manifest's RSA signature does not check out"] } }
      : {}),
    roles: [
      {
        kind: "holdsChecks",
        words: "Holds the hashes the partition's modules are checked against",
      },
    ],
  };
}

/**
 * A layout table's row: its CRC-32, where its version has one.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.table
 */
export function tableMarks(named: string, checksumValid: boolean | undefined): ToolRowMarks {
  if (checksumValid !== false) return NO_ROW_MARKS;
  return { problem: { isError: true, lines: [`Invalid ${named} CRC-32`] } };
}

/**
 * The RBE/PM Metadata rows: the rail when the module they were read out of is
 * stored compressed, with its name in the words.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATreeMarks.swift#MEATreeMarks.metadata
 */
export function metadataMarks(analysis: FirmwareAnalysis): ToolRowMarks {
  const partition = analysis.codePartition;
  if (partition === undefined) return NO_ROW_MARKS;
  const module = partition.modules.find((one) => metadataModules.has(one.name));
  if (module === undefined) return NO_ROW_MARKS;
  const compression = storage(module, partition).compression;
  if (compression === undefined) return NO_ROW_MARKS;
  return {
    decompressedFrom: `Read out of the ${module.name} module, stored ${compression} compressed`,
  };
}
