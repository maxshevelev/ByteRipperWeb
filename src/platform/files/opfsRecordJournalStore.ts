import type { JournalStore } from "@/core/edit/undoJournal";
import { holdForThisPage } from "@/platform/files/opfsScratchStore";

/**
 * An undo journal in the origin-private file system, each write a file of its own, written once
 * (`Design/FILE_SESSIONS.md`, S0 and S7).
 *
 * The session host runs in a `SharedWorker`, which Chromium gives neither a sync access handle nor
 * a nested worker that has one, and an async writable is a copy of the whole file: appending to
 * one file would cost the file's size at every write. A journal is only ever appended to and read,
 * so it is kept as its writes, each named by where it starts — 3–6 ms a write, behind the
 * journal's own queue, which answers reads from memory until the write lands.
 *
 * Named under one prefix this realm holds while it lives, so the sweep at startup removes what a
 * host that ended badly left behind (`sweepOrphanedScratch`).
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.init
 * @upstream-differs the journal is its writes, a file each, where upstream appends to one file
 * it unlinked as it opened it
 */
export class OpfsRecordJournalStore implements JournalStore {
  private readonly name: string;
  /** Where each write starts and how long it is, in the order written — which is offset order. */
  private readonly records: { readonly at: number; readonly length: number }[] = [];
  private closed = false;

  constructor() {
    this.name = `${realmPrefix()}-${counter++}`;
  }

  async write(at: number, bytes: Uint8Array): Promise<void> {
    if (bytes.length === 0) return;
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle(this.fileOf(at), { create: true });
    const stream = await handle.createWritable();
    try {
      await stream.write(bytes as Uint8Array<ArrayBuffer>);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => undefined);
      throw error;
    }
    this.records.push({ at, length: bytes.length });
    // Closed while the write was out: it is not wanted.
    if (this.closed) await root.removeEntry(this.fileOf(at)).catch(() => undefined);
  }

  async read(at: number, count: number): Promise<Uint8Array> {
    const out = new Uint8Array(count);
    const end = at + count;
    const root = await navigator.storage.getDirectory();
    for (const record of this.records) {
      const from = Math.max(at, record.at);
      const to = Math.min(end, record.at + record.length);
      if (from >= to) continue;
      const file = await (await root.getFileHandle(this.fileOf(record.at))).getFile();
      const bytes = await file.slice(from - record.at, to - record.at).arrayBuffer();
      out.set(new Uint8Array(bytes), from - at);
    }
    return out;
  }

  close(): void {
    this.closed = true;
    const names = this.records.map((record) => this.fileOf(record.at));
    void navigator.storage
      .getDirectory()
      .then(async (root) => {
        for (const name of names) await root.removeEntry(name).catch(() => undefined);
      })
      .catch(() => undefined);
  }

  private fileOf(at: number): string {
    return `${this.name}-${at.toString(16)}.bin`;
  }
}

let prefix: string | undefined;
let counter = 0;

/** The prefix this realm's journals are named under, held while it lives. */
function realmPrefix(): string {
  if (prefix === undefined) {
    prefix = `scratch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    holdForThisPage(prefix);
  }
  return prefix;
}
