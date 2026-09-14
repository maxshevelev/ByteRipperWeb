import type { CodePartition, FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import type { ModuleAttributesExtension } from "@/firmware/me/partition/extensions";

/**
 * When an analysis needs `Huffman.dat`.
 *
 * Upstream fetches the dictionaries in the middle of an analysis, and only for an
 * image that has something to decompress with them: a Huffman module whose `.met`
 * says so, on an identified firmware, or a Huffman-packed `pm`/`rbe` module. The
 * families whose modules are LZMA or uncompressed never trigger it. Here the
 * analysis runs in one pass without it, and says whether a second pass with it
 * would read more — so the panel fetches the file only for the images upstream
 * would have fetched it for.
 *
 * Ported from `Packages/MEFirmware/Engine/MEFirmwareAnalyzer.swift`.
 */

/** The attributes the `.met` companion of `moduleName` gives it. */
export function metAttributes(
  codePartition: CodePartition,
  moduleName: string
): ModuleAttributesExtension | undefined {
  const met = codePartition.modules.find((one) => one.name === `${moduleName}.met`);
  return met?.extensions?.find((one) => one.moduleAttributes !== undefined)?.moduleAttributes;
}

/**
 * A declared-Huffman module backed by a `.met` that advertises Huffman and no
 * encryption — the one case the decompression check can verify.
 */
export function hasHuffmanModuleToValidate(codePartition: CodePartition): boolean {
  return codePartition.modules.some(
    (module) =>
      module.isHuffman &&
      module.size > 0 &&
      codePartition.modules.some(
        (candidate) =>
          candidate.name === `${module.name}.met` &&
          (candidate.extensions ?? []).some(
            (one) =>
              one.moduleAttributes?.compression === 1 && one.moduleAttributes.encryption === 0
          )
      )
  );
}

/** Whether analysing this image again with the dictionaries would read more of it. */
export function huffmanDictionariesWanted(analysis: FirmwareAnalysis): boolean {
  const codePartition = analysis.codePartition;
  if (codePartition === undefined) return false;
  const packedMetadata = codePartition.modules.some(
    (one) => (one.name === "pm" || one.name === "rbe") && one.isHuffman
  );
  const identified = analysis.variant.length > 0;
  return packedMetadata || (identified && hasHuffmanModuleToValidate(codePartition));
}
