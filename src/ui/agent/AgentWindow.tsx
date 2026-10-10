import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  AGENT_LOG_COLUMNS,
  argumentsText,
  detailFields,
  isProblem,
  logText,
} from "@/core/agent/agentLogText";
import { isRunning } from "@/core/agent/agentServer";
import { agentStatusText } from "@/core/agent/agentStatus";
import { sectionsOf } from "@/core/agent/agentToolCatalogue";
import { L } from "@/core/localization/localization";
import { agentFindingStore } from "@/state/agent/agentDumpTools";
import { agentMarkStore } from "@/state/agent/agentMarkStore";
import { agentService } from "@/state/agent/agentService";
import { closeLargeDetail, toggleLargeDetail } from "@/state/largeDetailStore";
import { useStore } from "@/state/useStore";
import { EMPTY_DETAIL, field, type NodeDetail } from "@/tools/toolDetail";
import { AgentFindingsPage } from "@/ui/agent/AgentFindingsPage";
import { AgentList } from "@/ui/agent/AgentList";
import { AgentMarksPage, type MarkChoice } from "@/ui/agent/AgentMarksPage";
import { AgentSplit } from "@/ui/agent/AgentSplit";
import {
  AgentTableHead,
  agentRowClass,
  agentTableMinWidth,
  logColumns,
  useAgentColumns,
} from "@/ui/agent/AgentTableHead";
import { AgentToolsPage } from "@/ui/agent/AgentToolsPage";
import { DockPanelHeader } from "@/ui/fragments/DockPanelHeader";
import { AgentGlyph } from "@/ui/shell/ToolbarIcons";
import { ToolDetail } from "@/ui/toolPanel/ToolDetail";

/**
 * Window ▸ Agent: whether the agent service is running, who is connected, and every call an agent
 * has made, newest at the bottom.
 *
 * A panel in the dock, as the help book is: a pill that stays when the panel is folded, and the
 * panel over the panes when it is up, wearing the dock's header (`DockPanelHeader`) — the
 * toolbar button's glyph, the service's state, ⌄ and ✕ — and pulled down by it. One for the app.
 * A reveal the agent asks for folds it, so the bytes it points at are not behind it.
 *
 * The Log and the Tools page have the tool panels' details under their list (`AgentSplit`,
 * `ToolDetail`): Space opens them large on the right of the window, and the arrows still walk
 * the list while they are.
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
 * @upstream-differs a panel in the dock rather than a window of its own
 */
// help: window.agent
export function AgentWindow({ onSettings }: { readonly onSettings: () => void }) {
  const state = useStore(agentService.store);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [page, setPage] = useState<AgentPageName>("log");
  const [chosenMarks, setChosenMarks] = useState<ReadonlySet<string>>(new Set());
  // Where a Shift-click or Shift and an arrow extend the marks chosen from, and the row the arrows
  // move on from: an AppKit table's anchor and its cursor.
  const markAnchor = useRef<string | undefined>(undefined);
  const markCursor = useRef<string | undefined>(undefined);
  const [chosenFinding, setChosenFinding] = useState<string | undefined>(undefined);
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
  const log = useAgentColumns(logColumns, "AgentLogTable");

  // Ticks once a second while a call runs, so its Took cell counts up.
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.elapsedTimer
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.updateElapsedTimer
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.tickElapsed
  const [, setTick] = useState(0);
  const anyRunning = state.log.some(isRunning);
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => setTick((one) => one + 1), 1000);
    return () => window.clearInterval(timer);
  }, [anyRunning]);

  // The log scrolls to each new request as it arrives, when asked to — and to the ones that came
  // while another page was up, when the Log is shown again: a hidden list has no height to scroll.
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.followButton
  // biome-ignore lint/correctness/useExhaustiveDependencies: the log's length and the page are what move it
  useEffect(() => {
    if (follow && page === "log") list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [follow, state.log.length, page]);

  // The keyboard is on the list of the page shown, when the window comes up and when a page is
  // chosen, so the arrow keys walk its rows at once.
  //
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.focusList
  // @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.shownList
  // biome-ignore lint/correctness/useExhaustiveDependencies: the page is what moves it
  useEffect(() => {
    // The list on screen: the log's is kept, hidden, under the other pages.
    const lists = window_.current?.querySelectorAll<HTMLElement>(".agent-log") ?? [];
    [...lists].find((one) => one.offsetParent !== null)?.focus();
  }, [page]);

  /**
   * The rows of the page shown, in the order it shows them, by the id its choice is kept under.
   */
  const rowIds = (): readonly string[] =>
    page === "log"
      ? state.log.map((one) => String(one.id))
      : page === "marks"
        ? marks.map((one) => one.mark.id)
        : page === "findings"
          ? findings.map((one) => one.id)
          : // The Tools page's sections gather the tools by group, which is not the order the
            // catalogue lists them in.
            sectionsOf(agentService.catalogue()).flatMap((section) =>
              section.entries.map((one) => one.tool.name)
            );

  /**
   * Chooses marks as a click does: alone, toggled into the rows chosen, or every row from the
   * anchor to this one.
   *
   * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentMarksTable.selectedIDs
   * @upstream-differs an AppKit table keeps its own selection; the window keeps the page's
   */
  const chooseMark = (id: string, how: MarkChoice): void => {
    const ids = marks.map((one) => one.mark.id);
    const anchor = markAnchor.current;
    markCursor.current = id;
    if (how === "range" && anchor !== undefined && ids.includes(anchor)) {
      const [from, to] = [ids.indexOf(anchor), ids.indexOf(id)].sort((a, b) => a - b);
      setChosenMarks(new Set(ids.slice(from, (to ?? 0) + 1)));
      return;
    }
    markAnchor.current = id;
    if (how === "toggle") {
      setChosenMarks((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setChosenMarks(new Set([id]));
    }
  };

  /**
   * Up and Down move through the rows of the list that has the keyboard, as the arrow keys walk an
   * AppKit table's; with Shift, on the Marks page, they take the rows passed into the choice.
   *
   * @upstream-differs a React table has no row selection of its own; the page's choice is moved
   */
  const walk = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Space opens the details large, or closes them, as it does on a tool panel's table. A page
      // with no details has nothing for it — and the list does not scroll a page for it either.
      // @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailPane.swift#ToolDetailPane.handleKeyWhileShut
      const shown =
        page === "log"
          ? state.log.some((one) => one.id === selected)
          : page === "tools" && chosenTool !== undefined;
      if (
        page === "marks" ||
        page === "findings" ||
        toggleLargeDetail(shown, event.currentTarget)
      ) {
        event.preventDefault();
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const ids = rowIds();
    if (ids.length === 0) return;
    const now =
      page === "log"
        ? selected === undefined
          ? undefined
          : String(selected)
        : page === "marks"
          ? markCursor.current
          : page === "findings"
            ? chosenFinding
            : chosenTool;
    const at = now === undefined ? -1 : ids.indexOf(now);
    const next =
      ids[Math.max(0, Math.min(ids.length - 1, at + (event.key === "ArrowDown" ? 1 : -1)))];
    if (next === undefined) return;
    event.preventDefault();
    // The row walked to stays in view, the large view open or not.
    const walked = event.currentTarget;
    // The first row goes to the top of the list, under nothing: the column titles are stuck over
    // it, and the section heading above it would otherwise stay out of view.
    requestAnimationFrame(() => {
      if (next === ids[0]) walked.scrollTop = 0;
      else
        walked
          .querySelector(`[data-row="${CSS.escape(next)}"]`)
          ?.scrollIntoView({ block: "nearest" });
    });
    if (page === "log") setSelected(Number(next));
    else if (page === "marks") chooseMark(next, event.shiftKey ? "range" : "only");
    else if (page === "findings") setChosenFinding(next);
    else setChosenTool(next);
  };

  const record = state.log.find((one) => one.id === selected);
  const status = agentStatusText({
    available: agentService.isAvailable,
    failure: state.failure,
    running: state.running,
    connections: state.connections,
  });

  const choosePage = (one: AgentPageName) => {
    // The large view is of the page it was opened on.
    closeLargeDetail();
    setPage(one);
  };

  return (
    <section className="agent-window" aria-label={L("Agent")} ref={window_}>
      <DockPanelHeader
        glyph={<AgentGlyph connected={state.connections > 0} />}
        title={L("Agent")}
        closeLabel={L("Close the Agent")}
        onClose={() => agentService.setWindowOpen(false)}
      >
        <span
          className={
            state.failure === undefined ? "agent-window-status" : "agent-window-status agent-bad"
          }
          role="status"
          title={status}
        >
          {status}
        </span>
      </DockPanelHeader>
      <div className="agent-pages">
        <div className="tab-strip" role="tablist" aria-label={L("Page")}>
          {PAGES.map((one) => (
            <button
              key={one}
              type="button"
              role="tab"
              className="tab-strip-item"
              aria-selected={page === one}
              onClick={() => choosePage(one)}
            >
              {pageTitle(one)}
            </button>
          ))}
        </div>
      </div>
      {page === "marks" ? (
        <AgentMarksPage
          marks={marks}
          chosen={chosenMarks}
          onChoose={chooseMark}
          onShow={(id) => void agentService.markTools.show(id)}
          onKeyDown={walk}
        />
      ) : null}
      {page === "findings" ? (
        <AgentFindingsPage
          findings={findings}
          chosen={chosenFinding}
          onChoose={setChosenFinding}
          onShow={(finding) => void agentService.dumpTools.showFinding(finding)}
          onKeyDown={walk}
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
      {/* Kept while another page is up, hidden, so the log keeps its place and follows. */}
      <AgentSplit
        name="log"
        hidden={page !== "log"}
        list={
          <AgentList label={L("Log")} listRef={list} keyTable onKeyDown={walk}>
            <table
              className="agent-table"
              style={{ minWidth: agentTableMinWidth(log.columns, log.kept) }}
            >
              <AgentTableHead
                columns={log.columns}
                kept={log.kept}
                cellClass={(id) => `agent-col-${id}`}
              />
              <tbody>
                {state.log.map((one, index) => (
                  <tr
                    key={one.id}
                    className={agentRowClass(index)}
                    data-row={one.id}
                    aria-selected={one.id === selected}
                    onClick={() => setSelected(one.id)}
                  >
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
                        {logText(one, column)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </AgentList>
        }
        details={
          // help: window.agent.details
          <ToolDetail
            subject={record === undefined ? undefined : String(record.id)}
            detail={record === undefined ? EMPTY_DETAIL : requestDetail(record)}
            placeholder={L("Select a request to see all of it.")}
            onFocusTable={() => list.current?.focus()}
            after={
              record === undefined ? null : (
                <>
                  <h3 className="tool-detail-title">{L("Arguments")}</h3>
                  <pre className="agent-arguments">{argumentsText(record)}</pre>
                </>
              )
            }
          />
        }
      />
      <footer className="agent-window-foot">
        {page === "marks" ? (
          <>
            <button
              type="button"
              disabled={marks.length === 0}
              onClick={() => {
                agentService.markTools.remove(() => true);
                setChosenMarks(new Set());
                markAnchor.current = undefined;
                markCursor.current = undefined;
              }}
            >
              {L("Clear Marks")}
            </button>
            <button
              type="button"
              disabled={!marks.some((one) => chosenMarks.has(one.mark.id))}
              onClick={() => {
                agentService.markTools.remove((one) => chosenMarks.has(one.mark.id));
                setChosenMarks(new Set());
                markAnchor.current = undefined;
                markCursor.current = undefined;
              }}
            >
              {L("Remove Mark")}
            </button>
          </>
        ) : page === "findings" ? (
          <button
            type="button"
            disabled={findings.length === 0}
            onClick={() => {
              setChosenFinding(undefined);
              agentService.dumpTools.clearFindings();
            }}
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
      </footer>
    </section>
  );
}

/**
 * A request as the details list shows it: the tool for a title, and every field whole, the
 * result's sentence in the colour of a problem when it is one.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.showDetails
 */
function requestDetail(record: Parameters<typeof detailFields>[0]): NodeDetail {
  return {
    title: record.tool,
    fields: detailFields(record).map((one) => field(one.label, one.value, one.isProblem)),
    tables: [],
  };
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
