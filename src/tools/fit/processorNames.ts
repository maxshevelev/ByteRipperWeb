import { L } from "@/core/localization/localization";
import { microcodeCpuid } from "@/firmware/uefi/microcodeParser";
import brandNames from "@/tools/fit/IntelCPUIDBrandNames.json";

/**
 * Which processors a microcode is for, by its CPUIDs: the table of brand names
 * the FIT panel opens a microcode's rows into, and the microcode form searches
 * by model and S-SPEC.
 *
 * `IntelCPUIDBrandNames.json` is upstream's resource, copied as it ships: the
 * data is refreshed there (`Skills/update-cpuid-brand-names`) and arrives here
 * with a port, as the compiled ME maps and the JEDEC table do.
 *
 * Ported from `Modules/FITTool/Sources/FITTool/ProcessorNames.swift`.
 */

/**
 * One group of processors that share a CPUID, as the table of brand names lists
 * it.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily
 */
export interface ProcessorFamily {
  /**
   * As written: five hex digits, or a pattern with an `X` for any one digit
   * (`606AX`).
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily.cpuids
   */
  readonly cpuids: readonly string[];
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily.codeNames */
  readonly codeNames: readonly string[];
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily.productFamilies */
  readonly productFamilies: readonly string[];
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily.steppings */
  readonly steppings: readonly string[];
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily.segments */
  readonly segments: readonly string[];
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily.processors */
  readonly processors: readonly ProcessorModel[];
  /**
   * The architectures of its cores — `Golden Cove`, `Gracemont` — which the
   * article writes in brackets after a code name and the generator moves here.
   * Empty where the article names none.
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily.cores
   */
  readonly cores?: readonly string[] | undefined;
}

/**
 * One model: its name, and the S-SPECs it is sold under with this CPUID.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorModel
 */
export interface ProcessorModel {
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorModel.name */
  readonly name: string;
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorModel.sSpec */
  readonly sSpec: readonly string[];
  /**
   * Where a code that is not the article's came from: `ark` or `wikipedia`.
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorModel.sSpecSource
   */
  readonly sSpecSource?: Readonly<Record<string, string>> | null | undefined;
  /**
   * A line that names a series rather than its models.
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorModel.series
   */
  readonly series?: boolean | null | undefined;
}

/**
 * Whether `cpuid` — as a microcode header's CPUID is written — is one of this
 * group's.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorFamily.matches
 */
export function familyMatches(family: ProcessorFamily, cpuid: string): boolean {
  return family.cpuids.some(
    (pattern) =>
      pattern.length === cpuid.length &&
      [...pattern].every((digit, at) => digit === "X" || digit === cpuid[at])
  );
}

/**
 * The table shipped with the app, read once.
 *
 * The list is the one table Intel's own documents do not give in one place; it
 * is incomplete and its source says so. A CPUID it does not know is said to be
 * unknown, never guessed from a neighbour.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorNames
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorNames.shipped
 * @upstream-differs bundled into the page as a module rather than read from a bundle's file at
 * first use; the same one read
 */
export const SHIPPED_PROCESSORS: readonly ProcessorFamily[] = (
  brandNames as unknown as { readonly entries: readonly ProcessorFamily[] }
).entries;

/**
 * The groups for these processor signatures, in the order the signatures come —
 * the header's own first — and each group once.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#ProcessorNames.families
 */
export function processorFamilies(
  signatures: readonly number[],
  catalogue: readonly ProcessorFamily[] = SHIPPED_PROCESSORS
): ProcessorFamily[] {
  const found: ProcessorFamily[] = [];
  for (const signature of signatures) {
    const cpuid = microcodeCpuid(signature);
    for (const family of catalogue) {
      if (familyMatches(family, cpuid) && !found.includes(family)) found.push(family);
    }
  }
  return found;
}

/**
 * A line under a CPUID: a model the table of brand names lists for it.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorLine
 */
export interface FITProcessorLine {
  /**
   * `model` — one model, with its S-SPECs as the detail; `unknown` — nothing is
   * known for this CPUID.
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorLine.kind
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorLine.Kind
   */
  readonly kind: "model" | "unknown";
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorLine.text */
  readonly text: string;
  /**
   * Said after the text, quieter: the S-SPECs of a model.
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorLine.detail
   */
  readonly detail: string;
}

/**
 * Every name is Intel's, so the word says nothing in a list of them.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorLine.shortName
 */
export const processorShortName = (name: string): string =>
  name.startsWith("Intel ") ? name.slice(6) : name;

/**
 * The processors behind one CPUID of a microcode: what its node in the panel's
 * tree says, and the lines it opens into.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorGroup
 */
export interface FITProcessorGroup {
  /**
   * Five hex digits, as a bench writes it.
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorGroup.cpuid
   */
  readonly cpuid: string;
  /**
   * The code names of the groups the table has for this CPUID, said beside it —
   * the one thing that tells two CPUIDs of one update apart at a glance. Empty
   * when nothing is known.
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorGroup.codeNames
   */
  readonly codeNames: readonly string[];
  /**
   * What the table says of the groups besides their names — the cores'
   * architectures, the stepping, the segments — one line a group. The panel
   * puts it under the pointer on the CPUID's row rather than on a row of its
   * own. A line leads with its group's code names only where the CPUID has more
   * than one group, since the row already says them.
   *
   * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorGroup.notes
   */
  readonly notes: readonly string[];
  /** @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorGroup.lines */
  readonly lines: readonly FITProcessorLine[];
}

/**
 * One group per signature, in the order the update names them — the header's
 * own first. A CPUID the table does not know is a group of one line that says
 * so.
 *
 * @upstream Modules/FITTool/Sources/FITTool/ProcessorNames.swift#FITProcessorGroup.groups
 */
export function processorGroups(
  signatures: readonly number[],
  catalogue: readonly ProcessorFamily[] = SHIPPED_PROCESSORS
): FITProcessorGroup[] {
  return signatures.map((signature) => {
    const cpuid = microcodeCpuid(signature);
    const families = processorFamilies([signature], catalogue);
    if (families.length === 0) {
      return {
        cpuid,
        codeNames: [],
        notes: [],
        lines: [
          {
            kind: "unknown",
            text: L("No processor names known for CPUID %1$@", cpuid),
            detail: "",
          },
        ],
      };
    }
    const lines: FITProcessorLine[] = [];
    const notes: string[] = [];
    for (const family of families) {
      // A hybrid's two kinds of core read as one part: P + E.
      const cores = family.cores ?? [];
      const note = [
        ...(cores.length === 0 ? [] : [cores.join(" + ")]),
        ...family.steppings,
        ...family.segments,
      ].join(" · ");
      if (families.length > 1) {
        notes.push(family.codeNames.join(", ") + (note.length === 0 ? "" : `: ${note}`));
      } else if (note.length > 0) {
        notes.push(note);
      }
      for (const model of family.processors) {
        lines.push({
          kind: "model",
          text: processorShortName(model.name),
          detail: model.series === true ? L("series, models not listed") : model.sSpec.join(", "),
        });
      }
    }
    return { cpuid, codeNames: families.flatMap((one) => one.codeNames), notes, lines };
  });
}
