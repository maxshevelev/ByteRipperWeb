import {
  collectionFromJson,
  collectionsEqual,
  collectionToJson,
  SYNC_FORMAT,
  type SyncedCollection,
  type SyncedItem,
  type SyncItemRules,
  syncedCollection,
  writeJson,
} from "@/core/sync/syncedCollection";

/**
 * What this machine keeps: the collection it believes in, and the state it last
 * agreed on with each of the other machines' files
 * (`Design/FAVORITES_SYNC_WEB.md`).
 *
 * Two roles that must not be the same bytes. The **local** collection is the
 * truth — what the app reads and draws, always available, ahead of every base
 * whenever something has been added and not yet published. A **base** is the
 * last state agreed with one other machine's file, and it is what makes a merge
 * three-way.
 *
 * One record, written whole, because two would let a crash leave a base from
 * one round beside a truth from another.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncDocument.swift#SyncDocument
 */
export interface SyncDocument<Item extends SyncedItem> {
  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncDocument.swift#SyncDocument.format */
  readonly format: number;
  /**
   * What this machine believes.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncDocument.swift#SyncDocument.local
   */
  readonly local: SyncedCollection<Item>;
  /**
   * The last state agreed with each of the other machines, by the name of the
   * file it writes. One base per peer, because there is one file per machine.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncDocument.swift#SyncDocument.bases
   */
  readonly bases: Readonly<Record<string, SyncedCollection<Item>>>;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncDocument.swift#SyncDocument.init */
export function syncDocument<Item extends SyncedItem>(
  local: SyncedCollection<Item> = syncedCollection<Item>(),
  bases: Readonly<Record<string, SyncedCollection<Item>>> = {},
  format: number = SYNC_FORMAT
): SyncDocument<Item> {
  return { format, local, bases };
}

/** Whether two documents say the same thing, local and every base. */
export function documentsEqual<Item extends SyncedItem>(
  one: SyncDocument<Item>,
  other: SyncDocument<Item>,
  rules: SyncItemRules<Item>
): boolean {
  const names = Object.keys(one.bases);
  return (
    one.format === other.format &&
    collectionsEqual(one.local, other.local, rules) &&
    names.length === Object.keys(other.bases).length &&
    names.every((name) => {
      const mine = one.bases[name];
      const theirs = other.bases[name];
      return mine !== undefined && theirs !== undefined && collectionsEqual(mine, theirs, rules);
    })
  );
}

/**
 * The document as text.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncDocument.swift#SyncDocument.fileContents
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncDocument.swift#SyncDocument.encode
 */
export function encodeDocument<Item extends SyncedItem>(
  document: SyncDocument<Item>,
  rules: SyncItemRules<Item>
): string {
  const bases: Record<string, unknown> = {};
  for (const [name, base] of Object.entries(document.bases)) {
    bases[name] = collectionToJson(base, rules);
  }
  return writeJson({
    format: document.format,
    local: collectionToJson(document.local, rules),
    bases,
  });
}

/**
 * Reads a document back.
 *
 * Text written before the base existed is a bare collection rather than a
 * document, and it is read as one — the collection it holds is this machine's
 * truth, with nothing agreed yet.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncDocument.swift#SyncDocument.CodingKeys
 */
export function decodeDocument<Item extends SyncedItem>(
  contents: string,
  rules: SyncItemRules<Item>
): SyncDocument<Item> {
  const raw: unknown = JSON.parse(contents);
  try {
    return documentFromJson(raw, rules);
  } catch {
    return syncDocument(collectionFromJson(raw, rules));
  }
}

function documentFromJson<Item extends SyncedItem>(
  raw: unknown,
  rules: SyncItemRules<Item>
): SyncDocument<Item> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SyntaxError("A document is a JSON object.");
  }
  const { format, local, bases } = raw as Record<string, unknown>;
  if (local === undefined) throw new SyntaxError("A document has a local collection.");
  const read: Record<string, SyncedCollection<Item>> = {};
  if (bases !== undefined) {
    if (typeof bases !== "object" || bases === null || Array.isArray(bases)) {
      throw new SyntaxError("A document's bases are a dictionary.");
    }
    for (const [name, base] of Object.entries(bases)) read[name] = collectionFromJson(base, rules);
  }
  return {
    format: typeof format === "number" && Number.isInteger(format) ? format : SYNC_FORMAT,
    local: collectionFromJson(local, rules),
    bases: read,
  };
}
