import type { MicrocodeSignatures } from "@/firmware/intelCpuid/microcodeSignatures";
import type { EntryNotes } from "@/firmware/intelCpuid/processorFamily";
import {
  BRAND_NAMES_FILE,
  type BrandNamesFile,
  currentProcessorTables,
  decodeBrandNames,
  decodeNotes,
  decodeSignatures,
  installProcessorTables,
  type ProcessorTables,
  processorTablesAreEmpty,
  processorTablesOf,
  SIGNATURES_FILE,
} from "@/firmware/intelCpuid/processorTables";
import type { FreshenedStatus } from "@/platform/net/freshened";
import { type FreshRemote, freshRemote } from "@/platform/net/freshRemote";

/**
 * Where the processor tables come from (`processorTablesStore.ts`).
 *
 * An interface because the tests must not touch the network: a suite that
 * reaches GitHub is a suite that fails on a train. A test installs tables of
 * its own.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#ProcessorTablesSource
 */
export interface ProcessorTablesSource {
  /**
   * Installs the tables kept from the last good read, if none are installed
   * yet, then — unless they were checked recently — asks the repository
   * whether they changed and installs what it answers. A failure leaves the
   * installed tables as they are.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#ProcessorTablesSource.refresh
   */
  refresh(): Promise<void>;

  /**
   * When the table of brand names last changed and was last confirmed current,
   * or `undefined` if nothing is held.
   *
   * @web-only every source of third-party data carries its dates on the
   * interface (`MicrocodeSource.freshness`): the store holds only the
   * interface, so the date a panel shows has nowhere else to be reached from
   */
  freshness(): FreshenedStatus | undefined;
}

/**
 * `github.com/maxshevelev/IntelCPUID`, as `raw.githubusercontent.com` serves
 * it.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.base
 */
export const INTEL_CPUID_BASE = "https://raw.githubusercontent.com/maxshevelev/IntelCPUID/main/";

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.names */
export const INTEL_CPUID_NAMES = BRAND_NAMES_FILE;

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.signatures */
export const INTEL_CPUID_SIGNATURES = SIGNATURES_FILE;

/**
 * The generator's notes, by their path in the repository.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.notes
 */
export const INTEL_CPUID_NOTES = "Skills/update-cpuid-brand-names/scripts/extra-entries.json";

/**
 * The repository, over HTTPS.
 *
 * Its two files are the processor tables, and the app has no copy of its own:
 * what it shows is what it last read from there whole. Each file is one
 * `freshRemote` — the rule every third-party file of this app is held by
 * (`CLAUDE.md`, "Third-party data"): the copy the last session left in the
 * Cache API is taken up first, a copy younger than a day is not asked about at
 * all, an older one is answered at once with the day's check behind it, and a
 * check that cannot be made keeps what is held. At `raw.githubusercontent.com`
 * the check is the browser's revalidation (`cache: "no-cache"`), the `ETag`
 * being one a script cannot read or send there. A file that does not decode —
 * a newer `formatVersion`, a broken push — is refused before it is kept, so
 * the bench keeps the tables it had, and a reload starts from them. The kept
 * copy is what a run with no network shows, and before there is one — a first
 * run offline — the tables are empty.
 *
 * A third file is read beside them: the generator's `extra-entries.json`,
 * whose notes and pages the CPUID lookup shows for the entries the article
 * lacks. The tables do not wait on it — when it cannot be had, the copy kept of
 * it stands, or there are no notes.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.init
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.shared
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.refresh
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.check
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.running
 * @upstream-differs a `freshRemote` per file, as every other database of the web is held: the kept
 * copy, its validator and its dates are the Cache API's, a file is kept only once it decodes, and
 * each file is checked on its own day rather than the three on one — so a newer table of brand
 * names is installed beside the signatures in hand rather than waiting for both to be fetched again
 */
export function intelCpuidRepository(
  base: string = INTEL_CPUID_BASE,
  remote: <Value>(url: string, parse: (text: string) => Value) => FreshRemote<Value> = freshRemote
): ProcessorTablesSource {
  const names = remote(base + INTEL_CPUID_NAMES, decodeBrandNames);
  const signatures = remote(base + INTEL_CPUID_SIGNATURES, decodeSignatures);
  const notes = remote(base + INTEL_CPUID_NOTES, decodeNotes);

  const held: {
    names?: BrandNamesFile;
    signatures?: MicrocodeSignatures;
    notes?: ReadonlyMap<string, EntryNotes>;
  } = {};
  let installed: ProcessorTables | undefined;

  /** The pair, once both are in hand, with whatever notes are. */
  const install = () => {
    if (held.names === undefined || held.signatures === undefined) return;
    const notesNow = held.notes ?? new Map<string, EntryNotes>();
    if (
      installed !== undefined &&
      installed === currentProcessorTables() &&
      installed.microcode === held.signatures &&
      installed.notes === notesNow &&
      installed.families === held.names.entries
    ) {
      return;
    }
    installed = processorTablesOf(held.names, held.signatures, notesNow);
    installProcessorTables(installed);
  };

  // A check behind an answer that brings a newer file installs it as soon as
  // it is read: a panel on screen shows the names again (`onProcessorTablesChange`).
  names.changes((value) => {
    held.names = value;
    install();
  });
  signatures.changes((value) => {
    held.signatures = value;
    install();
  });
  notes.changes((value) => {
    held.notes = value;
    install();
  });

  let running: Promise<void> | undefined;

  return {
    refresh() {
      // Two readers opening at once ask once.
      running ??= (async () => {
        // The notes are what the tables can do without: asked beside them and
        // never waited on.
        const notesAsked = notes.value().then(
          (value) => {
            held.notes = value;
            install();
          },
          () => undefined
        );
        try {
          const [namesNow, signaturesNow] = await Promise.all([names.value(), signatures.value()]);
          held.names = namesNow;
          held.signatures = signaturesNow;
          // The kept copy is installed only where nothing else is: a test's
          // tables, installed by hand, are not overwritten by it.
          if (installed !== undefined || processorTablesAreEmpty(currentProcessorTables())) {
            install();
          }
        } catch {
          // Nothing could be had and nothing was kept: the tables stay as they
          // are — empty on a first run with no network — and the next reader
          // asks again.
        }
        await notesAsked;
        // A check running behind an answer is what a refresh is over with, as
        // upstream's is over with its check: what it brings is installed by
        // then (`changes` above). A reader that only wants the tables shown
        // does not wait on this — the panel does not.
        await Promise.all([names.settle(), signatures.settle(), notes.settle()]);
      })().finally(() => {
        running = undefined;
      });
      return running;
    },
    freshness: () => names.freshness(),
  };
}

/**
 * Tables already in hand — what a test installs as the source. `refresh`
 * installs them, so a panel that opens next reads them without a fetch.
 *
 * @upstream ByteRipperTests/FixtureProcessorTables.swift#FixtureProcessorTables
 * @upstream ByteRipperTests/FixtureProcessorTables.swift#FixtureProcessorTables.refresh
 */
export function fixedProcessorTablesSource(tables: ProcessorTables): ProcessorTablesSource {
  const at = Date.now();
  return {
    refresh: async () => installProcessorTables(tables),
    freshness: () => ({ changedAt: at, checkedAt: at }),
  };
}
