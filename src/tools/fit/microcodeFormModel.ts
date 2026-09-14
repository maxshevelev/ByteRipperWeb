import type { FITRow } from "@/firmware/fit/fitTable";
import {
  catalogueCounts,
  filterCatalogue,
  type MicrocodeCatalogueEntry,
} from "@/tools/fit/microcodeCatalogue";

/**
 * What the microcode form decides, without a window. Ported from upstream's
 * `FITAddMicrocodeViewController`, whose narrowing is `MicrocodeCatalogue.filter`
 * and whose words are these.
 *
 * The form lists the catalogue from `github.com/platomav/CPUMicrocodes`, Intel
 * only — a FIT names no other kind — searched by CPUID and optionally narrowed
 * to what the image already names. Nothing is downloaded until one is picked.
 */

/** Why the form is open: to add a microcode, or to replace one row's. */
export type MicrocodeFormMode =
  | {
      readonly kind: "add";
      /**
       * The CPUIDs the open image already names. A dump is for one board, and
       * what is worth adding to it is almost always a newer revision of one of
       * these.
       */
      readonly cpuidsInTheImage: ReadonlySet<number>;
    }
  | {
      readonly kind: "replace";
      /** The row being replaced. */
      readonly index: number;
      /** The row's CPUID, where it names one. */
      readonly targetCpuid: number | undefined;
      /** The same, as the row writes it. */
      readonly targetCpuidText: string | undefined;
    };

/** "Intel" in the title: the list has no vendor picker, so what is shown is said here. */
export function formTitle(mode: MicrocodeFormMode): string {
  return mode.kind === "replace" ? "Replace Intel Microcode" : "Add Intel Microcode";
}

/** The checkbox's words: the image's CPUIDs, or in replace mode the row's one. */
export function narrowingTitle(mode: MicrocodeFormMode): string {
  return mode.kind === "replace" && mode.targetCpuidText !== undefined
    ? `Only CPUID ${mode.targetCpuidText}`
    : "Only CPUIDs in this image";
}

/** The CPUIDs the checkbox narrows to. */
export function narrowingCpuids(mode: MicrocodeFormMode): ReadonlySet<number> {
  if (mode.kind === "add") return mode.cpuidsInTheImage;
  return mode.targetCpuid === undefined ? new Set() : new Set([mode.targetCpuid]);
}

/**
 * Whether the search field goes away: in replace mode, narrowed to the row's
 * one CPUID, there is nothing left to search.
 */
export function searchIsHidden(mode: MicrocodeFormMode, narrowed: boolean): boolean {
  return mode.kind === "replace" && narrowed;
}

/** The rows the form shows. */
export function shownEntries(
  entries: readonly MicrocodeCatalogueEntry[],
  mode: MicrocodeFormMode,
  search: string,
  narrowed: boolean
): MicrocodeCatalogueEntry[] {
  return filterCatalogue(entries, {
    vendor: "Intel",
    // A hidden field does not keep filtering from behind the scenes.
    search: searchIsHidden(mode, narrowed) ? "" : search,
    cpuidsInTheImage: narrowed ? narrowingCpuids(mode) : undefined,
  });
}

/** The line under the list once it is there: how many, of how many. */
export function countText(shown: number, entries: readonly MicrocodeCatalogueEntry[]): string {
  if (entries.length === 0) return "";
  const total = catalogueCounts(entries).get("Intel") ?? 0;
  return shown === total ? `${total} Intel microcodes` : `${shown} of ${total} Intel microcodes`;
}

/**
 * What the button says it will do. In replace mode a pick for the row's own
 * processor is an update and anything else a replace; in add mode a CPUID the
 * table already names is replaced rather than added a second time — and the
 * button says which before it is pressed.
 */
export function actionTitle(
  mode: MicrocodeFormMode,
  selected: MicrocodeCatalogueEntry | undefined
): string {
  if (mode.kind === "replace") {
    return selected !== undefined && selected.cpuid === mode.targetCpuid ? "Update" : "Replace";
  }
  return selected?.cpuid !== undefined && mode.cpuidsInTheImage.has(selected.cpuid)
    ? "Replace"
    : "Add";
}

/** A pre-release is worth telling apart before it goes into a board. */
export const releaseText = (entry: MicrocodeCatalogueEntry): string =>
  entry.isProduction ? "PRD" : "pre-release";

export const sizeText = (entry: MicrocodeCatalogueEntry): string =>
  `0x${entry.size.toString(16).toUpperCase()}`;

/** The CPUIDs a table's microcode rows name. */
export function cpuidsOf(rows: readonly { readonly model: FITRow }[]): Set<number> {
  const cpuids = new Set<number>();
  for (const row of rows) {
    if (row.model.target.kind === "microcode") {
      cpuids.add(row.model.target.header.processorSignature);
    }
  }
  return cpuids;
}
