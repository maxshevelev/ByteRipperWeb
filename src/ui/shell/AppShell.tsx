import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dragCarriesFiles, filesFromDrop } from "@/platform/files/dragDrop";
import type { OpenedFile } from "@/platform/files/openedFile";
import { openFiles } from "@/platform/files/openFile";
import { diffStore, watchWorkspaceForComparison } from "@/state/diffStore";
import { useStore } from "@/state/useStore";
import {
  closePane,
  openInPane,
  type PaneId,
  reportProblem,
  setActivePane,
  slotForNewFile,
  workspaceStore,
} from "@/state/workspaceStore";
import { HexPane } from "@/ui/pane/HexPane";
import { EmptyState } from "@/ui/shell/EmptyState";
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
  readonly start: number;
  readonly end: number;
  /** Makes a repeat of the same range a fresh request. */
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

  useEffect(() => watchWorkspaceForComparison(), []);

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

      const token = ++revealToken.current;
      const request: RevealRequest = { start: target.start, end: target.end, token };
      setReveal({ a: request, b: request });
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
      <Toolbar onOpen={open} onNavigate={navigate} />
      <main className="app-workspace" data-layout={state.layout} data-panes={panes.length}>
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
                label={id === "a" ? "File A" : "File B"}
                name={pane.name}
                document={pane.document}
                wordSize={state.wordSize}
                fontSizePx={state.fontSizePx}
                isActive={state.activePane === id}
                onActivate={() => setActivePane(id)}
                onClose={() => closePane(id)}
                differences={diff.index}
                peerSelection={state.panes[other] === undefined ? undefined : selections[other]}
                onSelectionChanged={onSelectionChanged[id]}
                revealRequest={reveal[id]}
              />
            );
          })
        )}
      </main>
      <StatusBar />
      {dragging ? <div className="drop-veil">Drop to open</div> : null}
    </div>
  );
}
