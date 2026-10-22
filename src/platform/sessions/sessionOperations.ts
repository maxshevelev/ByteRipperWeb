import type { RecordedAct } from "@/core/session/sessionActs";
import { type PartitionData, partitionData, partitionFrom } from "@/core/session/sessionCuts";
import type { SessionHost, SessionParts } from "@/core/session/sessionHost";
import type { SessionView } from "@/core/session/sessionView";
import type { ByteSource } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { EditOverlayStorage, type OverlayEdits } from "@/core/storage/editOverlayStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import type { OffsetRange } from "@/core/storage/pieceTable";
import { contentBlob, type SaveOutcome, type SaveTarget, writeTo } from "@/platform/files/fileSink";
import { OpfsScratchStore } from "@/platform/files/opfsScratchStore";

/**
 * What the platform does to a session in the host, in the session's turn among the requests
 * (`Design/FILE_SESSIONS.md`, S6): everything the page used to do to a document itself, each by a
 * name, with plain data both ways — so it is the same whether the host runs in the page or in a
 * `SharedWorker`.
 *
 * @web-only upstream's window holds the document and does these to it directly
 */
export interface SessionOperations {
  /** The content as it stands, written once to private storage: what a worker or a join reads. */
  readonly snapshot: { readonly args: undefined; readonly result: ByteSource };
  /** The content as one blob, for a download. */
  readonly contentBlob: { readonly args: undefined; readonly result: Blob };
  /** Writes the content to where a save goes, and marks it saved there. */
  readonly save: {
    readonly args: {
      readonly target: Extract<SaveTarget, { readonly kind: "inPlace" | "as" }>;
      readonly name: string;
    };
    readonly result: Extract<SaveOutcome, { readonly kind: "savedInPlace" | "savedAs" }>;
  };
  /** Throws every change away and starts again over `source`, the file as it is now. */
  readonly revert: { readonly args: { readonly source: ByteSource }; readonly result: undefined };
  /** Lays changes carried with a document over it: unsaved, with no history to undo them by. */
  readonly layEdits: { readonly args: OverlayEdits; readonly result: undefined };
  /** The changes as runs over the file; nothing where the storage cannot say. */
  readonly exportEdits: { readonly args: undefined; readonly result: OverlayEdits | undefined };
  /** The stretches that differ from the file, for what paints them. */
  readonly changedRanges: { readonly args: undefined; readonly result: OffsetRange[] };
  /** How many bytes the changes hold in memory. */
  readonly residentBytes: { readonly args: undefined; readonly result: number };
  /** The content was put back from outside: whatever reads it starts over. */
  readonly contentReplaced: { readonly args: undefined; readonly result: undefined };
  /** Puts a partition back, its history untouched: not an undo step. */
  readonly restoreCuts: { readonly args: PartitionData; readonly result: undefined };
  /** What Undo and Redo take back, the cuts with them, as a workspace writes it down. */
  readonly undoState: { readonly args: undefined; readonly result: UndoStateData };
  /** Puts back what Undo and Redo take back, as a workspace wrote it down. */
  readonly restoreUndo: { readonly args: UndoStateData; readonly result: undefined };
}

/** An act with its partitions as data. @web-only see {@link SessionOperations} */
export type RecordedActData =
  | { readonly kind: "document" | "segments"; readonly after?: PartitionData | undefined }
  | {
      readonly kind: "group";
      readonly parts: readonly RecordedActData[];
      readonly before?: PartitionData | undefined;
      readonly after?: PartitionData | undefined;
    };

/** @web-only see {@link SessionOperations} */
export interface UndoStateData {
  readonly past: readonly RecordedActData[];
  readonly future: readonly RecordedActData[];
  readonly cutsPast: readonly PartitionData[];
  readonly cutsFuture: readonly PartitionData[];
}

/** @web-only see {@link SessionOperations} */
export function actData(act: RecordedAct): RecordedActData {
  const data = (partition: RecordedAct["after"]) =>
    partition === undefined ? undefined : partitionData(partition);
  return act.kind === "group"
    ? {
        kind: "group",
        parts: act.parts.map(actData),
        before: data(act.before),
        after: data(act.after),
      }
    : { kind: act.kind, after: data(act.after) };
}

/** @web-only see {@link SessionOperations} */
export function actFrom(data: RecordedActData): RecordedAct {
  const partition = (one: PartitionData | undefined) =>
    one === undefined ? undefined : partitionFrom(one);
  return data.kind === "group"
    ? {
        kind: "group",
        parts: data.parts.map(actFrom),
        before: partition(data.before),
        after: partition(data.after),
      }
    : { kind: data.kind, after: partition(data.after) };
}

type Name = keyof SessionOperations;
type Args<K extends Name> = SessionOperations[K]["args"];
type Result<K extends Name> = SessionOperations[K]["result"];

/** Asks the host to do `name` to the session `view` shows; its answer. */
export async function operate<K extends Name>(
  view: SessionView,
  name: K,
  ...args: Args<K> extends undefined ? [] : [Args<K>]
): Promise<Result<K>> {
  return (await view.operate(name, args[0])) as Result<K>;
}

const overlayOf = (session: SessionParts) => session.document.storage as EditOverlayStorage;

/** What the host does under each name. */
const operations: {
  readonly [K in Name]: (session: SessionParts, args: Args<K>) => Promise<Result<K>> | Result<K>;
} = {
  snapshot: (session) => overlayOf(session).contentSnapshot(new OpfsScratchStore()),
  contentBlob: (session) => contentBlob(session.document.storage),
  save: async (session, { target, name }) => {
    const overlay = overlayOf(session);
    const written = await writeTo(target, {
      storage: overlay,
      name,
      baseSize: overlay.baseSize,
      // Patching writes only what changed, and only when writing back to the very file those
      // offsets were measured against.
      changedRanges: overlay.canPatchInPlace ? overlay.changedRanges : undefined,
    });
    // The file on disk now holds the document, so the overlay starts again over it: nothing is a
    // change any more.
    overlay.rebase(new FileBackedStorage(written.file.source, new ChunkCache()));
    session.document.markSaved();
    return written;
  },
  revert: (session, { source }) => {
    session.document.revert(
      new EditOverlayStorage(
        new FileBackedStorage(source, new ChunkCache()),
        OpfsScratchStore.isAvailable() ? { scratch: new OpfsScratchStore() } : {}
      )
    );
    return undefined;
  },
  layEdits: (session, edits) => {
    overlayOf(session).applyEdits(edits);
    // Changes nobody saved, with no history to undo them by: the state a join leaves a document
    // in, and what makes a close ask.
    session.document.undoHistory.clearKeepingDirty();
    session.document.contentReplaced();
    return undefined;
  },
  exportEdits: (session) => {
    const storage = session.document.storage;
    return storage instanceof EditOverlayStorage ? storage.exportEdits() : undefined;
  },
  changedRanges: (session) => {
    const storage = session.document.storage;
    return storage instanceof EditOverlayStorage ? storage.changedRanges : [];
  },
  residentBytes: (session) => {
    const storage = session.document.storage;
    return storage instanceof EditOverlayStorage ? storage.residentByteCount : 0;
  },
  contentReplaced: (session) => {
    session.document.contentReplaced();
    return undefined;
  },
  restoreCuts: (session, partition) => {
    session.cuts.restore(partitionFrom(partition));
    return undefined;
  },
  undoState: (session) => {
    const { past, future } = session.acts.recorded;
    return {
      past: past.map(actData),
      future: future.map(actData),
      cutsPast: session.cuts.past.map(partitionData),
      cutsFuture: session.cuts.future.map(partitionData),
    };
  },
  restoreUndo: (session, state) => {
    session.acts.restore(state.past.map(actFrom), state.future.map(actFrom));
    session.cuts.restoreHistory(
      state.cutsPast.map(partitionFrom),
      state.cutsFuture.map(partitionFrom)
    );
    return undefined;
  },
};

/** Teaches `host` every operation above. */
export function installSessionOperations(host: SessionHost): void {
  for (const [name, operation] of Object.entries(operations)) {
    host.defineSessionOperation(name, (session, args) =>
      (operation as (session: SessionParts, args: unknown) => unknown)(session, args)
    );
  }
}
