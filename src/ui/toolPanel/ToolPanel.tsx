import { useCallback, useState } from "react";
import { closeFirmware } from "@/state/firmwareStore";
import { chooseTool, toolPanelStore } from "@/state/toolPanelStore";
import { useStore } from "@/state/useStore";
import { reportProblem, workspaceStore } from "@/state/workspaceStore";
import { TOOLS, toolById } from "@/tools/registry";
import type { ToolContext } from "@/tools/toolModule";

/**
 * The tool panel: one tool at a time, bound to one pane.
 *
 * One at a time because these panels are dense — a tree of thousands of rows, a
 * table of microcode entries — and two of them side by side in a browser window
 * leaves neither usable. Which pane it is about is in the header and not
 * inferred, because with two files open a panel that did not say would be a
 * panel nobody could trust.
 */
export function ToolPanel({
  onClose,
  onReveal,
}: {
  readonly onClose: () => void;
  readonly onReveal: (pane: "a" | "b", start: number, end: number) => void;
}) {
  const workspace = useStore(workspaceStore);
  const { toolId } = useStore(toolPanelStore);
  const [pane, setPane] = useState<"a" | "b">(workspace.activePane);
  const tool = toolById(toolId);

  const reveal = useCallback(
    (start: number, end: number) => onReveal(pane, start, end),
    [onReveal, pane]
  );
  const context: ToolContext = { pane, reveal, report: reportProblem };

  const open = (["a", "b"] as const).filter((id) => workspace.panes[id] !== undefined);

  return (
    <aside className="tool-panel" aria-label="Tools">
      <header className="tool-panel-head">
        <select
          className="tool-picker"
          value={toolId}
          onChange={(event) => chooseTool(event.target.value)}
          aria-label="Tool"
        >
          {TOOLS.map((one) => (
            <option key={one.id} value={one.id} title={one.summary}>
              {one.title}
            </option>
          ))}
        </select>

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

        <span className="toolbar-spacer" />
        <button
          type="button"
          className="toolbar-button"
          onClick={() => {
            // The tree is worth keeping while the panel is open and not a byte
            // longer: it is the largest thing this application holds.
            for (const id of open) closeFirmware(id);
            onClose();
          }}
          title="Close the tool panel"
        >
          Close
        </button>
      </header>

      <div className="tool-panel-body">
        {tool === undefined || workspace.panes[pane] === undefined ? (
          <p className="tool-empty">Open a file to look inside it.</p>
        ) : (
          <tool.View context={context} />
        )}
      </div>
    </aside>
  );
}
