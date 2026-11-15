import { type MicrocodeUpdate, updateOthers } from "@/firmware/intelCpuid/microcodeSignatures";
import {
  type EntryNotes,
  modelShortName,
  type ProcessorFamily,
} from "@/firmware/intelCpuid/processorFamily";
import { notesOn, type ProcessorTables } from "@/firmware/intelCpuid/processorTables";

/**
 * The search the Intel CPUID Lookup runs over the processor tables: the same rules as the
 * repository's lookup page (`index.html` of IntelCPUID), so a query finds the same rows in both.
 *
 * A query is split into words; a row matches when every word is in its CPUID, model, S-SPECs,
 * code names or steppings, with case, spaces and punctuation ignored — `i72600k` finds
 * `Core i7-2600K`. A CPUID written with an `X` (`606AX`) matches any digit there. Built once per
 * installed table (`cpuidLookupFor`).
 *
 * Ported from `Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift`.
 */

/**
 * One model under one entry: a row of the lookup's table.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row
 */
export interface CpuidLookupRow {
  /**
   * The entry's place in `families`.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.entry
   */
  readonly entry: number;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.cpuids */
  readonly cpuids: readonly string[];
  /**
   * Without the `Intel ` every name starts with.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.name
   */
  readonly name: string;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.sSpecs */
  readonly sSpecs: readonly string[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.steppings */
  readonly steppings: string;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.codeNames */
  readonly codeNames: string;
  /**
   * A line that names a series rather than its models.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.series
   */
  readonly series: boolean;
}

/**
 * What kind of thing a completion is, in the order completions of one rank are offered.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Hint.Kind
 */
export type CpuidHintKind = "cpuid" | "sSpec" | "model" | "codeName";

const HINT_ORDER: Readonly<Record<CpuidHintKind, number>> = {
  cpuid: 0,
  sSpec: 1,
  model: 2,
  codeName: 3,
};

/**
 * A completion offered under the search field.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Hint
 */
export interface CpuidHint {
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Hint.kind */
  readonly kind: CpuidHintKind;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Hint.text */
  readonly text: string;
  /**
   * Said beside it, quieter: an S-SPEC's model, a model's CPUID, a CPUID's code name, a code
   * name's CPUIDs.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Hint.detail
   */
  readonly detail: string;
}

/**
 * One update that serves the heading's CPUIDs, with the others it serves.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Heading.shared
 */
export interface CpuidSharedUpdate {
  readonly update: MicrocodeUpdate;
  readonly others: readonly string[];
}

/**
 * What the lookup shows over its table for a query that is one CPUID.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Heading
 */
export interface CpuidHeading {
  /**
   * The entry, when the table has one for the CPUID.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Heading.family
   */
  readonly family: ProcessorFamily | undefined;
  /**
   * The CPUID the query names — the entry's own, or one no entry has but a microcode update
   * names.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Heading.cpuids
   */
  readonly cpuids: readonly string[];
  /**
   * The updates that serve these CPUIDs and others, newest first, with the others each names.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Heading.shared
   */
  readonly shared: readonly CpuidSharedUpdate[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Heading.notes */
  readonly notes: EntryNotes | undefined;
}

/**
 * A stretch of a text the query was found in: `[start, end)` in the text's UTF-16 units, which
 * is what `String.slice` takes.
 */
export interface CpuidHighlight {
  readonly start: number;
  readonly end: number;
}

/** What a row is searched in, beside it. */
interface Searched {
  readonly haystack: string;
  readonly patterns: readonly string[];
}

/**
 * The lookup over one installed table.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup
 */
export class CpuidLookup {
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.tables */
  readonly tables: ProcessorTables;
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.rows */
  readonly rows: readonly CpuidLookupRow[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.hints */
  readonly hints: readonly CpuidHint[];
  /**
   * Each row's haystack and CPUID patterns, by the row's place.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.haystack
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.patterns
   */
  readonly #searched: readonly Searched[];
  /**
   * Each hint's text normalized, by the hint's place.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Hint.normalized
   */
  readonly #normalized: readonly string[];

  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.init */
  constructor(tables: ProcessorTables) {
    this.tables = tables;
    const rows: CpuidLookupRow[] = [];
    const searched: Searched[] = [];
    const hints: CpuidHint[] = [];
    const normalized: string[] = [];
    const seen = new Map<CpuidHintKind, Set<string>>();
    const hint = (kind: CpuidHintKind, text: string, detail: string) => {
      let texts = seen.get(kind);
      if (texts === undefined) {
        texts = new Set();
        seen.set(kind, texts);
      }
      if (texts.has(text)) return;
      texts.add(text);
      hints.push({ kind, text, detail });
      normalized.push(normalizeCpuidQuery(text));
    };
    tables.families.forEach((family, index) => {
      const cpuids = family.cpuids.join(", ");
      const codeNames = family.codeNames.join(", ");
      const steppings = family.steppings.join(", ");
      for (const cpuid of family.cpuids) hint("cpuid", cpuid, family.codeNames[0] ?? "");
      for (const codeName of family.codeNames) hint("codeName", codeName, cpuids);
      const patterns = family.cpuids
        .filter((cpuid) => cpuid.includes("X"))
        .map((cpuid) => cpuid.toLowerCase());
      for (const model of family.processors) {
        const name = modelShortName(model.name);
        const series = model.series === true;
        rows.push({
          entry: index,
          cpuids: family.cpuids,
          name,
          sSpecs: model.sSpec,
          steppings,
          codeNames,
          series,
        });
        searched.push({
          haystack: [
            normalizeCpuidQuery(cpuids),
            normalizeCpuidQuery(model.name),
            model.sSpec.map(normalizeCpuidQuery).join("|"),
            normalizeCpuidQuery(codeNames),
            normalizeCpuidQuery(steppings),
          ].join("|"),
          patterns,
        });
        if (!series) hint("model", name, family.cpuids[0] ?? "");
        for (const sSpec of model.sSpec) hint("sSpec", sSpec, name);
      }
    });
    this.rows = rows;
    this.hints = hints;
    this.#searched = searched;
    this.#normalized = normalized;
  }

  /**
   * The models the table lists, series left out.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.modelCount
   */
  get modelCount(): number {
    return this.rows.filter((row) => !row.series).length;
  }

  /**
   * The CPUIDs the table has entries for, each once.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.cpuidCount
   */
  get cpuidCount(): number {
    return new Set(this.tables.families.flatMap((family) => family.cpuids)).size;
  }

  /**
   * The rows every word of `query` is in, in the table's order. An empty query is every row.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.rows
   */
  rowsMatching(query: string): CpuidLookupRow[] {
    const words = cpuidQueryWords(query);
    if (words.length === 0) return [...this.rows];
    return this.rows.filter((_, index) => {
      const searched = this.#searched[index];
      return searched !== undefined && words.every((word) => matches(searched, word));
    });
  }

  /**
   * What the lookup says over the table for `query`: the entries whose CPUID the query is, whole
   * — or, where no entry has it, the CPUID as a microcode update names it. Empty for anything
   * else.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.headings
   */
  headings(query: string): CpuidHeading[] {
    const words = cpuidQueryWords(query);
    const word = words[0];
    if (words.length !== 1 || word === undefined) return [];
    const named = this.tables.families.filter((family) =>
      family.cpuids.some((cpuid) => normalizeCpuidQuery(cpuid) === word)
    );
    if (named.length > 0) {
      return named.map((family) => ({
        family,
        cpuids: family.cpuids,
        shared: this.#shared(family.cpuids),
        notes: notesOn(this.tables, family),
      }));
    }
    const lone = [...this.tables.microcode.cpuids].find(
      (cpuid) => normalizeCpuidQuery(cpuid) === word
    );
    if (lone === undefined) return [];
    return [{ family: undefined, cpuids: [lone], shared: this.#shared([lone]), notes: undefined }];
  }

  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.shared */
  #shared(cpuids: readonly string[]): CpuidSharedUpdate[] {
    const seen: MicrocodeUpdate[] = [];
    for (const cpuid of cpuids) {
      for (const update of this.tables.microcode.updatesServing(cpuid)) {
        if (!seen.includes(update)) seen.push(update);
      }
    }
    return seen.map((update) => ({ update, others: updateOthers(update, cpuids) }));
  }

  /**
   * Up to `limit` completions of `query`: those that start with it before those that only
   * contain it; CPUIDs, then S-SPECs, models and code names; the shorter first. Nothing that is
   * the query already.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.hints
   */
  hintsFor(query: string, limit = 8): CpuidHint[] {
    const wanted = normalizeCpuidQuery(query);
    if (wanted.length === 0) return [];
    const offered: { hint: CpuidHint; rank: number; length: number }[] = [];
    this.hints.forEach((hint, index) => {
      const normalized = this.#normalized[index] ?? "";
      if (!normalized.includes(wanted) || normalized === wanted) return;
      offered.push({
        hint,
        rank: (normalized.startsWith(wanted) ? 1 : 2) * 10 + HINT_ORDER[hint.kind],
        length: [...hint.text].length,
      });
    });
    return offered
      .sort(
        (a, b) =>
          a.rank - b.rank || a.length - b.length || standardCompare(a.hint.text, b.hint.text)
      )
      .slice(0, limit)
      .map((one) => one.hint);
  }
}

/** The lookup built for each table installed, so a table is indexed once however often it is read. */
const built = new WeakMap<ProcessorTables, CpuidLookup>();

/**
 * The lookup over `tables`, built the first time it is asked for.
 *
 * @upstream ByteRipperApp/CPUIDLookup/CPUIDLookupViewController.swift#CPUIDLookupViewController.tablesChanged
 * @upstream-differs memoised by the tables it is built from, where upstream's window builds one on
 * every change it hears of
 */
export function cpuidLookupFor(tables: ProcessorTables): CpuidLookup {
  let lookup = built.get(tables);
  if (lookup === undefined) {
    lookup = new CpuidLookup(tables);
    built.set(tables, lookup);
  }
  return lookup;
}

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.Row.matches */
function matches(searched: Searched, word: string): boolean {
  return (
    searched.haystack.includes(word) ||
    searched.patterns.some(
      (pattern) =>
        pattern.length === word.length &&
        [...pattern].every((p, at) => {
          const w = word[at] ?? "";
          return p === "x" ? /^[0-9a-f]$/.test(w) : p === w;
        })
    )
  );
}

/**
 * Finder's order, as `localizedStandardCompare` gives it: case ignored, digits read as numbers.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * `localizedStandardCompare`: what the lookup sorts names by.
 *
 * @upstream-differs `Intl.Collator` with numeric order and case ignored, which is what Foundation's
 * standard comparison does
 */
export function standardCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * Lower case, Latin and Cyrillic letters, digits and `+` only: what a query and a row are
 * compared in.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.normalize
 */
export function normalizeCpuidQuery(text: string): string {
  let out = "";
  for (const character of text.toLowerCase()) {
    if (
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9") ||
      (character >= "а" && character <= "я") ||
      character === "+"
    ) {
      out += character;
    }
  }
  return out;
}

/**
 * The query's words, normalized; the empty ones dropped.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.words
 */
export function cpuidQueryWords(query: string): string[] {
  return query
    .split(/\s+/u)
    .map(normalizeCpuidQuery)
    .filter((word) => word.length > 0);
}

/**
 * The stretches of `text` the words of `query` are found in, as the text is written: a word may
 * span characters the search ignores — `i72600` lights `i7-2600`.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#CPUIDLookup.highlights
 */
export function cpuidHighlights(text: string, query: string): CpuidHighlight[] {
  const words = cpuidQueryWords(query);
  if (words.length === 0) return [];
  // Each character of the text kept by the search, and where in the text it stands.
  const flat: string[] = [];
  const origin: number[] = [];
  /** Where each character of the text starts, and where it ends. */
  const characters: { start: number; end: number }[] = [];
  let at = 0;
  for (const character of text) {
    const index = characters.length;
    characters.push({ start: at, end: at + character.length });
    at += character.length;
    for (const kept of normalizeCpuidQuery(character)) {
      flat.push(kept);
      origin.push(index);
    }
  }
  const lit = new Set<number>();
  for (const word of words.map((one) => [...one])) {
    if (word.length > flat.length) continue;
    for (let start = 0; start <= flat.length - word.length; start += 1) {
      if (!word.every((character, offset) => flat[start + offset] === character)) continue;
      // From its first character to its last as written, the ignored ones between included.
      const first = origin[start] ?? 0;
      const last = origin[start + word.length - 1] ?? first;
      for (let index = first; index <= last; index += 1) lit.add(index);
    }
  }
  const ranges: CpuidHighlight[] = [];
  let open: number | undefined;
  characters.forEach((character, index) => {
    if (lit.has(index)) {
      if (open === undefined) open = character.start;
    } else if (open !== undefined) {
      ranges.push({ start: open, end: character.start });
      open = undefined;
    }
  });
  if (open !== undefined) ranges.push({ start: open, end: text.length });
  return ranges;
}

/**
 * How many searches the lookup's menu keeps.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#SearchHistory.limit
 */
export const CPUID_SEARCH_HISTORY_LIMIT = 10;

/**
 * The last searches, newest first — what the search field offers before anything is typed:
 * `query` put first. It replaces itself and what was typed on the way to it (`SR0` before
 * `SR00C`); the oldest falls off past the limit.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#SearchHistory
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/CPUIDLookup.swift#SearchHistory.remembering
 */
export function rememberingCpuidSearch(query: string, history: readonly string[]): string[] {
  const tidy = query
    .split(/\s+/u)
    .filter((word) => word.length > 0)
    .join(" ");
  const normalized = normalizeCpuidQuery(tidy);
  if (normalized.length === 0) return [...history];
  const rest = history.filter((kept) => !normalized.startsWith(normalizeCpuidQuery(kept)));
  return [tidy, ...rest].slice(0, CPUID_SEARCH_HISTORY_LIMIT);
}
