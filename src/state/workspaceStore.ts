import type { DiffEdit } from "@/core/diff/diffEngine";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { TypingController } from "@/core/edit/typingController";
import type { ByteStorage, EditableByteStorage } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { makeByteDecoder } from "@/core/text/byteDecoderRegistry";
import { detectFileCapabilities, type FileCapabilities } from "@/platform/files/capabilities";
import {
  type SaveOutcome,
  save as saveFile,
  saveAs as saveFileAs,
} from "@/platform/files/fileSink";
import type { OpenedFile } from "@/platform/files/openedFile";
import { OpfsScratchStore } from "@/platform/files/opfsScratchStore";
import type { WordSize } from "@/render/hexGrid/hexLayout";
import { noteDocumentChanged } from "@/state/editStore";
import { createStore } from "@/state/store";

/**
 * The workspace: one per browser tab (D11), so this is a module-level store and
 * not something a component instantiates.
 *
 * It owns the two file slots, the view settings both panes share, and the
 * browser's file capabilities — detected once, on the way in, so nothing below
 * has to ask again.
 */

/** Which slot. File B is optional; with only A the app is in single-file mode. */
export type PaneId = "a" | "b";

export const PANE_IDS: readonly PaneId[] = ["a", "b"];

export interface PaneState {
  readonly name: string;
  /** Kept so the comparison worker can be handed the file itself. */
  readonly file: OpenedFile;
  readonly document: BinaryDocument;
  /**
   * The editing state machine for this document. It lives here rather than in
   * the component because it holds a half-typed nibble and an open undo group,
   * neither of which should survive a pane remounting or a layout change.
   */
  readonly typing: TypingController;
  /**
   * The file as it was last saved, which is what says whether a byte is an
   * unsaved edit. Absent for a document that has never been on disk — a new
   * file, a duplicate — where every byte would otherwise read as modified.
   */
  readonly saved: ByteStorage | undefined;
  /** True when this file can be written back to itself (D7). */
  readonly writable: boolean;
}

/**
 * Told what each edit changed, so the comparison can update without a rescan,
 * and asked before an edit that shifts every offset after it. Set once by the
 * app; absent under tests.
 */
export const editingHooks: {
  onEdit?: ((pane: PaneId, edit: DiffEdit) => void) | undefined;
  confirmShift?: (() => boolean | Promise<boolean>) | undefined;
} = {};

/**
 * A read-only view of the file as it sits on disk.
 *
 * Its own cache, because a chunk cache is keyed by chunk index alone and this
 * reads the same offsets as the document's own storage — one shared between
 * them would serve the edited bytes for the saved ones and paint every edit as
 * unmodified.
 */
function savedStorageFor(file: OpenedFile): ByteStorage {
  return new FileBackedStorage(file.source, new ChunkCache());
}

/** A scratch store where the browser has one, and none where it does not. */
function scratchOptions(): { scratch?: OpfsScratchStore } {
  return OpfsScratchStore.isAvailable() ? { scratch: new OpfsScratchStore() } : {};
}

function makeDocument(storage: EditableByteStorage, pane: PaneId) {
  const document = new BinaryDocument(storage);
  const typing = new TypingController(document, {
    onEdit: (edit) => editingHooks.onEdit?.(pane, edit),
    confirmInsertShift: () => editingHooks.confirmShift?.() ?? true,
  });
  // Both signals, because neither alone is enough. A content change fires while
  // an edit group is still open, so the document is not yet dirty when it
  // arrives; the commit that makes it dirty fires no content change. Anything
  // watching only one of them shows the wrong answer for a typed byte.
  document.onContentChanged(noteDocumentChanged);
  document.onTransactionCommitted(noteDocumentChanged);
  return { document, typing };
}

/**
 * How the two panes sit. Side by side is the default — a firmware dump is 16
 * bytes wide and two of those fit on any bench monitor — and stacked is for a
 * narrow window or a long region read down the page.
 */
export type PaneLayout = "sideBySide" | "stacked";

/**
 * How far apart differing bytes may sit and still count as one change. One,
 * two, four and sixteen hex rows, as upstream offers.
 */
export const GROUPING_GAP_CHOICES: readonly number[] = [16, 32, 64, 256];

/**
 * Four rows: close enough that a press moves to a change you were not already
 * looking at, without folding neighbouring changes into one.
 */
export const DEFAULT_GROUPING_GAP = 64;

/**
 * How small and how large the hex font may be stepped.
 *
 * Below nine pixels the two hex digits of a byte stop being two digits; above
 * twenty-four a row of sixteen no longer fits a pane worth having.
 */
export const MIN_FONT_SIZE_PX = 9;
export const MAX_FONT_SIZE_PX = 24;
export const DEFAULT_FONT_SIZE_PX = 13;

export interface WorkspaceState {
  readonly panes: Readonly<Record<PaneId, PaneState | undefined>>;
  readonly layout: PaneLayout;
  /** File A's share of the workspace, 0–1. The divider moves it. */
  readonly splitFraction: number;
  /** Which pane the keyboard and the commands act on. */
  readonly activePane: PaneId;
  readonly capabilities: FileCapabilities;
  readonly wordSize: WordSize;
  readonly decoderIdentifier: string;
  readonly fontSizePx: number;
  readonly groupingGap: number;
  /**
   * Whether to ask before an edit that shifts every offset after it. Turned off
   * from the warning's own "don't ask again".
   */
  readonly confirmShiftingEdits: boolean;
  /** Something the user needs told — a file that would not open. */
  readonly problem: string | undefined;
}

export const workspaceStore = createStore<WorkspaceState>({
  panes: { a: undefined, b: undefined },
  layout: "sideBySide",
  splitFraction: 0.5,
  activePane: "a",
  capabilities: detectFileCapabilities(),
  wordSize: 1,
  decoderIdentifier: "cp1252",
  fontSizePx: DEFAULT_FONT_SIZE_PX,
  groupingGap: DEFAULT_GROUPING_GAP,
  confirmShiftingEdits: true,
  problem: undefined,
});

/** The decoder the panes draw with, rebuilt only when the setting changes. */
let cachedDecoder = makeByteDecoder(workspaceStore.getSnapshot().decoderIdentifier);
let cachedDecoderIdentifier = workspaceStore.getSnapshot().decoderIdentifier;

export function activeDecoder() {
  const { decoderIdentifier } = workspaceStore.getSnapshot();
  if (decoderIdentifier !== cachedDecoderIdentifier) {
    cachedDecoder = makeByteDecoder(decoderIdentifier);
    cachedDecoderIdentifier = decoderIdentifier;
  }
  return cachedDecoder;
}

/**
 * Where a file opened without a named target goes: the first free slot, or —
 * when both are full — the active pane.
 *
 * Replacing the active pane is the only answer that is not arbitrary. Always
 * replacing A means a drop can silently throw away the file the user was
 * looking at while they were looking at it.
 */
export function slotForNewFile(): PaneId {
  const { panes, activePane } = workspaceStore.getSnapshot();
  if (panes.a === undefined) return "a";
  if (panes.b === undefined) return "b";
  return activePane;
}

/**
 * Puts a file in a slot.
 *
 * The chunk cache is created here and belongs to this file alone: a cache is
 * keyed by chunk index, so one shared between two files would serve one file's
 * bytes at the other's offsets.
 */
export function openInPane(pane: PaneId, file: OpenedFile): void {
  try {
    const base = new FileBackedStorage(file.source, new ChunkCache());
    // The materialisation valve, now that there is somewhere private to write:
    // an edit session pathological enough to grow the piece list past its
    // budget folds it into a scratch file rather than letting reads crawl.
    const { document, typing } = makeDocument(new EditOverlayStorage(base, scratchOptions()), pane);
    workspaceStore.update((state) => ({
      ...state,
      panes: {
        ...state.panes,
        [pane]: {
          name: file.name,
          file,
          document,
          typing,
          saved: savedStorageFor(file),
          writable: file.handle !== undefined,
        },
      },
      activePane: pane,
      problem: undefined,
    }));
  } catch (error) {
    workspaceStore.update((state) => ({
      ...state,
      problem: error instanceof Error ? error.message : "This file could not be opened.",
    }));
  }
}

export function closePane(pane: PaneId): void {
  workspaceStore.update((state) => ({
    ...state,
    panes: { ...state.panes, [pane]: undefined },
    activePane: pane === "a" && state.panes.b !== undefined ? "b" : "a",
    problem: undefined,
  }));
}

/**
 * Swaps the two files.
 *
 * The comparison itself is symmetric — a byte differs or it does not — but
 * which file is on the left is how a person keeps "the one that works" apart
 * from "the one that does not".
 */
export function swapPanes(): void {
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: state.panes.b, b: state.panes.a },
    activePane: state.activePane === "a" ? "b" : "a",
    // The files change sides, so the sizes they were given change with them.
    splitFraction: 1 - state.splitFraction,
  }));
}

export function setActivePane(pane: PaneId): void {
  workspaceStore.update((state) =>
    state.activePane === pane ? state : { ...state, activePane: pane }
  );
}

export function setSplitFraction(splitFraction: number): void {
  workspaceStore.update((state) => ({ ...state, splitFraction }));
}

export function setLayout(layout: PaneLayout): void {
  workspaceStore.update((state) => ({ ...state, layout }));
}

export function setWordSize(wordSize: WordSize): void {
  workspaceStore.update((state) => ({ ...state, wordSize }));
}

export function setConfirmShiftingEdits(confirmShiftingEdits: boolean): void {
  workspaceStore.update((state) => ({ ...state, confirmShiftingEdits }));
}

export function setGroupingGap(groupingGap: number): void {
  workspaceStore.update((state) => ({ ...state, groupingGap }));
}

export function setFontSize(fontSizePx: number): void {
  workspaceStore.update((state) => ({
    ...state,
    fontSizePx: Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, Math.round(fontSizePx))),
  }));
}

export function reportProblem(problem: string | undefined): void {
  workspaceStore.update((state) => ({ ...state, problem }));
}

/**
 * Saves a pane, by whichever route the browser offers.
 *
 * The outcome matters to the caller: a save in place rebases the document onto
 * the file that now holds its bytes, so nothing counts as changed any more and
 * a second save writes nothing. A download changes no file, so the document
 * stays exactly as dirty as it was — the copy is a copy, not a save, and
 * pretending otherwise would let a close discard real work.
 */
export async function savePane(pane: PaneId, as = false): Promise<SaveOutcome> {
  const state = workspaceStore.getSnapshot();
  const slot = state.panes[pane];
  if (slot === undefined) return { kind: "cancelled" };

  const overlay = slot.document.storage as EditOverlayStorage;
  const request = {
    storage: slot.document.storage,
    name: slot.name,
    handle: slot.file.handle,
    capabilities: state.capabilities,
    baseSize: overlay.baseSize,
    // Patching writes only what changed, and only when writing back to the
    // very file those offsets were measured against.
    changedRanges: overlay.canPatchInPlace ? overlay.changedRanges : undefined,
  };

  const outcome = as ? await saveFileAs(request) : await saveFile(request);

  if (outcome.kind === "savedInPlace" || outcome.kind === "savedAs") {
    // The file on disk now holds the document, so the overlay starts again over
    // it: nothing is a change any more.
    const base = new FileBackedStorage(outcome.file.source, new ChunkCache());
    overlay.rebase(base);
    slot.document.markSaved();
    noteDocumentChanged();
    workspaceStore.update((current) => ({
      ...current,
      panes: {
        ...current.panes,
        [pane]: {
          ...slot,
          name: outcome.file.name,
          file: outcome.file,
          // The file on disk now holds the document, so nothing is an edit.
          saved: savedStorageFor(outcome.file),
          writable: outcome.file.handle !== undefined,
        },
      },
    }));
  }

  return outcome;
}

/**
 * Copies a pane's current content — edits included — into the other slot.
 *
 * The copy is its own document: attached to no file, and dirty with an empty
 * history, because its bytes have never been on disk and there is no earlier
 * state to undo to. The source is left completely alone.
 *
 * Refused where there is no origin-private filesystem to write the snapshot
 * into. Sharing the source's base instead would leave the copy reading a file
 * the next save replaces.
 */
export async function duplicatePane(from: PaneId): Promise<void> {
  const slot = workspaceStore.getSnapshot().panes[from];
  if (slot === undefined) return;
  if (!OpfsScratchStore.isAvailable()) {
    reportProblem("This browser cannot make a copy: it has no private storage to put one in.");
    return;
  }

  const into: PaneId = from === "a" ? "b" : "a";
  const scratch = new OpfsScratchStore();
  const source = await (slot.document.storage as EditOverlayStorage).contentSnapshot(scratch);
  const { document, typing } = makeDocument(
    new EditOverlayStorage(new FileBackedStorage(source, new ChunkCache()), { scratch }),
    into
  );
  // Never-saved content with nothing behind it to undo to — the state a join
  // leaves upstream, and what makes a close warn.
  document.undoHistory.clearKeepingDirty();

  workspaceStore.update((state) => ({
    ...state,
    panes: {
      ...state.panes,
      [into]: {
        name: copyName(slot.name),
        file: { name: copyName(slot.name), size: source.size, lastModified: Date.now(), source },
        document,
        typing,
        // Never on disk, so nothing in it is an unsaved *edit* — the whole
        // document is unsaved, which the readout says.
        saved: undefined,
        writable: false,
      },
    },
    activePane: into,
    problem: undefined,
  }));
  noteDocumentChanged();
}

/** `bios.bin` becomes `bios copy.bin`, which is what a file manager would say. */
function copyName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? `${name} copy` : `${name.slice(0, dot)} copy${name.slice(dot)}`;
}

/** Opens an empty document in a slot — File ▸ New. */
export function openEmptyInPane(pane: PaneId, name = "Untitled.bin"): void {
  const { document, typing } = makeDocument(
    new EditOverlayStorage(new MemoryBackedStorage()),
    pane
  );
  workspaceStore.update((state) => ({
    ...state,
    panes: {
      ...state.panes,
      [pane]: { name, file: emptyFile(name), document, typing, saved: undefined, writable: false },
    },
    activePane: pane,
    problem: undefined,
  }));
}

/** The placeholder a never-saved document points at until it is given a home. */
function emptyFile(name: string): OpenedFile {
  const blob = new Blob([], { type: "application/octet-stream" });
  return { name, size: 0, lastModified: Date.now(), source: blob };
}

/**
 * Throws every unsaved edit away and starts again from the file on disk.
 *
 * The file is re-read rather than the overlay merely reset: it may have changed
 * since it was opened, and "revert to saved" means the bytes that are saved.
 */
export async function revertPane(pane: PaneId): Promise<void> {
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;

  const handle = slot.file.handle;
  const source = handle === undefined ? slot.file.source : await handle.getFile();
  slot.document.revert(
    new EditOverlayStorage(new FileBackedStorage(source, new ChunkCache()), scratchOptions())
  );
  // The file may have changed since it was opened, so the saved view is
  // rebuilt from what was just read rather than kept from before.
  workspaceStore.update((state) => {
    const current = state.panes[pane];
    if (current === undefined) return state;
    return {
      ...state,
      panes: {
        ...state.panes,
        [pane]: { ...current, saved: new FileBackedStorage(source, new ChunkCache()) },
      },
    };
  });
  noteDocumentChanged();
}
