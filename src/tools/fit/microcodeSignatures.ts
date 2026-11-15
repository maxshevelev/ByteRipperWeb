import type {
  MicrocodeSignatures,
  MicrocodeUpdate,
} from "@/firmware/intelCpuid/microcodeSignatures";
import { updateOthers } from "@/firmware/intelCpuid/microcodeSignatures";
import { currentProcessorTables } from "@/firmware/intelCpuid/processorTables";
import { microcodeCpuid } from "@/firmware/uefi/microcodeParser";
import type { MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";

/**
 * The shared-microcode table (`src/firmware/intelCpuid/microcodeSignatures.ts`),
 * asked about what this module holds: a file of the microcode catalogue, a
 * signature.
 *
 * A file newer than the commit the table was read at is matched by what its
 * name says of the update — revision, date, platforms and size, which a copy
 * keeps — and one that matches nothing has no extended CPUIDs said for it:
 * unknown, not none.
 *
 * Ported from `Modules/FITTool/Sources/FITTool/MicrocodeSignatures.swift`.
 *
 * @upstream Modules/FITTool/Sources/FITTool/MicrocodeSignatures.swift#MicrocodeSignatures
 */

/**
 * The table as last read from `github.com/maxshevelev/IntelCPUID`: empty until
 * a copy has been read.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.current
 */
export const currentMicrocodeSignatures = (): MicrocodeSignatures =>
  currentProcessorTables().microcode;

/**
 * The update a catalogue file is a copy of, where it serves several CPUIDs: by
 * its path, or else by what its name says of the update.
 *
 * @upstream Modules/FITTool/Sources/FITTool/MicrocodeSignatures.swift#MicrocodeSignatures.update
 */
export function updateForEntry(
  signatures: MicrocodeSignatures,
  entry: MicrocodeCatalogueEntry
): MicrocodeUpdate | undefined {
  if (entry.vendor !== "Intel") return undefined;
  const byPath = signatures.updateForFile(entry.path);
  if (byPath !== undefined) return byPath;
  // A copy the table has not seen: same revision, date and platforms as one it
  // has, under a CPUID that update names.
  return signatures.updates.find(
    (update) =>
      update.revision === entry.revisionText &&
      update.date === entry.date &&
      update.signatures.some(
        (one) =>
          one.cpuid === entry.cpuidText &&
          entry.platformID !== undefined &&
          Number.parseInt(one.platforms, 16) === entry.platformID
      )
  );
}

/**
 * The other CPUIDs a catalogue file's update serves, in the update's order,
 * each once. Empty for an update that serves one.
 *
 * @upstream Modules/FITTool/Sources/FITTool/MicrocodeSignatures.swift#MicrocodeSignatures.extendedCPUIDs
 */
export function extendedCpuids(
  entry: MicrocodeCatalogueEntry,
  signatures: MicrocodeSignatures = currentMicrocodeSignatures()
): string[] {
  const update = updateForEntry(signatures, entry);
  return update === undefined ? [] : updateOthers(update, [entry.cpuidText]);
}

/**
 * The CPUIDs that share a microcode update with this signature: those of the
 * newest update that serves it and others, without it, each once.
 *
 * @upstream Modules/FITTool/Sources/FITTool/MicrocodeSignatures.swift#MicrocodeSignatures.sharing
 */
export function sharingSignature(
  signature: number,
  signatures: MicrocodeSignatures = currentMicrocodeSignatures()
): string[] {
  return signatures.sharing(microcodeCpuid(signature));
}
