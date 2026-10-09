import { L } from "@/core/localization/localization";
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

/**
 * Why the form is open: to add a microcode, or to replace one row's.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.isReplacing
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.targetCpuids
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.targetCpuidText
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.cpuidsInTheImage
 * @upstream-differs the form's mode as one value, add or replace, rather than four properties
 */
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
      /**
       * The row's CPUIDs, where it names them — the header's own and those its
       * extended table adds: the narrowing, and the "Update" the button says
       * when the pick is for one of the same processors.
       */
      readonly targetCpuids: ReadonlySet<number>;
      /** The same, as the row writes them — `B06A2 + B06A3, B06A8`. */
      readonly targetCpuidText: string | undefined;
    };

/** "Intel" in the title: the list has no vendor picker, so what is shown is said here. */
export function formTitle(mode: MicrocodeFormMode): string {
  return mode.kind === "replace" ? L("Replace Intel Microcode") : L("Add Intel Microcode");
}

/** The checkbox's words: the image's CPUIDs, or in replace mode the row's. */
export function narrowingTitle(mode: MicrocodeFormMode): string {
  return mode.kind === "replace" && mode.targetCpuidText !== undefined
    ? `Only CPUID ${mode.targetCpuidText}`
    : L("Only CPUIDs in this image");
}

/** The CPUIDs the checkbox narrows to. */
export function narrowingCpuids(mode: MicrocodeFormMode): ReadonlySet<number> {
  // In replace mode the narrowing is to the CPUIDs the row names — "replace it
  // with a newer one" — not to everything the image has. An update with an
  // extended table names several, and the catalogue files it under each.
  return mode.kind === "add" ? mode.cpuidsInTheImage : mode.targetCpuids;
}

/**
 * Whether the search field goes away: in replace mode, narrowed to the row's
 * CPUIDs, there is nothing left to search.
 */
export function searchIsHidden(mode: MicrocodeFormMode, narrowed: boolean): boolean {
  return mode.kind === "replace" && narrowed;
}

/**
 * The rows the form shows.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.shown
 */
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
  return shown === total
    ? L("%1$@ Intel microcodes", total)
    : L("%1$@ of %2$@ Intel microcodes", shown, total);
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
    return selected?.cpuid !== undefined && mode.targetCpuids.has(selected.cpuid)
      ? L("Update")
      : L("Replace");
  }
  return selected?.cpuid !== undefined && mode.cpuidsInTheImage.has(selected.cpuid)
    ? L("Replace")
    : L("Add");
}

/** A pre-release is worth telling apart before it goes into a board. */
export const releaseText = (entry: MicrocodeCatalogueEntry): string =>
  entry.isProduction ? L("PRD") : "pre-release";

export const sizeText = (entry: MicrocodeCatalogueEntry): string =>
  `0x${entry.size.toString(16).toUpperCase()}`;

/**
 * The CPUIDs a table's microcode rows name: every processor a microcode serves,
 * the ones its extended table adds included — the catalogue files the same
 * update under each of them.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.show
 */
export function cpuidsOf(rows: readonly { readonly cpuids: readonly number[] }[]): Set<number> {
  return new Set(rows.flatMap((row) => row.cpuids));
}
