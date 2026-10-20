/**
 * The bounds Settings ▸ Agent offers for the files an agent opened by path
 * (`AgentBackgroundDocuments`), and what they are until the person picks.
 *
 * A parsed dump holds the file read whole and what its compressed sections decompressed to — at
 * most 256 MiB a tree and some tens of MiB for a usual BIOS. Eight files and 1 GiB keep a working
 * set of dumps parsed on any machine the shell runs on; past a quarter of the machine's memory the
 * agent's files would be pushing the person's own work out of it.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits
 */

/** @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.fileChoices */
export const BACKGROUND_FILE_CHOICES: readonly number[] = [1, 2, 4, 8, 16, 32, 64];
/** @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.defaultFiles */
export const DEFAULT_BACKGROUND_FILES = 8;

/** @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.memoryChoicesMiB */
const MEMORY_CHOICES_MIB: readonly number[] = [256, 512, 1024, 2048, 4096, 8192, 16384];
/** @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.defaultMemoryMiBWanted */
const DEFAULT_MEMORY_MIB_WANTED = 1024;

/**
 * The memory bounds offered on a machine with `physicalMemory` bytes: up to a quarter of it, and
 * always the smallest.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.memoryChoicesMiB
 */
export function memoryChoicesMiB(physicalMemory: number): number[] {
  const quarter = Math.floor(physicalMemory / 4 / 2 ** 20);
  const offered = MEMORY_CHOICES_MIB.filter((mib) => mib <= quarter);
  return offered.length === 0 ? [MEMORY_CHOICES_MIB[0] ?? 256] : offered;
}

/** @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.defaultMemoryMiB */
export function defaultMemoryMiB(physicalMemory: number): number {
  const offered = memoryChoicesMiB(physicalMemory);
  return offered.findLast((mib) => mib <= DEFAULT_MEMORY_MIB_WANTED) ?? offered[0] ?? 256;
}

/**
 * A kept value brought inside what is offered: the largest choice not over it — a setting made on
 * a machine with more memory, or written by hand — or `fallback` when there is none or nothing was
 * kept.
 *
 * @upstream ByteRipperApp/Agent/AgentBackgroundDocuments.swift#AgentBackgroundLimits.snapped
 */
export function snappedLimit(
  value: number | undefined,
  choices: readonly number[],
  fallback: number
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return choices.findLast((choice) => choice <= value) ?? choices[0] ?? fallback;
}
