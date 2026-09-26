import type { DiffEdit } from "@/core/diff/diffEngine";
import { BinaryDocument, type JoinPosition } from "@/core/document/binaryDocument";
import { caretAt } from "@/core/document/selectionModel";
import { TypingController } from "@/core/edit/typingController";
import type { UndoOperation } from "@/core/edit/undoHistory";
import { SegmentLink, type SegmentSourceID } from "@/core/segments/segmentation";
import type { ByteStorage, EditableByteStorage } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import type { ByteDecoder } from "@/core/text/byteDecoder";
import { makeByteDecoder } from "@/core/text/byteDecoderRegistry";
import type { ShiftingEdit } from "@/core/text/shiftWarning";
import { detectFileCapabilities, type FileCapabilities } from "@/platform/files/capabilities";
import {
  type SaveOutcome,
  save as saveFile,
  saveAs as saveFileAs,
} from "@/platform/files/fileSink";
import type { OpenedFile } from "@/platform/files/openedFile";
import { OpfsScratchStore } from "@/platform/files/opfsScratchStore";
import type { WordSize } from "@/render/hexGrid/hexLayout";
import type { DocumentOrigin } from "@/state/documentOrigin";
import { noteDocumentChanged } from "@/state/editStore";
import {
  collapsePanels,
  EMPTY_DOCK,
  expandPanel,
  type FragmentDock,
  openPanel,
  type PanelId,
  removePanel,
} from "@/state/fragmentDock";
import {
  isSlot,
  PANE_IDS,
  type PaneId,
  type PartId,
  panelOf,
  partPane,
  type SlotId,
  type SurfaceId,
  surfaceOf,
  WORKSPACE_SURFACE,
} from "@/state/paneId";
import { sanitizedPaneName } from "@/state/paneName";
import {
  clearSources,
  linkedSourceNamed,
  sourceIDForFile,
  sourceWriteConflict,
  swapSources,
} from "@/state/segmentSources";
import { applySegments, clearSegments, resetSegments, swapSegments } from "@/state/segmentsStore";
import {
  DEFAULT_GROUPING_GAP,
  DEFAULT_TEXT_DECODING,
  forgetGroupingGap,
  forgetWarnsBeforeShiftingEdits,
  GROUPING_GAP_CHOICES,
  loadSettings,
  rememberGroupingGap,
  rememberLayoutIsVertical,
  rememberWarnsBeforeShiftingEdits,
  rememberWordSize,
  settingsStore,
  type TextDecodingSettings,
} from "@/state/settingsStore";
import { createStore } from "@/state/store";
import { groupActs, noteDocumentAct } from "@/state/undoRouter";

/**
 * The workspace: one per browser tab (D11), so this is a module-level store and
 * not something a component instantiates.
 *
 * It owns the two file slots, the view settings both panes share, and the
 * browser's file capabilities — detected once, on the way in, so nothing below
 * has to ask again.
 */

export type { PaneId, PartId, SlotId, SurfaceId };
// Which pane an id names lives one level down, where the stores keyed by it can
// read it without reaching up into the workspace (`src/state/paneId.ts`); this
// is where the rest of the application reads it from.
export { isSlot, PANE_IDS, partPane, surfaceOf, WORKSPACE_SURFACE };

/**
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel
 * @upstream-differs a pane is its slot in the workspace: the document, its typing controller and its file
 */
export interface PaneState {
  readonly name: string;
  /** Kept so the comparison worker can be handed the file itself. */
  readonly file: OpenedFile;
  /**
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.document
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.isOpen
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.byteStorage
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.fileSize
   */
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
  /**
   * Nothing on disk holds this document: a new file, a duplicate, a part taken
   * out of another document. It is what routes Save to Save As and what lets
   * the name be changed by hand — a saved document's name is its file's.
   *
   * Kept apart from `saved` above, which is a different question: a part has no
   * file and still has bytes to read as modified against, which are the ones it
   * was opened with.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.isUntitled
   */
  readonly untitled: boolean;
  /** True when this file can be written back to itself (D7). */
  readonly writable: boolean;
  /**
   * Where a part's bytes came from, and the way back. Only a part has one: a
   * file in a slot was opened, not taken out of anything.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.origin
   */
  readonly origin?: DocumentOrigin | undefined;
}

/**
 * Told what each edit changed, so the comparison can update without a rescan,
 * and asked before an edit that shifts every offset after it. Set once by the
 * app; absent under tests.
 *
 * `onContentChange` is the same news told to an observer rather than acted on,
 * and it differs from `onEdit` in what it is *about*: an edit is one write,
 * where this is a whole transaction — a checksum repair that writes six places
 * is six edits and one change, and a shape that says where the damage starts is
 * only true of the transaction. It also carries the news that there is no
 * transaction: a content replaced wholesale arrives with no operations at all,
 * which is what {@link signalFullInvalidation} sends.
 */
export const editingHooks: {
  /** The comparison's, so only the workspace's own panes have one. */
  onEdit?: ((pane: SlotId, edit: DiffEdit) => void) | undefined;
  /**
   * Any pane's: a tool open on a part has to hear that the bytes under it
   * changed, exactly as one open on a file does.
   */
  onContentChange?: ((pane: PaneId, operations: readonly UndoOperation[]) => void) | undefined;
  /**
   * The shell's answer to a shifting edit's warning (§7.2). The edit is handed
   * over because the warning names it — see {@link ShiftingEdit}.
   */
  confirmShift?: ((edit: ShiftingEdit) => boolean | Promise<boolean>) | undefined;
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
    // The comparison is between the workspace's two panes: an edit in a part
    // is not a difference between files.
    onEdit: (edit) => {
      if (isSlot(pane)) editingHooks.onEdit?.(pane, edit);
    },
    confirmInsertShift: (edit) => editingHooks.confirmShift?.(edit) ?? true,
  });
  // Both signals, because neither alone is enough. A content change fires while
  // an edit group is still open, so the document is not yet dirty when it
  // arrives; the commit that makes it dirty fires no content change. Anything
  // watching only one of them shows the wrong answer for a typed byte.
  document.onContentChanged(noteDocumentChanged);
  // A tool's tree is told of the same change, whole: an undo of six writes is
  // one transaction and one stretch of the file that is no longer what it read.
  document.onContentChanged((change) => editingHooks.onContentChange?.(pane, change.ops));
  document.onTransactionCommitted(noteDocumentChanged);
  // The order the two histories are undone in — an edit and a cut are both
  // undoable and Cmd/Ctrl+Z has to take back whichever came last.
  document.onTransactionCommitted(() => {
    noteDocumentAct(pane);
    // A new step is a new future: an undone join can no longer be redone. Only
    // a slot can have been joined — a part is opened over a file, never out of
    // two.
    if (isSlot(pane)) undoneJoins[pane].length = 0;
  });
  return { document, typing };
}

/**
 * The pane's bytes are not the bytes it held: whatever was read from it is
 * worth nothing now.
 *
 * Every path that replaces a pane's storage wholesale says so here — a file
 * opened into the pane, a New, a duplicate — because nothing about the change
 * can be told precisely: no operation describes it, and there is no stretch of
 * the file it left alone. A tool's tree is read from the file the pane *had*,
 * so a panel that kept its reading would be showing the dump that was in the
 * pane before, under the name of the one that is.
 *
 * It rides on the channel an edit uses, with no operations, which is the shape
 * a full invalidation takes on this side of the port (see
 * `noteFirmwareContentChange`: a change with nothing to be precise about is a
 * reload of the whole tree). A revert takes the same road from the other end —
 * the document reports it with an empty operation list.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.signalFullInvalidation
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.onFullInvalidation
 */
function signalFullInvalidation(pane: SlotId): void {
  editingHooks.onContentChange?.(pane, []);
}

/**
 * How the two panes sit. Side by side is the default — a firmware dump is 16
 * bytes wide and two of those fit on any bench monitor — and stacked is for a
 * narrow window or a long region read down the page.
 */
export type PaneLayout = "sideBySide" | "stacked";

export { DEFAULT_GROUPING_GAP, GROUPING_GAP_CHOICES };

export interface WorkspaceState {
  /**
   * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.pane1
   * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.pane2
   * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.openPaneCount
   * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.hasOpenFile
   */
  readonly panes: Readonly<Record<SlotId, PaneState | undefined>>;
  /**
   * The parts taken out of those files, each a pane of its own, keyed by the
   * panel it was opened into. Empty until a part is opened — the panel that
   * opens one is G48 — and kept apart from the slots because the two are not
   * the same thing: a file is opened into a slot, and a part is opened over
   * one.
   *
   * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface
   */
  readonly parts: Readonly<Record<PartId, PaneState>>;
  /**
   * Which parts this workspace has taken out and in what order their pills sit,
   * with the one that is up — the model, which knows nothing about what is in
   * them.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.fragments
   * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.dock
   */
  readonly dock: FragmentDock;
  /**
   * The panel the help book is in, while there is one.
   *
   * The dock holds identity and order and nothing else, so a panel that is not
   * a part costs it nothing: what a panel *is* lives in the state kept against
   * its id, and this is that state for the one panel that holds no bytes. At
   * most one, because two copies of one book are not two things — asking for
   * help again raises the pill there is (`Design/HELP.md`).
   *
   * @web-only upstream opens a window; there are none here, and the dock is
   * already the workspace's answer to something else to look at without giving
   * up the panes
   */
  readonly helpPanel: PanelId | undefined;
  /**
   * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettings
   * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettings.isVertical
   */
  readonly layout: PaneLayout;
  /** File A's share of the workspace, 0–1. The divider moves it. */
  readonly splitFraction: number;
  /**
   * Which of the workspace's own two panes the keyboard and the pane commands
   * act on — whatever is in front of it. The commands that mean a document
   * read `frontPane` instead, which is this one only while no panel is up.
   *
   * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.activePaneIndex
   * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.activePane
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.windowActivePane
   */
  readonly activePane: SlotId;
  readonly capabilities: FileCapabilities;
  /**
   * @upstream-differs held in the workspace, and remembered through settingsStore
   */
  readonly wordSize: WordSize;
  /**
   * @upstream ByteRipperApp/Window/ComparisonCoordinator.swift#ComparisonCoordinator.groupingGap
   * @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings
   * @upstream-differs held in the workspace, and remembered through settingsStore
   */
  readonly groupingGap: number;
  /**
   * Whether to ask before an edit that shifts every offset after it. Turned off
   * from the warning's own "don't ask again".
   *
   * @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings
   * @upstream-differs held in the workspace, and remembered through settingsStore
   */
  readonly confirmShiftingEdits: boolean;
  /**
   * Something the user needs told, standing until they have read it.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.lastAlertTitle
   */
  readonly alert: Alert | undefined;
}

/**
 * A title and a message, shown together and dismissed as one — what upstream
 * puts in an `NSAlert`.
 *
 * The title names the kind of thing that happened ("Save failed"), the message
 * says what it was about ("bios.bin could not be written: …"). Upstream has the
 * pair in one alert and the web keeps the pair, rather than folding one into the
 * other: the title is what a person reads first and needs fewest words in.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentAlert
 */
export interface Alert {
  readonly title: string;
  readonly message: string;
}

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.windowModel
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.mode
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.refreshMode
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel
 */
export const workspaceStore = createStore<WorkspaceState>({
  panes: { a: undefined, b: undefined },
  parts: {},
  dock: EMPTY_DOCK,
  helpPanel: undefined,
  layout: "sideBySide",
  splitFraction: 0.5,
  activePane: "a",
  capabilities: detectFileCapabilities(),
  wordSize: 1,
  groupingGap: DEFAULT_GROUPING_GAP,
  confirmShiftingEdits: true,
  alert: undefined,
});

/**
 * The pane `id` names, wherever it lives: a file slot, or a part in the dock.
 *
 * Everything that reads a pane's document goes through here rather than
 * indexing the slots, because a part is a pane too — it has a document, an
 * editing controller and a name of its own, and nothing that asks "what is in
 * this pane" should have to know which kind it got.
 *
 * @upstream ByteRipperApp/Window/DocumentSurface.swift#DocumentSurface.mappedPane
 */
export const paneIn = (state: WorkspaceState, pane: PaneId): PaneState | undefined =>
  isSlot(pane) ? state.panes[pane] : state.parts[pane];

/** The same, over the store's current snapshot. */
export const paneState = (pane: PaneId): PaneState | undefined =>
  paneIn(workspaceStore.getSnapshot(), pane);

/**
 * Puts a pane's state back where that pane lives — a slot, or a part — for the
 * operations that are a document's rather than a slot's and so can be handed
 * either.
 *
 * A pane that is no longer there is left alone: writing one back would bring a
 * part closed while its save panel was open back from the dead, with a pill in
 * a dock that has already forgotten it.
 */
function withPane(state: WorkspaceState, pane: PaneId, next: PaneState): WorkspaceState {
  if (paneIn(state, pane) === undefined) return state;
  return isSlot(pane)
    ? { ...state, panes: { ...state.panes, [pane]: next } }
    : { ...state, parts: { ...state.parts, [pane]: next } };
}

/**
 * The pane a command is about: the part in the panel that is up, or — with the
 * stage clear — the workspace's own active pane.
 *
 * The commands that mean a *document* read this one: the caret and the
 * selection, Find, Go To, the bookmarks, the segments, Save, and the tool
 * panel's own. A panel covers the file it came out of, so a command that went
 * on meaning the dump underneath would act on bytes nobody can see.
 *
 * The commands that mean the workspace's *panes* read `activePane` instead —
 * File ▸ Open and where a file lands, the drops, Swap Panels, Duplicate, Close
 * Pane, the comparison. A panel has one pane and none beside it, so those are
 * not addressed to it; while one is up they are refused rather than redirected
 * (`windowPanesAreReachable`).
 *
 * Which list a call site belongs in is upstream's decision, not the call site's
 * (`Design/FRAGMENT_PANELS_PLAN.md`, "Which commands follow the front
 * surface").
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activePane
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.frontPane
 */
export const frontPane = (state: WorkspaceState): PaneId =>
  state.dock.expanded === undefined || state.dock.expanded === state.helpPanel
    ? state.activePane
    : partPane(state.dock.expanded);

/** The same, over the store's current snapshot. */
export const paneInFront = (): PaneId => frontPane(workspaceStore.getSnapshot());

/**
 * The surface in front: the part of the panel that is up, or the workspace's
 * own. What the Tools menu, the tool picker and the minimap's toggle mean.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.frontSurface
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.frontSurface
 */
export const frontSurface = (): SurfaceId => surfaceOf(paneInFront());

/**
 * Whether the workspace's own panes are taking orders. They are not while a
 * panel is up: it covers them, and a command that rearranged or replaced
 * something nobody can see is a command that looks like it did nothing.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.windowPanesAreReachable
 */
export const windowPanesAreReachable = (state: WorkspaceState): boolean =>
  state.dock.expanded === undefined;

/** The decoder the panes draw with, rebuilt only when the setting changes. */
let cachedDecoder = makeByteDecoder(
  DEFAULT_TEXT_DECODING.identifier,
  DEFAULT_TEXT_DECODING.placeholder
);

/** The decoder for `settings`: the one already built, when nothing changed. */
export function decoderFor(settings: TextDecodingSettings): ByteDecoder {
  if (
    cachedDecoder.identifier !== settings.identifier ||
    cachedDecoder.placeholder !== settings.placeholder
  ) {
    cachedDecoder = makeByteDecoder(settings.identifier, settings.placeholder);
  }
  return cachedDecoder;
}

/** @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.textDecoder */
export function activeDecoder(): ByteDecoder {
  return decoderFor(settingsStore.getSnapshot().textDecoding);
}

/**
 * Where a file opened without a named target goes: the first free slot, or —
 * when both are full — the active pane.
 *
 * Replacing the active pane is the only answer that is not arbitrary. Always
 * replacing A means a drop can silently throw away the file the user was
 * looking at while they were looking at it.
 *
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.plan
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.Result
 * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.Result.firstFilePane
 * @upstream-differs picks the slot for one file; a drop of several fills the empty slots in order
 */
export function slotForNewFile(): SlotId {
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
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openIntoPane
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openInPane
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.open
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.openBytes
 */
export function openInPane(pane: SlotId, file: OpenedFile): void {
  try {
    const base = new FileBackedStorage(file.source, new ChunkCache());
    // The materialisation valve, now that there is somewhere private to write:
    // an edit session pathological enough to grow the piece list past its
    // budget folds it into a scratch file rather than letting reads crawl.
    const previous = workspaceStore.getSnapshot().panes[pane]?.document;
    const { document, typing } = makeDocument(new EditOverlayStorage(base, scratchOptions()), pane);
    // Where the reader is, in offsets. Loading another dump into a pane is
    // usually a way of looking at the same offsets in a different file, so the
    // caret comes over, clamped to what the new file has — and the viewport is
    // left where it is (the scroll link keeps it across the pane's remount).
    if (previous !== undefined) {
      document.setSelection(
        caretAt(Math.min(previous.selection.start, document.size), document.size)
      );
    }
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
          untitled: false,
          writable: file.handle !== undefined,
        },
      },
      activePane: pane,
    }));
    // A file arrives as one piece covering it, whatever the pane held before.
    forgetJoins(pane);
    resetSegments(pane, document.size);
    // And every source the old file's pieces pointed at goes with it.
    clearSources(pane);
    // Opening replaces the storage wholesale, so anything read from the file
    // this pane was showing is about a file that is no longer here.
    signalFullInvalidation(pane);
  } catch (error) {
    reportAlert(
      "Could not open file.",
      error instanceof Error ? error.message : "This file could not be opened."
    );
  }
}

/**
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.closePane
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.close
 */
export function closePane(pane: SlotId): void {
  forgetJoins(pane);
  clearSegments(pane);
  clearSources(pane);
  workspaceStore.update((state) => ({
    ...state,
    panes: { ...state.panes, [pane]: undefined },
    activePane: pane === "a" && state.panes.b !== undefined ? "b" : "a",
  }));
}

/**
 * Swaps the two files.
 *
 * The comparison itself is symmetric — a byte differs or it does not — but
 * which file is on the left is how a person keeps "the one that works" apart
 * from "the one that does not".
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.swapPanes
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.swapPanes
 */
export function swapPanes(): void {
  swapSegments();
  swapSources();
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: state.panes.b, b: state.panes.a },
    activePane: state.activePane === "a" ? "b" : "a",
    // The files change sides, so the sizes they were given change with them.
    splitFraction: 1 - state.splitFraction,
  }));
}

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activatePane
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activePane
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activeFilePane
 * @upstream ByteRipperApp/Window/WindowViewModel.swift#WindowViewModel.setActivePane
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.setActive
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.onPaneActivated
 */
export function setActivePane(pane: SlotId): void {
  workspaceStore.update((state) =>
    state.activePane === pane ? state : { ...state, activePane: pane }
  );
}

/**
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.currentFraction
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.onFractionChanged
 */
export function setSplitFraction(splitFraction: number): void {
  workspaceStore.update((state) => ({ ...state, splitFraction }));
}

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.togglePaneLayout
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.setLayout
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.toggleLayout
 * @upstream ByteRipperApp/Settings/LayoutSettingsViewController.swift#LayoutSettings.set
 */
export function setLayout(layout: PaneLayout): void {
  rememberLayoutIsVertical(layout === "sideBySide");
  workspaceStore.update((state) => ({ ...state, layout }));
}

/**
 * @upstream ByteRipperApp/Hex/WordSize.swift#WordSize.set
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.setWordSize
 */
export function setWordSize(wordSize: WordSize): void {
  rememberWordSize(wordSize);
  workspaceStore.update((state) => ({ ...state, wordSize }));
}

/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.set */
export function setConfirmShiftingEdits(confirmShiftingEdits: boolean): void {
  rememberWarnsBeforeShiftingEdits(confirmShiftingEdits);
  workspaceStore.update((state) => ({ ...state, confirmShiftingEdits }));
}

/** @upstream ByteRipperApp/Settings/EditingSettings.swift#EditingSettings.resetToDefaults */
export function resetEditingSettings(): void {
  forgetWarnsBeforeShiftingEdits();
  workspaceStore.update((state) => ({ ...state, confirmShiftingEdits: true }));
}

/** @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings.set */
export function setGroupingGap(groupingGap: number): void {
  rememberGroupingGap(groupingGap);
  workspaceStore.update((state) => ({ ...state, groupingGap }));
}

/** @upstream ByteRipperApp/Settings/ComparisonSettings.swift#ComparisonSettings.resetToDefaults */
export function resetComparisonSettings(): void {
  forgetGroupingGap();
  workspaceStore.update((state) => ({ ...state, groupingGap: DEFAULT_GROUPING_GAP }));
}

/**
 * Reads the remembered preferences — the page's into the settings store, the
 * workspace's here — before the first frame, so nothing is drawn at a default
 * and then drawn again at the choice.
 */
export async function restoreSettings(): Promise<void> {
  const stored = await loadSettings();
  workspaceStore.update((state) => ({
    ...state,
    wordSize: stored.wordSize,
    layout: stored.layoutIsVertical ? "sideBySide" : "stacked",
    groupingGap: stored.groupingGap,
    confirmShiftingEdits: stored.warnsBeforeShiftingEdits,
  }));
}

/**
 * Shows a modal alert: a title, a message and one button that dismisses it.
 *
 * Upstream spells this as three methods, and the web keeps one because the
 * difference between them is a difference the web does not have: `presentError`
 * and `presentFileError` take an `NSError` (here an error is thrown and caught,
 * and its message arrives as the message), and `presentFileError`'s own upgrade
 * of a sandbox denial to "Access denied — choose the file again to grant
 * access" has no counterpart — a browser picker hands over access when it hands
 * over the file, so there is no second, later refusal to explain.
 *
 * Nothing else takes the alert down. It is the answer to what just happened, so
 * the next thing that happens does not erase it: a successful open does not
 * clear a failure the user has not read yet.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentAlert
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentError
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentFileError
 * @upstream-differs one entry point for upstream's three, and no `isSandboxAccessDenied` upgrade
 */
export function reportAlert(title: string, message: string): void {
  workspaceStore.update((state) => ({ ...state, alert: { title, message } }));
}

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentModal
 * @upstream-differs the button's own answer to a one-button alert, rather than a
 * modal response a caller reads
 */
export function dismissAlert(): void {
  workspaceStore.update((state) => ({ ...state, alert: undefined }));
}

/**
 * Whether a pane's name can be changed by hand (§23): only a document with no
 * file behind it. Its name is a label — the header's, Save As's starting point,
 * and the base every piece's file name is built from — and a label costs
 * nothing to change. A saved document's name is its file's, and moving a file
 * is Save As's business.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.canRename
 */
export function canRenamePane(pane: PaneId): boolean {
  const slot = paneState(pane);
  return slot?.untitled === true;
}

/**
 * Renames an unsaved document, saying whether the name was taken. Nothing is
 * written: this sets the label, which is the whole of an unsaved document's
 * name. Refused for a name that survives sanitising as nothing, or as the name
 * it already has.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.rename
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.untitledName
 * @upstream-differs the pane's own name field, which every document here already has
 */
export function renamePane(pane: PaneId, raw: string): boolean {
  const slot = paneState(pane);
  if (slot === undefined || !slot.untitled) return false;
  const name = sanitizedPaneName(raw);
  if (name === undefined || name === slot.name) return false;
  workspaceStore.update((state) =>
    paneIn(state, pane) === slot ? withPane(state, pane, { ...slot, name }) : state
  );
  return true;
}

/**
 * Saves a pane, by whichever route the browser offers.
 *
 * The outcome matters to the caller: a save in place rebases the document onto
 * the file that now holds its bytes, so nothing counts as changed any more and
 * a second save writes nothing. A download changes no file, so the document
 * stays exactly as dirty as it was — the copy is a copy, not a save, and
 * pretending otherwise would let a close discard real work.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.save
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.saveAs
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneSaveError
 */
export async function savePane(pane: PaneId, as = false): Promise<SaveOutcome> {
  const state = workspaceStore.getSnapshot();
  const slot = paneIn(state, pane);
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
    // A save never writes over a file the dump is built out of (§21.7). The
    // Save As picker is asked, and a name that is a segment's source is sent
    // back up to choose another; an in-place save writes the file it came from,
    // which is not a source (a join is what detaches it), so it needs no guard.
    validateTarget: (handle: FileSystemFileHandle) => {
      const source = linkedSourceNamed(pane, handle.name);
      if (source === undefined) return Promise.resolve(true);
      const words = sourceWriteConflict([source.name], "name");
      reportAlert(words.title, words.message);
      return Promise.resolve(false);
    },
  };

  const outcome = as ? await saveFileAs(request) : await saveFile(request);

  if (outcome.kind === "savedInPlace" || outcome.kind === "savedAs") {
    // The file on disk now holds the document, so the overlay starts again over
    // it: nothing is a change any more.
    const base = new FileBackedStorage(outcome.file.source, new ChunkCache());
    overlay.rebase(base);
    slot.document.markSaved();
    noteDocumentChanged();
    workspaceStore.update((current) =>
      withPane(current, pane, {
        ...slot,
        name: outcome.file.name,
        file: outcome.file,
        // The file on disk now holds the document, so nothing is an edit.
        saved: savedStorageFor(outcome.file),
        untitled: false,
        writable: outcome.file.handle !== undefined,
      })
    );
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
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.duplicate
 * @upstream-differs a workspace operation: the copy becomes another pane's document
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.openDuplicate
 */
export async function duplicatePane(from: SlotId): Promise<void> {
  const slot = workspaceStore.getSnapshot().panes[from];
  if (slot === undefined) return;
  if (!OpfsScratchStore.isAvailable()) {
    // @web-only upstream copies into a temp file it can always create; a page
    // has no private storage to put one in unless the browser grants OPFS, and
    // the shell is what knows how to say so
    throw new Error("This browser cannot make a copy: it has no private storage to put one in.");
  }

  const into: SlotId = from === "a" ? "b" : "a";
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
        untitled: true,
        writable: false,
      },
    },
    activePane: into,
  }));
  // The copy is a document of its own: it starts as one piece, and the
  // original's cuts stay with the original. The copy reads a snapshot of the
  // original's bytes, so a source the original's pieces pointed at is not the
  // copy's — the copy's pieces have no link at all.
  forgetJoins(into);
  resetSegments(into, document.size);
  clearSources(into);
  noteDocumentChanged();
  // The pane the copy lands in is showing bytes that were not there a moment
  // ago, whatever it was reading before. The source pane is untouched, and has
  // nothing to be told.
  signalFullInvalidation(into);
}

/**
 * `bios.bin` becomes `bios copy.bin`, which is what a file manager would say.
 *
 * @upstream ByteRipperApp/Documents/DuplicateName.swift#DuplicateName
 * @upstream ByteRipperApp/Documents/DuplicateName.swift#DuplicateName.next
 * @upstream-differs always "name copy.ext", without numbering a second copy
 */
function copyName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? `${name} copy` : `${name.slice(0, dot)} copy${name.slice(dot)}`;
}

/**
 * Opens an empty document in a slot — File ▸ New.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.newDocument
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.newUntitledDocument
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.newUntitledIntoPane
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.newDocumentInPane
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.openUntitled
 */
export function openEmptyInPane(pane: SlotId, name = "Untitled.bin"): void {
  const { document, typing } = makeDocument(
    new EditOverlayStorage(new MemoryBackedStorage()),
    pane
  );
  workspaceStore.update((state) => ({
    ...state,
    panes: {
      ...state.panes,
      [pane]: {
        name,
        file: emptyFile(name),
        document,
        typing,
        saved: undefined,
        untitled: true,
        writable: false,
      },
    },
    activePane: pane,
  }));
  forgetJoins(pane);
  resetSegments(pane, 0);
  clearSources(pane);
  // A new document replaces the storage wholesale, exactly as an open does:
  // the pane's file is gone from under whatever was reading it.
  signalFullInvalidation(pane);
}

/**
 * Opens `bytes` as a part of its own — a pane over the file they came out of,
 * with a panel in the dock to show it — and gives back the pane it landed in.
 *
 * A part is a document like any other: it can be typed into, undone and saved
 * somewhere else. What it is not is a file slot, so nothing about opening a
 * file happens here — no placement rule, no join, no active-pane change, and
 * the workspace's own panes stay exactly where they are behind it.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openFragment
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.open
 * @upstream ByteRipperApp/Documents/DocumentOrigin.swift#DocumentOrigin.original
 */
export function openPart(bytes: Uint8Array, name: string, origin?: DocumentOrigin): PartId {
  const opened = openPanel(workspaceStore.getSnapshot().dock);
  const pane = partPane(opened.id);
  // The bytes become a Blob and the part reads them back out of it, exactly as
  // an opened file does. Two reasons, and both are about what else asks for a
  // pane's bytes: the firmware worker, the minimap's overview and the search
  // all take a clean document's *file* and read it off the main thread, and a
  // part whose file was the empty placeholder handed all three an empty file —
  // measured, and it is why the panel's own UEFI panel said the part looked
  // like nothing. And a 17 MB decompressed body is better held in the browser's
  // blob store than on the JavaScript heap.
  // `slice()` because a Blob wants bytes over a plain ArrayBuffer, as the
  // clipboard's own export does for the same reason.
  const blob = new Blob([bytes.slice()], { type: "application/octet-stream" });
  const file: OpenedFile = { name, size: bytes.length, lastModified: Date.now(), source: blob };
  const { document, typing } = makeDocument(
    new EditOverlayStorage(new FileBackedStorage(blob, new ChunkCache())),
    pane
  );
  workspaceStore.update((state) => ({
    ...state,
    parts: {
      ...state.parts,
      [pane]: {
        name,
        file,
        document,
        typing,
        // What a byte of a part reads as modified *against*: the bytes it was
        // opened with. A part has nothing on disk, and upstream answers the
        // same question the same way — the pane's saved storage is the link's
        // `original` until the part is saved somewhere, and it does not move
        // when the part is put back into its parent, because putting the bytes
        // there does not make them the ones the panel opened with.
        saved: savedStorageFor(file),
        // A part is a document nothing on disk holds: it can be renamed, and
        // Save is Save As.
        untitled: true,
        writable: false,
        origin,
      },
    },
    dock: opened.dock,
  }));
  // A part is a document of its own: if the pane it landed in was one, its
  // sources go with the document it was.
  clearSources(pane);
  return pane;
}

/**
 * Opens the help panel, or raises the one that is already in the dock.
 *
 * At most one: asking for help twice is asking to read it, not asking for a
 * second book. The panel holds no pane and no bytes — what it shows is the
 * help store's business, and the dock's ignorance of what a panel *is* is what
 * makes that cost nothing here (`Design/HELP.md`).
 *
 * @web-only upstream shows the book in a window of its own
 */
export function openHelpPanel(): void {
  workspaceStore.update((state) => {
    if (state.helpPanel !== undefined) {
      return { ...state, dock: expandPanel(state.dock, state.helpPanel).dock };
    }
    const opened = openPanel(state.dock);
    return { ...state, dock: opened.dock, helpPanel: opened.id };
  });
}

/**
 * Takes the help out of the dock. The pill goes with it; folding is the pill's
 * own click, and is not this.
 *
 * @web-only upstream closes a window
 */
export function closeHelpPanel(): void {
  workspaceStore.update((state) => {
    if (state.helpPanel === undefined) return state;
    return {
      ...state,
      dock: removePanel(state.dock, state.helpPanel).dock,
      helpPanel: undefined,
    };
  });
}

/**
 * The help pill's own click: the panel that is up folds, and a folded one
 * rises — the same gesture every other pill answers to.
 *
 * @web-only the pill is the web's, upstream's book being a window
 */
export function toggleHelpPanel(): void {
  const state = workspaceStore.getSnapshot();
  if (state.helpPanel === undefined) return;
  if (state.dock.expanded === state.helpPanel) foldParts();
  else
    workspaceStore.update((now) => ({
      ...now,
      dock: now.helpPanel === undefined ? now.dock : expandPanel(now.dock, now.helpPanel).dock,
    }));
}

/**
 * Raises the panel holding `pane`, folding whatever was up — one gesture, as
 * the dock hands it back.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.expand
 */
export function raisePart(pane: PartId): void {
  workspaceStore.update((state) => ({
    ...state,
    dock: expandPanel(state.dock, panelOf(pane)).dock,
  }));
}

/**
 * The pill's own click: the panel that is up folds, any other rises.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.toggle
 */
export function togglePart(pane: PartId): void {
  const state = workspaceStore.getSnapshot();
  if (state.dock.expanded === panelOf(pane)) foldParts();
  else raisePart(pane);
}

/**
 * Folds the panel that is up, leaving the workspace's own panes in full view.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.collapse
 */
export function foldParts(): void {
  workspaceStore.update((state) => ({ ...state, dock: collapsePanels(state.dock).dock }));
}

/**
 * Closes a part: its pill goes, and its document with it.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.close
 */
export function closePart(pane: PartId): void {
  clearSegments(pane);
  clearSources(pane);
  // The marks stay: they were never the part's. A panel reads the workspace's
  // list at the part's offsets (§20.7), so closing the panel closes a window
  // onto the marks, not the marks themselves — the same row is still marked in
  // the dump the part came out of.
  workspaceStore.update((state) => {
    const parts = { ...state.parts };
    delete parts[pane];
    return { ...state, parts, dock: removePanel(state.dock, panelOf(pane)).dock };
  });
}

/**
 * The placeholder a never-saved document points at until it is given a home.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/BinaryDocument.swift#BinaryDocument.placeholderURL
 * @upstream-differs an empty Blob named like the file, since a never-saved document has no URL
 */
function emptyFile(name: string): OpenedFile {
  const blob = new Blob([], { type: "application/octet-stream" });
  return { name, size: 0, lastModified: Date.now(), source: blob };
}

/**
 * Whether this pane's Revert goes back to the bytes it was opened with rather
 * than to a file: a part taken out of another document has no file behind it,
 * and has those bytes.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.canRevertToOriginal
 * @upstream-differs a predicate over the pane's state, the pane being a record here rather than an object
 */
export function canRevertToOriginal(pane: PaneState): boolean {
  return pane.untitled && pane.origin !== undefined;
}

/**
 * Throws every unsaved edit away and starts again from the file on disk — or,
 * for a part, from the bytes the panel was opened with.
 *
 * The file is re-read rather than the overlay merely reset: it may have changed
 * since it was opened, and "revert to saved" means the bytes that are saved.
 *
 * Upstream needs two of these, because its two bases are different things: a
 * file it reopens by URL, and `DocumentOrigin.original`, a copy of the bytes
 * the tab opened with that the link carries for exactly this. Here they are one
 * — `openPart` builds the part's document over a Blob of those bytes, and that
 * Blob is the pane's file — so the file this re-reads *is* the original, and
 * the part simply takes the branch every handle-less document takes. What the
 * link holds is left alone either way: the bytes are still the part's, so the
 * part is still linked (upstream says the same in `revertToOriginal`).
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.revert
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.revertToOriginal
 * @upstream-differs one revert for both, a part's file being the bytes it opened with
 */
export async function revertPane(pane: PaneId): Promise<void> {
  const slot = paneState(pane);
  if (slot === undefined) return;

  const handle = slot.file.handle;
  const source = handle === undefined ? slot.file.source : await handle.getFile();
  const caret = slot.document.selection.start;
  slot.document.revert(
    new EditOverlayStorage(new FileBackedStorage(source, new ChunkCache()), scratchOptions())
  );
  // A reload is not a navigation: the reader asked for the bytes back, not to be
  // taken somewhere, so the caret stays where it was as far as the file now
  // reaches — and nothing scrolls.
  slot.document.setSelection(caretAt(Math.min(caret, slot.document.size), slot.document.size));
  // The file may have changed since it was opened, so the saved view is
  // rebuilt from what was just read rather than kept from before.
  workspaceStore.update((state) => {
    const current = paneIn(state, pane);
    if (current === undefined) return state;
    return withPane(state, pane, {
      ...current,
      saved: new FileBackedStorage(source, new ChunkCache()),
    });
  });
  // Reverting throws the edits away, and the cuts travelled with them.
  if (isSlot(pane)) forgetJoins(pane);
  resetSegments(pane, slot.document.size);
  clearSources(pane);
  noteDocumentChanged();
}

// MARK: - Joining another file in (§22)

/**
 * What a pane was attached to before a join, kept so undoing the join can put
 * it back.
 *
 * Upstream keeps this inside the document, which owns its own URL and identity.
 * Here the attachment *is* the pane — the file it was opened from, the copy of
 * it that says which bytes are unsaved, and whether it can be written back — so
 * the mark lives beside the pane and the document only reports the serial that
 * identifies the step.
 */
interface JoinMark {
  readonly serial: number;
  readonly name: string;
  readonly file: OpenedFile;
  readonly saved: ByteStorage | undefined;
  readonly writable: boolean;
  /** What the join made of the pane, so a redo can detach it again. */
  readonly joined: { readonly name: string; readonly file: OpenedFile };
}

const joinMarks: Record<SlotId, JoinMark[]> = { a: [], b: [] };
/** Joins undone and not yet redone, newest last. */
const undoneJoins: Record<SlotId, JoinMark[]> = { a: [], b: [] };

/**
 * `bios.bin` becomes `bios-2.bin`, stepping over the names already on screen.
 *
 * The result is not the file it came from, but it is that file with something
 * added, so it wears that file's name with a series suffix — the same shape a
 * copy takes, and for the same reason: the header has to say which dump is on
 * screen, and Save All as Separate Files has to have a base name to build the
 * piece names from.
 */
export function joinedName(name: string, taken: readonly string[]): string {
  const dot = name.lastIndexOf(".");
  const stem = dot <= 0 ? name : name.slice(0, dot);
  const extension = dot <= 0 ? "" : name.slice(dot);
  // A name that is already a series member continues it rather than nesting.
  const base = /-\d+$/.test(stem) ? stem.replace(/-\d+$/, "") : stem;
  for (let index = 2; ; index++) {
    const candidate = `${base}-${index}${extension}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export interface JoinRequest {
  readonly pane: SlotId;
  readonly source: ByteStorage;
  /** What the joined bytes came from, for the piece that holds them. */
  readonly sourceName: string;
  readonly position: JoinPosition;
  /**
   * The file the donor's bytes are being read from, when there is one (§21.7):
   * the joined piece links to it, so the image the join leaves still knows which
   * half came from which chip and can be measured against it. A donor that is
   * not a file joins without a link.
   */
  readonly sourceFile?: OpenedFile | undefined;
}

/**
 * Puts another file's bytes at one end of a pane's content (§22).
 *
 * The join **copies**: the source is left exactly as it was, which is what lets
 * a pane be joined to itself and what stops a dropped file being consumed.
 *
 * Three things happen together, and each is the subject of its own rule:
 * the bytes go in as one undoable insert; the seam becomes a cut, so the
 * content the pane already held and the bytes that arrived are separate pieces
 * under their own names (§22.3) — which is what makes a joined image split back
 * at exactly the seam it was joined at; and the pane detaches from its file,
 * because what is on screen is no longer that file (§22.2).
 */
export function joinIntoPane(request: JoinRequest): Promise<void> {
  // One gesture, one press to take back: the bytes going in and the seam
  // becoming a cut are the same act (§22.3).
  return groupActs(request.pane, () => performJoin(request));
}

/** @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.join */
async function performJoin(request: JoinRequest): Promise<void> {
  const { pane, source, sourceName, position } = request;
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;

  const sizeBefore = slot.document.size;
  const sourceSize = source.size;
  const before: Omit<JoinMark, "serial" | "joined"> = {
    name: slot.name,
    file: slot.file,
    saved: slot.saved,
    writable: slot.writable,
  };

  // The join is about to take the document's file away from it (§22.2), so
  // that file becomes what the content the pane already holds is measured
  // against: every piece that has no source of its own is linked to it, at the
  // offsets it sits at there (§21.7). Done before the insert, while those
  // offsets are still the file's, and after the snapshot, so undoing the join
  // — which gives the file back — takes the links with it.
  const preJoinSource = slot.untitled ? undefined : sourceIDForFile(pane, slot.file);
  if (preJoinSource !== undefined) {
    applySegments(pane, (partition) => partition.linkUnlinkedPieces(preJoinSource));
  }
  const joinedSource =
    request.sourceFile === undefined ? undefined : sourceIDForFile(pane, request.sourceFile);

  const serial = await slot.document.join(source, position);

  // The base every worker reads is the file the pane was opened from, and after
  // a join it is not what the pane holds any more. A snapshot of the joined
  // content replaces it; the old one is kept in the mark, so undoing the join
  // puts the original file back rather than re-snapshotting a shrunken copy.
  const name = joinedName(
    before.name,
    PANE_IDS.map((id) => workspaceStore.getSnapshot().panes[id]?.name ?? "")
  );
  const file = await snapshotOf(slot, name);

  workspaceStore.update((state) => {
    const current = state.panes[pane];
    if (current === undefined) return state;
    return {
      ...state,
      panes: {
        ...state.panes,
        // Never on disk, so nothing in it is an unsaved *edit*: the whole image
        // is unsaved, and the readout says so.
        [pane]: { ...current, name, file, saved: undefined, writable: false },
      },
      activePane: pane,
    };
  });
  if (serial !== undefined) joinMarks[pane].push({ ...before, serial, joined: { name, file } });

  // One edit, not one per chunk: everything downstream cares only about which
  // offsets stopped meaning what they meant.
  const anchor = position === "start" ? 0 : sizeBefore;
  editingHooks.onEdit?.(pane, { kind: "insert", at: anchor, length: sourceSize });
  seamCut({ pane, position, sizeBefore, sourceSize, sourceName, joinedSource });
  noteDocumentChanged();
}

/** The joined content as a file the workers can read, or the old one if it cannot be written. */
async function snapshotOf(slot: PaneState, name: string): Promise<OpenedFile> {
  if (!OpfsScratchStore.isAvailable()) return { ...slot.file, name };
  const source = await (slot.document.storage as EditOverlayStorage).contentSnapshot(
    new OpfsScratchStore()
  );
  return { name, size: source.size, lastModified: Date.now(), source };
}

/**
 * The seam becomes a cut (§22.3).
 *
 * The insert has already moved the partition with the content, so what is left
 * is to split the piece that now spans both halves and give each its name: the
 * content the pane already held keeps the name of the file it was opened from,
 * and the joined bytes take the source's.
 */
function seamCut(options: {
  pane: SlotId;
  position: JoinPosition;
  sizeBefore: number;
  sourceSize: number;
  sourceName: string;
  joinedSource: SegmentSourceID | undefined;
}): void {
  const { pane, position, sizeBefore, sourceSize, sourceName, joinedSource } = options;
  // The joined bytes stand for the whole of their source, whatever length it
  // has — and where there is no source behind them, they stand for nothing.
  const link =
    joinedSource === undefined ? undefined : new SegmentLink(joinedSource, 0, sourceSize);
  // A pane that was empty holds nothing but the source, so there is one piece
  // and it is the source's — a cut at 0 or at the end would be refused anyway.
  if (sizeBefore === 0) {
    applySegments(pane, (partition) => partition.rename(0, sourceName).setLink(link, 0));
    return;
  }
  const seam = position === "start" ? sourceSize : sizeBefore;

  applySegments(pane, (partition) => {
    const cut = partition.addCut(seam);
    if (cut === undefined) return undefined;
    if (position === "start") {
      // The cut splits the piece that opens at 0: piece 0 is the joined bytes
      // (take the source's name); piece 1 is the original content (addCut left
      // it unnamed, so name it — with the name the piece had before the cut,
      // not the pane's, which has already been renamed).
      const originalName = cut.segments[0]?.name ?? "";
      return cut.rename(0, sourceName).rename(1, originalName).setLink(link, 0);
    }
    // The joined bytes are the last piece — the cut at the old end split the
    // piece that ran to it, whichever piece that was. The content the pane
    // already held keeps its own names (addCut left them alone), and the new
    // tail takes the source's.
    const joined = cut.segments.length - 1;
    return cut.rename(joined, sourceName).setLink(link, joined);
  });
}

/**
 * Re-attaches a pane to the file a join detached it from, or detaches it again.
 *
 * Called after every undo and redo. A join's step is recognised by the serial
 * the document reported when it committed: while that serial is still in the
 * history the join is applied, and when it is not the document is back to what
 * the file holds — so the name, the file and the saved copy come back with it.
 */
export function syncJoinAttachment(pane: SlotId): void {
  const slot = workspaceStore.getSnapshot().panes[pane];
  if (slot === undefined) return;
  const marks = joinMarks[pane];
  const undone = undoneJoins[pane];
  const applied = slot.document.undoHistory.lastCommittedSerial ?? 0;

  let attachment: Pick<PaneState, "name" | "file" | "saved" | "writable"> | undefined;
  // Undone: the join's step has left the history, so the file comes back.
  for (let mark = marks.at(-1); mark !== undefined && applied < mark.serial; mark = marks.at(-1)) {
    marks.pop();
    undone.push(mark);
    attachment = { name: mark.name, file: mark.file, saved: mark.saved, writable: mark.writable };
  }
  // Redone: the step is back, and the pane is the joined image again.
  for (
    let mark = undone.at(-1);
    mark !== undefined && applied >= mark.serial;
    mark = undone.at(-1)
  ) {
    undone.pop();
    marks.push(mark);
    attachment = {
      name: mark.joined.name,
      file: mark.joined.file,
      saved: undefined,
      writable: false,
    };
  }
  if (attachment === undefined) return;

  const next = attachment;
  workspaceStore.update((state) => {
    const current = state.panes[pane];
    if (current === undefined) return state;
    return { ...state, panes: { ...state.panes, [pane]: { ...current, ...next } } };
  });
  noteDocumentChanged();
}

/** A pane's content was replaced: nothing it was joined from is reachable now. */
function forgetJoins(pane: SlotId): void {
  joinMarks[pane].length = 0;
  undoneJoins[pane].length = 0;
}
