import { AGENT_MARK_COLUMNS, markColumnTitle, markText } from "@/core/agent/agentMarkText";
import { L } from "@/core/localization/localization";
import type { LocatedMark } from "@/state/agent/agentMarkTools";

/**
 * The Marks page of the Agent window: every mark an agent left, in every open document, with what
 * it is about. A click chooses a row; the button on a row shows the bytes.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.build
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.show
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.selectedIDs
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.doubleClicked
 * @upstream-differs a double-click shows the bytes; the row's own button does what a click on it does besides choosing it
 */
export function AgentMarksPage({
  marks,
  chosen,
  onChoose,
  onShow,
}: {
  readonly marks: readonly LocatedMark[];
  readonly chosen: ReadonlySet<string>;
  readonly onChoose: (id: string, extend: boolean) => void;
  readonly onShow: (id: string) => void;
}) {
  const all = marks.map((one) => one.mark);
  return (
    <div className="agent-log">
      <table className="agent-table agent-marks" aria-label={L("Marks")}>
        <thead>
          <tr>
            {AGENT_MARK_COLUMNS.map((column) => (
              <th key={column} className={`agent-cell agent-mark-col-${column}`} scope="col">
                {markColumnTitle(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {marks.map(({ mark, place }) => (
            <tr
              key={mark.id}
              className="agent-row"
              aria-selected={chosen.has(mark.id)}
              onDoubleClick={() => onShow(mark.id)}
            >
              {AGENT_MARK_COLUMNS.map((column) => {
                const text = markText(mark, column, place.name, all);
                return (
                  <td
                    key={column}
                    className={`agent-cell agent-mark-col-${column}`}
                    title={column === "note" || column === "related" ? text : undefined}
                  >
                    {column === "id" ? (
                      <button
                        type="button"
                        className="agent-row-button"
                        onClick={(event) => onChoose(mark.id, event.metaKey || event.ctrlKey)}
                      >
                        {text}
                      </button>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
