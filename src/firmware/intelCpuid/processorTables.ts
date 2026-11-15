import {
  MicrocodeSignatures,
  type MicrocodeUpdate,
} from "@/firmware/intelCpuid/microcodeSignatures";
import {
  type EntryEvidence,
  type EntryNotes,
  familyKey,
  type ProcessorFamily,
  type ProcessorModel,
} from "@/firmware/intelCpuid/processorFamily";

/**
 * The tables that say which processors stand behind a CPUID: the models
 * (`ProcessorFamily`), the microcode updates that serve several CPUIDs
 * (`MicrocodeSignatures`), and what the repository says of the entries the
 * article lacks (`EntryNotes`).
 *
 * They are not part of the app. They live in the public repository
 * `github.com/maxshevelev/IntelCPUID`, which the repository source
 * (`src/state/intelCpuidRepository.ts`) reads at run time, so a correction
 * there reaches every bench without a new build. There is one copy in the page
 * — `currentProcessorTables()` — and every reader reads it: the FIT panel, its
 * microcode form, the agent's tools, and the CPUID lookup that is to come.
 * Until something is installed — a first run with no network and no copy kept
 * from an earlier one — the tables are empty, and every CPUID is one they do
 * not know.
 *
 * Ported from `Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift`.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.init
 */
export interface ProcessorTables {
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.families */
  readonly families: readonly ProcessorFamily[];
  /** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.microcode */
  readonly microcode: MicrocodeSignatures;
  /**
   * By `familyKey`.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.notes
   */
  readonly notes: ReadonlyMap<string, EntryNotes>;
  /**
   * The day the table's sources were last read, as the file says it —
   * `2026-11-14`. Undefined when it does not say.
   *
   * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.retrieved
   */
  readonly retrieved: string | undefined;
}

/**
 * The one format this build reads. A file of a newer one is refused, not
 * guessed at, and the tables in hand are kept.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.formatVersion
 */
export const PROCESSOR_TABLES_FORMAT_VERSION = 1;

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.empty */
export const EMPTY_PROCESSOR_TABLES: ProcessorTables = {
  families: [],
  microcode: new MicrocodeSignatures([]),
  notes: new Map(),
  retrieved: undefined,
};

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.isEmpty */
export const processorTablesAreEmpty = (tables: ProcessorTables): boolean =>
  tables.families.length === 0;

/** The two files, by the names the repository gives them. */
export const BRAND_NAMES_FILE = "IntelCPUIDBrandNames.json";
export const SIGNATURES_FILE = "IntelMicrocodeSignatures.json";

/**
 * Why a file was refused.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.DecodeError
 */
export class ProcessorTablesDecodeError extends Error {
  readonly reason:
    | {
        /** The file says it is of a format this build does not read. */
        readonly kind: "unsupportedFormat";
        readonly file: string;
        readonly version: number;
      }
    | {
        /** The file is not the JSON this build reads. */
        readonly kind: "malformed";
        readonly file: string;
      };

  constructor(reason: ProcessorTablesDecodeError["reason"]) {
    super(
      reason.kind === "unsupportedFormat"
        ? `${reason.file} is of format ${reason.version}, newer than this build reads`
        : `${reason.file} is not the JSON this build reads`
    );
    this.name = "ProcessorTablesDecodeError";
    this.reason = reason;
  }
}

/** One of the two files, read alone: what the pair is made of. */
export interface BrandNamesFile {
  readonly entries: readonly ProcessorFamily[];
  readonly retrieved: string | undefined;
}

/**
 * `IntelCPUIDBrandNames.json`, read alone: refused when it is not the JSON this
 * build reads, or says a format newer than it reads — or none.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.decode
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.init
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.init
 * @upstream-differs each file is decoded on its own as it arrives, so the repository source can
 * refuse one before it is kept; `decodeProcessorTables` puts the pair together as upstream's one
 * call does
 */
export function decodeBrandNames(text: string): BrandNamesFile {
  const file = BRAND_NAMES_FILE;
  const json = parseJson(text, file);
  const entries = json.entries;
  if (!Array.isArray(entries)) throw malformed(file);
  checkFormat(json.formatVersion, file);
  const source = json.source;
  const retrieved =
    isObject(source) && typeof source.retrieved === "string" ? source.retrieved : undefined;
  return { entries: entries.map((one) => family(one, file)), retrieved };
}

/**
 * `IntelMicrocodeSignatures.json`, read alone, refused as the brand names are.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.decode
 * @upstream-differs read on its own, as `decodeBrandNames` is
 */
export function decodeSignatures(text: string): MicrocodeSignatures {
  const file = SIGNATURES_FILE;
  const json = parseJson(text, file);
  const updates = json.updates;
  if (!Array.isArray(updates)) throw malformed(file);
  checkFormat(json.formatVersion, file);
  return new MicrocodeSignatures(updates.map((one) => update(one, file)));
}

/**
 * `IntelCPUIDBrandNames.json` and `IntelMicrocodeSignatures.json`, read
 * together: one that fails is a reason to keep both as they are. The notes are
 * what the tables can do without: a file that does not read leaves them empty,
 * and the tables stand.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.decode
 */
export function decodeProcessorTables(
  brandNames: string,
  signatures: string,
  notes?: string
): ProcessorTables {
  return processorTablesOf(
    decodeBrandNames(brandNames),
    decodeSignatures(signatures),
    notes === undefined ? new Map() : decodeNotes(notes)
  );
}

/** The pair, each already read, and the notes. */
export function processorTablesOf(
  names: BrandNamesFile,
  microcode: MicrocodeSignatures,
  notes: ReadonlyMap<string, EntryNotes>
): ProcessorTables {
  return { families: names.entries, microcode, notes, retrieved: names.retrieved };
}

/**
 * The generator's `extra-entries.json`: its entries' notes and pages, by the
 * entry they are of. An entry that does not read is left out, not the file;
 * a file that does not read at all is no notes.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.decodeNotes
 */
export function decodeNotes(text: string): ReadonlyMap<string, EntryNotes> {
  const notes = new Map<string, EntryNotes>();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return notes;
  }
  if (!isObject(json) || !Array.isArray(json.entries)) return notes;
  for (const entry of json.entries) {
    if (!isObject(entry)) continue;
    const { cpuids, codeNames, note, evidence } = entry;
    if (!isStrings(cpuids) || !isStrings(codeNames)) continue;
    if (note !== undefined && note !== null && typeof note !== "string") continue;
    let pages: EntryEvidence[] = [];
    if (evidence !== undefined && evidence !== null) {
      if (!Array.isArray(evidence)) continue;
      const read = evidence.map(evidenceOf);
      if (read.some((one) => one === undefined)) continue;
      pages = read as EntryEvidence[];
    }
    notes.set(familyKey({ cpuids, codeNames }), {
      note: typeof note === "string" ? note : undefined,
      evidence: pages,
    });
  }
  return notes;
}

/**
 * What the repository says of `family` beyond the table, if anything.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.notes
 */
export function notesOn(tables: ProcessorTables, family: ProcessorFamily): EntryNotes | undefined {
  return tables.notes.get(familyKey(family));
}

// MARK: - The tables this page uses

let current: ProcessorTables = EMPTY_PROCESSOR_TABLES;
const listeners = new Set<() => void>();

/**
 * What the table says now: the last tables installed, or nothing.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.current
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.store
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.Store
 * @upstream-differs a module's own variable, where upstream locks a class around it: a page has
 * one thread
 */
export function currentProcessorTables(): ProcessorTables {
  return current;
}

/**
 * Makes `tables` the ones every lookup reads from now on, and tells whatever
 * shows processor names to show them again.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.install
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.didChange
 */
export function installProcessorTables(tables: ProcessorTables): void {
  if (tables === current) return;
  current = tables;
  for (const listener of [...listeners]) listener();
}

/**
 * Hears every install; returns its own removal.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.didChange
 * @upstream-differs a listener rather than a notification posted on the main queue
 */
export function onProcessorTablesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// MARK: - Reading

type JsonObject = { readonly [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((one) => typeof one === "string");
}

function malformed(file: string): ProcessorTablesDecodeError {
  return new ProcessorTablesDecodeError({ kind: "malformed", file });
}

function parseJson(text: string, file: string): JsonObject {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw malformed(file);
  }
  if (!isObject(json)) throw malformed(file);
  return json;
}

/** A file that says no format, or a newer one than this build reads, is refused. */
function checkFormat(version: unknown, file: string): void {
  if (version !== undefined && version !== null && typeof version !== "number") {
    throw malformed(file);
  }
  if (typeof version !== "number" || version > PROCESSOR_TABLES_FORMAT_VERSION) {
    throw new ProcessorTablesDecodeError({
      kind: "unsupportedFormat",
      file,
      version: typeof version === "number" ? version : 0,
    });
  }
}

function strings(value: unknown, file: string): string[] {
  if (!isStrings(value)) throw malformed(file);
  return value;
}

function optionalStrings(value: unknown, file: string): string[] {
  return value === undefined || value === null ? [] : strings(value, file);
}

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorFamily.init */
function family(value: unknown, file: string): ProcessorFamily {
  if (!isObject(value) || !Array.isArray(value.processors)) throw malformed(file);
  return {
    cpuids: strings(value.cpuids, file),
    codeNames: strings(value.codeNames, file),
    productFamilies: strings(value.productFamilies, file),
    steppings: strings(value.steppings, file),
    segments: strings(value.segments, file),
    processors: value.processors.map((one) => model(one, file)),
    cores: optionalStrings(value.cores, file),
  };
}

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#ProcessorModel.init */
function model(value: unknown, file: string): ProcessorModel {
  if (!isObject(value) || typeof value.name !== "string") throw malformed(file);
  const source = value.sSpecSource;
  if (
    source !== undefined &&
    source !== null &&
    !(isObject(source) && Object.values(source).every((one) => typeof one === "string"))
  ) {
    throw malformed(file);
  }
  const series = value.series;
  if (series !== undefined && series !== null && typeof series !== "boolean") throw malformed(file);
  return {
    name: value.name,
    sSpec: optionalStrings(value.sSpec, file),
    sSpecSource: (source as Readonly<Record<string, string>> | null | undefined) ?? undefined,
    series: series ?? undefined,
  };
}

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/MicrocodeSignatures.swift#MicrocodeSignatures.Update.init */
function update(value: unknown, file: string): MicrocodeUpdate {
  if (
    !isObject(value) ||
    typeof value.revision !== "string" ||
    typeof value.date !== "string" ||
    !Array.isArray(value.signatures)
  ) {
    throw malformed(file);
  }
  return {
    revision: value.revision,
    date: value.date,
    signatures: value.signatures.map((one) => {
      if (!isObject(one) || typeof one.cpuid !== "string" || typeof one.platforms !== "string") {
        throw malformed(file);
      }
      return { cpuid: one.cpuid, platforms: one.platforms };
    }),
    files: strings(value.files, file),
  };
}

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorFamily.swift#EntryNotes.Evidence.init */
function evidenceOf(value: unknown): EntryEvidence | undefined {
  if (!isObject(value) || typeof value.url !== "string") return undefined;
  const quote = value.quote ?? "";
  const gives = value.gives ?? [];
  if (typeof quote !== "string" || !isStrings(gives)) return undefined;
  return { url: value.url, quote, gives };
}
