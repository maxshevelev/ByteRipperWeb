import {
  type CaseFolding,
  foldingFor,
  parsePattern,
  SEARCH_ENCODINGS,
  type SearchEncoding,
} from "@/core/search/searchPattern";
import {
  formatTimestamp,
  mintId,
  parseTimestamp,
  readId,
  type SyncedItem,
} from "@/core/sync/syncedCollection";

/**
 * A search someone kept: the pattern as they wrote it, the encoding it is read
 * in, how letters compare — and, for a favourite, what it is called (§11).
 *
 * A favourite **is** a recent with a name and nothing else. Beside what the
 * user wrote, an entry carries the bookkeeping a shared library needs: an id of
 * its own, where it sits in the list, when it was last changed and by which
 * machine (`Design/FAVORITES_SYNC_WEB.md`).
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry
 */
export interface SearchPatternEntry extends SyncedItem {
  /**
   * What a favourite is called; empty for a recent.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.name
   */
  readonly name: string;
  /**
   * The text the user wrote, not the bytes it parses to — so an entry stays
   * editable and re-parseable, and `DE AD` and `DEAD` stay two entries.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.pattern
   */
  readonly pattern: string;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.encoding */
  readonly encoding: SearchEncoding;
  /**
   * Whether the search was run case-sensitively. Meaningful only for text
   * encodings: hex is always byte-exact.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.caseSensitive
   */
  readonly caseSensitive: boolean;
}

/**
 * An entry, with the bookkeeping minted where it is not given.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.init
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.id
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.sortKey
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.modifiedAt
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.device
 */
export function searchPatternEntry(fields: {
  readonly pattern: string;
  readonly encoding: SearchEncoding;
  readonly name?: string;
  readonly caseSensitive?: boolean;
  readonly id?: string;
  readonly sortKey?: number;
  readonly modifiedAt?: number;
  readonly device?: string;
}): SearchPatternEntry {
  return {
    id: fields.id ?? mintId(),
    name: fields.name ?? "",
    pattern: fields.pattern,
    encoding: fields.encoding,
    caseSensitive: fields.caseSensitive ?? false,
    sortKey: fields.sortKey ?? 0,
    modifiedAt: fields.modifiedAt ?? Date.now(),
    device: fields.device ?? "",
  };
}

/**
 * Two entries say the same thing when they are the same search under the same
 * name. The id, the order and the time of writing are bookkeeping — upstream's
 * `==`.
 */
export function entriesSayTheSame(one: SearchPatternEntry, other: SearchPatternEntry): boolean {
  return one.name === other.name && isSameSearch(one, other);
}

/**
 * Whether two entries ask the same thing of a file. The name is not part of it:
 * keeping the same search twice under two names is what the library refuses.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.isSameSearch
 */
export function isSameSearch(one: SearchPatternEntry, other: SearchPatternEntry): boolean {
  return (
    one.pattern === other.pattern &&
    one.encoding === other.encoding &&
    one.caseSensitive === other.caseSensitive
  );
}

/**
 * Whether the pattern can still be looked for — false only for a hand-edited
 * file, and then the bar reports it like any other bad pattern.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.isUsable
 */
export function isUsableEntry(entry: SearchPatternEntry): boolean {
  return parsePattern(entry.pattern, entry.encoding).ok;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.folding */
export function entryFolding(entry: SearchPatternEntry): CaseFolding {
  return foldingFor(entry.encoding, entry.caseSensitive);
}

/** The entry as the library file writes it. */
export function encodeSearchPatternEntry(entry: SearchPatternEntry): Record<string, unknown> {
  return {
    id: entry.id,
    name: entry.name,
    pattern: entry.pattern,
    encoding: entry.encoding,
    caseSensitive: entry.caseSensitive,
    sortKey: entry.sortKey,
    modifiedAt: formatTimestamp(entry.modifiedAt),
    device: entry.device,
  };
}

/**
 * Reads one back from the file. The pattern and its encoding are the entry;
 * everything else has an answer when it is missing — which is exactly what
 * reading a library written before ids existed has to do. A field that is there
 * but is not what it says is a file that is not a library.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SearchPatternEntry.swift#SearchPatternEntry.CodingKeys
 */
export function decodeSearchPatternEntry(raw: unknown): SearchPatternEntry {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SyntaxError("An entry is a JSON object.");
  }
  const row = raw as Record<string, unknown>;
  if (typeof row.pattern !== "string") throw new SyntaxError("An entry has a pattern.");
  if (!SEARCH_ENCODINGS.includes(row.encoding as SearchEncoding)) {
    throw new SyntaxError(`Not an encoding: ${String(row.encoding)}`);
  }
  return searchPatternEntry({
    id: row.id === undefined ? mintId() : readId(row.id),
    name: optional(row.name, "string", "name") ?? "",
    pattern: row.pattern,
    encoding: row.encoding as SearchEncoding,
    caseSensitive: optional(row.caseSensitive, "boolean", "caseSensitive") ?? false,
    sortKey: optional(row.sortKey, "number", "sortKey") ?? 0,
    modifiedAt: row.modifiedAt === undefined ? Date.now() : parseTimestamp(row.modifiedAt),
    device: optional(row.device, "string", "device") ?? "",
  });
}

function optional<Kind extends "string" | "boolean" | "number">(
  value: unknown,
  kind: Kind,
  field: string
): (Kind extends "string" ? string : Kind extends "boolean" ? boolean : number) | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== kind) throw new SyntaxError(`${field} is not a ${kind}.`);
  return value as Kind extends "string" ? string : Kind extends "boolean" ? boolean : number;
}
