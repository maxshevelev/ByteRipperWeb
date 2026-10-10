import { type KeyboardEvent, useEffect, useRef, useState } from "react";
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
import { agentFindingStore } from "@/state/agent/agentDumpTools";
import { agentMarkStore } from "@/state/agent/agentMarkStore";
import { agentService } from "@/state/agent/agentService";
import { useStore } from "@/state/useStore";
import { AgentFindingsPage } from "@/ui/agent/AgentFindingsPage";
import { AgentList } from "@/ui/agent/AgentList";
import { AgentMarksPage } from "@/ui/agent/AgentMarksPage";
import { AgentToolsPage } from "@/ui/agent/AgentToolsPage";
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
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.showTools
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.toolsPage
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.logSelection
 * @upstream-differs a floating panel of the page rather than a window of its own
 */
// help: window.agent
export function AgentWindow({ onSettings }: { readonly onSettings: () => void }) {
  const state = useStore(agentService.store);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [page, setPage] = useState<AgentPageName>("log");
  const [chosenMarks, setChosenMarks] = useState<ReadonlySet<string>>(new Set());
  const [chosenTool, setChosenTool] = useState<string | undefined>(undefined);
  const window_ = useRef<HTMLElement>(null);
  // The marks as they are now: listening to the store is what keeps the page and the dump one.
  useStore(agentMarkStore);
  const marks = agentService.markTools.all();
  const findings = useStore(agentFindingStore).findings;
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

  // The keyboard is on the list of the page shown, when the window comes up and when a page is
  // chosen, so the arrow keys walk its rows at once.
  //
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.focusList
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.shownList
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page is what moves it
  useEffect(() => {
    window_.current?.querySelector<HTMLElement>(".agent-log:not([hidden])")?.focus();
  }, [page]);

  /**
   * Up and Down move through the rows of the list that has the keyboard, as the arrow keys walk an
   * AppKit table's.
   *
   * @upstream-differs a React table has no row selection of its own; the page's choice is moved
   */
  const walk = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const ids: string[] =
      page === "log"
        ? state.log.map((one) => String(one.id))
        : page === "marks"
          ? marks.map((one) => one.mark.id)
          : page === "tools"
            ? agentService.catalogue().map((one) => one.tool.name)
            : [];
    if (ids.length === 0) return;
    const now =
      page === "log"
        ? selected === undefined
          ? undefined
          : String(selected)
        : page === "marks"
          ? [...chosenMarks][0]
          : chosenTool;
    const at = now === undefined ? -1 : ids.indexOf(now);
    const next =
      ids[Math.max(0, Math.min(ids.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next === undefined) return;
    event.preventDefault();
    if (page === "log") setSelected(Number(next));
    else if (page === "marks") setChosenMarks(new Set([next]));
    else setChosenTool(next);
  };

  const record = state.log.find((one) => one.id === selected);
  const status = agentStatusText({
    available: agentService.isAvailable,
    failure: state.failure,
    running: state.running,
    connections: state.connections,
  });

  return (
    <aside className="agent-window" aria-label={L("Agent")} ref={window_}>
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
      <nav className="agent-pages" aria-label={L("Page")}>
        {PAGES.map((one) => (
          <button
            key={one}
            type="button"
            className="agent-page-button"
            aria-pressed={page === one}
            onClick={() => setPage(one)}
          >
            {pageTitle(one)}
          </button>
        ))}
      </nav>
      {page === "marks" ? (
        <AgentMarksPage
          marks={marks}
          chosen={chosenMarks}
          onChoose={(id, extend) =>
            setChosenMarks((current) => {
              const next = new Set(extend ? current : []);
              if (current.has(id) && extend) next.delete(id);
              else next.add(id);
              return next;
            })
          }
          onShow={(id) => void agentService.markTools.show(id)}
          onKeyDown={walk}
        />
      ) : null}
      {page === "findings" ? (
        <AgentFindingsPage
          findings={findings}
          onShow={(finding) => void agentService.dumpTools.showFinding(finding)}
        />
      ) : null}
      {page === "tools" ? (
        <AgentToolsPage
          entries={agentService.catalogue()}
          stats={state.toolStats}
          chosen={chosenTool}
          onChoose={setChosenTool}
          onKeyDown={walk}
        />
      ) : null}
      <AgentList listRef={list} hidden={page !== "log"} onKeyDown={walk}>
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
      </AgentList>
      {/* help: window.agent.details */}
      <div className="agent-details" aria-live="polite" hidden={page !== "log"}>
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
          hidden={page !== "log"}
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
        {page === "marks" ? (
          <>
            <button
              type="button"
              disabled={!marks.some((one) => chosenMarks.has(one.mark.id))}
              onClick={() => {
                agentService.markTools.remove((one) => chosenMarks.has(one.mark.id));
                setChosenMarks(new Set());
              }}
            >
              {L("Remove Mark")}
            </button>
            <button
              type="button"
              disabled={marks.length === 0}
              onClick={() => agentService.markTools.remove(() => true)}
            >
              {L("Clear Marks")}
            </button>
          </>
        ) : page === "findings" ? (
          <button
            type="button"
            disabled={findings.length === 0}
            onClick={() => agentService.dumpTools.clearFindings()}
          >
            {L("Clear Findings")}
          </button>
        ) : page === "tools" ? (
          <button
            type="button"
            disabled={Object.keys(state.toolStats).length === 0}
            onClick={() => agentService.resetToolStats()}
          >
            {L("Reset Statistics")}
          </button>
        ) : (
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
        )}
      </footer>
    </aside>
  );
}

/** The pages of the window. @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.Page */
type AgentPageName = "log" | "marks" | "findings" | "tools";
const PAGES: readonly AgentPageName[] = ["log", "marks", "findings", "tools"];
const pageTitle = (page: AgentPageName): string =>
  page === "log"
    ? L("Log")
    : page === "marks"
      ? L("Marks")
      : page === "findings"
        ? L("Findings")
        : L("Tools");

/** Where the choice is kept, so the window opens the way it was left. @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.followKey */
const FOLLOW_KEY = "AgentLogFollowsNewRequests";
