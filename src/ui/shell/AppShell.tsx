import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DiffEdit } from "@/core/diff/diffEngine";
import { dragCarriesFiles, filesFromDrop } from "@/platform/files/dragDrop";
import type { OpenedFile } from "@/platform/files/openedFile";
import { openFiles } from "@/platform/files/openFile";
import { sweepOrphanedScratch } from "@/platform/files/opfsScratchStore";
import { diffStore, noteEdit, watchWorkspaceForComparison } from "@/state/diffStore";
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
import { HexPane } from "@/ui/pane/HexPane";
import { EmptyState } from "@/ui/shell/EmptyState";
import { PaneDivider } from "@/ui/shell/PaneDivider";
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
}

export function AppShell() {
  const state = useStore(workspaceStore);
  const diff = useStore(diffStore);
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
    editingHooks.onEdit = (_pane: PaneId, edit: DiffEdit) => noteEdit(edit);
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
  const [goToOpen, setGoToOpen] = useState(false);

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

  const panes = (["a", "b"] as const).filter((id) => state.panes[id] !== undefined);

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
        onGoTo={() => setGoToOpen(true)}
        onDuplicate={doDuplicate}
      />
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
                fontSizePx={state.fontSizePx}
                isActive={state.activePane === id}
                onActivate={() => setActivePane(id)}
                onClose={() => closeWithWarning(id)}
                differences={diff.index}
                peerSelection={state.panes[other] === undefined ? undefined : selections[other]}
                onSelectionChanged={onSelectionChanged[id]}
                revealRequest={reveal[id]}
                typing={pane.typing}
                onSave={() => void doSave(false)}
                onSaveAs={() => void doSave(true)}
                onGoTo={() => setGoToOpen(true)}
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
      <StatusBar />
      {dragging ? <div className="drop-veil">Drop to open</div> : null}

      <GoToDialog
        open={goToOpen}
        fileSize={state.panes[activePane]?.document.size ?? 0}
        onGo={doGoTo}
        onClose={() => setGoToOpen(false)}
      />
      <FillDialog
        open={fillOpen}
        byteCount={Math.max(1, selections[activePane].end - selections[activePane].start)}
        onFill={doFill}
        onClose={() => setFillOpen(false)}
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
    </div>
  );
}
