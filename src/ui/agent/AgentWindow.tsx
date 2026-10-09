import { useEffect, useRef, useState } from "react";
import {
  AGENT_LOG_COLUMNS,
  argumentsText,
  columnTitle,
  detailFields,
  isProblem,
  logText,
} from "@/core/agent/agentLogText";
import { agentStatusText } from "@/core/agent/agentStatus";
import { L } from "@/core/localization/localization";
import { agentService } from "@/state/agent/agentService";
import { useStore } from "@/state/useStore";
import { CloseButton } from "@/ui/shell/CloseButton";

/**
 * Window ▸ Agent: whether the agent service is running, who is connected, and every call an agent
 * has made, newest at the bottom.
 *
 * A panel of the page, floating over it and not in the dock: the dock's panels cover the panes, and
 * the panes are what the conversation is about. One for the app, like Settings.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.service
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.showSettings
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.followKey
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.showDetails
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.follows
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.selectLogRow
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.logSelection
 * @upstream-differs a floating panel of the page rather than a window of its own
 */
// help: window.agent
export function AgentWindow({ onSettings }: { readonly onSettings: () => void }) {
  const state = useStore(agentService.store);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [follow, setFollow] = useState(() => {
    try {
      return window.localStorage.getItem(FOLLOW_KEY) !== "false";
    } catch {
      return true;
    }
  });
  const list = useRef<HTMLDivElement>(null);

  // The log scrolls to each new request as it arrives, when asked to.
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.followButton
  // biome-ignore lint/correctness/useExhaustiveDependencies: the log's length is what moves it
  useEffect(() => {
    if (follow) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [follow, state.log.length]);

  const record = state.log.find((one) => one.id === selected);
  const status = agentStatusText({
    available: agentService.isAvailable,
    failure: state.failure,
    running: state.running,
    connections: state.connections,
  });

  return (
    <aside className="agent-window" aria-label={L("Agent")}>
      <header className="agent-window-head">
        <h2 className="agent-window-title">{L("Agent")}</h2>
        <span
          className={
            state.failure === undefined ? "agent-window-status" : "agent-window-status agent-bad"
          }
          role="status"
        >
          {status}
        </span>
        <CloseButton label={L("Close")} onClick={() => agentService.setWindowOpen(false)} />
      </header>
      <div className="agent-log" ref={list}>
        <table className="agent-table" aria-label={L("Log")}>
          <thead>
            <tr>
              {AGENT_LOG_COLUMNS.map((column) => (
                <th key={column} className={`agent-cell agent-col-${column}`} scope="col">
                  {columnTitle(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.log.map((one) => (
              <tr key={one.id} className="agent-row" aria-selected={one.id === selected}>
                {AGENT_LOG_COLUMNS.map((column) => (
                  <td
                    key={column}
                    className={
                      column === "result" && isProblem(one)
                        ? `agent-cell agent-col-${column} agent-bad`
                        : `agent-cell agent-col-${column}`
                    }
                    title={
                      column === "arguments" || column === "result"
                        ? logText(one, column)
                        : undefined
                    }
                  >
                    {column === "time" ? (
                      // The row is chosen through its first cell's button, which covers the row.
                      <button
                        type="button"
                        className="agent-row-button"
                        onClick={() => setSelected(one.id)}
                      >
                        {logText(one, column)}
                      </button>
                    ) : (
                      logText(one, column)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* help: window.agent.details */}
      <div className="agent-details" aria-live="polite">
        {record === undefined ? (
          <p className="agent-placeholder">{L("Select a request to see all of it.")}</p>
        ) : (
          <>
            <h3 className="agent-details-title">{record.tool}</h3>
            <dl className="agent-fields">
              {detailFields(record).map((field) => (
                <div key={field.label} className="agent-field">
                  <dt>{field.label}</dt>
                  <dd className={field.isProblem ? "agent-bad" : undefined}>{field.value}</dd>
                </div>
              ))}
            </dl>
            <h3 className="agent-details-title">{L("Arguments")}</h3>
            <pre className="agent-arguments">{argumentsText(record)}</pre>
          </>
        )}
      </div>
      <footer className="agent-window-foot">
        {/* help: window.agent.follow */}
        <label
          className="agent-follow"
          title={L("Scroll the log to each new request as it arrives")}
        >
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => {
              setFollow(event.target.checked);
              try {
                window.localStorage.setItem(FOLLOW_KEY, String(event.target.checked));
              } catch {
                // A choice that is not remembered is asked again.
              }
            }}
          />
          {L("Follow New Requests")}
        </label>
        <span className="agent-spacer" />
        <button type="button" onClick={onSettings}>
          {L("Agent Settings…")}
        </button>
        <button
          type="button"
          disabled={state.log.length === 0}
          onClick={() => {
            setSelected(undefined);
            agentService.clearLog();
          }}
        >
          {L("Clear Log")}
        </button>
      </footer>
    </aside>
  );
}

/** Where the choice is kept, so the window opens the way it was left. @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.followKey */
const FOLLOW_KEY = "AgentLogFollowsNewRequests";
