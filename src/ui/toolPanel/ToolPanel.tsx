import { useCallback, useState } from "react";
import {
  DEFAULT_TOOL_PANEL_WIDTH,
  MAX_TOOL_PANEL_WIDTH,
  MIN_TOOL_PANEL_WIDTH,
  setToolPanelWidth,
  toolPanelStore,
} from "@/state/toolPanelStore";
import { useStore } from "@/state/useStore";
import { reportProblem, workspaceStore } from "@/state/workspaceStore";
import { toolById } from "@/tools/registry";
import type { ToolContext } from "@/tools/toolModule";
import { EdgeSplitter } from "@/ui/shell/EdgeSplitter";

/**
 * The tool panel, on the left: one tool at a time, bound to one pane.
 *
 * One at a time because these panels are dense — a tree of thousands of rows, a
 * table of microcode entries — and two of them side by side in a browser window
 * leaves neither usable. Which tool it is lives in the toolbar, where None closes
 * it. Which pane it is about is in the header and not inferred, because with two
 * files open a panel that did not say would be a panel nobody could trust.
 */
export function ToolPanel({
  onReveal,
}: {
  readonly onReveal: (pane: "a" | "b", start: number, end: number) => void;
}) {
  const workspace = useStore(workspaceStore);
  const { toolId, width } = useStore(toolPanelStore);
  const [pane, setPane] = useState<"a" | "b">(workspace.activePane);
  // The pane the panel was about has closed: it moves to the one still open,
  // which closing made the active one. Adjusted during render rather than in an
  // effect, so the empty state never flashes between the two.
  if (
    workspace.panes[pane] === undefined &&
    workspace.panes[workspace.activePane] !== undefined &&
    pane !== workspace.activePane
  ) {
    setPane(workspace.activePane);
  }
  const tool = toolId === undefined ? undefined : toolById(toolId);

  const reveal = useCallback(
    (start: number, end: number) => onReveal(pane, start, end),
    [onReveal, pane]
  );
  const context: ToolContext = { pane, reveal, report: reportProblem };

  const open = (["a", "b"] as const).filter((id) => workspace.panes[id] !== undefined);

  return (
    <aside className="tool-panel" aria-label="Tools" style={{ width }}>
      <header className="tool-panel-head">
        {/* Which file the panel is about. Shown even with one open, because the
            answer is what the panel means. */}
        <select
          className="tool-pane"
          value={pane}
          onChange={(event) => setPane(event.target.value as "a" | "b")}
          aria-label="File"
        >
          {open.map((id) => (
            <option key={id} value={id}>
              {workspace.panes[id]?.name ?? (id === "a" ? "File A" : "File B")}
            </option>
          ))}
        </select>
      </header>

      <div className="tool-panel-body">
        {tool === undefined || workspace.panes[pane] === undefined ? (
          <p className="tool-empty">Open a file to look inside it.</p>
        ) : (
          <tool.View context={context} />
        )}
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
