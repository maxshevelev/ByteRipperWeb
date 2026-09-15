import {
  EMPTY_VECTOR,
  readVector,
  type VersionVector,
  vectorsEqual,
} from "@/core/sync/versionVector";

/**
 * A collection several machines keep in step, and the file it is written as
 * (`Design/FAVORITES_SYNC_WEB.md`).
 *
 * The favourites are the first of these, and nothing about carrying them
 * between machines is about *patterns*: an item needs an identity of its own, a
 * place in the order, when it last changed and which machine changed it, and
 * the merge does the rest.
 *
 * The file format is upstream's, byte for byte where it matters and field for
 * field everywhere: the web edition takes part in the same folder as the macOS
 * app, so a file one writes is a file the other has to read.
 */

/**
 * One thing a synced collection holds.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedItem
 */
export interface SyncedItem {
  /**
   * The item's own identity, minted once and kept for its lifetime: what makes
   * a rename a rename rather than a deletion plus an addition. An upper-case
   * UUID, as Foundation writes one.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedItem.id
   */
  readonly id: string;
  /**
   * Where it sits in the list: a number between its neighbours', not an index
   * — two machines renumbering the same list have nothing left to merge.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedItem.sortKey
   */
  readonly sortKey: number;
  /**
   * When it last changed, in milliseconds since the epoch, by the clock of the
   * machine that changed it. A tiebreak, never the arbiter of a merge.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedItem.modifiedAt
   */
  readonly modifiedAt: number;
  /**
   * The machine that last changed it, or empty where that is unknown.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedItem.device
   */
  readonly device: string;
}

/**
 * What a collection has to say about its items for the merge to work over them.
 *
 * Upstream gets the first two from the item's own `Equatable` conformance and
 * `isDuplicate(of:)`, and the last two from `Codable`; a TypeScript object has
 * none of those, so they are handed over.
 */
export interface SyncItemRules<Item extends SyncedItem> {
  /**
   * Whether two items say the same thing — content only, not identity, order or
   * time. What "did both sides change this the same way" is asked of.
   */
  readonly sameContent: (one: Item, other: Item) => boolean;
  /**
   * Whether two items are the same thing said twice, where the collection
   * refuses to hold it twice. Collections with no such rule answer no.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedItem.isDuplicate
   */
  readonly isDuplicate: (one: Item, other: Item) => boolean;
  /** The item as its file writes it. */
  readonly encode: (item: Item) => Record<string, unknown>;
  /** The item read back, or a throw for a row that is not one. */
  readonly decode: (raw: unknown) => Item;
}

/**
 * A deleted item: which one, when, and by whom.
 *
 * Kept long enough for another machine to hear about it, because without it
 * "you deleted it" and "you never had it" are the same absence, and a merge
 * resurrects whatever either side removed.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncTombstone
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncTombstone.init
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.Tombstone
 */
export interface SyncTombstone {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncTombstone.id */
  readonly id: string;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncTombstone.deletedAt */
  readonly deletedAt: number;
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncTombstone.device */
  readonly device: string;
}

/**
 * The format a file is written in. Read back defensively: a file from a newer
 * build is not thrown away, it is read for what this build knows.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#Sync
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#Sync.currentFormat
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.currentFormat
 */
export const SYNC_FORMAT = 1;

/**
 * The gap left between neighbours in the order. Large enough that inserting
 * between two of them repeatedly halves for a long time before the numbers get
 * close.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#Sync.sortKeyStep
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.sortKeyStep
 */
export const SORT_KEY_STEP = 1024;

/**
 * How long a deletion is remembered. Long enough for a machine that was off for
 * a holiday to hear about it; short enough that the file does not grow forever.
 * Getting it wrong resurrects an item.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#Sync.tombstoneLifetime
 */
export const TOMBSTONE_LIFETIME_MS = 30 * 24 * 3600 * 1000;

/**
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection
 */
export interface SyncedCollection<Item extends SyncedItem> {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.format */
  readonly format: number;
  /**
   * The kept items. Their order is their sort keys', not the array's.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.entries
   */
  readonly entries: readonly Item[];
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.tombstones */
  readonly tombstones: readonly SyncTombstone[];
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.vector */
  readonly vector: VersionVector;
  /**
   * Which machine wrote this copy, in the words its owner uses. For a person
   * reading the folder, and for nothing else — which is why it is not part of
   * {@link collectionsEqual}.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.machine
   */
  readonly machine: string;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.init */
export function syncedCollection<Item extends SyncedItem>(
  fields: Partial<SyncedCollection<Item>> = {}
): SyncedCollection<Item> {
  return {
    format: fields.format ?? SYNC_FORMAT,
    entries: fields.entries ?? [],
    tombstones: fields.tombstones ?? [],
    vector: fields.vector ?? EMPTY_VECTOR,
    machine: fields.machine ?? "",
  };
}

/**
 * A fresh identity: a version 4 UUID, written the way Foundation writes one.
 *
 * Built from `Math.random` rather than Web Crypto, because the domain half
 * reaches no browser API (D1). An identity has to be unique among a person's
 * patterns, not unguessable, and 122 random bits are that many times over.
 */
export function mintId(random: () => number = Math.random): string {
  const digits = Array.from({ length: 32 }, () => Math.floor(random() * 16));
  digits[12] = 4; // the version
  digits[16] = ((digits[16] ?? 0) & 0x3) | 0x8; // the variant
  const hex = digits.map((digit) => digit.toString(16).toUpperCase()).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Two collections are equal when they *say* the same thing. Who wrote the copy
 * is not part of that: every machine writes its own name into its own file, and
 * those comparisons decide whether anything needs writing at all. Upstream's
 * `==`.
 */
export function collectionsEqual<Item extends SyncedItem>(
  one: SyncedCollection<Item>,
  other: SyncedCollection<Item>,
  rules: SyncItemRules<Item>
): boolean {
  return (
    one.format === other.format &&
    one.entries.length === other.entries.length &&
    one.entries.every((entry, index) => {
      const theirs = other.entries[index];
      return theirs !== undefined && rules.sameContent(entry, theirs);
    }) &&
    one.tombstones.length === other.tombstones.length &&
    one.tombstones.every((tombstone, index) => {
      const theirs = other.tombstones[index];
      return (
        theirs !== undefined &&
        tombstone.id === theirs.id &&
        tombstone.deletedAt === theirs.deletedAt &&
        tombstone.device === theirs.device
      );
    }) &&
    vectorsEqual(one.vector, other.vector)
  );
}

// MARK: - Order

/**
 * The entries in the order the user put them in, which is what `sortKey` holds.
 * Entries that have never been placed (a sort key of zero) keep the order they
 * arrived in — a stable sort, so reading a migrated library twice gives the
 * same list.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.ordered
 */
export function orderedEntries<Item extends SyncedItem>(
  collection: SyncedCollection<Item>
): Item[] {
  return collection.entries
    .map((entry, offset) => ({ entry, offset }))
    .sort((a, b) => a.entry.sortKey - b.entry.sortKey || a.offset - b.offset)
    .map(({ entry }) => entry);
}

/**
 * The entries replaced with `list`, in that order, their sort keys spaced so a
 * later insertion has room between any two of them.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.setOrder
 */
export function withOrder<Item extends SyncedItem>(
  collection: SyncedCollection<Item>,
  list: readonly Item[]
): SyncedCollection<Item> {
  return {
    ...collection,
    entries: list.map((entry, index) => ({ ...entry, sortKey: (index + 1) * SORT_KEY_STEP })),
  };
}

/**
 * The same collection in the one form it is written in: entries in the order
 * they are shown, tombstones by id. Two machines merging the same facts hold
 * them in different array orders, and without this each would rewrite the file
 * in its own order and the two would sync each other for ever.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.canonical
 */
export function canonicalCollection<Item extends SyncedItem>(
  collection: SyncedCollection<Item>
): SyncedCollection<Item> {
  return {
    ...collection,
    entries: orderedEntries(collection),
    tombstones: [...collection.tombstones].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

/**
 * A sort key that places an entry between two others — what a dragged row asks
 * for, without renumbering everything below it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.sortKey
 */
export function sortKeyBetween(above: number | undefined, below: number | undefined): number {
  if (above !== undefined && below !== undefined) return (above + below) / 2;
  if (above !== undefined) return above + SORT_KEY_STEP;
  if (below !== undefined) return below - SORT_KEY_STEP;
  return SORT_KEY_STEP;
}

// MARK: - The file

/**
 * A timestamp as the file writes it: ISO 8601 with milliseconds.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#Sync.timestamps
 */
export function formatTimestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * A timestamp read back — with fractions of a second, or without: a file
 * written by hand, or by a tool that does not bother with fractions, is still a
 * file.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#Sync.wholeSeconds
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.decoder
 */
export function parseTimestamp(raw: unknown): number {
  if (typeof raw !== "string" || !ISO_8601.test(raw)) {
    throw new SyntaxError(`Not a timestamp: ${String(raw)}`);
  }
  const milliseconds = Date.parse(raw);
  if (Number.isNaN(milliseconds)) throw new SyntaxError(`Not a timestamp: ${raw}`);
  return milliseconds;
}

/**
 * JSON the way upstream's encoder writes it: pretty-printed with sorted keys and
 * unescaped slashes. The file is meant to be read by a person and diffed by a
 * tool, and a diff of one changed name should be one changed line.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.encoder
 */
export function writeJson(value: unknown): string {
  return writeValue(value, "");
}

function writeValue(value: unknown, indent: string): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => inner + writeValue(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort();
    if (keys.length === 0) return "{}";
    const rows = keys.map(
      (key) =>
        `${inner}${JSON.stringify(key)} : ${writeValue((value as Record<string, unknown>)[key], inner)}`
    );
    return `{\n${rows.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** A collection as its file's JSON object. */
export function collectionToJson<Item extends SyncedItem>(
  collection: SyncedCollection<Item>,
  rules: SyncItemRules<Item>
): Record<string, unknown> {
  return {
    format: collection.format,
    entries: collection.entries.map(rules.encode),
    tombstones: collection.tombstones.map((tombstone) => ({
      id: tombstone.id,
      deletedAt: formatTimestamp(tombstone.deletedAt),
      device: tombstone.device,
    })),
    vector: collection.vector,
    machine: collection.machine,
  };
}

/**
 * A collection read back from its JSON object. Everything but the entries'
 * own required fields is optional on the way in: a file written by a build that
 * had no tombstones yet is a valid collection, not an error to report to
 * someone who only wants their patterns back.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.CodingKeys
 */
export function collectionFromJson<Item extends SyncedItem>(
  raw: unknown,
  rules: SyncItemRules<Item>
): SyncedCollection<Item> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SyntaxError("A collection is a JSON object.");
  }
  const { format, entries, tombstones, vector, machine } = raw as Record<string, unknown>;
  return {
    format: format === undefined ? SYNC_FORMAT : integer(format, "format"),
    entries: entries === undefined ? [] : array(entries, "entries").map(rules.decode),
    tombstones: tombstones === undefined ? [] : array(tombstones, "tombstones").map(readTombstone),
    vector: vector === undefined ? EMPTY_VECTOR : readVector(vector),
    machine: machine === undefined ? "" : text(machine, "machine"),
  };
}

/**
 * The bytes to write.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncedCollection.swift#SyncedCollection.fileContents
 */
export function encodeCollection<Item extends SyncedItem>(
  collection: SyncedCollection<Item>,
  rules: SyncItemRules<Item>
): string {
  return writeJson(collectionToJson(collection, rules));
}

/**
 * Reads a collection back. Throws only when the text is not a collection at
 * all.
 */
export function decodeCollection<Item extends SyncedItem>(
  contents: string,
  rules: SyncItemRules<Item>
): SyncedCollection<Item> {
  return collectionFromJson(JSON.parse(contents), rules);
}

function readTombstone(raw: unknown): SyncTombstone {
  if (typeof raw !== "object" || raw === null) throw new SyntaxError("A tombstone is an object.");
  const { id, deletedAt, device } = raw as Record<string, unknown>;
  return {
    id: readId(id),
    deletedAt: deletedAt === undefined ? Date.now() : parseTimestamp(deletedAt),
    device: device === undefined ? "" : text(device, "device"),
  };
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An identity read back, upper-cased as Foundation writes it. */
export function readId(raw: unknown): string {
  if (typeof raw !== "string" || !UUID_TEXT.test(raw)) {
    throw new SyntaxError(`Not an identity: ${String(raw)}`);
  }
  return raw.toUpperCase();
}

function integer(raw: unknown, field: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) {
    throw new SyntaxError(`${field} is not a whole number.`);
  }
  return raw;
}

function array(raw: unknown, field: string): unknown[] {
  if (!Array.isArray(raw)) throw new SyntaxError(`${field} is not a list.`);
  return raw;
}

function text(raw: unknown, field: string): string {
  if (typeof raw !== "string") throw new SyntaxError(`${field} is not text.`);
  return raw;
}
