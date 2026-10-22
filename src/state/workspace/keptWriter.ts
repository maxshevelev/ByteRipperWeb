import { Sha256 } from "@/core/crypto/sha256";
import type { Selection } from "@/core/document/selectionModel";
import { HistoryLogWriter } from "@/core/edit/historyLog";
import type { KeptTransaction } from "@/core/edit/undoHistory";
import { liveJournalNames, type UndoJournal } from "@/core/edit/undoJournal";
import type { KeptFolder } from "@/core/workspace/keptFolder";
import {
  type KeptBase,
  type KeptContent,
  updatingKept,
  type Workspace,
} from "@/core/workspace/workspace";

/**
 * Writes what a workspace's snapshots decide about the content they keep, in order and behind
 * them: a document's base written whole and hashed, its transactions appended to its log, the log
 * pinned — and only then the workspace that names them, and only after that the kept files no
 * workspace names any more removed. A record never points at bytes not there.
 *
 * @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWriter
 * @upstream-differs a queue of promises on the page, where upstream's is a serial queue off the
 * main thread
 */

/** A base to write for a content begun anew. */
export type PendingBase =
  /** The base as it was: a new log over it. */
  | { readonly kind: "unchanged" }
  /** The file on disk, holding the saved state. */
  | { readonly kind: "file"; readonly serial: number }
  /** A file's changes as runs over it, encoded. */
  | {
      readonly kind: "edits";
      readonly file: string;
      readonly serial: number;
      readonly data: Uint8Array;
    }
  /**
   * A document's whole content, read when the snapshot decided it.
   *
   * @upstream-differs the bytes themselves, where upstream hands over a snapshot that shares the
   * piece list: a page's overlay has nothing cheaper to share than its content
   */
  | {
      readonly kind: "bytes";
      readonly file: string;
      readonly serial: number;
      readonly content: Uint8Array;
    };

/**
 * What one snapshot has the writer do for one document.
 *
 * @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWrite
 */
export type KeptWrite =
  /**
   * The content begun anew: its base, and every transaction the history holds into its log — the
   * history's journal, already in `Kept/`.
   */
  | {
      readonly kind: "rebase";
      readonly id: string;
      readonly journal: UndoJournal | undefined;
      readonly base: PendingBase;
      readonly held: readonly KeptTransaction[];
    }
  /** What changed since the last snapshot: new transactions, a refined selection, a new base. */
  | {
      readonly kind: "append";
      readonly id: string;
      readonly records: readonly KeptTransaction[];
      readonly selections: readonly (readonly [number, Selection])[];
      readonly base?: KeptBase | undefined;
    }
  /** A content put back by a restore: the log appended to goes on being the restored journal. */
  | {
      readonly kind: "resume";
      readonly id: string;
      readonly base: KeptBase;
      readonly journal: UndoJournal | undefined;
    };

/** What the writer holds for one content: its base as written, and the log it appends to. */
interface Held {
  base: KeptBase | undefined;
  log: HistoryLogWriter | undefined;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWriter */
export class KeptWriter {
  private readonly folder: KeptFolder;
  private readonly held = new Map<string, Held>();
  private readonly failed = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private lastWritten = false;

  constructor(folder: KeptFolder) {
    this.folder = folder;
  }

  /**
   * Whether the last snapshot handed over was written whole.
   *
   * @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWriter.lastSnapshotWasWritten
   */
  get lastSnapshotWasWritten(): boolean {
    return this.lastWritten;
  }

  /** @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWriter.hasFailed */
  hasFailed(id: string): boolean {
    return this.failed.has(id);
  }

  /**
   * The contents whose writes failed since the last call: each begun anew at the next snapshot.
   *
   * @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWriter.takeFailures
   */
  takeFailures(): Set<string> {
    const taken = new Set(this.failed);
    this.failed.clear();
    return taken;
  }

  /** Every write handed over so far has been made. */
  settled(): Promise<void> {
    return this.queue;
  }

  /**
   * Writes `writes` in order, outside a snapshot: what a restore resumes.
   *
   * @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWriter.submit
   */
  submit(writes: readonly KeptWrite[]): void {
    this.queue = this.queue.then(async () => {
      for (const write of writes) await this.perform(write);
    });
  }

  /**
   * A snapshot: its writes, then `workspace` with what they came out as filled in, handed to
   * `record`; then every kept file `named` does not name removed. Answers once it is written.
   *
   * @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWriter.commit
   */
  commit(
    writes: readonly KeptWrite[],
    workspace: Workspace,
    named: ReadonlySet<string>,
    record: (workspace: Workspace) => Promise<void>
  ): Promise<void> {
    const done = this.queue.then(async () => {
      this.lastWritten = false;
      let whole = true;
      for (const write of writes) whole = (await this.perform(write)) && whole;
      // A record never names what was not written: one write that failed leaves the last record
      // standing, and the next snapshot begins that content anew.
      if (!whole) return;
      const filled = await this.filled(workspace);
      await record(filled);
      // Documents no longer kept let go of their journals first; a journal an open document still
      // writes stays, named yet or not.
      const ids = new Set(writes.map((one) => one.id));
      for (const id of [...this.held.keys()])
        if (!ids.has(id) && !this.named(id, filled)) this.held.delete(id);
      const keep = new Set([...named, ...liveJournalNames(this.folder.id)]);
      await this.folder.removeExcept(keep).catch(() => undefined);
      this.lastWritten = true;
    });
    this.queue = done.catch(() => undefined);
    return done;
  }

  /**
   * `workspace` with each kept content's base and log as they came out: the base's hash, the
   * log's pinned length and hash.
   *
   * @upstream ByteRipperApp/Workspace/KeptWriter.swift#KeptWriter.filled
   */
  private async filled(workspace: Workspace): Promise<Workspace> {
    const pins = new Map<string, { length: number; hash: string; file: string } | undefined>();
    for (const [id, held] of this.held) {
      const pinned = await held.log?.pin();
      const file = held.log?.journal.place?.file;
      if (pinned !== undefined && file !== undefined) {
        await this.folder
          .file(file)
          .synchronize()
          .catch(() => undefined);
        pins.set(id, { length: pinned.length, hash: hex(pinned.hash), file });
      } else pins.set(id, undefined);
    }
    return updatingKept(workspace, (content): KeptContent => {
      const held = this.held.get(content.id);
      if (held === undefined) return content;
      const pin = pins.get(content.id);
      return {
        ...content,
        ...(held.base === undefined ? {} : { base: held.base }),
        log: pin,
      };
    });
  }

  /** Whether `workspace` names the content `id`. */
  private named(id: string, workspace: Workspace): boolean {
    let found = false;
    updatingKept(workspace, (content) => {
      if (content.id === id) found = true;
      return content;
    });
    return found;
  }

  private async perform(write: KeptWrite): Promise<boolean> {
    try {
      switch (write.kind) {
        case "rebase": {
          const base = await this.writeBase(write.id, write.base);
          const log = write.journal === undefined ? undefined : new HistoryLogWriter(write.journal);
          for (const record of write.held) log?.append(record);
          this.held.set(write.id, { base, log });
          break;
        }
        case "append": {
          const held = this.held.get(write.id);
          if (held === undefined) throw new Error("Nothing to append to.");
          for (const record of write.records) held.log?.append(record);
          for (const [serial, selection] of write.selections)
            held.log?.appendSelection(serial, selection);
          if (write.base !== undefined) held.base = write.base;
          break;
        }
        case "resume":
          this.held.set(write.id, {
            base: write.base,
            log: write.journal === undefined ? undefined : new HistoryLogWriter(write.journal),
          });
          break;
      }
      return true;
    } catch {
      this.failed.add(write.id);
      return false;
    }
  }

  /** Writes a base whole, hashing it as it goes; answers it as the workspace names it. */
  private async writeBase(id: string, base: PendingBase): Promise<KeptBase | undefined> {
    switch (base.kind) {
      case "unchanged":
        return this.held.get(id)?.base;
      case "file":
        return { kind: "file", serial: base.serial };
      case "edits": {
        const file = this.folder.file(base.file);
        await file.write(0, base.data);
        await file.synchronize();
        return {
          kind: "edits",
          file: base.file,
          serial: base.serial,
          hash: hex(new Sha256().update(base.data).digest()),
        };
      }
      case "bytes": {
        const file = this.folder.file(base.file);
        const hasher = new Sha256();
        const slice = 4 << 20;
        for (let at = 0; at < base.content.length; at += slice) {
          const bytes = base.content.subarray(at, at + slice);
          hasher.update(bytes);
          await file.write(at, bytes);
        }
        await file.synchronize();
        return { kind: "bytes", file: base.file, serial: base.serial, hash: hex(hasher.digest()) };
      }
    }
  }
}
