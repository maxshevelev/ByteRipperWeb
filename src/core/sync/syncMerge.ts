import {
  SORT_KEY_STEP,
  type SyncedCollection,
  type SyncedItem,
  type SyncItemRules,
  type SyncTombstone,
  syncedCollection,
  TOMBSTONE_LIFETIME_MS,
} from "@/core/sync/syncedCollection";
import { dominates, isConcurrent, mergedVectors } from "@/core/sync/versionVector";

/**
 * Merging two versions of a collection against the state they last agreed on
 * (`Design/FAVORITES_SYNC_WEB.md`).
 *
 * A shared folder is not a lock: between one machine's write and the other
 * seeing it there are seconds to minutes, and in that window the other is
 * editing a copy that is already stale. The base — the last state both sides
 * agreed on — is what turns "these two lists differ" into "this side changed
 * that field", which is the difference between one question and twenty.
 *
 * The rules are upstream's, case for case, because a web browser and a Mac merge
 * the same pair of files and must land on the same answer.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge
 */

/**
 * What a rule must not decide on its own. Everything a merge *can* answer, it
 * answers silently; what is left is two people saying different things about
 * the same entry, and that is a question, not a rule.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncConflict
 */
export type SyncConflict<Item extends SyncedItem> =
  /**
   * The same entry, changed differently on both sides.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncConflict.bothEdited
   */
  | { readonly kind: "bothEdited"; readonly ours: Item; readonly theirs: Item }
  /**
   * Changed on one machine, deleted on the other. `entry` is the *edited*
   * version whichever side this machine is on; `deletedHere` says which side
   * that is. Both machines ask, or the one that deleted would decide for the
   * one that edited.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncConflict.editedAndDeleted
   */
  | {
      readonly kind: "editedAndDeleted";
      readonly entry: Item;
      readonly deletedBy: string;
      readonly deletedHere: boolean;
    }
  /**
   * Both sides kept the same thing under different names. One entry has to go,
   * and which name it carries is not the app's to choose.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncConflict.duplicate
   */
  | { readonly kind: "duplicate"; readonly ours: Item; readonly theirs: Item };

/**
 * The entry the question is about, on this machine's side.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncConflict.id
 */
export function conflictId<Item extends SyncedItem>(conflict: SyncConflict<Item>): string {
  return conflict.kind === "editedAndDeleted" ? conflict.entry.id : conflict.ours.id;
}

/**
 * Which side of a conflict the user kept. `keepBoth` is only offered where the
 * two are genuinely different things.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncResolution
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncResolution.keepOurs
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncResolution.keepTheirs
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncResolution.keepBoth
 */
export type SyncResolution = "keepOurs" | "keepTheirs" | "keepBoth";

/**
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.Outcome
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.Outcome.init
 */
export interface MergeOutcome<Item extends SyncedItem> {
  /**
   * The merged collection — usable as it stands. Where a conflict was found
   * this machine's version is kept, so the app has something true to show while
   * the question is unanswered.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.Outcome.library
   */
  readonly library: SyncedCollection<Item>;
  /**
   * What the user has to answer. Empty means the merge is complete and may be
   * written.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.Outcome.conflicts
   */
  readonly conflicts: readonly SyncConflict<Item>[];
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.Outcome.isResolved */
export function isResolved<Item extends SyncedItem>(outcome: MergeOutcome<Item>): boolean {
  return outcome.conflicts.length === 0;
}

export interface MergeOptions {
  /**
   * Skips the question of who saw what, for a version whose vector says
   * nothing — a lineage of its own, whose empty vector is a lack of information
   * rather than evidence of having seen nothing.
   */
  readonly assumeConcurrent?: boolean;
  /** Milliseconds since the epoch; what "old" is measured from. */
  readonly now?: number;
}

/**
 * Merges `theirs` into `ours` against `base`, the last state the two agreed on.
 * `base` is undefined the first time this machine ever sees the other's file —
 * then there is no common past, and every entry either side has is kept.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.merge
 */
export function mergeCollections<Item extends SyncedItem>(
  base: SyncedCollection<Item> | undefined,
  ours: SyncedCollection<Item>,
  theirs: SyncedCollection<Item>,
  rules: SyncItemRules<Item>,
  options: MergeOptions = {}
): MergeOutcome<Item> {
  const now = options.now ?? Date.now();

  // Nothing concurrent about it: one side has seen everything the other wrote,
  // so the version that has seen more simply wins. The ordinary case.
  if (options.assumeConcurrent !== true && !isConcurrent(ours.vector, theirs.vector)) {
    if (dominates(theirs.vector, ours.vector) && !dominates(ours.vector, theirs.vector)) {
      return { library: pruned(theirs, now), conflicts: [] };
    }
    if (dominates(ours.vector, theirs.vector)) {
      return { library: pruned(ours, now), conflicts: [] };
    }
  }

  const conflicts: SyncConflict<Item>[] = [];
  const baseById = byId(base?.entries ?? []);
  const oursById = byId(ours.entries);
  const theirsById = byId(theirs.entries);
  const deletedByThem = tombstonesById(theirs);
  const deletedByUs = tombstonesById(ours);
  const same = rules.sameContent;

  // A deterministic pass: this machine's entries in their order, then whatever
  // the other has that this machine has never seen. Two machines merging the
  // same pair must reach the same list.
  const order = [
    ...ours.entries.map((entry) => entry.id),
    ...theirs.entries.map((entry) => entry.id).filter((id) => !oursById.has(id)),
  ];

  const kept: Item[] = [];
  for (const id of order) {
    const was = baseById.get(id);
    const mine = oursById.get(id);
    const yours = theirsById.get(id);

    if (mine !== undefined && yours !== undefined) {
      if (same(mine, yours)) {
        // The same thing said twice; the other's copy carries the order.
        kept.push(preferringOrder(yours, mine));
      } else if (was !== undefined && same(mine, was)) {
        kept.push(yours); // only they changed it
      } else if (was !== undefined && same(yours, was)) {
        kept.push(mine); // only we changed it
      } else {
        conflicts.push({ kind: "bothEdited", ours: mine, theirs: yours });
        kept.push(mine); // something true to show meanwhile
      }
    } else if (mine !== undefined) {
      const tombstone = deletedByThem.get(id);
      if (tombstone === undefined) {
        // Absent without a tombstone is not a deletion: a line removed from the
        // file by hand comes back, which is the safe way round.
        kept.push(mine);
      } else if (was !== undefined && !same(mine, was)) {
        // They deleted it, and we changed it since the base: a question.
        conflicts.push({
          kind: "editedAndDeleted",
          entry: mine,
          deletedBy: tombstone.device,
          deletedHere: false,
        });
        kept.push(mine);
      } else if (was === undefined && outlives(mine, tombstone)) {
        // The base says nothing, so the later of the two deliberate acts wins —
        // or keeping an entry against a deletion is undone by the very next
        // merge with the machine that still carries the note.
        kept.push(mine);
      }
    } else if (yours !== undefined) {
      const tombstone = deletedByUs.get(id);
      if (tombstone === undefined) {
        kept.push(yours);
      } else if (was !== undefined && !same(yours, was)) {
        // We deleted it and they changed it: the same question from this side.
        // What this machine says meanwhile is the deletion.
        conflicts.push({
          kind: "editedAndDeleted",
          entry: yours,
          deletedBy: tombstone.device,
          deletedHere: true,
        });
      } else if (was === undefined && outlives(yours, tombstone)) {
        // The mirror of the rule above, and it has to be the same rule.
        kept.push(yours);
      }
    }
  }

  // Two sides can keep the same thing under two ids without either knowing.
  const [deduplicated, duplicateConflicts] = deduplicate(kept, oursById, rules);
  conflicts.push(...duplicateConflicts);

  const merged = syncedCollection<Item>({
    format: Math.max(ours.format, theirs.format),
    vector: mergedVectors(ours.vector, theirs.vector),
    tombstones: mergedTombstones(ours, theirs),
    entries: placed(deduplicated, theirsById),
  });
  return { library: pruned(merged, now), conflicts };
}

/**
 * Applies the user's answers to a merge that had questions, giving a collection
 * that can be written.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.resolve
 */
export function resolveMerge<Item extends SyncedItem>(
  outcome: MergeOutcome<Item>,
  answers: ReadonlyMap<string, SyncResolution>,
  now: number = Date.now()
): SyncedCollection<Item> {
  let entries = [...outcome.library.entries];
  let tombstones = [...outcome.library.tombstones];

  for (const conflict of outcome.conflicts) {
    const id = conflictId(conflict);
    const answer = answers.get(id);
    if (answer === undefined) continue;

    if (conflict.kind === "editedAndDeleted") {
      const { entry, deletedHere } = conflict;
      if (answer === "keepTheirs" && !deletedHere) {
        // Their answer was to delete it: this machine's edit goes, and the
        // deletion is recorded properly.
        entries = entries.filter((kept) => kept.id !== entry.id);
        if (!tombstones.some((note) => note.id === entry.id)) {
          tombstones.push({ id: entry.id, deletedAt: now, device: entry.device });
        }
      } else if (answer === "keepTheirs") {
        // This machine deleted it and the answer was to keep theirs: the
        // deletion goes and their version comes back.
        tombstones = tombstones.filter((note) => note.id !== entry.id);
        if (!entries.some((kept) => kept.id === entry.id)) entries.push(revived(entry, now));
      } else if (!deletedHere) {
        // Keeping the edit means taking the deletion back. Where the deletion
        // is this machine's own answer the merged library already says it.
        tombstones = tombstones.filter((note) => note.id !== entry.id);
        entries = entries.map((kept) => (kept.id === entry.id ? revived(kept, now) : kept));
      }
      continue;
    }

    const theirs = conflict.theirs;
    if (answer === "keepTheirs") {
      entries = entries.filter((kept) => kept.id !== id && kept.id !== theirs.id);
      entries.push(theirs);
    } else if (answer === "keepBoth") {
      if (!entries.some((kept) => kept.id === theirs.id)) entries.push(theirs);
    }
    // keepOurs: the merged library already holds ours.
  }

  return { ...outcome.library, entries, tombstones };
}

// MARK: - Parts

/**
 * An entry kept against a deletion, stamped as changed now: the machine that
 * deleted it still has the note, and the note outlives an entry last touched
 * before it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.revived
 */
function revived<Item extends SyncedItem>(entry: Item, now: number): Item {
  return { ...entry, modifiedAt: now };
}

/**
 * Whether an entry is later than a deletion of it — the tiebreak used only where
 * the base can say nothing. Clocks are not the arbiter of a merge: this decides
 * between two deliberate acts minutes apart with no common past.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.outlives
 */
function outlives<Item extends SyncedItem>(entry: Item, tombstone: SyncTombstone): boolean {
  return entry.modifiedAt > tombstone.deletedAt;
}

/**
 * The entries by id, the first of any repeated id winning.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.index
 */
function byId<Item extends SyncedItem>(entries: readonly Item[]): Map<string, Item> {
  const found = new Map<string, Item>();
  for (const entry of entries) if (!found.has(entry.id)) found.set(entry.id, entry);
  return found;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.tombstonesByID */
function tombstonesById<Item extends SyncedItem>(
  collection: SyncedCollection<Item>
): Map<string, SyncTombstone> {
  const found = new Map<string, SyncTombstone>();
  for (const note of collection.tombstones) if (!found.has(note.id)) found.set(note.id, note);
  return found;
}

/**
 * Both sides' deletions, the later note for an id winning, oldest first.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.mergedTombstones
 */
function mergedTombstones<Item extends SyncedItem>(
  ours: SyncedCollection<Item>,
  theirs: SyncedCollection<Item>
): SyncTombstone[] {
  const all = tombstonesById(ours);
  for (const [id, note] of tombstonesById(theirs)) {
    const existing = all.get(id);
    if (existing !== undefined && existing.deletedAt >= note.deletedAt) continue;
    all.set(id, note);
  }
  return [...all.values()].sort(
    (a, b) => a.deletedAt - b.deletedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * An entry says what this machine says, and sits where the other's file says:
 * that file's order leads, so nobody's reordering is undone by the other's.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.preferringOrder
 */
function preferringOrder<Item extends SyncedItem>(theirs: Item, content: Item): Item {
  return { ...content, sortKey: theirs.sortKey };
}

/**
 * What a collection refuses to hold twice is held once. Where both sides said
 * the same about it, the copy that stays is the one with the smaller id — a rule
 * both machines compute the same way; where they said different things, the
 * user settles it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.deduplicate
 */
function deduplicate<Item extends SyncedItem>(
  entries: readonly Item[],
  ours: ReadonlyMap<string, Item>,
  rules: SyncItemRules<Item>
): [Item[], SyncConflict<Item>[]] {
  const kept: Item[] = [];
  const conflicts: SyncConflict<Item>[] = [];
  for (const entry of entries) {
    const twin = kept.findIndex((existing) => rules.isDuplicate(existing, entry));
    if (twin === -1) {
      kept.push(entry);
      continue;
    }
    const existing = kept[twin] as Item;
    if (rules.sameContent(existing, entry)) {
      if (entry.id < existing.id) kept[twin] = entry;
      continue;
    }
    const mine = ours.has(existing.id) ? existing : entry;
    const yours = ours.has(existing.id) ? entry : existing;
    conflicts.push({ kind: "duplicate", ours: mine, theirs: yours });
    kept[twin] = mine;
  }
  return [kept, conflicts];
}

/**
 * The other file's order leads; entries only this machine has are placed after
 * everything that file places.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.ordered
 */
function placed<Item extends SyncedItem>(
  entries: readonly Item[],
  theirs: ReadonlyMap<string, Item>
): Item[] {
  const theirKeys = entries.filter((entry) => theirs.has(entry.id)).map((entry) => entry.sortKey);
  const highest = theirKeys.length === 0 ? 0 : Math.max(...theirKeys);
  let next = highest;
  return entries.map((entry) => {
    if (theirs.has(entry.id) || entry.sortKey > highest) return entry;
    next += SORT_KEY_STEP;
    return { ...entry, sortKey: next };
  });
}

/**
 * Drops deletions that contradict the result, and those old enough that every
 * machine has had a chance to see them. A tombstone kept forever is a file that
 * grows forever; one dropped too early is an entry that comes back.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.pruned
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/SyncMerge.swift#SyncMerge.tombstoneLifetime
 */
function pruned<Item extends SyncedItem>(
  collection: SyncedCollection<Item>,
  now: number
): SyncedCollection<Item> {
  const alive = new Set(collection.entries.map((entry) => entry.id));
  return {
    ...collection,
    tombstones: collection.tombstones.filter(
      (note) => !alive.has(note.id) && now - note.deletedAt < TOMBSTONE_LIFETIME_MS
    ),
  };
}
