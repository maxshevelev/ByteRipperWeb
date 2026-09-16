import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffEdit } from "@/core/diff/diffEngine";
import { JoinEmpty } from "@/core/document/binaryDocument";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { dragCarriesFiles, filesFromDrop } from "@/platform/files/dragDrop";
import type { OpenedFile } from "@/platform/files/openedFile";
import { openFiles } from "@/platform/files/openFile";
import { sweepOrphanedScratch } from "@/platform/files/opfsScratchStore";
import { editBookmarkInPane, toggleBookmarkInPane } from "@/state/bookmarkEditStore";
import { bookmarksStore, noteVisited, restoreBookmarks } from "@/state/bookmarksStore";
import { diffStore, noteEdit, watchWorkspaceForComparison } from "@/state/diffStore";
import { editStore } from "@/state/editStore";
import { restoreFavorites } from "@/state/favoritesStore";
import { noteFirmwareOperations } from "@/state/firmwareStore";
import { noteMinimapEdit, toggleMinimap, watchForMinimap } from "@/state/minimapStore";
import {
  closeSearch,
  noteSearchEdit,
  openSearch,
  resultsFor,
  searchStore,
  setSearchPane,
} from "@/state/searchStore";
import { noteSegmentEdit, segmentsFor } from "@/state/segmentsStore";
import { paneClosed, toolController } from "@/state/toolController";
import { redoLast, undoHooks, undoLast } from "@/state/undoRouter";
import { watchForUnsavedWork } from "@/state/unsavedWork";
import { useStore } from "@/state/useStore";
import {
  closePane,
  duplicatePane,
  editingHooks,
  joinIntoPane,
  openEmptyInPane,
  openInPane,
  type PaneId,
  renamePane,
  reportProblem,
  revertPane,
  savePane,
  setActivePane,
  setConfirmShiftingEdits,
  setSplitFraction,
  slotForNewFile,
  workspaceStore,
} from "@/state/workspaceStore";
import { zoneHooks } from "@/state/zoneStore";
import { ConfirmDialog } from "@/ui/dialogs/ConfirmDialog";
import { CutDialog } from "@/ui/dialogs/CutDialog";
import { FillDialog } from "@/ui/dialogs/FillDialog";
import { GoToDialog } from "@/ui/dialogs/GoToDialog";
import { SegmentsDialog } from "@/ui/dialogs/SegmentsDialog";
import { SelectBlockDialog } from "@/ui/dialogs/SelectBlockDialog";
import { MinimapPanel } from "@/ui/minimap/MinimapPanel";
import { HexPane } from "@/ui/pane/HexPane";
import { detectKeyboardPlatform } from "@/ui/pane/hexKeys";
import { scrollLink } from "@/ui/pane/scrollLink";
import { FindBar, focusFindInput } from "@/ui/search/FindBar";
import { addCut, saveAllPieces } from "@/ui/segments/segmentCommands";
import { SettingsDialog, type SettingsTab } from "@/ui/settings/SettingsDialog";
import { ContextMenuHost, openContextMenu } from "@/ui/shell/ContextMenu";
import { EmptyState } from "@/ui/shell/EmptyState";
import { windowTitle } from "@/ui/shell/emptyWindow";
import { ignoredFilesMessage } from "@/ui/shell/ignoredFiles";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { dumpMenu, type PaneMenuActions, paneFileMenu } from "@/ui/shell/paneMenus";
import { StatusBar } from "@/ui/shell/StatusBar";
import { Toolbar } from "@/ui/shell/Toolbar";
import { TransientNotice } from "@/ui/shell/TransientNotice";
import { ToolPanel } from "@/ui/toolPanel/ToolPanel";

/**
 * Header, workspace, status bar — the three bands the app never loses.
 *
 * The drop target is the window rather than a pane: a person dragging a dump
 * onto an empty app has no pane to aim at, and aiming is not what dropping a
 * file should require. A drop with both slots full replaces the active one.
 */

/** A stable name for each open document, so a pane remounts for a new one and only then. */
const documentKeys = new WeakMap<object, number>();
let nextDocumentKey = 0;
function documentKey(document: object): number {
  let key = documentKeys.get(document);
  if (key === undefined) {
    key = ++nextDocumentKey;
    documentKeys.set(document, key);
  }
  return key;
}

/** Whether typing here edits text of its own, which keeps its own undo. */
function isTextEntry(element: HTMLElement): boolean {
  return element.isContentEditable || element.closest("input, textarea, select") !== null;
}

export interface RevealRequest {
  /** Where the caret goes. Navigation moves the caret; it does not select. */
  readonly offset: number;
  /** Makes a repeat of the same offset a fresh request. */
  readonly token: number;
  /**
   * False scrolls without taking the caret along — what a minimap click does.
   * Looking somewhere is not the same as putting the insertion point there.
   */
  readonly moveCaret?: boolean;
  /**
   * Scrolls only when the offset is not on screen already — what showing a zone
   * a tool has just focused means. Something in front of the reader is left
   * exactly where it is: a scroll that moves the rows under someone who can
   * already see them is worse than no scroll at all.
   *
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.revealOffsetIfOffScreen
   */
  readonly onlyIfOffScreen?: boolean;
}

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.loadView
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.viewDidLoad
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.paneViews
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.comparisonView
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.contentContainer
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.contentHost
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.coordinator
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.paneView1
 * @upstream ByteRipperApp/Window/ComparisonView.swift#ComparisonView.paneView2
 * @upstream-differs the shell is a React component over the stores
 */
export function AppShell() {
  const state = useStore(workspaceStore);
  const diff = useStore(diffStore);
  // An insert or a delete changes a document's length, and each pane has to
  // stay scrollable to the *other* one's end. The workspace store does not
  // change on an edit, so without this nudge a companion that grew would leave
  // this pane unable to reach its new end.
  useStore(editStore);
  const [dragging, setDragging] = useState(false);
  const [selections, setSelections] = useState<Record<PaneId, { start: number; end: number }>>({
    a: { start: 0, end: 0 },
    b: { start: 0, end: 0 },
  });
  const [reveal, setReveal] = useState<Partial<Record<PaneId, RevealRequest>>>({});
  const revealToken = useRef(0);

  /**
   * The one-time warning before an edit that shifts every offset after it.
   *
   * It resolves a promise the editing queue is waiting on, so the keystrokes
   * behind it wait rather than racing past the answer — and it can be turned
   * off from its own checkbox, because asking every session teaches people to
   * dismiss the dialog without reading it.
   */
  const shiftAnswer = useRef<((allowed: boolean) => void) | undefined>(undefined);
  const [shiftAsking, setShiftAsking] = useState(false);

  /** @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.confirmInsertModeWarning */
  const confirmInsertShift = useCallback(() => {
    if (!workspaceStore.getSnapshot().confirmShiftingEdits) return true;
    setShiftAsking(true);
    return new Promise<boolean>((resolve) => {
      shiftAnswer.current = resolve;
    });
  }, []);

  const answerShift = useCallback((allowed: boolean, remember = false) => {
    setShiftAsking(false);
    if (remember) setConfirmShiftingEdits(false);
    shiftAnswer.current?.(allowed);
    shiftAnswer.current = undefined;
  }, []);

  useEffect(() => watchWorkspaceForComparison(), []);
  // The tab can be closed in a dozen ways this app never hears about; this is
  // the one hook it does get.
  useEffect(() => watchForUnsavedWork(), []);
  // A crash or a killed tab leaves scratch files nothing will ever read again.
  useEffect(() => {
    void sweepOrphanedScratch();
  }, []);

  // The two things the editing controllers need from the app: where to send an
  // edit, and who to ask before one that shifts every offset after it.
  useEffect(() => {
    // Two listeners on one edit: the comparison updates its blocks, and the
    // search re-runs. Both are claims about the bytes, and an edit can falsify
    // either.
    editingHooks.onEdit = (pane: PaneId, edit: DiffEdit) => {
      noteEdit(edit);
      noteSearchEdit(pane, edit);
      noteMinimapEdit(pane);
      // A cut travels with the content: an insert before it moves it, a delete
      // across it merges the pieces it separated.
      const size = workspaceStore.getSnapshot().panes[pane]?.document.size ?? 0;
      noteSegmentEdit(pane, edit, size);
    };
    editingHooks.confirmShift = confirmInsertShift;
    // The tree a tool is reading is told what became of the bytes — held for a
    // moment and merged, so a burst of typing is one change rather than thirty,
    // and so an undo of a repair is one stretch rather than the six places it
    // wrote to.
    editingHooks.onContentChange = noteFirmwareOperations;
    return () => {
      editingHooks.onEdit = undefined;
      editingHooks.onContentChange = undefined;
      editingHooks.confirmShift = undefined;
    };
  }, [confirmInsertShift]);

  /**
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.onDropFiles
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openFiles
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openableFiles
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.isOpenableFile
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.openFiles
   * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.application
   * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.Result.openSecond
   * @upstream ByteRipperApp/Documents/OpenPlacement.swift#OpenPlacement.Result.ignoredCount
   */
  const accept = useCallback((files: OpenedFile[], into?: PaneId) => {
    // Two files chosen at once fill both slots, which is how a comparison is
    // opened in one gesture — but only into an empty workspace: with a file
    // already open, a second one would land on top of it. A single file goes
    // where slotForNewFile says, and the ones left over are said, rather than
    // silently dropped.
    const { panes } = workspaceStore.getSnapshot();
    const bothEmpty = panes.a === undefined && panes.b === undefined;
    const taken = files.slice(0, into === undefined && bothEmpty ? 2 : 1);
    let slot = into ?? slotForNewFile();
    for (const file of taken) {
      openInPane(slot, file);
      slot = slot === "a" ? "b" : "a";
    }
    if (files.length > taken.length) {
      reportProblem(ignoredFilesMessage(files.length - taken.length, "open"));
    }
  }, []);

  /** @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentOpenPanel */
  const open = useCallback(
    async (into?: PaneId) => {
      try {
        accept(
          await openFiles({ multiple: into === undefined, capabilities: state.capabilities }),
          into
        );
      } catch (error) {
        reportProblem(error instanceof Error ? error.message : "This file could not be opened.");
      }
    },
    [accept, state.capabilities]
  );

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!dragCarriesFiles(event.dataTransfer)) return;
      event.preventDefault();
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      // Leaving for a child element is not leaving the window.
      if (event.relatedTarget !== null) return;
      setDragging(false);
    };
    /**
     * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.prepareForDragOperation
     * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.performDragOperation
     * @upstream-differs the window takes the drop, and a pane's bands take joins
     * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.handleEmptyDrop
     * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.handleSingleFileDrop
     * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.handleComparisonDrop
     */
    const onDrop = (event: DragEvent) => {
      if (event.dataTransfer === null) return;
      event.preventDefault();
      setDragging(false);
      filesFromDrop(event.dataTransfer)
        .then((files) => accept(files))
        .catch(() => reportProblem("That file could not be read."));
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [accept]);

  /**
   * Steps to the next or previous difference, or matching block, from the
   * active pane's caret — and shows it in *both* panes, because a comparison
   * that scrolled one side would be asking the user to find the other.
   */
  const activePane = state.activePane;

  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveDocument
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.savePaneDocument
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveDocumentOfPane
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveDocumentAs
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.savePaneDocumentAs
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentSaveAs
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.savePane
   */
  const doSave = useCallback(
    async (as: boolean) => {
      try {
        const outcome = await savePane(activePane, as);
        if (outcome.kind === "downloaded") {
          reportProblem(`Downloaded ${outcome.name}. The file you opened is unchanged.`);
        } else {
          reportProblem(undefined);
        }
      } catch (error) {
        reportProblem(error instanceof Error ? error.message : "That file could not be saved.");
      }
    },
    [activePane]
  );

  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revertDocument
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revertPaneDocument
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revertDocumentOfPane
   */
  const doRevert = useCallback(() => {
    const pane = workspaceStore.getSnapshot().panes[activePane];
    if (pane === undefined || !pane.document.isDirty) return;
    if (!window.confirm(`Throw away every unsaved edit to ${pane.name}?`)) return;
    void revertPane(activePane).catch(() =>
      reportProblem("That file could not be read again — it may have changed or been moved.")
    );
  }, [activePane]);

  const [fillOpen, setFillOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The tab Settings was asked to open on, when the opener named one. */
  const [settingsTab, setSettingsTab] = useState<SettingsTab | undefined>(undefined);
  /** The pane whose header name is a field right now (§23). */
  const [renamingPane, setRenamingPane] = useState<PaneId | undefined>(undefined);

  // What the browser's tab is called: the files the workspace holds, or how
  // many marks an empty one is keeping.
  const bookmarkCount = useStore(bookmarksStore).bookmarks.length;
  const nameA = state.panes.a?.name;
  const nameB = state.panes.b?.name;
  useEffect(() => {
    document.title = windowTitle({ a: nameA, b: nameB }, bookmarkCount);
  }, [nameA, nameB, bookmarkCount]);
  /** Go To, and which half of it the keyboard starts in. */
  const [goTo, setGoTo] = useState<"offset" | "bookmarks" | undefined>(undefined);
  /** The pane and address a Select Block was asked for from, or nothing. */
  const [selectBlock, setSelectBlock] = useState<
    { pane: PaneId; start: number | undefined } | undefined
  >(undefined);
  /** The pane and offset a cut was asked for at, or nothing. */
  const [cutAt, setCutAt] = useState<{ pane: PaneId; offset: number } | undefined>(undefined);
  /** The pane whose segments form is open, or nothing. */
  const [segmentsPane, setSegmentsPane] = useState<PaneId | undefined>(undefined);
  /** The tool on the left, or None. One at a time, beside the dumps. */
  const toolId = useStore(toolController).activeIdentifier;
  /**
   * The question Save All asks before it writes, and the answer it is waiting
   * for. A promise rather than a callback so the command reads as one sequence:
   * pick a folder, ask, write.
   */
  const [writeAsk, setWriteAsk] = useState<
    { title: string; message: string; answer: (yes: boolean) => void } | undefined
  >(undefined);
  const search = useStore(searchStore);
  const searchOpen = search.open;

  useEffect(() => watchForMinimap(), []);

  // The marks this workspace had when it was last open (ANALYSIS.md §
  // Bookmarks). Read once; a failure to read is a workspace with no marks yet,
  // which is what it looks like anyway.
  useEffect(() => {
    void restoreBookmarks();
    // The favourites and this browser's identity, from the last visit.
    void restoreFavorites();
  }, []);

  // The find bar always searches the pane the commands act on.
  useEffect(() => {
    setSearchPane(activePane);
  }, [activePane]);

  // Closing the last file closes the find bar with it. Refusing to open it
  // over an empty workspace while leaving one open there would be two answers
  // to the same question.
  useEffect(() => {
    if (state.panes.a === undefined && state.panes.b === undefined) closeSearch();
  }, [state.panes.a, state.panes.b]);

  /**
   * The app's own shortcuts, from anywhere.
   *
   * The panes map these too, but only while one of them holds the keyboard —
   * and something else usually does: a toolbar button that was just clicked,
   * the find bar's field, the menu. Worse, the browser is waiting behind
   * Cmd/Ctrl+F with a find bar of its own. These are commands about the
   * workspace rather than about a pane's caret, so they are taken at the window
   * before anything else can have them.
   *
   * Find pressed while the bar is already up re-selects the field, which is
   * what makes the shortcut a way of starting a new search rather than a no-op.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      // Nothing open to act on: leave the keys to the browser.
      if (workspaceStore.getSnapshot().panes.a === undefined) return;

      // Alt is the bookmark list's own modifier and difference navigation's;
      // everything else below is Alt-free. The dump has no handler for it, so
      // it is taken here wherever the keyboard is.
      if (event.altKey) {
        if (event.key === "b" || event.key === "B" || event.code === "KeyB") {
          event.preventDefault();
          setGoTo("bookmarks");
        }
        return;
      }

      // The dump has its own handler for every shortcut below, and this one
      // runs first because it captures at the window. Acting on both is acting
      // twice — which for a toggle is doing nothing at all, measured: Cmd+M
      // with the keyboard in the dump left the minimap exactly as it was. So
      // where the dump will handle it, this stands aside.
      const target = event.target;
      if (target instanceof Element && target.closest(".hex-scroller") !== null) return;

      switch (event.key) {
        case "f":
        case "F":
          event.preventDefault();
          openSearch();
          focusFindInput();
          return;
        case "l":
        case "L":
          event.preventDefault();
          setGoTo("offset");
          return;
        case "m":
        case "M":
          event.preventDefault();
          toggleMinimap();
          return;
        case "d":
        case "D": {
          // The pane's own handler has this too, but only while the dump has
          // the keyboard — and marking a row is a workspace command.
          event.preventDefault();
          const active = workspaceStore.getSnapshot().activePane;
          const slot = workspaceStore.getSnapshot().panes[active];
          if (slot === undefined) return;
          // ⇧⌘D edits the caret row's mark; ⌘D marks and names it, or unmarks it.
          if (event.shiftKey) editBookmarkInPane(active, slot.document.selection.start);
          else toggleBookmarkInPane(active, slot.document.selection.start);
          return;
        }
        case "z":
        case "Z":
        case "y":
        case "Y": {
          // Undo and Redo belong to the Edit menu and act on the active pane
          // wherever the keyboard is — after a click on the toolbar, say. A text
          // field keeps its own: undoing a typed character is not undoing a cut.
          if (target instanceof HTMLElement && isTextEntry(target)) return;
          const redo =
            event.key === "y" || event.key === "Y"
              ? detectKeyboardPlatform() === "other"
              : event.shiftKey;
          if ((event.key === "y" || event.key === "Y") && !redo) return;
          event.preventDefault();
          const active = workspaceStore.getSnapshot().activePane;
          if (redo) void redoLast(active);
          else void undoLast(active, false);
          return;
        }
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  /**
   * Keeps the keyboard where it was when a click lands on something that has
   * nowhere to type.
   *
   * A toolbar button, a pane header, a divider: pressing one moves the focus to
   * it, and from there every shortcut the pane owns — undo, select all, step
   * through differences — stops working, with nothing on screen to say why. The
   * fix is the one toolbars have always used: refuse the focus on mousedown.
   * The click still fires, and Tab still reaches the button, so nothing is lost
   * but the focus theft.
   *
   * Anything that can actually be typed into keeps its focus, and so does the
   * commands menu, which drives itself with the arrow keys.
   */
  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("input, textarea, select, [contenteditable], .menu-popup") !== null) {
        return;
      }
      // The dump itself takes the keyboard on a click — that is how a pane is
      // chosen, and its own handler asks for the focus.
      if (target.closest(".hex-scroller") !== null) return;
      event.preventDefault();
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, []);

  /**
   * No browser context menu anywhere in the application.
   *
   * Back, Reload and Inspect over a dump are commands about the web page, not
   * about the file — and one slip of Back throws the unsaved edits away. The
   * only menus here are the ones this application builds (`openContextMenu`),
   * and those are opened by their own handlers, which this does not stop: it
   * only cancels the default, so a right-click with no menu of ours — or one
   * whose menu turned out to have nothing to offer — shows nothing at all.
   */
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.findPattern
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.toggleFindBar
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showFindBar
   */
  const openFind = useCallback(() => {
    openSearch();
    focusFindInput();
  }, []);

  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.fillSelectionWithBytes
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.fillPaneSelection
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentFillSheet
   */
  const doFill = useCallback((pattern: Uint8Array) => {
    void workspaceStore
      .getSnapshot()
      .panes[workspaceStore.getSnapshot().activePane]?.typing.fillSelection(pattern);
  }, []);

  /**
   * Moves the caret, and shows it: a Go To that did not scroll would be a lie.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.goToPosition
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openGoToForm
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.presentGoToForm
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.goTo
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.goToFormPresenter
   */
  const doGoTo = useCallback(
    (offset: number) => {
      setReveal({
        a: { offset, token: ++revealToken.current },
        b: { offset, token: revealToken.current },
      });
      setActivePane(activePane);
      // Remembered, so the next Go To offers it back rather than being retyped.
      noteVisited(offset);
    },
    [activePane]
  );

  /**
   * Closing a pane throws away whatever is unsaved in it, so it asks first —
   * and names the file, because with two open the wrong one is easy to close.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.closeDocument
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.closePane
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performClosePane
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.closePaneDocument
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.confirmSaveDiscardCancel
   */
  const closeWithWarning = useCallback((pane: PaneId) => {
    const slot = workspaceStore.getSnapshot().panes[pane];
    if (slot?.document.isDirty) {
      if (!window.confirm(`${slot.name} has unsaved edits. Close it and lose them?`)) return;
    }
    // Before the workspace forgets which file this was: a session bound to it
    // has nothing left to read.
    // @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.performClosePane
    paneClosed(pane);
    // Closed on purpose, not remounted: the next file in an empty workspace
    // opens at its top rather than at where this one was.
    scrollLink.forget(pane);
    closePane(pane);
  }, []);

  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.duplicateDocument
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.duplicatePaneDocument
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.duplicate
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.canDuplicate
   */
  const doDuplicate = useCallback(() => {
    void duplicatePane(workspaceStore.getSnapshot().activePane).catch((error: unknown) =>
      reportProblem(error instanceof Error ? error.message : "That copy could not be made.")
    );
  }, []);

  /**
   * Save All as Separate Files: the command asks its question through the
   * shell's own confirmation rather than `window.confirm`, which cannot show a
   * preview of several lines.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveAllPieces
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.confirmSegmentWrite
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.runSegmentWrite
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.segmentWriteRunner
   */
  const doSaveAllSegments = useCallback(async (pane: PaneId) => {
    await saveAllPieces(
      pane,
      (title, message) =>
        new Promise<boolean>((resolve) => setWriteAsk({ title, message, answer: resolve }))
    );
    setSegmentsPane(undefined);
  }, []);

  /**
   * Shows an offset in both panes, the way difference navigation does.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.scrollPanesToOffset
   */
  const revealInBoth = useCallback((offset: number) => {
    setReveal({
      a: { offset, token: ++revealToken.current },
      b: { offset, token: revealToken.current },
    });
  }, []);

  /**
   * Centres a join's seam in the pane that took the file.
   *
   * The document has already put the caret at the start of the added part —
   * `0` for an insert, the old end for an append — so the reveal leaves it
   * there and only scrolls. The other pane is not asked: the link follows the
   * scroll, and its caret is not the join's business.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activateJoinedPane
   * @upstream-differs upstream's join notifies the view to centre its caret; here the shell asks the pane
   */
  const revealSeam = useCallback((pane: PaneId) => {
    const document = workspaceStore.getSnapshot().panes[pane]?.document;
    if (document === undefined) return;
    setReveal({
      [pane]: { offset: document.selection.start, token: ++revealToken.current, moveCaret: false },
    });
  }, []);

  /**
   * Brings back into view the caret an undo or a redo restored.
   *
   * The histories put the caret where the edit began — the top of the file for
   * an undone join, the seam for a redone one — and a pane still showing the
   * rows it was showing before has the place the step was about off screen.
   *
   * Upstream's `.center` is not "scroll to the caret": it centres **only if the
   * caret landed outside the viewport**, which is `onlyIfOffScreen`. The
   * document has already restored the caret, so this is the scroll alone.
   *
   * Registered rather than called, because all three doors onto undo — the
   * keyboard, the pane's own handler and the Edit menu — reach the router, and
   * none of them should have to remember to reveal; the router knows when a step
   * was actually taken.
   *
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.undo
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.redo
   * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.SelectionReveal
   */
  useEffect(() => {
    undoHooks.onCaretRestored = (pane: PaneId) => {
      const document = workspaceStore.getSnapshot().panes[pane]?.document;
      if (document === undefined) return;
      setReveal({
        [pane]: {
          offset: document.selection.start,
          token: ++revealToken.current,
          moveCaret: false,
          onlyIfOffScreen: true,
        },
      });
    };
    return () => {
      undoHooks.onCaretRestored = undefined;
    };
  }, []);

  /**
   * A tool has put a zone in focus — a FIT row the user picked, an MEA row, a
   * node in the tree. That is a range the user is being shown, so the dump goes
   * to its start: the scroll alone, and only when it is not on screen already.
   * The caret and the selection are deliberately untouched, because looking
   * somewhere is not the same as putting the insertion point there.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showZoneStartForTool
   * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.revealOffsetIfOffScreen
   */
  useEffect(() => {
    zoneHooks.onZoneFocused = (pane: PaneId, offset: number) => {
      setReveal({
        [pane]: {
          offset,
          token: ++revealToken.current,
          moveCaret: false,
          onlyIfOffScreen: true,
        },
      });
    };
    return () => {
      zoneHooks.onZoneFocused = undefined;
    };
  }, []);

  /**
   * Append File… / Insert File at Start… (§22).
   *
   * A join copies: the file that is picked is not consumed, and neither is the
   * pane's own content — what changes is this pane, which stops being the file
   * it was opened from and says so in its header.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.appendFile
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.insertFileAtStart
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.appendFileInPane
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.insertFileAtStartInPane
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.joinFile
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.join
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activateJoinedPane
   */
  const doJoin = useCallback(
    async (pane: PaneId, position: "start" | "end") => {
      try {
        const [picked] = await openFiles({
          multiple: false,
          capabilities: workspaceStore.getSnapshot().capabilities,
        });
        if (picked === undefined) return;
        await joinIntoPane({
          pane,
          source: new FileBackedStorage(picked.source, new ChunkCache()),
          sourceName: picked.name,
          position,
        });
        revealSeam(pane);
      } catch (error) {
        if (error instanceof JoinEmpty) {
          reportProblem(`${error.message} Nothing was joined.`);
          return;
        }
        reportProblem(error instanceof Error ? error.message : "That file could not be joined.");
      }
    },
    [revealSeam]
  );

  /**
   * A file dropped on a pane's band joins there rather than replacing it.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.handleComparisonBandDrop
   */
  const doJoinDrop = useCallback(
    async (event: React.DragEvent, pane: PaneId, where: "start" | "end") => {
      setDragging(false);
      if (event.dataTransfer === null) return;
      try {
        const [picked, ...extra] = await filesFromDrop(event.dataTransfer);
        // A join takes one file: the rest are not joined, and saying so is the
        // whole of what happens to them.
        if (extra.length > 0) reportProblem(ignoredFilesMessage(extra.length, "join"));
        if (picked !== undefined) {
          await joinIntoPane({
            pane,
            source: new FileBackedStorage(picked.source, new ChunkCache()),
            sourceName: picked.name,
            position: where,
          });
          // The same seam the menu's join centres (§22.5): a drop is the same act.
          revealSeam(pane);
        }
      } catch (error) {
        if (error instanceof JoinEmpty) {
          reportProblem(`${error.message} Nothing was joined.`);
          return;
        }
        reportProblem(error instanceof Error ? error.message : "That file could not be joined.");
      }
    },
    [revealSeam]
  );

  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.deleteBytes
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.deletePaneSelection
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.deleteSelectionOrCaret
   */
  const doDeleteBytes = useCallback(() => {
    void workspaceStore.getSnapshot().panes[activePane]?.typing.deleteBytes();
  }, [activePane]);

  /**
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.nextDifference
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.previousDifference
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.nextSameBlock
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.previousSameBlock
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.navigateBlock
   * @upstream ByteRipperApp/Window/ComparisonCoordinator.swift#ComparisonCoordinator.findBlock
   */
  const navigate = useCallback(
    (what: "difference" | "same", direction: 1 | -1) => {
      const hunks = diff.hunks;
      if (hunks === undefined) return;

      const from = selections[state.activePane].start;
      const target =
        what === "difference"
          ? direction > 0
            ? hunks.nextDifference(from)
            : hunks.previousDifference(from)
          : direction > 0
            ? hunks.nextSame(from)
            : hunks.previousSame(from);
      if (target === undefined) return;

      // Forward lands on the block's first byte, backward on its LAST — not on
      // the byte past it. Landing past the block would let the next Previous
      // press find the same block again and go nowhere.
      const offset = direction > 0 ? target.start : Math.max(target.start, target.end - 1);
      setReveal({
        a: { offset, token: ++revealToken.current },
        b: { offset, token: revealToken.current },
      });
    },
    [diff.hunks, selections, state.activePane]
  );

  const onSelectionChanged = useMemo(
    () => ({
      a: (selection: { start: number; end: number }) =>
        setSelections((current) => ({ ...current, a: selection })),
      b: (selection: { start: number; end: number }) =>
        setSelections((current) => ({ ...current, b: selection })),
    }),
    []
  );

  /**
   * What every pane menu can do. Each takes the pane it acts on, because a
   * right-click menu acts on the pane it was opened over — which the click has
   * just made active, but the item says so rather than assuming it.
   *
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.offsetContextTarget
   */
  const menuActions = useMemo<PaneMenuActions>(
    () => ({
      onNew: () => openEmptyInPane(slotForNewFile()),
      onOpen: (into) => void open(into),
      onSave: () => void doSave(false),
      onSaveAs: () => void doSave(true),
      onRename: (pane) => setRenamingPane(pane),
      onRevert: doRevert,
      onDuplicate: doDuplicate,
      onClose: (pane) => closeWithWarning(pane),
      onFill: () => setFillOpen(true),
      onDeleteBytes: doDeleteBytes,
      onSelectBlockFrom: (pane, offset) => setSelectBlock({ pane, start: offset }),
      onSplitHere: (pane, offset) => setCutAt({ pane, offset }),
      onSelectZone: (pane, zone) => {
        const slot = workspaceStore.getSnapshot().panes[pane];
        if (slot === undefined) return;
        void slot.typing.setSelection(zone.start, zone.end);
        revealInBoth(zone.start);
      },
      onJoin: (pane, position) => void doJoin(pane, position),
      onSegments: (pane) => setSegmentsPane(pane),
      onProblem: reportProblem,
    }),
    [open, doSave, doRevert, doDuplicate, closeWithWarning, doDeleteBytes, doJoin, revealInBoth]
  );

  const panes = (["a", "b"] as const).filter((id) => state.panes[id] !== undefined);

  // Whether each difference arrow has somewhere to go from the active caret —
  // the rule the navigation itself uses, so a lit arrow always moves.
  const caretForNavigation = selections[activePane].start;
  const navigation =
    diff.status === "ready" && diff.hunks !== undefined
      ? {
          previousDifference: diff.hunks.previousDifference(caretForNavigation) !== undefined,
          nextDifference: diff.hunks.nextDifference(caretForNavigation) !== undefined,
        }
      : { previousDifference: false, nextDifference: false };

  return (
    <div className="app-shell" data-dragging={dragging ? "" : undefined}>
      <Toolbar
        onOpen={open}
        onNew={() => openEmptyInPane(slotForNewFile())}
        onNavigate={navigate}
        onSave={() => void doSave(false)}
        onSaveAs={() => void doSave(true)}
        onRevert={doRevert}
        onFill={() => setFillOpen(true)}
        onDeleteBytes={doDeleteBytes}
        onGoTo={() => setGoTo("offset")}
        onBookmarks={() => setGoTo("bookmarks")}
        onJoin={(position) => void doJoin(activePane, position)}
        onSegments={() => setSegmentsPane(activePane)}
        onSplitHere={() =>
          setCutAt({
            pane: activePane,
            offset: workspaceStore.getSnapshot().panes[activePane]?.document.caret ?? 0,
          })
        }
        onSaveAllSegments={() => void doSaveAllSegments(activePane)}
        onToggleBookmark={() => {
          const slot = workspaceStore.getSnapshot().panes[activePane];
          if (slot !== undefined) toggleBookmarkInPane(activePane, slot.document.selection.start);
        }}
        onDuplicate={doDuplicate}
        onFind={openFind}
        onClose={() => closeWithWarning(activePane)}
        onSettings={() => {
          setSettingsTab(undefined);
          setSettingsOpen(true);
        }}
        navigation={navigation}
      />
      {searchOpen ? (
        <FindBar
          onReveal={revealInBoth}
          // @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showFavoritePatternSettings
          onManageFavorites={() => {
            setSettingsTab("favorites");
            setSettingsOpen(true);
          }}
        />
      ) : null}
      {/* Before the workspace in the document as well as on screen, so Tab
          reaches the panel in the order it is read. */}
      {toolId !== undefined && panes.length > 0 ? (
        <ToolPanel
          onReveal={(pane, start, end) => {
            const slot = workspaceStore.getSnapshot().panes[pane];
            if (slot !== undefined) {
              void slot.typing.setSelection(start, end);
            }
            setActivePane(pane);
            revealInBoth(start);
          }}
        />
      ) : null}
      <main
        className="app-workspace"
        data-layout={state.layout}
        data-panes={panes.length}
        style={
          panes.length === 2
            ? ({
                "--split": `${state.splitFraction}fr`,
                "--split-rest": `${1 - state.splitFraction}fr`,
              } as React.CSSProperties)
            : undefined
        }
      >
        {panes.length === 0 ? (
          <EmptyState onOpen={() => void open()} />
        ) : (
          panes.map((id) => {
            const pane = state.panes[id];
            if (pane === undefined) return null;
            const other = id === "a" ? "b" : "a";
            return (
              <HexPane
                // The document, not the file: a join's undo and redo put a
                // different file under the same document, and remounting the
                // dump for it lost the keyboard and the scroll with it.
                key={`${id}:${documentKey(pane.document)}`}
                paneId={id}
                label={id === "a" ? "File A" : "File B"}
                name={pane.name}
                document={pane.document}
                wordSize={state.wordSize}
                isActive={state.activePane === id}
                onActivate={() => setActivePane(id)}
                onClose={() => closeWithWarning(id)}
                differences={diff.index}
                companionSize={state.panes[other]?.document.size}
                peerSelection={state.panes[other] === undefined ? undefined : selections[other]}
                onSelectionChanged={onSelectionChanged[id]}
                revealRequest={reveal[id]}
                typing={pane.typing}
                saved={pane.saved}
                onSave={() => void doSave(false)}
                onSaveAs={() => void doSave(true)}
                onGoTo={() => setGoTo("offset")}
                onFind={openFind}
                matches={resultsFor(search, id).matches}
                currentMatch={resultsFor(search, id).current}
                resultsShown={resultsFor(search, id).resultsShown}
                searchStatus={resultsFor(search, id).status}
                onGoToMatch={revealInBoth}
                onHeaderMenu={(event) =>
                  openContextMenu(event, paneFileMenu(state, id, menuActions))
                }
                renaming={renamingPane === id}
                onRenameEnd={(typed, commit) => {
                  setRenamingPane(undefined);
                  if (commit) renamePane(id, typed);
                }}
                onDumpMenu={(event, anchor, onClose) =>
                  openContextMenu(event, dumpMenu(state, id, anchor.offset, menuActions), onClose)
                }
                dragActive={dragging}
                onJoinDrop={(event, where) => void doJoinDrop(event, id, where)}
              />
            );
          })
        )}
        {panes.length === 2 ? (
          <PaneDivider
            layout={state.layout}
            fraction={state.splitFraction}
            onChange={setSplitFraction}
          />
        ) : null}
      </main>
      <MinimapPanel
        selections={selections}
        onActivate={setActivePane}
        stacked={state.layout === "stacked"}
      />
      <StatusBar />
      {dragging ? <div className="drop-veil">Drop to open</div> : null}

      <GoToDialog
        open={goTo !== undefined}
        fileSize={state.panes[activePane]?.document.size ?? 0}
        document={state.panes[activePane]?.document}
        focus={goTo ?? "offset"}
        onGo={doGoTo}
        onClose={() => setGoTo(undefined)}
      />
      <FillDialog
        open={fillOpen}
        byteCount={Math.max(1, selections[activePane].end - selections[activePane].start)}
        onFill={doFill}
        onClose={() => setFillOpen(false)}
      />
      <SelectBlockDialog
        open={selectBlock !== undefined}
        fileSize={state.panes[selectBlock?.pane ?? activePane]?.document.size ?? 0}
        presetStart={selectBlock?.start}
        onSelect={(start, end) => {
          const pane = selectBlock?.pane ?? activePane;
          void state.panes[pane]?.typing.setSelection(start, end);
          revealInBoth(start);
        }}
        onClose={() => setSelectBlock(undefined)}
      />
      <TransientNotice />
      <SettingsDialog
        open={settingsOpen}
        tab={settingsTab}
        onClose={() => setSettingsOpen(false)}
      />
      <ConfirmDialog
        open={shiftAsking}
        title="This edit shifts the file"
        message={
          "Every byte after this point will move, so every offset past it changes. " +
          "That is what insert mode does, and it is undoable."
        }
        confirmLabel="Carry on"
        rememberLabel="Do not ask again"
        onConfirm={(remember) => answerShift(true, remember)}
        onCancel={() => answerShift(false)}
      />
      <CutDialog
        open={cutAt !== undefined}
        fileSize={state.panes[cutAt?.pane ?? activePane]?.document.size ?? 0}
        presetOffset={cutAt?.offset ?? 0}
        existingCuts={segmentsFor(cutAt?.pane ?? activePane)?.cuts ?? []}
        onCut={(offset, name) => addCut(cutAt?.pane ?? activePane, offset, name)}
        onClose={() => setCutAt(undefined)}
      />
      <SegmentsDialog
        open={segmentsPane !== undefined}
        pane={segmentsPane ?? activePane}
        onAddCut={() => {
          const pane = segmentsPane ?? activePane;
          setCutAt({ pane, offset: state.panes[pane]?.document.caret ?? 0 });
        }}
        onSaveAll={() => void doSaveAllSegments(segmentsPane ?? activePane)}
        onSelectPiece={(piece) => {
          const pane = segmentsPane ?? activePane;
          const slot = state.panes[pane];
          if (slot === undefined) return;
          void slot.typing.setSelection(piece.start, piece.end);
          revealInBoth(piece.start);
        }}
        onClose={() => setSegmentsPane(undefined)}
      />
      <ConfirmDialog
        open={writeAsk !== undefined}
        title={writeAsk?.title ?? ""}
        message={writeAsk?.message ?? ""}
        confirmLabel="Save"
        onConfirm={() => {
          writeAsk?.answer(true);
          setWriteAsk(undefined);
        }}
        onCancel={() => {
          writeAsk?.answer(false);
          setWriteAsk(undefined);
        }}
      />
      <ContextMenuHost />
    </div>
  );
}
