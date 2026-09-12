import type { MicrocodeHeader } from "@/firmware/uefi/microcodeParser";

/**
 * The list of what can be added, read from the repository's file names.
 *
 * Downloading is not this module's business — it has no network in it — but
 * *understanding* the list is, so the whole of it is tested over a fixture the
 * size of a paragraph.
 *
 * Ported from `Modules/FITTool/MicrocodeCatalogue.swift`.
 */

/**
 * The four kinds of microcode the collection holds, one directory each.
 *
 * Only Intel can go into a FIT — the table names nothing else — so only Intel
 * is ever offered. The other three are read all the same, because the listing
 * is of the whole repository and telling them apart is what keeps AMD's names
 * from being read as Intel's.
 */
export const MICROCODE_VENDORS = ["Intel", "AMD", "VIA", "Freescale"] as const;

export type MicrocodeVendor = (typeof MICROCODE_VENDORS)[number];

/**
 * One microcode file in the catalogue.
 *
 * Everything here is read out of the file's *name*: the collection at
 * `github.com/platomav/CPUMicrocodes` encodes what a person needs to choose by
 * into it, which is what makes thousands of files searchable without
 * downloading any of them.
 *
 * ```
 * Intel:     cpu906EB_plat02_ver0000007C_2017-12-03_PRD_5046D998.bin
 * AMD:       cpu00800F11_ver08001129_2017-07-14_4F426450.bin
 * VIA:       cpu10690_ver00000001_sig[BJ_10690.020]_2017-01-09_A8B24DC2.bin
 * Freescale: soc8360_rev2.1_sig[Soft-UART]_3725F40B.bin
 * ```
 *
 * The four disagree about almost everything: only Intel has a platform id, and
 * Freescale has no CPUID and no hexadecimal revision at all. So the fields not
 * everyone has are optional, and the text ones are what the panel shows.
 */
export interface MicrocodeCatalogueEntry {
  readonly vendor: MicrocodeVendor;
  /** The path in the repository, which is also its identity. */
  readonly path: string;
  /**
   * The processor it is for, where that is a number. Nothing for Freescale,
   * whose files name a system-on-chip instead.
   */
  readonly cpuid: number | undefined;
  /**
   * What identifies the processor, as the file name writes it: `906EB` for
   * Intel and AMD, `8360` for a Freescale SoC.
   */
  readonly cpuidText: string;
  /** The platform ids this update is for, as a bit mask. Intel only. */
  readonly platformID: number | undefined;
  /** The revision, as written: `7C`, or `2.1` for Freescale. */
  readonly revisionText: string;
  /** `2017-12-03`, as written. Empty where the name carries no date. */
  readonly date: string;
  /** `PRD` rather than `PRE`: released rather than pre-release. */
  readonly isProduction: boolean;
  readonly size: number;
}

/**
 * Two hex digits at least, the way the file name writes it: `plat02`, not
 * `plat2`.
 */
export function platformText(entry: MicrocodeCatalogueEntry): string {
  if (entry.platformID === undefined) return "";
  return entry.platformID.toString(16).toUpperCase().padStart(2, "0");
}

export function entryFileName(entry: MicrocodeCatalogueEntry): string {
  return entry.path.split("/").at(-1) ?? entry.path;
}

/**
 * The revision as a number, where the file name writes one: `7C` reads as
 * 0x7C. Nothing for Freescale, whose `2.1` is no hexadecimal — one more way in
 * which it is not like the other three.
 */
export function entryRevision(entry: MicrocodeCatalogueEntry): number | undefined {
  return parseHex(entry.revisionText);
}

/**
 * How one installed microcode stands against the catalogue: is there a newer
 * revision out there for the same processor and platform?
 *
 * A value rather than a question asked against a live fetch, so a row's verdict
 * is decided here and unit tested. The panel turns it into a mark in the Type
 * column — one where the row is newest, another where the catalogue has newer —
 * and nothing where there is no basis for a verdict.
 */
export type MicrocodeLatest =
  /**
   * The newest revision the catalogue lists among the updates that serve this
   * board — whichever platform of the installed update's set it is on.
   */
  | { readonly kind: "latest" }
  /**
   * The catalogue holds a newer one that serves this board whatever its
   * platform — which, so the panel can name it.
   */
  | { readonly kind: "outdated"; readonly newestRevision: number }
  /**
   * The catalogue holds a newer revision for this CPUID whose platform set
   * *overlaps* the installed update's without covering it, so whether it serves
   * this board depends on which platform the board actually is — which only the
   * board's own `IA32_PLATFORM_ID` says, and an image does not carry it. Named
   * so the panel can say what the doubt is about.
   */
  | { readonly kind: "undecided"; readonly newestRevision: number }
  /**
   * No basis for a verdict: no catalogue yet, nothing it holds for this CPUID,
   * nothing whose platform set meets this one's, or a revision newer than any
   * it lists — the collection is behind the board.
   */
  | { readonly kind: "notRated" };

export const NOT_RATED: MicrocodeLatest = { kind: "notRated" };

/**
 * Parses GitHub's recursive tree listing — one request for the whole
 * repository, where the contents API would need a page per directory.
 */
export function entriesFromTree(json: string): MicrocodeCatalogueEntry[] {
  const parsed: unknown = JSON.parse(json);
  const tree = (parsed as { tree?: unknown }).tree;
  if (!Array.isArray(tree)) throw new Error("That listing has no tree in it.");

  const entries: MicrocodeCatalogueEntry[] = [];
  for (const node of tree) {
    const one = node as { path?: unknown; type?: unknown; size?: unknown };
    if (one.type !== "blob" || typeof one.path !== "string") continue;
    const entry = entryAt(one.path, typeof one.size === "number" ? one.size : 0);
    if (entry !== undefined) entries.push(entry);
  }
  // Shortest identifier first, then alphabetically — which puts `906EA` beside
  // `906EB` rather than between two of AMD's eight-digit names.
  return entries.sort(
    (left, right) =>
      left.cpuidText.length - right.cpuidText.length ||
      compare(left.cpuidText, right.cpuidText) ||
      compare(left.revisionText, right.revisionText)
  );
}

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * Reads one file name. Nothing for anything that is not a microcode file —
 * every directory holds a licence too.
 */
export function entryAt(path: string, size: number): MicrocodeCatalogueEntry | undefined {
  const vendor = MICROCODE_VENDORS.find((one) => path.startsWith(`${one}/`));
  if (vendor === undefined) return undefined;
  const name = path.split("/").at(-1) ?? "";
  if (!name.endsWith(".bin")) return undefined;
  const fields = name.slice(0, -4).split("_");

  const field = (prefix: string): string | undefined => {
    const found = fields.find((one) => one.startsWith(prefix));
    return found === undefined ? undefined : found.slice(prefix.length);
  };

  // Freescale names a SoC where everyone else names a CPUID, and its revision
  // is `2.1` rather than a hexadecimal number. `soc8360` reads as valid
  // hexadecimal, which is exactly why the two are told apart by the field they
  // came from rather than by whether they parse.
  const processor = field("cpu");
  const identifier = processor ?? field("soc");
  if (identifier === undefined) return undefined;
  const revision = field("ver") ?? field("rev");
  if (revision === undefined) return undefined;

  // The date is the field shaped like one; not every name has one.
  const date = fields.find((one) => one.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(one));
  const cpuid = processor === undefined ? undefined : parseHex(processor);
  const revisionValue = parseHex(revision);

  return {
    vendor,
    path,
    cpuid,
    // Leading zeros dropped, so a search for what is on screen matches: AMD
    // writes `00800F11` where Intel writes `906EB`.
    cpuidText: cpuid === undefined ? identifier : cpuid.toString(16).toUpperCase(),
    platformID: parseHex(field("plat") ?? ""),
    revisionText: revisionValue === undefined ? revision : revisionValue.toString(16).toUpperCase(),
    date: date ?? "",
    isProduction: !fields.includes("PRE"),
    size,
  };
}

/**
 * What the form shows: one vendor's microcode, narrowed by what the user typed.
 * "Vendor" and not "platform" throughout, because Intel's names carry a `plat`
 * field that means something else.
 *
 * `cpuidsInTheImage` is the narrowing a bench asks for by hand: a dump is for
 * one board, and what is worth adding to it is usually a newer revision of a
 * CPUID its table already names.
 */
export function filterCatalogue(
  entries: readonly MicrocodeCatalogueEntry[],
  options: {
    readonly vendor?: MicrocodeVendor | undefined;
    readonly search?: string;
    readonly cpuidsInTheImage?: ReadonlySet<number> | undefined;
  } = {}
): MicrocodeCatalogueEntry[] {
  const needle = (options.search ?? "").trim().toUpperCase();
  return entries.filter((entry) => {
    if (options.vendor !== undefined && entry.vendor !== options.vendor) return false;
    if (options.cpuidsInTheImage !== undefined) {
      if (entry.cpuid === undefined || !options.cpuidsInTheImage.has(entry.cpuid)) return false;
    }
    if (needle.length === 0) return true;
    // A search is by the CPUID — what a bench writes down and looks up — and by
    // nothing else: the revision and the file name are the catalogue's, and
    // matching them is a guess about which the user meant.
    return entry.cpuidText.startsWith(needle);
  });
}

/**
 * How many there are of each, for the picker — a vendor the collection has
 * nothing for is worth showing as empty rather than hiding.
 */
export function catalogueCounts(
  entries: readonly MicrocodeCatalogueEntry[]
): Map<MicrocodeVendor, number> {
  const counts = new Map<MicrocodeVendor, number>();
  for (const entry of entries) counts.set(entry.vendor, (counts.get(entry.vendor) ?? 0) + 1);
  return counts;
}

/**
 * Whether an installed microcode is the newest the catalogue lists for its
 * processor and platform.
 *
 * The platform field is a *set*, and that is what makes this more than a
 * comparison of numbers.
 *
 * A processor has one platform id — three bits of `IA32_PLATFORM_ID`
 * (MSR 0x17, bits 52:50). An update's `Processor Flags` is a bit mask of the
 * platform ids it serves: "the three platform ID bits … indicate the bit
 * position in the microcode update header's processor flags field associated
 * with the installed processor", and "each set bit represents a different
 * platform ID that the update supports" (Intel SDM Vol. 3A §9.11). So an update
 * serves a processor when the processor's one bit is in the update's mask — the
 * test Linux writes as `cpu.pf & update.pf`, with an all-zero mask meaning every
 * platform.
 *
 * An image does not carry `IA32_PLATFORM_ID`. All this knows is the mask of the
 * update that is *installed*, which the board must be served by — so the
 * board's bit is somewhere in that mask, and no narrower than that. Three
 * answers follow, and the middle one is the reason this is not a two-way
 * decision:
 *
 * - the candidate's mask covers the whole installed mask (or is the
 *   all-platforms zero): it serves this board whichever bit the board is, and
 *   its revision counts.
 * - the two masks meet but the candidate does not cover: it serves this board
 *   only for some of the bits the board might be. A newer revision there is a
 *   real possibility, not a verdict — undecided.
 * - the masks do not meet at all: that update is for other boards, and its
 *   revision says nothing here.
 *
 * A revision newer than anything the catalogue lists is not "latest": the
 * collection is behind the board, and a behind catalogue cannot confirm what it
 * does not know.
 */
export function latestOf(
  header: MicrocodeHeader,
  entries: readonly MicrocodeCatalogueEntry[]
): MicrocodeLatest {
  // Which platform bits the board can be. An installed update that serves every
  // platform narrows nothing, so the board is any of the eight a three-bit id
  // can name.
  const candidates = header.platformIDs === 0 ? 0xff : header.platformIDs;

  let newestCertain: number | undefined;
  let newestPossible: number | undefined;
  for (const entry of entries) {
    if (entry.cpuid !== header.processorSignature) continue;
    const revision = entryRevision(entry);
    if (revision === undefined) continue;
    const mask = entry.platformID ?? 0;
    if (mask === 0 || (candidates & ~mask) === 0) {
      newestCertain = Math.max(newestCertain ?? revision, revision);
    } else if ((candidates & mask) !== 0) {
      newestPossible = Math.max(newestPossible ?? revision, revision);
    }
  }

  // A doubt only matters when what is behind it is newer than what is
  // installed; an older or equal maybe changes nothing.
  const doubt: MicrocodeLatest | undefined =
    newestPossible !== undefined && newestPossible > header.updateRevision
      ? { kind: "undecided", newestRevision: newestPossible }
      : undefined;

  if (newestCertain === undefined) return doubt ?? NOT_RATED;
  if (header.updateRevision < newestCertain) {
    return { kind: "outdated", newestRevision: newestCertain };
  }
  if (header.updateRevision === newestCertain) {
    // Newest of the ones that certainly serve this board — but a newer one that
    // *might* still leaves the question open.
    return doubt ?? { kind: "latest" };
  }
  // Newer than anything the catalogue can confirm for this board.
  return doubt ?? NOT_RATED;
}

/** A hex field, or nothing when it is not one. */
function parseHex(text: string): number | undefined {
  if (text.length === 0 || !/^[0-9a-fA-F]+$/.test(text)) return undefined;
  const value = Number.parseInt(text, 16);
  return Number.isSafeInteger(value) ? value : undefined;
}
