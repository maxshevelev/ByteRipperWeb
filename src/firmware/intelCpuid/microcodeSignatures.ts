/**
 * Which Intel microcode updates serve several CPUIDs: the extended signature
 * tables of the updates platomav/CPUMicrocodes holds.
 *
 * One update can name, after its data, more processors than the one in its
 * header (Intel SDM vol. 3A, §10.11.2) — the same bytes for each. The
 * collection files such an update once under each of them, `cpuB06F2_…` and
 * `cpuB06F5_…`, and its file names say nothing of the rest. IntelCPUID's
 * `microcode_signatures.py` reads the files at one commit into
 * `IntelMicrocodeSignatures.json`, which the app reads at run time
 * (`processorTables.ts`).
 *
 * Ported from `Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift`.
 */

/**
 * One CPUID an update serves.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.Signature
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.Signature.init
 */
export interface MicrocodeSignature {
  /**
   * Five hex digits, as the file name writes it.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.Signature.cpuid
   */
  readonly cpuid: string;
  /**
   * The platform ids for that CPUID, as a two-digit mask.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.Signature.platforms
   */
  readonly platforms: string;
}

/**
 * One update that serves several CPUIDs.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.init
 */
export interface MicrocodeUpdate {
  /**
   * Hexadecimal, without leading zeros, as the catalogue writes it.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.revision
   */
  readonly revision: string;
  /**
   * `2025-10-12`, from the header.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.date
   */
  readonly date: string;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.signatures */
  readonly signatures: readonly MicrocodeSignature[];
  /**
   * The collection's copies of the update, one per CPUID it serves.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.files
   */
  readonly files: readonly string[];
}

/**
 * An update's CPUIDs other than `cpuids`, in the update's order, each once.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.others
 */
export function updateOthers(update: MicrocodeUpdate, cpuids: readonly string[]): string[] {
  const seen = new Set(cpuids);
  const others: string[] = [];
  for (const { cpuid } of update.signatures) {
    if (seen.has(cpuid)) continue;
    seen.add(cpuid);
    others.push(cpuid);
  }
  return others;
}

/**
 * The table of updates that serve several CPUIDs, indexed by the files that are
 * copies of them.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures
 */
export class MicrocodeSignatures {
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.updates */
  readonly updates: readonly MicrocodeUpdate[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.byFile */
  private readonly byFile = new Map<string, number>();

  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.init */
  constructor(updates: readonly MicrocodeUpdate[]) {
    this.updates = updates;
    updates.forEach((update, index) => {
      for (const file of update.files) this.byFile.set(file, index);
    });
  }

  /**
   * The update a file of the collection is a copy of, by its path.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.update
   */
  updateForFile(path: string): MicrocodeUpdate | undefined {
    const index = this.byFile.get(path);
    return index === undefined ? undefined : this.updates[index];
  }

  /**
   * The updates that serve `cpuid` — five hex digits — among others, newest
   * first.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.updates
   */
  updatesServing(cpuid: string): MicrocodeUpdate[] {
    return this.updates
      .filter((update) => update.signatures.some((one) => one.cpuid === cpuid))
      .sort((one, two) => (one.date > two.date ? -1 : one.date < two.date ? 1 : 0));
  }

  /**
   * The CPUIDs that share a microcode update with this one: those of the newest
   * update that serves it and others, without it, each once.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.sharing
   */
  sharing(cpuid: string): string[] {
    const [newest] = this.updatesServing(cpuid);
    return newest === undefined ? [] : updateOthers(newest, [cpuid]);
  }

  /**
   * Every CPUID an update names, each once.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.cpuids
   */
  get cpuids(): ReadonlySet<string> {
    return new Set(this.updates.flatMap((update) => update.signatures.map((one) => one.cpuid)));
  }
}
