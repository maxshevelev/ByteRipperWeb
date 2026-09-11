import { useCallback, useEffect, useState } from "react";
import { dragCarriesFiles, filesFromDrop } from "@/platform/files/dragDrop";
import type { OpenedFile } from "@/platform/files/openedFile";
import { openFiles } from "@/platform/files/openFile";
import { useStore } from "@/state/useStore";
import { openInPaneA, reportProblem, workspaceStore } from "@/state/workspaceStore";
import { HexPane } from "@/ui/pane/HexPane";
import { EmptyState } from "@/ui/shell/EmptyState";
import { StatusBar } from "@/ui/shell/StatusBar";
import { Toolbar } from "@/ui/shell/Toolbar";

/**
 * Header, workspace, status bar — the three bands the app never loses.
 *
 * The drop target is the window rather than the pane: a person dragging a dump
 * onto an empty app has no pane to aim at, and aiming is not what dropping a
 * file should require.
 */
export function AppShell() {
  const state = useStore(workspaceStore);
  const [dragging, setDragging] = useState(false);

  const accept = useCallback((files: OpenedFile[]) => {
    const first = files[0];
    if (first === undefined) return;
    openInPaneA(first);
  }, []);

  const open = useCallback(async () => {
    try {
      accept(await openFiles({ capabilities: state.capabilities }));
    } catch (error) {
      reportProblem(error instanceof Error ? error.message : "This file could not be opened.");
    }
  }, [accept, state.capabilities]);

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
        .then(accept)
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

  return (
    <div className="app-shell" data-dragging={dragging ? "" : undefined}>
      <Toolbar onOpen={open} />
      <main className="app-workspace">
        {state.paneA === undefined ? (
          <EmptyState onOpen={open} />
        ) : (
          <HexPane
            document={state.paneA.document}
            wordSize={state.wordSize}
            fontSizePx={state.fontSizePx}
          />
        )}
      </main>
      <StatusBar />
      {dragging ? <div className="drop-veil">Drop to open</div> : null}
    </div>
  );
}
