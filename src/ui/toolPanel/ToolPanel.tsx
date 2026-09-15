import { useCallback } from "react";
import { showNotice } from "@/state/noticeStore";
import {
  activate,
  activeModule,
  DEFAULT_TOOL_PANEL_WIDTH,
  MAX_TOOL_PANEL_WIDTH,
  MIN_TOOL_PANEL_WIDTH,
  setToolPanelWidth,
  toolController,
} from "@/state/toolController";
import { useStore } from "@/state/useStore";
import { reportProblem, workspaceStore } from "@/state/workspaceStore";
import type { ToolContext } from "@/tools/toolModule";
import { CloseButton } from "@/ui/shell/CloseButton";
import { EdgeSplitter } from "@/ui/shell/EdgeSplitter";

/**
 * The tool panel's chrome: a header naming the tool and the file its session is
 * bound to, a close button, and the tool's own view below.
 *
 * The header answers the one question the panel would otherwise leave open —
 * which file this is. A session is bound to the pane it was opened for and does
 * not follow the active pane, so in a comparison the panel and the pane being
 * typed in can be different files, and what the header names is where the
 * tool's writes go.
 *
 * @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView
 */
export function ToolPanel({
  onReveal,
}: {
  readonly onReveal: (pane: "a" | "b", start: number, end: number) => void;
}) {
  const workspace = useStore(workspaceStore);
  const tools = useStore(toolController);
  const { boundPane, width } = tools;
  const tool = activeModule(tools);
  const slot = boundPane === undefined ? undefined : workspace.panes[boundPane];

  const reveal = useCallback(
    (start: number, end: number) => {
      if (boundPane !== undefined) onReveal(boundPane, start, end);
    },
    [onReveal, boundPane]
  );

  if (tool === undefined || boundPane === undefined || slot === undefined) return null;
  const context: ToolContext = {
    pane: boundPane,
    reveal,
    report: reportProblem,
    // The window's own plate, through the presenter every other notice goes
    // through, so a tool's confirmation cannot come to look like another app's.
    // @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.showNotice
    showNotice,
  };

  return (
    <aside className="tool-panel" aria-label="Tools" style={{ width }}>
      {/* @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setTitle */}
      <header className="tool-panel-head">
        <ToolsIcon />
        <span className="tool-panel-title">{tool.title}</span>
        <span className="tool-panel-file" title={slot.name}>
          {slot.name}
        </span>
        {/* The panel's ✕ is Tools ▸ None by another route.
            @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.onClose */}
        <CloseButton label="Close the tool panel" onClick={() => activate(undefined)} />
      </header>

      {/* @upstream ByteRipperApp/Tools/ToolPanelView.swift#ToolPanelView.setContent */}
      <div className="tool-panel-body">
        <tool.View key={`${tool.id}:${boundPane}`} context={context} />
      </div>

      <EdgeSplitter
        edge="right"
        label="Resize the tool panel"
        width={width}
        min={MIN_TOOL_PANEL_WIDTH}
        max={MAX_TOOL_PANEL_WIDTH}
        initial={DEFAULT_TOOL_PANEL_WIDTH}
        onChange={setToolPanelWidth}
      />
    </aside>
  );
}

/**
 * The wrench the header carries, so the panel reads as the tools' own.
 *
 * @upstream-differs upstream's `wrench.and.screwdriver` symbol, drawn as a wrench: SF Symbols do not ship to a browser
 */
function ToolsIcon() {
  return (
    <svg className="tool-panel-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M10.5 1.5a4 4 0 0 0-3.8 5.2L1.9 11.5a1.4 1.4 0 0 0 2 2l4.8-4.8a4 4 0 0 0 5.2-3.8l-2.2 2.2-2.1-.6-.6-2.1z" />
    </svg>
  );
}
