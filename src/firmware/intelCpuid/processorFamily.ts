/**
 * The model of the processor tables: which processors stand behind a CPUID, as
 * `IntelCPUIDBrandNames.json` of `github.com/maxshevelev/IntelCPUID` lists them
 * — read at run time (`processorTables.ts`) and generated there by its
 * `update-cpuid-brand-names` skill — and what the repository says of the
 * entries the article lacks.
 *
 * Ported from `Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift`.
 */

/**
 * One group of processors that share a CPUID, as the table of brand names lists
 * it.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.init
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.CodingKeys
 */
export interface ProcessorFamily {
  /**
   * As written: five hex digits, or a pattern with an `X` for any one digit
   * (`606AX`).
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.cpuids
   */
  readonly cpuids: readonly string[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.codeNames */
  readonly codeNames: readonly string[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.productFamilies */
  readonly productFamilies: readonly string[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.steppings */
  readonly steppings: readonly string[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.segments */
  readonly segments: readonly string[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.processors */
  readonly processors: readonly ProcessorModel[];
  /**
   * The architectures of its cores — `Golden Cove`, `Gracemont` — which the
   * article writes in brackets after a code name and the generator moves here.
   * Empty where the article names none.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.cores
   */
  readonly cores?: readonly string[] | undefined;
}

/**
 * One model: its name, and the S-SPECs it is sold under with this CPUID.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.init
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.CodingKeys
 */
export interface ProcessorModel {
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.name */
  readonly name: string;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.sSpec */
  readonly sSpec: readonly string[];
  /**
   * Where a code that is not the article's came from: `ark`, `wikipedia`, or
   * what IntelCPUID's `find-sspec` found — `intel`, `database`, `marking`.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.sSpecSource
   */
  readonly sSpecSource?: Readonly<Record<string, string>> | null | undefined;
  /**
   * A line that names a series rather than its models.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.series
   */
  readonly series?: boolean | null | undefined;
}

/**
 * Whether `cpuid` — five hex digits, upper case, as a microcode header's
 * signature is written — is one of this group's.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.matches
 */
export function familyMatches(family: ProcessorFamily, cpuid: string): boolean {
  return family.cpuids.some(
    (pattern) =>
      pattern.length === cpuid.length &&
      [...pattern].every((digit, at) => digit === "X" || digit === cpuid[at])
  );
}

/**
 * What names this group among the others with a CPUID of its: its CPUIDs and
 * code names, as the generator's notes are keyed (`EntryNotes`).
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.key
 */
export function familyKey(family: Pick<ProcessorFamily, "cpuids" | "codeNames">): string {
  return `${family.cpuids.join(",")}|${family.codeNames.join(",")}`;
}

/**
 * Every name is Intel's, so the word says nothing in a list of them.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.shortName
 */
export const modelShortName = (name: string): string =>
  name.startsWith("Intel ") ? name.slice(6) : name;

/**
 * One page a fact of an entry was read from.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.Evidence
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.Evidence.init
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.Evidence.CodingKeys
 */
export interface EntryEvidence {
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.Evidence.url */
  readonly url: string;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.Evidence.quote */
  readonly quote: string;
  /**
   * What the page gives the entry — `cpuids`, `steppings`, `processors`.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.Evidence.gives
   */
  readonly gives: readonly string[];
}

/**
 * What the repository says of a group beyond the table: the note on a CPUID the
 * article lacks, and the pages each of its facts was read from. Kept in the
 * generator's `extra-entries.json`, which the lookup page reads too; a group
 * the article has carries none.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.init
 */
export interface EntryNotes {
  /**
   * In English, as the generator writes it.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.note
   */
  readonly note: string | undefined;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.evidence */
  readonly evidence: readonly EntryEvidence[];
}

/**
 * The pages that say something of the CPUID itself: a page that only lists
 * models is a source of the table below, not of the entry.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.sources
 */
export function entrySources(notes: EntryNotes): EntryEvidence[] {
  return notes.evidence.filter((one) => !(one.gives.length === 1 && one.gives[0] === "processors"));
}
