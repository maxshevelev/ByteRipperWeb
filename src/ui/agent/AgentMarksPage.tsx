import type { KeyboardEvent } from "react";
import { AGENT_MARK_COLUMNS, markText } from "@/core/agent/agentMarkText";
import { L } from "@/core/localization/localization";
import type { LocatedMark } from "@/state/agent/agentMarkTools";
import { AgentList } from "@/ui/agent/AgentList";
import {
  AgentTableHead,
  agentRowClass,
  agentTableMinWidth,
  markColumns,
  useAgentColumns,
} from "@/ui/agent/AgentTableHead";

/**
 * The Marks page of the Agent window: every mark an agent left, in every open document, with what
 * it is about. A click chooses a row — ⌘ or Ctrl adds it to the rows chosen or takes it out,
 * Shift chooses every row from the last one clicked — and a double-click shows the bytes.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.build
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.show
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.selectedIDs
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.doubleClicked
 */
export function AgentMarksPage({
  marks,
  chosen,
  onChoose,
  onShow,
  onKeyDown,
}: {
  readonly marks: readonly LocatedMark[];
  readonly chosen: ReadonlySet<string>;
  readonly onChoose: (id: string, how: MarkChoice) => void;
  readonly onShow: (id: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const all = marks.map((one) => one.mark);
  const { columns, kept } = useAgentColumns(markColumns, "AgentMarksTable");
  return (
    <div className="agent-single">
      <AgentList label={L("Marks")} multiselectable onKeyDown={onKeyDown}>
        <table
          className="agent-table agent-marks"
          style={{ minWidth: agentTableMinWidth(columns, kept) }}
        >
          <AgentTableHead
            columns={columns}
            kept={kept}
            cellClass={(id) => `agent-mark-col-${id}`}
          />
          <tbody>
            {marks.map(({ mark, place }, index) => (
              <tr
                key={mark.id}
                className={agentRowClass(index)}
                data-row={mark.id}
                aria-selected={chosen.has(mark.id)}
                onClick={(event) =>
                  onChoose(
                    mark.id,
                    event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "only"
                  )
                }
                onDoubleClick={() => onShow(mark.id)}
              >
                {AGENT_MARK_COLUMNS.map((column) => {
                  const text = markText(mark, column, place.name, all);
                  return (
                    <td
                      key={column}
                      className={`agent-cell agent-mark-col-${column}`}
                      title={column === "note" ? text : undefined}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </AgentList>
    </div>
  );
}

/**
 * How a click chooses a mark: alone, added to or taken out of the rows chosen (⌘ or Ctrl), or with
 * every row from the last one clicked (Shift) — an AppKit table's multiple selection.
 *
 * @web-only an AppKit table reads the modifier keys of a click itself
 */
export type MarkChoice = "only" | "toggle" | "range";
