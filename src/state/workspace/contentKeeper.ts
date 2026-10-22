import { sha256 } from "@/core/crypto/sha256";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import type { Selection } from "@/core/document/selectionModel";
import {
  applyHistory,
  HistoryLogError,
  historyConnects,
  historyPath,
  historySides,
  readHistoryLog,
} from "@/core/edit/historyLog";
import type { KeptTransaction } from "@/core/edit/undoHistory";
import { UndoJournal } from "@/core/edit/undoJournal";
import type { OverlayEdits } from "@/core/storage/editOverlayStorage";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { type KeptFolder, readWholeKeptFile } from "@/core/workspace/keptFolder";
import {
  type KeptBase,
  type KeptContent,
  type KeptJoin,
  keptFiles,
} from "@/core/workspace/workspace";
import { decodeEdits, encodeEdits } from "@/platform/files/projectFolder";
import { type KeptWrite, KeptWriter, type PendingBase } from "@/state/workspace/keptWriter";

/**
 * Keeps every document's content beside the workspace, so a crash does not take a join, a New
 * File, a part's changes or a file's unsaved changes with it (`Design/PERSISTENT_UNDO_PLAN.md`
 * upstream, "Content = base + journal").
 *
 * A document's content is kept as a base — the file on disk, or the content written whole once —
 * and a log the document's transactions are appended to (`historyLog.ts`). A snapshot appends the
 * transactions made since the last one and writes down which state the document is in; an undo
 * writes nothing but that. The base is written again only when no transaction leads from it to
 * the document's state any more — the history was emptied, its bounds dropped steps before they
 * were written. A written base or log is never rewritten: a new one gets a new name, and the old
 * goes once the workspace that read it has been replaced.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper
 */

/**
 * What the keeper needs to know of a pane: its document, whether it has a file the content is
 * laid over, and how to put a file's changes into words.
 *
 * @upstream-differs upstream asks the pane's view model; the page's panes are records in a store
 */
export interface KeptPane {
  readonly document: BinaryDocument;
  /** No file under it: an untitled document, or a part. */
  readonly isUntitled: boolean;
  /** The file's changes as runs over it; nothing when the storage cannot say. */
  exportKeptEdits(): Promise<OverlayEdits | undefined>;
  /** The joins on its history, each with the file it detached the document from. */
  joins(): { readonly undo: readonly KeptJoin[]; readonly redo: readonly KeptJoin[] };
}

/** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.Entry */
interface Entry {
  readonly id: string;
  /** The base as decided: its kind, file and serial. Its hash is the writer's to fill in. */
  base: KeptBase | undefined;
  /** The history's journal the log is written into; another one there is a log begun anew. */
  journal: UndoJournal | undefined;
  /** The serials of the transactions in the log, each to its parent. */
  parents: Map<number, number>;
  /** The newest serial in the log: everything after it is new. */
  newestLogged: number;
  /** States the log is known to lead to from the base. */
  connected: Set<number>;
  /** The selection after each transaction as the log has it. */
  afters: Map<number, Selection>;
  /** What the last snapshot wrote down for this document. */
  kept: KeptContent | undefined;
  /** The content's version and the saved state when it was. */
  version: { readonly epoch: number; readonly serial: number } | undefined;
  saved: number | undefined;
}

const sameSelection = (one: Selection | undefined, other: Selection) =>
  one !== undefined && one.start === other.start && one.end === other.end;

const newId = () => `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper */
export class ContentKeeper {
  private readonly folder: KeptFolder;
  private entries = new Map<BinaryDocument, Entry>();
  /** The kept files the snapshot being taken named, so the ones nobody names can go. */
  private named = new Set<string>();
  private namedIds = new Set<string>();
  /** What the snapshot being taken has for the writer. */
  private pending: KeptWrite[] = [];
  /** Writes behind the snapshots what they decide. */
  readonly writer: KeptWriter;

  constructor(folder: KeptFolder) {
    this.folder = folder;
    this.writer = new KeptWriter(folder);
  }

  /** Whether the snapshot being taken has anything for the writer. */
  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** The folder this keeper keeps content in. */
  get keptFolder(): KeptFolder {
    return this.folder;
  }

  /**
   * The content of `pane`'s document as it now stands, written down: what changed since the last
   * snapshot handed to the writer to append, the rest as it was. Nothing for a file with nothing
   * beyond what is on disk. Nothing is written here: `commit` hands the snapshot over.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.keep
   */
  async keep(pane: KeptPane): Promise<KeptContent | undefined> {
    const { document } = pane;
    const history = document.undoHistory;
    if (!pane.isUntitled && !document.isDirty && !history.canUndo && !history.canRedo) {
      this.entries.delete(document);
      return undefined;
    }
    let entry = this.entries.get(document);
    if (entry === undefined) {
      entry = {
        id: newId(),
        base: undefined,
        journal: undefined,
        parents: new Map(),
        newestLogged: 0,
        connected: new Set(),
        afters: new Map(),
        kept: undefined,
        version: undefined,
        saved: undefined,
      };
      this.entries.set(document, entry);
    }
    const saved = pane.isUntitled ? undefined : history.savedStateSerial;
    const newest = history.newestTransaction;
    const refined =
      newest !== undefined &&
      !sameSelection(entry.afters.get(newest.serial), newest.selectionAfter);
    const version = history.version;
    if (
      entry.version?.epoch !== version.epoch ||
      entry.version?.serial !== version.serial ||
      entry.saved !== saved ||
      entry.kept === undefined ||
      refined
    ) {
      await this.update(entry, pane, saved);
    }
    if (entry.kept !== undefined) {
      for (const file of keptFiles(entry.kept)) this.named.add(file);
      this.namedIds.add(entry.id);
    }
    return entry.kept;
  }

  /** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.update */
  private async update(entry: Entry, pane: KeptPane, saved: number | undefined): Promise<void> {
    const { document } = pane;
    const history = document.undoHistory;
    const epochMoved = entry.version !== undefined && entry.version.epoch !== history.version.epoch;
    // The log is the history's journal, and it has to be in this workspace's `Kept/`: one made
    // before the workspace was recorded, or in another, is moved here — once — and the log begins
    // anew.
    this.placeJournal(entry, document);
    let needsBase = entry.base === undefined || epochMoved;
    // Another journal — the first, a compacted one, a moved one — is a new log; the base stays
    // when the new log still leads from it.
    const newLog = history.currentJournal !== entry.journal;
    if (entry.base?.kind === "file" && pane.isUntitled) needsBase = true;
    let newBase: KeptBase | undefined;
    if (!needsBase && saved !== undefined && saved !== entry.saved) {
      // Saved: the file on disk now holds the saved state, which the log leads to — or the
      // document was saved for the first time.
      newBase = { kind: "file", serial: saved };
      entry.base = newBase;
    }
    if (needsBase || newLog) {
      if (!(await this.rebase(entry, pane, saved, !needsBase))) return this.failed(entry);
    } else {
      const records: KeptTransaction[] = [];
      const selections: (readonly [number, Selection])[] = [];
      for (const kept of history.heldTransactionsAfter(entry.newestLogged)) {
        const transaction = kept.transaction;
        if (entry.parents.has(transaction.serial)) continue;
        records.push(kept);
        entry.parents.set(transaction.serial, transaction.parent);
        entry.afters.set(transaction.serial, transaction.selectionAfter);
        entry.newestLogged = Math.max(entry.newestLogged, transaction.serial);
      }
      // Only the newest transaction can have its selection refined after it was recorded.
      const newest = history.newestTransaction;
      if (
        newest !== undefined &&
        !sameSelection(entry.afters.get(newest.serial), newest.selectionAfter)
      ) {
        selections.push([newest.serial, newest.selectionAfter]);
        entry.afters.set(newest.serial, newest.selectionAfter);
      }
      if (!this.connects(entry, history.headSerial)) {
        if (!(await this.rebase(entry, pane, saved))) return this.failed(entry);
      } else if (records.length > 0 || selections.length > 0 || newBase !== undefined) {
        this.pending.push({ kind: "append", id: entry.id, records, selections, base: newBase });
      }
    }
    const joins = pane.joins();
    const base = entry.base;
    if (base === undefined) return this.failed(entry);
    const file = entry.journal?.place?.file;
    entry.kept = {
      id: entry.id,
      base,
      head: history.headSerial,
      nextSerial: history.upcomingSerial,
      ...(saved === undefined ? {} : { saved }),
      ...(file === undefined ? {} : { log: { file, length: 0, hash: "" } }),
      history: {
        undoBase: history.undoBaseSerial,
        ...(history.redoTipSerial === undefined ? {} : { redoTip: history.redoTipSerial }),
        redoSteps: history.redoStepSizes,
        savedState: history.savedStateSerial,
        dirtyRegardless: history.isDirtyRegardless,
        joins: joins.undo,
        undoneJoins: joins.redo,
      },
    };
    entry.version = history.version;
    entry.saved = saved;
  }

  /**
   * Puts the history's journal into this workspace's `Kept/` when it is not there — a journal of
   * its own, one in another workspace. The copy is the journal's own queue: the history switches
   * to the new journal at once, and its bytes land behind.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.placeJournal
   * @upstream-differs no rounds and no sheet: a journal answers reads of what it still copies
   * from the one it copies, so nothing waits on the move
   */
  private placeJournal(entry: Entry, document: BinaryDocument): void {
    const history = document.undoHistory;
    const journal = history.currentJournal;
    if (journal?.place?.folder === this.folder.id) return;
    if (journal === undefined && !history.canUndo && !history.canRedo) return;
    const file = `${entry.id}-${Math.random().toString(36).slice(2, 10)}.log`;
    history.moveJournal(
      new UndoJournal(this.folder.file(file), undefined, { folder: this.folder.id, file })
    );
  }

  /**
   * A content that could not be taken afresh: the snapshot keeps what the last one kept, and the
   * next one tries again from the start.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.failed
   */
  private failed(entry: Entry): void {
    entry.base = undefined;
    entry.version = undefined;
  }

  /**
   * Starts the document's content afresh: a new base, and a new log holding every transaction the
   * history has. A file's base is the file itself when the history leads from its saved state;
   * otherwise the content is written — whole for a document with no file, as runs over the file
   * for one.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.rebase
   */
  private async rebase(
    entry: Entry,
    pane: KeptPane,
    saved: number | undefined,
    keepingBase = false
  ): Promise<boolean> {
    const { document } = pane;
    const history = document.undoHistory;
    const name = `${entry.id}-${Math.random().toString(36).slice(2, 10)}`;
    const held = history.heldTransactions;
    const parents = new Map<number, number>();
    const afters = new Map<number, Selection>();
    for (const kept of held) {
      parents.set(kept.transaction.serial, kept.transaction.parent);
      afters.set(kept.transaction.serial, kept.transaction.selectionAfter);
    }
    const head = history.headSerial;
    let pendingBase: PendingBase;
    let base: KeptBase;
    const kept = entry.base;
    if (keepingBase && kept !== undefined && historyConnects(kept.serial, head, parents)) {
      // A new log over the same base: nothing written whole again.
      pendingBase = { kind: "unchanged" };
      base = kept;
    } else if (saved !== undefined && historyConnects(saved, head, parents)) {
      pendingBase = { kind: "file", serial: saved };
      base = { kind: "file", serial: saved };
    } else if (saved !== undefined) {
      const edits = await pane.exportKeptEdits();
      if (edits === undefined) return false;
      pendingBase = {
        kind: "edits",
        file: `${name}.edits`,
        serial: head,
        data: encodeEdits(edits),
      };
      base = { kind: "edits", file: `${name}.edits`, serial: head, hash: "" };
    } else {
      const content = await document.storage.read(0, document.size).catch(() => undefined);
      if (content === undefined) return false;
      pendingBase = { kind: "bytes", file: `${name}.bin`, serial: head, content: content.slice() };
      base = { kind: "bytes", file: `${name}.bin`, serial: head, hash: "" };
    }
    entry.base = base;
    entry.journal = history.currentJournal;
    entry.parents = parents;
    entry.newestLogged = held.at(-1)?.transaction.serial ?? 0;
    entry.connected = new Set([base.serial]);
    entry.afters = afters;
    this.pending.push({
      kind: "rebase",
      id: entry.id,
      journal: history.currentJournal,
      base: pendingBase,
      held,
    });
    return true;
  }

  /**
   * Whether the log leads from the base to `head`: the way up from `head` is followed only until
   * it meets a state already known to be reached.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.connects
   */
  private connects(entry: Entry, head: number): boolean {
    const base = entry.base?.serial;
    if (base === undefined) return false;
    if (entry.connected.size === 0) entry.connected.add(base);
    const walked: number[] = [];
    let at = head;
    while (!entry.connected.has(at)) {
      walked.push(at);
      const parent = entry.parents.get(at);
      if (parent === undefined || walked.length > entry.parents.size) {
        // Not upwards: the base may lie below `head`'s way, as after an undo past it.
        if (!historyConnects(base, head, entry.parents)) return false;
        for (const one of walked) entry.connected.add(one);
        return true;
      }
      at = parent;
    }
    for (const one of walked) entry.connected.add(one);
    return true;
  }

  /**
   * Whether what `document` holds now is what the last snapshot kept and the writer wrote — what
   * lets leaving the page not ask about it: it comes back at the next launch as it is.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.holdsCurrentBytes
   */
  holdsCurrentBytes(document: BinaryDocument): boolean {
    const entry = this.entries.get(document);
    if (entry?.kept === undefined || entry.version === undefined) return false;
    const now = document.undoHistory.version;
    return (
      entry.version.epoch === now.epoch &&
      entry.version.serial === now.serial &&
      !this.writer.hasFailed(entry.id) &&
      this.writer.lastSnapshotWasWritten
    );
  }

  /**
   * A snapshot is about to be taken. A document whose last writes failed is started afresh.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.beginSnapshot
   */
  beginSnapshot(): void {
    this.named = new Set();
    this.namedIds = new Set();
    this.pending = [];
    const failed = this.writer.takeFailures();
    if (failed.size === 0) return;
    for (const entry of this.entries.values()) {
      if (failed.has(entry.id)) {
        entry.base = undefined;
        entry.version = undefined;
      }
    }
  }

  /**
   * The snapshot is taken: hands it to the writer, which writes what it decided, then the
   * workspace through `record`, then removes the kept files it no longer names.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.commit
   */
  commit(
    workspace: Parameters<KeptWriter["commit"]>[1],
    record: Parameters<KeptWriter["commit"]>[3]
  ): Promise<void> {
    const pending = this.pending;
    this.pending = [];
    for (const [document, entry] of this.entries) {
      if (!this.namedIds.has(entry.id)) this.entries.delete(document);
    }
    return this.writer.commit(pending, workspace, new Set(this.named), record);
  }

  // MARK: - Reading back

  /** What `readBack` has read, by content id. */
  private readBacks = new Map<string, Promise<ReadBack>>();
  /** The names of documents whose content came back without its history. */
  private historiesLost: string[] = [];

  /**
   * Reads `content` back: its log checked by its chained hash, its base by its own, a document's
   * content rebuilt. Read once, and answered again from there until it is taken up.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.readBack
   */
  readBack(content: KeptContent): Promise<ReadBack> {
    let read = this.readBacks.get(content.id);
    if (read === undefined) {
      read = readKept(this.folder, content);
      this.readBacks.set(content.id, read);
    }
    return read;
  }

  /**
   * The content of an untitled document or a part as it was kept.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.bytes
   */
  async bytesOf(content: KeptContent): Promise<Uint8Array> {
    const read = content.base.kind === "bytes" ? await this.readBack(content) : undefined;
    if (read?.bytes === undefined) throw new HistoryLogError("unreadable");
    return read.bytes;
  }

  /**
   * Lays a file's kept content over the file its document has just opened: its runs, then the
   * transactions from the base to the state kept. Half laid over is not an outcome: on a failure
   * the storage is as it was opened.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.apply
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.applyKeptContent
   */
  async apply(content: KeptContent, storage: EditOverlayStorage): Promise<void> {
    if (content.base.kind === "bytes") throw new HistoryLogError("unreadable");
    const read = await this.readBack(content);
    const ops = opsOf(content, read.records);
    const before = await storage.exportEdits();
    try {
      if (read.edits !== undefined) storage.applyEdits(read.edits);
      await applyHistory(ops, storage);
    } catch (error) {
      storage.applyEdits(before);
      throw error;
    }
  }

  /**
   * A restored document goes on as kept: its history counts on from where the kept one stopped,
   * and the next snapshot appends to the same log. Its undo and redo sides come back with it when
   * the workspace kept them and the log holds them; otherwise it goes on with an empty history, as
   * dirty as it was. Answers the joins the history came back with, for the pane to attach.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.adopt
   */
  async adopt(
    document: BinaryDocument,
    content: KeptContent,
    name: string,
    dirty: boolean
  ): Promise<{ readonly joins: readonly KeptJoin[]; readonly undoneJoins: readonly KeptJoin[] }> {
    const read = await this.readBack(content).catch(() => undefined);
    const records = read?.records ?? [];
    const map = new Map(records.map((one) => [one.transaction.serial, one]));
    const kept = content.history;
    const sides =
      kept === undefined
        ? undefined
        : historySides({
            head: content.head,
            undoBase: kept.undoBase,
            redoTip: kept.redoTip,
            redoSizes: kept.redoSteps,
            records: map,
          });
    let joins: { joins: readonly KeptJoin[]; undoneJoins: readonly KeptJoin[] } = {
      joins: [],
      undoneJoins: [],
    };
    if (kept !== undefined && sides !== undefined) {
      document.undoHistory.restore({
        undo: sides.undo,
        redo: sides.redo,
        base: kept.undoBase,
        nextSerial: content.nextSerial,
        saved: kept.savedState,
        dirtyRegardless: kept.dirtyRegardless,
        journal: read?.journal,
      });
      joins = { joins: kept.joins, undoneJoins: sides.redo.length === 0 ? [] : kept.undoneJoins };
    } else {
      document.undoHistory.resume({
        head: content.head,
        nextSerial: content.nextSerial,
        saved: content.saved,
        dirty,
        journal: read?.journal,
      });
      // Kept, but the log no longer leads back: the content is right, the steps to undo it are
      // gone, and the warning says so.
      if (kept !== undefined && (kept.undoBase !== content.head || kept.redoTip !== undefined)) {
        this.historiesLost.push(name);
      }
    }
    this.readBacks.delete(content.id);
    const journal = document.undoHistory.currentJournal;
    this.writer.submit([{ kind: "resume", id: content.id, base: content.base, journal }]);
    const entry: Entry = {
      id: content.id,
      base: content.base,
      journal,
      parents: new Map(),
      newestLogged: 0,
      connected: new Set(),
      afters: new Map(),
      kept: content,
      version: document.undoHistory.version,
      saved: content.saved,
    };
    for (const record of records) {
      entry.parents.set(record.transaction.serial, record.transaction.parent);
      entry.afters.set(record.transaction.serial, record.transaction.selectionAfter);
      entry.newestLogged = Math.max(entry.newestLogged, record.transaction.serial);
    }
    this.entries.set(document, entry);
    return joins;
  }

  /**
   * Lets go of what was read back and not taken up — content whose file changed, a part whose
   * parent did not come back — and the journals it held open.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.forgetReadBacks
   */
  forgetReadBacks(): void {
    this.readBacks.clear();
  }

  /**
   * The names of documents that came back without their history since the last call — for the
   * restore's warning.
   *
   * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.takeHistoriesLost
   */
  takeHistoriesLost(): string[] {
    const taken = this.historiesLost;
    this.historiesLost = [];
    return taken;
  }
}

/**
 * What reading a kept content back gave: the log's transactions, and the base read and checked —
 * a document's whole content, or the runs over a file.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.ReadBack
 */
export interface ReadBack {
  readonly records: readonly KeptTransaction[];
  readonly bytes?: Uint8Array | undefined;
  readonly edits?: OverlayEdits | undefined;
  /**
   * The log taken up again, cut to its pin: the restored history's journal, which its operations'
   * bytes point into.
   */
  readonly journal?: UndoJournal | undefined;
}

const hexOf = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function fromHex(text: string): Uint8Array | undefined {
  if (text.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(text)) return undefined;
  return Uint8Array.from({ length: text.length / 2 }, (_, index) =>
    Number.parseInt(text.slice(index * 2, index * 2 + 2), 16)
  );
}

/** @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.read */
async function readKept(folder: KeptFolder, content: KeptContent): Promise<ReadBack> {
  let records: readonly KeptTransaction[] = [];
  let journal: UndoJournal | undefined;
  const log = content.log;
  if (log !== undefined) {
    const hash = fromHex(log.hash);
    if (hash === undefined) throw new HistoryLogError("unreadable");
    const file = folder.file(log.file);
    // What was written past the pin — after the last manifest, before a crash — is not part of it.
    await file.truncate(log.length);
    journal = new UndoJournal(
      file,
      { length: log.length, hash },
      { folder: folder.id, file: log.file }
    );
    records = await readHistoryLog(journal, log.length, hash);
  }
  const checked = async (name: string, hash: string): Promise<Uint8Array> => {
    const bytes = await readWholeKeptFile(folder.file(name));
    if (bytes === undefined || hexOf(sha256(bytes)) !== hash) {
      throw new HistoryLogError("unreadable");
    }
    return bytes;
  };
  const base = content.base;
  switch (base.kind) {
    case "file":
      return { records, journal };
    case "edits": {
      const edits = decodeEdits(await checked(base.file, base.hash));
      if (edits === undefined) throw new HistoryLogError("unreadable");
      return { records, edits, journal };
    }
    case "bytes": {
      const storage = new EditOverlayStorage(
        new MemoryBackedStorage(await checked(base.file, base.hash))
      );
      await applyHistory(opsOf(content, records), storage);
      return { records, bytes: await storage.read(0, storage.size), journal };
    }
  }
}

/**
 * The operations from the content's base to the state it was in.
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.ops
 */
function opsOf(content: KeptContent, records: readonly KeptTransaction[]) {
  const map = new Map(records.map((one) => [one.transaction.serial, one.transaction]));
  const ops = historyPath(content.base.serial, content.head, map);
  if (ops === undefined) throw new HistoryLogError("noPath");
  return ops;
}
