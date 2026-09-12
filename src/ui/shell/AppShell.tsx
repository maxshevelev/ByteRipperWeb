import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffEdit } from "@/core/diff/diffEngine";
import { selection as makeSelection } from "@/core/document/selectionModel";
import { dragCarriesFiles, filesFromDrop } from "@/platform/files/dragDrop";
import type { OpenedFile } from "@/platform/files/openedFile";
import { openFiles } from "@/platform/files/openFile";
import { sweepOrphanedScratch } from "@/platform/files/opfsScratchStore";
import { noteVisited, restoreBookmarks, toggleBookmark } from "@/state/bookmarksStore";
import { diffStore, noteEdit, watchWorkspaceForComparison } from "@/state/diffStore";
import { editStore } from "@/state/editStore";
import { noteMinimapEdit, toggleMinimap, watchForMinimap } from "@/state/minimapStore";
import {
  closeSearch,
  noteSearchEdit,
  openSearch,
  resultsFor,
  searchStore,
  setSearchPane,
} from "@/state/searchStore";
import { watchForUnsavedWork } from "@/state/unsavedWork";
import { useStore } from "@/state/useStore";
import {
  closePane,
  duplicatePane,
  editingHooks,
  openEmptyInPane,
  openInPane,
  type PaneId,
  reportProblem,
  revertPane,
  savePane,
  setActivePane,
  setConfirmShiftingEdits,
  setSplitFraction,
  slotForNewFile,
  workspaceStore,
} from "@/state/workspaceStore";
import { ConfirmDialog } from "@/ui/dialogs/ConfirmDialog";
import { FillDialog } from "@/ui/dialogs/FillDialog";
import { GoToDialog } from "@/ui/dialogs/GoToDialog";
import { SelectBlockDialog } from "@/ui/dialogs/SelectBlockDialog";
import { MinimapPanel } from "@/ui/minimap/MinimapPanel";
import { HexPane } from "@/ui/pane/HexPane";
import { FindBar, focusFindInput } from "@/ui/search/FindBar";
import { ContextMenuHost, openContextMenu } from "@/ui/shell/ContextMenu";
import { EmptyState } from "@/ui/shell/EmptyState";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { dumpMenu, type PaneMenuActions, paneFileMenu } from "@/ui/shell/paneMenus";
import { StatusBar } from "@/ui/shell/StatusBar";
import { Toolbar } from "@/ui/shell/Toolbar";

/**
 * Header, workspace, status bar — the three bands the app never loses.
 *
 * The drop target is the window rather than a pane: a person dragging a dump
 * onto an empty app has no pane to aim at, and aiming is not what dropping a
 * file should require. A drop with both slots full replaces the active one.
 */

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
}

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
    };
    editingHooks.confirmShift = confirmInsertShift;
    return () => {
      editingHooks.onEdit = undefined;
      editingHooks.confirmShift = undefined;
    };
  }, [confirmInsertShift]);

  const accept = useCallback((files: OpenedFile[], into?: PaneId) => {
    // Two files chosen at once fill both slots, which is how a comparison is
    // opened in one gesture. A single one goes where slotForNewFile says.
    let slot = into ?? slotForNewFile();
    for (const file of files) {
      openInPane(slot, file);
      slot = slot === "a" ? "b" : "a";
    }
  }, []);

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

  const doRevert = useCallback(() => {
    const pane = workspaceStore.getSnapshot().panes[activePane];
    if (pane === undefined || !pane.document.isDirty) return;
    if (!window.confirm(`Throw away every unsaved edit to ${pane.name}?`)) return;
    void revertPane(activePane).catch(() =>
      reportProblem("That file could not be read again — it may have changed or been moved.")
    );
  }, [activePane]);

  const [fillOpen, setFillOpen] = useState(false);
  /** Go To, and which half of it the keyboard starts in. */
  const [goTo, setGoTo] = useState<"offset" | "bookmarks" | undefined>(undefined);
  /** The pane and address a Select Block was asked for from, or nothing. */
  const [selectBlock, setSelectBlock] = useState<
    { pane: PaneId; start: number | undefined } | undefined
  >(undefined);
  const search = useStore(searchStore);
  const searchOpen = search.open;

  useEffect(() => watchForMinimap(), []);

  // The marks this workspace had when it was last open (ANALYSIS.md §
  // Bookmarks). Read once; a failure to read is a workspace with no marks yet,
  // which is what it looks like anyway.
  useEffect(() => {
    void restoreBookmarks();
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
          const slot = workspaceStore.getSnapshot().panes[workspaceStore.getSnapshot().activePane];
          if (slot !== undefined) toggleBookmark(slot.document.caret);
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

  const openFind = useCallback(() => {
    openSearch();
    focusFindInput();
  }, []);

  const doFill = useCallback((pattern: Uint8Array) => {
    void workspaceStore
      .getSnapshot()
      .panes[workspaceStore.getSnapshot().activePane]?.typing.fillSelection(pattern);
  }, []);

  /** Moves the caret, and shows it: a Go To that did not scroll would be a lie. */
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
   */
  const closeWithWarning = useCallback((pane: PaneId) => {
    const slot = workspaceStore.getSnapshot().panes[pane];
    if (slot?.document.isDirty) {
      if (!window.confirm(`${slot.name} has unsaved edits. Close it and lose them?`)) return;
    }
    closePane(pane);
  }, []);

  const doDuplicate = useCallback(() => {
    void duplicatePane(workspaceStore.getSnapshot().activePane).catch((error: unknown) =>
      reportProblem(error instanceof Error ? error.message : "That copy could not be made.")
    );
  }, []);

  const doDeleteBytes = useCallback(() => {
    void workspaceStore.getSnapshot().panes[activePane]?.typing.deleteBytes();
  }, [activePane]);

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
   */
  const menuActions = useMemo<PaneMenuActions>(
    () => ({
      onNew: () => openEmptyInPane(slotForNewFile()),
      onOpen: (into) => void open(into),
      onSave: () => void doSave(false),
      onSaveAs: () => void doSave(true),
      onRevert: doRevert,
      onDuplicate: doDuplicate,
      onClose: (pane) => closeWithWarning(pane),
      onFill: () => setFillOpen(true),
      onDeleteBytes: doDeleteBytes,
      onSelectBlockFrom: (pane, offset) => setSelectBlock({ pane, start: offset }),
      // Editing a mark is picking it out of the list that already renames,
      // moves and removes marks — rather than a second dialog saying the same
      // things about one of them.
      onEditBookmark: () => setGoTo("bookmarks"),
      onProblem: reportProblem,
    }),
    [open, doSave, doRevert, doDuplicate, closeWithWarning, doDeleteBytes]
  );

  const panes = (["a", "b"] as const).filter((id) => state.panes[id] !== undefined);

  /** Shows an offset in both panes, the way difference navigation does. */
  const revealInBoth = useCallback((offset: number) => {
    setReveal({
      a: { offset, token: ++revealToken.current },
      b: { offset, token: revealToken.current },
    });
  }, []);

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
        onToggleBookmark={() => {
          const slot = workspaceStore.getSnapshot().panes[activePane];
          if (slot !== undefined) toggleBookmark(slot.document.caret);
        }}
        onDuplicate={doDuplicate}
        onFind={openFind}
        onClose={() => closeWithWarning(activePane)}
      />
      {searchOpen ? <FindBar onReveal={revealInBoth} /> : null}
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
                key={`${id}:${pane.name}:${pane.file.lastModified}`}
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
                onGoToMatch={revealInBoth}
                onHeaderMenu={(event) =>
                  openContextMenu(event, paneFileMenu(state, id, menuActions))
                }
                onDumpMenu={(event, offset) =>
                  openContextMenu(event, dumpMenu(state, id, offset, menuActions))
                }
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
          state.panes[pane]?.document.setSelection(
            makeSelection(start, end, state.panes[pane]?.document.size ?? 0)
          );
          revealInBoth(start);
        }}
        onClose={() => setSelectBlock(undefined)}
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
      <ContextMenuHost />
    </div>
  );
}
