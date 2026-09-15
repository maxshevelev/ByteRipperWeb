import { type SyncDocument, syncDocument } from "@/core/sync/syncDocument";
import {
  canonicalCollection,
  collectionToJson,
  decodeCollection,
  encodeCollection,
  orderedEntries,
  type SyncedCollection,
  type SyncedItem,
  type SyncItemRules,
  syncedCollection,
  writeJson,
} from "@/core/sync/syncedCollection";
import { isLibraryFile, libraryFileName } from "@/core/sync/syncFolderNaming";
import {
  mergeCollections,
  resolveMerge,
  type SyncConflict,
  type SyncResolution,
} from "@/core/sync/syncMerge";
import { dominates, incremented, mergedVectors, vectorsEqual } from "@/core/sync/versionVector";

/**
 * One machine's copy of a synced collection, and the loop that keeps it level
 * with the other machines' files (`Design/FAVORITES_SYNC_WEB.md`).
 *
 * This browser's record is the **truth**: read at start, written on every
 * change, always there. A folder the user shares — iCloud Drive, OneDrive, a
 * stick — is the **medium** the machines exchange state through, and it can be
 * unmounted, half-downloaded or refused while the Find bar still has to list
 * patterns. So nothing here reads the folder to answer a question about the
 * library; it reads it to merge.
 *
 * **One file per machine.** This browser writes exactly one file in that folder
 * and never touches another's; it reads every file it finds there and merges
 * each into its own collection against the state the two last agreed on.
 * Nothing in the folder has two writers, so the sync provider has nothing to
 * arbitrate — and a disagreement is a question for the user, asked on both
 * machines because both can see both files.
 *
 * One instance per machine, so a test can make two of them over one folder and
 * be two machines. Pure: the folder is an interface, and nothing here knows it
 * is a directory handle, an upload or a map in a test.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.Item
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.Folder
 * @upstream ByteRipperApp/Search/FolderSync.swift#LibrarySync
 * @upstream-differs asynchronous and serialised, over a folder interface; watching, polling and file presenters are the store's, since a browser has a different way to hear of each
 */

/**
 * The folder the machines share, as the loop needs it: the names in it, a
 * file's text, and a file written whole.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder
 * @upstream-differs an interface the store implements over a directory handle, or over the files a picker handed over
 */
export interface SyncFolderFiles {
  /** What the folder is called, for the person choosing it. */
  readonly name: string;
  /** Every name in the folder; which of them are libraries is the loop's to decide. */
  list(): Promise<readonly string[]>;
  /** A file's text, or `undefined` when there is no such file. Throws when it is there and cannot be read. */
  read(name: string): Promise<string | undefined>;
  /** Writes a file whole. Absent where the folder can only be read. */
  readonly write?: (name: string, contents: string) => Promise<void>;
  /** Removes a file this machine wrote. Absent where the folder can only be read. */
  readonly remove?: (name: string) => Promise<void>;
}

/**
 * What to do when the folder pointed at is not empty — the one moment two
 * libraries meet.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.Adoption
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.Adoption.merge
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.Adoption.takeTheFile
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.Adoption.replaceTheFile
 */
export type FolderAdoption =
  /** Keep both lists. The default: twelve patterns here and three there make fifteen. */
  | "merge"
  /** Start from what the folder holds, dropping what this machine had. */
  | "takeTheFile"
  /** Keep this machine's list and remove the rest — with tombstones. Never the default. */
  | "replaceTheFile";

/**
 * What is in the folder being joined — the question to ask before anything is
 * published.
 *
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.SharedFileState
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.SharedFileState.empty
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.SharedFileState.patterns
 * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.SharedFileState.unreadable
 */
export type SharedFileState =
  /** Nothing there, or libraries with nothing in them: nothing to reconcile. */
  | { readonly kind: "empty" }
  /** Libraries with entries, which is the one moment two libraries meet. */
  | { readonly kind: "patterns"; readonly count: number }
  /**
   * Library files that cannot be read — not downloaded yet, damaged. **Never**
   * treated as empty: that road ends with publishing into a folder whose
   * library could not be read.
   */
  | { readonly kind: "unreadable" };

export interface FolderSyncOptions<Item extends SyncedItem> {
  readonly rules: SyncItemRules<Item>;
  /**
   * This machine's name in a version vector.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.device
   */
  readonly device: string;
  /**
   * What this machine is called, for a person reading the folder — read on
   * every write, so a renamed machine signs its next file with the new name.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.thisMachine
   */
  readonly machine: () => string;
  /** A device id's stamp, which names its file (`DeviceIdentity.digest`). */
  readonly stamp: (device: string) => string;
  /** What was kept from before: this machine's truth and its bases. */
  readonly document?: SyncDocument<Item>;
  /**
   * Keeps the document — called only when it says something new.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.localURL
   */
  readonly persist?: (document: SyncDocument<Item>) => void | Promise<void>;
  /** Milliseconds since the epoch; what a tombstone is stamped with. */
  readonly now?: () => number;
}

export class FolderSync<Item extends SyncedItem> {
  /** @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.device */
  readonly device: string;

  private readonly rules: SyncItemRules<Item>;
  private readonly machine: () => string;
  private readonly stamp: (device: string) => string;
  private readonly persistDocument:
    | ((document: SyncDocument<Item>) => void | Promise<void>)
    | undefined;
  private readonly now: () => number;

  /**
   * The folder this machine publishes to, or `undefined` while the collection
   * is kept to this browser.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.sharedURL
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.sharedFolder
   */
  private files: SyncFolderFiles | undefined;

  /** @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.document */
  private local: SyncedCollection<Item>;
  private agreed: Record<string, SyncedCollection<Item>>;
  /**
   * What was last kept, so a save that would keep the same thing is skipped.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.savedDocument
   */
  private saved: string | undefined;

  /**
   * What the merge could not decide. While this is non-empty the collection is
   * read-only; this machine's file goes on saying what this machine believes,
   * so the other machine is asked about the same disagreement.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.conflicts
   */
  conflicts: readonly SyncConflict<Item>[] = [];

  /**
   * The versions the outstanding questions are about, by file — what answering
   * them means this machine has seen.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.conflictedWith
   */
  private conflictedWith: Record<string, SyncedCollection<Item>> = {};

  /**
   * True when the user answered and the answer did not take: the merge straight
   * after it asked again, because another machine's file had moved on.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.answerDidNotTake
   */
  answerDidNotTake = false;

  /**
   * Why the folder could not be reached, if it could not. Not an error the user
   * has to act on — the truth is safe locally — but the Favorites tab says it.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.publishError
   */
  publishError: unknown = undefined;

  /**
   * When the collection and the folder were last agreed.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.lastPublished
   */
  lastPublished: number | undefined = undefined;

  private readonly listeners = new Set<() => void>();
  /** Every operation runs after the one before it: two merges never interleave. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Takes this machine's record and nothing else. **No syncing here**: the
   * owner holds the instance first, and then starts it.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.init
   */
  constructor(options: FolderSyncOptions<Item>) {
    this.rules = options.rules;
    this.device = options.device;
    this.machine = options.machine;
    this.stamp = options.stamp;
    this.persistDocument = options.persist;
    this.now = options.now ?? Date.now;
    const document = options.document ?? syncDocument<Item>();
    this.local = document.local;
    this.agreed = { ...document.bases };
    this.saved = this.documentText();
  }

  // MARK: - The collection

  /**
   * What this machine believes — what the app reads and draws.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.library
   */
  get library(): SyncedCollection<Item> {
    return this.local;
  }

  /**
   * The state last agreed with each machine's file, by that file's name.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.bases
   */
  get bases(): Readonly<Record<string, SyncedCollection<Item>>> {
    return this.agreed;
  }

  get document(): SyncDocument<Item> {
    return syncDocument(this.local, { ...this.agreed });
  }

  /** The folder being published to, if any. */
  get folder(): SyncFolderFiles | undefined {
    return this.files;
  }

  /** The file this machine writes in the folder. */
  get ownFileName(): string {
    return libraryFileName(this.stamp(this.device));
  }

  /**
   * Told after the collection changes for any reason — a local edit, or a merge
   * bringing in someone else's — and when a question appears or goes.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.onChange
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Begins publishing into `files`, or stops when it is `undefined`. Stopping
   * forgets what was agreed: there is nobody left to have agreed with.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.sharedURL
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.start
   */
  setFolder(files: SyncFolderFiles | undefined): Promise<void> {
    return this.serially(async () => {
      if (files === this.files) return;
      this.files = files;
      if (files === undefined) {
        this.agreed = {};
        await this.persist();
        return;
      }
      await this.attach();
      await this.runSync();
    });
  }

  /**
   * Records a change made here, and publishes it. Refused — `false` — while a
   * question is unanswered: editing a list the user has been asked about is the
   * one way this design can lose a pattern.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.save
   */
  save(library: SyncedCollection<Item>): Promise<boolean> {
    return this.serially(async () => {
      if (this.conflicts.length > 0) return false;
      this.local = { ...library, vector: incremented(library.vector, this.device) };
      await this.persist();
      this.announce();
      await this.runSync();
      return true;
    });
  }

  /**
   * A change made here, given as what to do to the collection rather than as
   * the collection it produces: it is applied to what this machine holds when
   * its turn comes, so a merge that landed while it waited is not written over.
   * `undefined` from `change` is a change that found nothing to do.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.save
   * @upstream-differs the change travels as a function, because between a click and its turn in the queue a merge may have run
   */
  edit(
    change: (library: SyncedCollection<Item>) => SyncedCollection<Item> | undefined
  ): Promise<boolean> {
    return this.serially(async () => {
      if (this.conflicts.length > 0) return false;
      const next = change(this.local);
      if (next === undefined) return false;
      this.local = { ...next, vector: incremented(next.vector, this.device) };
      await this.persist();
      this.announce();
      await this.runSync();
      return true;
    });
  }

  /** Settles once everything asked of this machine so far has run. */
  idle(): Promise<void> {
    return this.serially(async () => undefined);
  }

  /**
   * Applies the user's answers and publishes the result.
   *
   * Answering is also this machine saying it has **seen** the versions it was
   * asked about: each becomes the base for its file and its counters join ours,
   * so the result is simply newer. Without that, the next merge finds the same
   * versions differing from the same bases and asks again.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.resolve
   */
  resolve(answers: ReadonlyMap<string, SyncResolution>): Promise<void> {
    return this.serially(async () => {
      if (this.conflicts.length === 0) return;
      let resolved = resolveMerge(
        { library: this.local, conflicts: this.conflicts },
        answers,
        this.now()
      );
      // What the answers are *about*: the versions in the folder, read afresh
      // rather than remembered, so an answer given after a file moved on still
      // counts as having seen it.
      for (const [name, asked] of Object.entries(this.conflictedWith)) {
        let seen = asked;
        if (this.files !== undefined) {
          try {
            seen = (await this.readShared(this.files, name)) ?? asked;
          } catch {
            seen = asked;
          }
        }
        resolved = { ...resolved, vector: mergedVectors(resolved.vector, seen.vector) };
        this.agreed[name] = seen;
      }
      this.local = { ...resolved, vector: incremented(resolved.vector, this.device) };
      this.conflicts = [];
      this.conflictedWith = {};
      this.answerDidNotTake = false;
      await this.persist();
      this.announce();
      await this.runSync();
      // Answered, and asked again: a file moved while the dialog was open.
      this.answerDidNotTake = this.conflicts.length > 0;
    });
  }

  // MARK: - Joining a folder that already holds entries

  /**
   * Publishes into `files`, deciding what to do with what is already there. The
   * two decided answers are carried out with tombstones, never by writing over
   * anyone's file.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.publish
   */
  publish(files: SyncFolderFiles, adopting: FolderAdoption): Promise<void> {
    return this.serially(async () => {
      const own = this.ownFileName;
      if (adopting === "takeTheFile") {
        const theirs = await this.folderLibrary(files, own);
        const keep = new Set(theirs.entries.map((entry) => entry.id));
        const now = this.now();
        const mine: SyncedCollection<Item> = {
          ...this.local,
          entries: this.local.entries.filter((entry) => keep.has(entry.id)),
          tombstones: [
            ...this.local.tombstones,
            ...this.local.entries
              .filter((entry) => !keep.has(entry.id))
              .map((entry) => ({ id: entry.id, deletedAt: now, device: this.device })),
          ],
        };
        const taken = mergeCollections(undefined, mine, theirs, this.rules, {
          assumeConcurrent: true,
          now,
        }).library;
        this.local = { ...taken, vector: incremented(taken.vector, this.device) };
        this.announce();
      } else if (adopting === "replaceTheFile") {
        const theirs = await this.folderLibrary(files, own);
        const ours = new Set(this.local.entries.map((entry) => entry.id));
        const now = this.now();
        const vector = incremented(mergedVectors(this.local.vector, theirs.vector), this.device);
        this.local = {
          ...this.local,
          vector,
          tombstones: [
            ...this.local.tombstones,
            ...theirs.entries
              .filter((entry) => !ours.has(entry.id))
              .map((entry) => ({ id: entry.id, deletedAt: now, device: this.device })),
          ],
        };
      }
      // No bases, whichever the answer: this machine has agreed nothing with
      // these files yet, so everything either side holds is weighed afresh.
      this.agreed = {};
      await this.persist();
      this.files = files;
      await this.attach();
      await this.runSync();
    });
  }

  /**
   * Reads the folder the way joining it would.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.inspectShared
   */
  inspect(files: SyncFolderFiles): Promise<SharedFileState> {
    return this.serially(async () => {
      const exclude = this.files === undefined ? undefined : this.ownFileName;
      const names = (await libraryNames(files)).filter((name) => name !== exclude);
      if (names.length === 0) return { kind: "empty" } as const;
      let library = syncedCollection<Item>();
      let read = false;
      for (const name of names) {
        let theirs: SyncedCollection<Item>;
        try {
          theirs = (await this.readShared(files, name)) ?? syncedCollection<Item>();
        } catch {
          continue;
        }
        library = mergeCollections(undefined, library, theirs, this.rules, {
          assumeConcurrent: true,
          now: this.now(),
        }).library;
        read = true;
      }
      if (!read) return { kind: "unreadable" } as const;
      return library.entries.length === 0
        ? ({ kind: "empty" } as const)
        : ({ kind: "patterns", count: library.entries.length } as const);
    });
  }

  // MARK: - The loop

  /**
   * Merges every machine's file into this one's collection and writes this
   * machine's own back.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.sync
   */
  sync(): Promise<void> {
    return this.serially(() => this.runSync());
  }

  /**
   * Merges what a folder holds into this machine's collection **without
   * writing to it** — a browser that can read a folder it was handed but cannot
   * write one. Each file keeps its base like any other, so the next time the
   * same folder is handed over only what changed since is weighed.
   *
   * @web-only Firefox and Safari have no folder to keep; they are handed one to read
   */
  fetchFrom(files: SyncFolderFiles): Promise<{ readonly read: number; readonly problems: number }> {
    return this.serially(async () => {
      const before = this.listed();
      const hadConflicts = this.conflicts.length > 0;
      const raised: SyncConflict<Item>[] = [];
      const asked: Record<string, SyncedCollection<Item>> = {};
      let read = 0;
      let problems = 0;
      for (const name of await libraryNames(files)) {
        try {
          await this.absorb(files, name, raised, asked);
          read += 1;
        } catch {
          problems += 1;
        }
      }
      this.conflicts = raised;
      this.conflictedWith = asked;
      await this.persist();
      this.announceIfChanged(before, hadConflicts);
      return { read, problems };
    });
  }

  /**
   * Takes a document another tab of this browser kept, when it says something
   * new, and publishes it.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.reloadLocal
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.takeLocalEditsFromDisk
   * @upstream-differs another tab's record in IndexedDB stands in for the local file edited from outside
   */
  reload(document: SyncDocument<Item>): Promise<void> {
    return this.serially(async () => {
      const text = encodeDocumentText(document, this.rules);
      if (text === this.documentText()) return;
      this.local = document.local;
      this.agreed = { ...document.bases };
      this.saved = text;
      this.announce();
      await this.runSync();
    });
  }

  private async runSync(): Promise<void> {
    const files = this.files;
    if (files === undefined) return;
    const before = this.listed();
    const hadConflicts = this.conflicts.length > 0;
    const problems: unknown[] = [];
    const raised: SyncConflict<Item>[] = [];
    const asked: Record<string, SyncedCollection<Item>> = {};

    let names: readonly string[] = [];
    try {
      names = await libraryNames(files);
    } catch (error) {
      problems.push(error);
    }
    // This machine's own file is read like any other: nothing else writes it,
    // so a difference is a hand edit or a restored copy — things somebody meant.
    for (const name of names) {
      try {
        await this.absorb(files, name, raised, asked);
      } catch (error) {
        problems.push(error);
      }
    }
    this.conflicts = raised;
    this.conflictedWith = asked;

    const own = this.ownFileName;
    try {
      // Written even while a question stands — the file is this machine's own
      // belief, and the other machine cannot be asked about a version it was
      // never shown. And only when it would say something different, or know
      // less than this machine does: a touched file in a synced folder is an
      // upload, a download elsewhere, a merge there, and a write back — two
      // machines syncing each other in a circle for ever.
      const ours = this.local;
      const onDisk = (await this.readShared(files, own)) ?? syncedCollection<Item>();
      if (
        contentText(onDisk, this.rules) !== contentText(ours, this.rules) ||
        !dominates(onDisk.vector, ours.vector)
      ) {
        await this.writeShared(files, ours);
        this.agreed[own] = ours;
      } else {
        // Left alone, so what is agreed with it is what it holds — not what
        // this machine holds, or the next round would call the file stale and
        // rewrite it once per counter picked up from elsewhere.
        this.agreed[own] = onDisk;
      }
      this.lastPublished = this.now();
    } catch (error) {
      problems.push(error);
    }
    await this.persist();
    this.announceIfChanged(before, hadConflicts);
    this.publishError = problems[0];
  }

  /**
   * Merges one machine's file into this machine's collection.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.absorb
   */
  private async absorb(
    files: SyncFolderFiles,
    name: string,
    raised: SyncConflict<Item>[],
    asked: Record<string, SyncedCollection<Item>>
  ): Promise<void> {
    const theirs = (await this.readShared(files, name)) ?? syncedCollection<Item>();
    const agreed = this.agreed[name];
    // A file edited by hand says something new and carries no evidence of
    // having been written: its counters have not moved since the two agreed,
    // and its content has.
    const editedOutside =
      agreed !== undefined &&
      vectorsEqual(theirs.vector, agreed.vector) &&
      canonicalText(theirs, this.rules) !== canonicalText(agreed, this.rules);
    // A base is only a base while the file descends from it.
    const base =
      agreed !== undefined && dominates(theirs.vector, agreed.vector) ? agreed : undefined;
    const ourVersionBefore = this.local.vector;
    const outcome = mergeCollections(base, this.local, theirs, this.rules, {
      assumeConcurrent: editedOutside,
      now: this.now(),
    });
    this.local = outcome.library;
    if (outcome.conflicts.length > 0) {
      // A question keeps this machine's version where it was: with the other
      // side's counters folded in, the next sync would find this machine simply
      // newer, and the disagreement would settle itself in its favour.
      this.local = { ...this.local, vector: ourVersionBefore };
      raised.push(...outcome.conflicts);
      asked[name] = theirs;
      return;
    }
    // Agreed with that machine, up to the version just read.
    this.agreed[name] = theirs;
  }

  /**
   * Everything the folder's files say, merged into one — what joining it joins.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.folderLibrary
   */
  private async folderLibrary(
    files: SyncFolderFiles,
    excluding: string
  ): Promise<SyncedCollection<Item>> {
    let library = syncedCollection<Item>();
    for (const name of await libraryNames(files)) {
      if (name === excluding) continue;
      let theirs: SyncedCollection<Item> | undefined;
      try {
        theirs = await this.readShared(files, name);
      } catch {
        continue;
      }
      if (theirs === undefined) continue;
      library = mergeCollections(undefined, library, theirs, this.rules, {
        assumeConcurrent: true,
        now: this.now(),
      }).library;
    }
    return library;
  }

  /**
   * Makes the folder a library folder: this machine's file, written if it is
   * not there yet, so a second machine joining sees one to take.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.watchShared
   */
  private async attach(): Promise<void> {
    const files = this.files;
    if (files?.write === undefined) return;
    try {
      if ((await files.read(this.ownFileName)) === undefined) {
        await this.writeShared(files, this.local);
      }
    } catch (error) {
      this.publishError = error;
    }
  }

  /**
   * A file's collection, or `undefined` when there is none. Throws for one that
   * is there and cannot be read — which is what stops this machine acting on a
   * file it has not read.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.readShared
   */
  private async readShared(
    files: SyncFolderFiles,
    name: string
  ): Promise<SyncedCollection<Item> | undefined> {
    const text = await files.read(name);
    return text === undefined ? undefined : decodeCollection(text, this.rules);
  }

  /**
   * This machine's file, signed with its current name and written in the one
   * canonical form.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.writeShared
   */
  private async writeShared(
    files: SyncFolderFiles,
    library: SyncedCollection<Item>
  ): Promise<void> {
    if (files.write === undefined) throw new Error("This folder can only be read.");
    const signed = canonicalCollection({ ...library, machine: this.machine() });
    await files.write(this.ownFileName, encodeCollection(signed, this.rules));
  }

  /**
   * Keeps the document when it says something new: a poll that found nothing
   * must not rewrite the record every minute.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.saveLocal
   */
  private async persist(): Promise<void> {
    const text = this.documentText();
    if (text === this.saved) return;
    this.saved = text;
    await this.persistDocument?.(this.document);
  }

  private documentText(): string {
    return encodeDocumentText(this.document, this.rules);
  }

  /** The entries as a reader sees them, in full: what an announcement is about. */
  private listed(): string {
    return JSON.stringify(orderedEntries(this.local).map(this.rules.encode));
  }

  /**
   * Announces only what a reader would notice: the entries as they are listed,
   * or a question appearing or going away.
   *
   * @upstream ByteRipperApp/Search/FolderSync.swift#FolderSync.announceIfChanged
   */
  private announceIfChanged(before: string, hadConflicts: boolean): void {
    if (this.listed() !== before || hadConflicts !== this.conflicts.length > 0) this.announce();
  }

  private announce(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private serially<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

/**
 * The library files in a folder, in a fixed order so two runs merge the same
 * folder the same way.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.libraryFiles
 */
export async function libraryNames(files: SyncFolderFiles): Promise<string[]> {
  return (await files.list()).filter(isLibraryFile).sort();
}

/**
 * The device a library file belongs to, recovered from the file itself: the
 * counter in its vector whose stamp names the file. `undefined` when none does —
 * a file written by hand, or one that never counted a write of its own.
 *
 * What lets a browser that lost its data say "this was me": its old file names
 * it by stamp, and the id behind the stamp is one of the file's own counters.
 *
 * @web-only upstream's device id comes from the hardware and is never lost
 */
export function writerOf(
  library: SyncedCollection<SyncedItem>,
  fileName: string,
  stamp: (device: string) => string
): string | undefined {
  return Object.keys(library.vector).find((device) => libraryFileName(stamp(device)) === fileName);
}

/** The entries and deletions a file carries, in full, in the order it writes them. */
function contentText<Item extends SyncedItem>(
  collection: SyncedCollection<Item>,
  rules: SyncItemRules<Item>
): string {
  const canonical = canonicalCollection(collection);
  const json = collectionToJson(canonical, rules);
  return writeJson({ entries: json.entries, tombstones: json.tombstones });
}

/** Everything a file says except who signed it: upstream's canonical `==`. */
function canonicalText<Item extends SyncedItem>(
  collection: SyncedCollection<Item>,
  rules: SyncItemRules<Item>
): string {
  return writeJson(collectionToJson(canonicalCollection({ ...collection, machine: "" }), rules));
}

function encodeDocumentText<Item extends SyncedItem>(
  document: SyncDocument<Item>,
  rules: SyncItemRules<Item>
): string {
  const bases: Record<string, unknown> = {};
  for (const name of Object.keys(document.bases).sort()) {
    const base = document.bases[name];
    if (base !== undefined) bases[name] = collectionToJson(base, rules);
  }
  return writeJson({
    format: document.format,
    local: collectionToJson(document.local, rules),
    bases,
  });
}
