import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FITProblem } from "@/firmware/fit/fitProblem";
import { fitProblemMessage, fitSeverity } from "@/firmware/fit/fitProblem";
import type { FITReport } from "@/firmware/fit/fitTable";
import { editPaneFit, firmwareStore, parsePaneFirmware, readPaneFit } from "@/state/firmwareStore";
import {
  cancelMicrocodeCatalogue,
  downloadMicrocode,
  loadMicrocodeCatalogue,
  microcodeCatalogueMessage,
  microcodeCatalogueStore,
  microcodeDownloadMessage,
} from "@/state/microcodeCatalogueStore";
import { applyTransaction } from "@/state/toolEdits";
import { useStore } from "@/state/useStore";
import { clearZones, publishZones } from "@/state/zoneStore";
import {
  displayNumber,
  EMPTY_DISPLAY,
  type FITDisplay,
  type FITDisplayRow,
  type FITRowCommand,
  fitCommandTitle,
  fitDisplay,
  focusingTarget,
  focusingZone,
  latestText,
  offsetToGoTo,
  ratingLatest,
  rowCommands,
  rowKey,
  TABLE_ZONE_ID,
} from "@/tools/fit/fitDisplay";
import { MicrocodeForm, type MicrocodeFormStatus } from "@/tools/fit/MicrocodeForm";
import {
  entryFileName,
  type MicrocodeCatalogueEntry,
  type MicrocodeLatest,
} from "@/tools/fit/microcodeCatalogue";
import { cpuidsOf, type MicrocodeFormMode } from "@/tools/fit/microcodeFormModel";
import { pickMicrocode } from "@/tools/fit/pickMicrocode";
import type { NodeDetail } from "@/tools/toolDetail";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { ToolDetail } from "@/ui/toolPanel/ToolDetail";
import type { FitEditRequest } from "@/workers/protocol";

type FitEdit = FitEditRequest["edit"];

/**
 * FIT Table: what the Firmware Interface Table names, read as things rather
 * than as addresses.
 *
 * Laid out as upstream's `FITToolViewController`: the table's name, which a
 * click takes the dump to; its entries above the detail of the row in focus,
 * with a divider between them the reader moves; what is wrong with the table
 * under both, as plain lines; the one button; and the notice line. Neither half
 * decides anything: `fitDisplay` builds the rows, the detail and the zones from
 * the report, and this lays out what it says.
 *
 * Ported from `Modules/FITTool/FITToolUI`.
 */

/**
 * Upstream's columns, their widths laid out for 11-point text and scaled to this
 * panel's 13 pixels. Fixed, and the table scrolls sideways when they do not fit:
 * squeezing "Points at" to whatever is left is how the one column with something
 * to say ends up saying "Microco…".
 */
const COLUMNS = [
  { title: "#", width: 24 },
  { title: "Type", width: 113 },
  { title: "Address", width: 90 },
  { title: "Size", width: 99 },
  { title: "Points at", width: 355 },
] as const;

/** How many findings are shown before the list scrolls. */
const MAX_PROBLEM_ROWS = 8;

const DEFAULT_TABLE_SHARE = 2 / 3;
const TABLE_SHARE_KEY = "byteripper.fitTableShare";

function storedTableShare(): number {
  try {
    const raw = localStorage.getItem(TABLE_SHARE_KEY);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : DEFAULT_TABLE_SHARE;
  } catch {
    return DEFAULT_TABLE_SHARE;
  }
}

/**
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.loadView
 * @upstream-differs a React component: its render and effects are the session and its view controller
 */
function FitToolView({ context }: { readonly context: ToolContext }) {
  const pane = context.pane;
  const firmware = useStore(firmwareStore).panes[pane];
  const catalogue = useStore(microcodeCatalogueStore);
  const [report, setReport] = useState<FITReport | undefined>(undefined);
  const [reading, setReading] = useState(true);
  const [focus, setFocus] = useState<number | undefined>(undefined);
  /** The whole table in focus, as a click on its name puts it. */
  const [tableFocused, setTableFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tableShare, setTableShare] = useState(storedTableShare);
  /** The microcode form, and what it was opened for — or nothing when it is shut. */
  const [form, setForm] = useState<MicrocodeFormMode | undefined>(undefined);
  /** What the form's line says about a fetch the panel is making for it. */
  const [formStatus, setFormStatus] = useState<MicrocodeFormStatus | undefined>(undefined);
  /** The microcode being fetched for the form, so Cancel can stop it. */
  const download = useRef<AbortController | undefined>(undefined);

  // The image is parsed once for this pane. The table is read against the
  // tree — a row is named by whatever node covers the address it points at —
  // so this has to happen before the reading below, and it is what causes it.
  useEffect(() => {
    void parsePaneFirmware(context.pane);
    // The zones go when the panel does: a gutter still marking a tool nobody
    // has open is a promise about bytes nothing is watching.
    return () => clearZones(context.pane);
  }, [context.pane]);

  // The catalogue starts loading when the panel opens, as upstream's does: a
  // row's "latest" verdict waits on it, and the wait is said in the notice line
  // with a cancel.
  useEffect(() => {
    loadMicrocodeCatalogue();
  }, []);

  // Read the table whenever the tree changes. It changes twice for the ordinary
  // reason — the parse lands, then a branch somebody opened arrives — and a
  // row's name follows it.
  const roots = firmware?.roots;
  const status = firmware?.status;
  useEffect(() => {
    if (status !== "ready" || roots === undefined) return;
    let current = true;
    setReading(true);
    void readPaneFit(pane).then((found) => {
      if (!current) return;
      setReport(found);
      setReading(false);
    });
    return () => {
      current = false;
    };
  }, [roots, status, pane]);

  // The verdicts ride on top of the display rather than inside the read: a
  // catalogue landing late must change the marks and nothing else.
  const display: FITDisplay = useMemo(() => {
    if (report === undefined) return EMPTY_DISPLAY;
    const built = ratingLatest(fitDisplay(report, focus), catalogue.entries);
    return tableFocused ? focusingZone(built, TABLE_ZONE_ID) : built;
  }, [report, focus, tableFocused, catalogue.entries]);

  // Whatever the panel has decided is worth drawing, handed to the shell.
  useEffect(() => {
    if (display.zones.zones.length === 0) clearZones(context.pane);
    else publishZones(context.pane, display.zones);
  }, [display.zones, context.pane]);

  /**
   * Plans the change in the worker, writes it through the document, and says
   * what came of it. A refusal is a sentence, not a silence.
   */
  const runEdit = useCallback(
    async (edit: FitEdit) => {
      setBusy(true);
      const done = await editPaneFit(pane, edit);
      setBusy(false);
      context.report(done.problem ?? done.summary);
    },
    [pane, context]
  );

  /**
   * Opens the form on the catalogue, to add. It opens on the whole Intel list,
   * with the image's own CPUIDs one checkbox away. A catalogue that failed to
   * arrive is asked for again: the form is on screen, and the list is what it
   * is for.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.addMicrocode
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onAddMicrocode
   */
  const openAdd = useCallback(() => {
    setFormStatus(undefined);
    setForm({ kind: "add", cpuidsInTheImage: cpuidsOf(display.rows) });
    loadMicrocodeCatalogue();
  }, [display.rows]);

  /**
   * The row's "Replace Microcode": the same form, named for replacing, its
   * narrowing the row's own CPUID. The replacement need not be that CPUID — the
   * row, not the processor, is what changes — so it opens on the whole list.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.replaceMicrocode
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onReplaceMicrocode
   */
  const openReplace = useCallback(
    (index: number) => {
      const row = display.rows.find((one) => one.index === index && !one.isBackup);
      const target = row?.model.target;
      setFormStatus(undefined);
      setForm({
        kind: "replace",
        index,
        targetCpuid: target?.kind === "microcode" ? target.header.processorSignature : undefined,
        targetCpuidText: row?.cpuidText,
      });
      loadMicrocodeCatalogue();
    },
    [display.rows]
  );

  /** @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.onCancel */
  const closeForm = useCallback(() => {
    download.current?.abort();
    download.current = undefined;
    setForm(undefined);
    setFormStatus(undefined);
  }, []);

  /**
   * A microcode picked in the form: fetched — the form says so while it is —
   * then the form closes and the change is planned and written as one step. A
   * fetch that fails says why in the form, which stays up.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.replaceMicrocode
   * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.onAdd
   * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.onReplace
   */
  const pickFromCatalogue = useCallback(
    (entry: MicrocodeCatalogueEntry) => {
      const mode = form;
      if (mode === undefined) return;
      download.current?.abort();
      const controller = new AbortController();
      download.current = controller;
      setFormStatus({ text: `Fetching ${entryFileName(entry)}…`, busy: true, problem: false });
      downloadMicrocode(entry, controller.signal)
        .then((component) => {
          if (download.current !== controller) return;
          closeForm();
          void runEdit(editFor(mode, component));
        })
        .catch((error: unknown) => {
          if (download.current !== controller || controller.signal.aborted) return;
          download.current = undefined;
          setFormStatus({ text: microcodeDownloadMessage(error), busy: false, problem: true });
        });
    },
    [form, closeForm, runEdit]
  );

  /**
   * The way in without a network, and for a microcode the collection does not
   * have. When the form opened to replace a row, the file goes to that row.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/FITAddMicrocodeViewController.swift#FITAddMicrocodeViewController.onChooseFile
   */
  const chooseFileForForm = useCallback(() => {
    const mode = form;
    if (mode === undefined) return;
    void pickMicrocode().then((component) => {
      if (component === undefined) return;
      closeForm();
      void runEdit(editFor(mode, component));
    });
  }, [form, closeForm, runEdit]);

  /**
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.goToOffset
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.copyCPUID
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.removeMicrocode
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.fixChecksum
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onGoToTarget
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onCopyCPUID
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onRemoveMicrocode
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onGoToProblem
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onFixChecksum
   * @upstream-differs one dispatcher over the row's commands, rather than a method per command
   */
  const run = useCallback(
    (command: FITRowCommand) => {
      switch (command.kind) {
        case "goToOffset": {
          const row = display.rows.find((one) => offsetToGoTo(one) === command.offset);
          const range = row?.targetRange;
          context.reveal(command.offset, range?.end ?? command.offset + 16);
          if (row !== undefined) {
            setFocus(rowKey(row));
            setTableFocused(false);
            publishZones(context.pane, focusingTarget(display, rowKey(row)).zones);
          }
          return;
        }
        case "copyCPUID":
          void navigator.clipboard
            .writeText(command.cpuid)
            .then(() => context.report(`CPUID ${command.cpuid} copied.`))
            .catch(() => context.report("This browser would not let the clipboard be written."));
          return;
        case "fixChecksum": {
          const fix = display.checksumFix;
          if (fix === undefined) return;
          void applyTransaction(pane, fix).then((problem) => {
            context.report(
              problem ??
                (fix.writes.length > 1
                  ? "Checksum written, in the Top Swap backup's table too. Undo takes it back."
                  : "Checksum written. Undo takes it back.")
            );
          });
          return;
        }
        case "replaceMicrocode":
          // The microcode is chosen first and the plan made after: a refusal
          // read before choosing anything says nothing about the choice.
          openReplace(command.index);
          return;
        case "removeMicrocode":
          void runEdit({ kind: "remove", index: command.index });
          return;
      }
    },
    [display, context, pane, runEdit, openReplace]
  );

  /**
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onSelect
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.tableViewSelectionDidChange
   */
  const choose = useCallback(
    (row: FITDisplayRow) => {
      setFocus(rowKey(row));
      setTableFocused(false);
      // The row's own sixteen bytes: selecting a row is about the row, and
      // going to what it points at is the double-click and the menu's command.
      context.reveal(row.rowStart, row.rowStart + 16);
    },
    [context]
  );

  /**
   * The table's name: the dump goes to the whole table, and no row is in focus.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.showTable
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.onSelectTable
   */
  const chooseTable = useCallback(() => {
    const table = display.zones.zones.find((zone) => zone.id === TABLE_ZONE_ID);
    if (table === undefined) return;
    setFocus(undefined);
    setTableFocused(true);
    context.reveal(table.start, table.end);
  }, [display.zones, context]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const at = display.rows.findIndex((row) => rowKey(row) === focus);
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step !== 0) {
        const next =
          display.rows[at < 0 ? 0 : Math.min(display.rows.length - 1, Math.max(0, at + step))];
        if (next !== undefined) choose(next);
      } else if (event.key === "Enter") {
        const row = display.rows[at];
        if (row !== undefined) run({ kind: "goToOffset", offset: offsetToGoTo(row) });
      } else {
        return;
      }
      event.preventDefault();
    },
    [display.rows, focus, choose, run]
  );

  const changeTableShare = useCallback((share: number) => {
    setTableShare(share);
    try {
      localStorage.setItem(TABLE_SHARE_KEY, String(share));
    } catch {
      // A private window may refuse to store it; the split still applies here.
    }
  }, []);

  const message = microcodeCatalogueMessage(catalogue);
  // The form's line while its list is not there yet: the listing being fetched,
  // or why it could not be — red, because the form is where the user is looking.
  const formLine: MicrocodeFormStatus | undefined =
    formStatus ??
    (catalogue.entries.length > 0
      ? undefined
      : catalogue.status === "loading"
        ? { text: "Fetching the list from github.com…", busy: true, problem: false }
        : message !== undefined
          ? { text: message, busy: false, problem: true }
          : undefined);
  const detail: NodeDetail = {
    title: display.detail.title,
    fields: display.detail.fields,
    tables: [],
  };

  if (reading) return <div className="tool-empty">Reading…</div>;
  if (report === undefined) {
    return <div className="tool-empty">{firmware?.problem ?? "That image could not be read."}</div>;
  }

  return (
    <div className="fit-tool">
      <button
        type="button"
        className="fit-summary"
        data-selected={tableFocused ? "" : undefined}
        title="Show the whole table in the dump"
        onClick={chooseTable}
      >
        {display.summary}
      </button>

      <div
        className="tool-split"
        style={{
          gridTemplateRows: `minmax(0, ${tableShare}fr) 6px minmax(0, ${1 - tableShare}fr)`,
        }}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: the grid role sits on the scroller that takes the keyboard; a <table> may not carry it */}
        <div
          className="fit-entries"
          role="grid"
          aria-label="FIT entries"
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <table className="fit-table">
            <colgroup>
              {COLUMNS.map((column) => (
                <col key={column.title} style={{ width: column.width }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column.title} scope="col" className="fit-head">
                    {column.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {display.rows.map((row, position) => (
                <Fragment key={rowKey(row)}>
                  {position === display.backupStart ? (
                    // The Top Swap backup's copy of the table follows under a
                    // heading of its own, which cannot be selected.
                    <tr className="fit-backup-heading">
                      <th colSpan={COLUMNS.length} scope="colgroup">
                        {display.backupHeading}
                      </th>
                    </tr>
                  ) : null}
                  <tr
                    className="fit-row"
                    data-backup={row.isBackup ? "" : undefined}
                    data-selected={!tableFocused && focus === rowKey(row) ? "" : undefined}
                    onClick={() => choose(row)}
                    onDoubleClick={() => run({ kind: "goToOffset", offset: offsetToGoTo(row) })}
                    onContextMenu={(event) => {
                      choose(row);
                      openContextMenu(
                        event,
                        rowCommands(row).map((command) => ({
                          label: fitCommandTitle(command),
                          // A command that changes the table stands down while
                          // an edit is being planned — greyed, not gone.
                          disabled:
                            busy &&
                            (command.kind === "replaceMicrocode" ||
                              command.kind === "removeMicrocode" ||
                              command.kind === "fixChecksum"),
                          onSelect: () => run(command),
                        }))
                      );
                    }}
                  >
                    <td className="fit-number">{displayNumber(row)}</td>
                    <td title={`Version ${row.versionText}`}>
                      <span className="fit-type">
                        <LatestMark state={row.latestState} />
                        {row.hasProblem ? (
                          <span
                            className="tool-problem"
                            role="img"
                            aria-label="Invalid"
                            title={problemText(display, row)}
                          >
                            !
                          </span>
                        ) : null}
                        <span className="fit-type-text">{row.typeText}</span>
                      </span>
                    </td>
                    <td className="fit-number">{row.addressText}</td>
                    <td className="fit-number">{row.sizeText}</td>
                    <td title={row.targetText.length === 0 ? undefined : row.targetText}>
                      {row.targetText}
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <PaneDivider
          layout="stacked"
          fraction={tableShare}
          onChange={changeTableShare}
          initial={DEFAULT_TABLE_SHARE}
          label="Resize the detail"
        />

        <ToolDetail
          subject={focus === undefined || tableFocused ? undefined : String(focus)}
          detail={detail}
          placeholder="Select a row to see what it is."
        />
      </div>

      {/* The findings as plain lines under the table, each wrapped onto as many
          lines as it takes, as tall as they are up to eight lines' worth, and
          absent when the table checks out. A double-click takes the dump to
          what a line is about. */}
      {display.problems.length === 0 ? null : (
        <ul className="fit-problems" style={{ maxHeight: `${MAX_PROBLEM_ROWS * 22}px` }}>
          {display.problems.map((problem) => (
            <li
              key={`${problem.inBackup === true ? "backup:" : ""}${problemKey(problem)}`}
              data-severity={fitSeverity(problem.detail)}
              onDoubleClick={() => {
                if (problem.offset === undefined) return;
                context.reveal(problem.offset, problem.offset + 1);
              }}
            >
              {fitProblemMessage(problem)}
            </li>
          ))}
        </ul>
      )}

      <div className="fit-buttons">
        <button
          type="button"
          className="toolbar-button"
          disabled={busy || display.rows.length === 0}
          onClick={openAdd}
          title="Put a microcode in the image and name it in the table"
        >
          Add Microcode…
        </button>
      </div>

      <footer className="tool-notice">
        {busy ? (
          <>
            <span>Planning the change…</span>
            <progress />
          </>
        ) : catalogue.status === "loading" ? (
          <>
            <span>Checking the microcode catalogue…</span>
            <button
              type="button"
              className="toolbar-button is-quiet"
              onClick={cancelMicrocodeCatalogue}
            >
              Cancel
            </button>
          </>
        ) : message !== undefined ? (
          // Named rather than printed as "it failed": being rate-limited is
          // waited out, being offline means yesterday's copy is the best there
          // is, and a 404 means no amount of waiting helps.
          <>
            <span className="fit-catalogue-problem" data-kind={catalogue.failure?.kind}>
              {message}
            </span>
            <button
              type="button"
              className="toolbar-button is-quiet"
              onClick={() => loadMicrocodeCatalogue()}
            >
              Try again
            </button>
          </>
        ) : null}
      </footer>

      {form === undefined ? null : (
        <MicrocodeForm
          mode={form}
          entries={catalogue.entries}
          status={formLine}
          onPick={pickFromCatalogue}
          onChooseFile={chooseFileForForm}
          onCancel={closeForm}
        />
      )}
    </div>
  );
}

/** What a microcode chosen in the form does: goes into the row, or into the table. */
function editFor(mode: MicrocodeFormMode, component: Uint8Array): FitEdit {
  return mode.kind === "replace"
    ? { kind: "replaceAt", index: mode.index, component }
    : { kind: "addOrReplace", component };
}

/**
 * How a row's microcode stands against the catalogue, ahead of its type:
 * upstream's green seal, orange triangle or orange question mark — a glyph *and*
 * a colour — and nothing where there is no basis for a verdict.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.marks
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.verdict
 * @upstream-differs a row carries the latest verdict and the validator's problem; the Boot Guard tints and badges are not ported
 */
function LatestMark({ state }: { readonly state: MicrocodeLatest }) {
  if (state.kind === "notRated") return null;
  const path =
    state.kind === "latest"
      ? "M8 1.5l1.6 1.2 2-.1.6 1.9 1.6 1.2-.7 1.9.7 1.9-1.6 1.2-.6 1.9-2-.1L8 12.5l-1.6-1.2-2 .1-.6-1.9L2.2 8.3l.7-1.9-.7-1.9 1.6-1.2.6-1.9 2 .1ZM5.6 7.4l1.7 1.7 3.2-3.3"
      : state.kind === "outdated"
        ? "M8 2 14.5 13.5h-13ZM8 6.2v3.6M8 11.6v.1"
        : "M8 1.8a6.2 6.2 0 1 1 0 12.4A6.2 6.2 0 0 1 8 1.8ZM6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4M8 11.6v.1";
  return (
    <svg
      className="fit-latest"
      data-state={state.kind}
      viewBox="0 0 16 16"
      role="img"
      aria-label={latestText(state)}
    >
      <title>{latestText(state)}</title>
      <path d={path} />
    </svg>
  );
}

/**
 * What the list below says about one row, for the mark where the row sits.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.marks
 */
function problemText(display: FITDisplay, row: FITDisplayRow): string | undefined {
  // A row wears its own copy's problems: the backup's rows the backup's.
  const messages = display.problems
    .filter(
      (problem) => problem.entryIndex === row.index && (problem.inBackup === true) === row.isBackup
    )
    .map(fitProblemMessage);
  return messages.length === 0 ? undefined : messages.join("\n");
}

/** A problem is identified by what it is about, which is where it points. */
const problemKey = (problem: FITProblem): string =>
  `${problem.detail.kind}:${problem.entryIndex ?? -1}:${problem.offset ?? -1}`;

/**
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolModule
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolModule.identifier
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolModule.title
 */
export const fitTool: ToolModule = {
  id: "dev.maxik.tool.fit",
  title: "FIT Table",
  summary: "The Firmware Interface Table: what it names, and whether it adds up.",
  View: FitToolView,
};
