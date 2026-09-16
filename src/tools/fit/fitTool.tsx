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
  keepingTheOutline,
  offsetToGoTo,
  ratingLatest,
  rowCommands,
  rowKey,
  TABLE_ZONE_ID,
  zoneToFocus,
} from "@/tools/fit/fitDisplay";
import { FIT_ROW_MARKS, fitRowMarks, verdict } from "@/tools/fit/fitRowMarks";
import { MicrocodeForm, type MicrocodeFormStatus } from "@/tools/fit/MicrocodeForm";
import { entryFileName, type MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";
import { cpuidsOf, type MicrocodeFormMode } from "@/tools/fit/microcodeFormModel";
import { pickMicrocode } from "@/tools/fit/pickMicrocode";
import type { NodeDetail } from "@/tools/toolDetail";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import type { ToolRowMarks } from "@/tools/toolRowMarks";
import { openContextMenu } from "@/ui/shell/ContextMenu";
import { PaneDivider } from "@/ui/shell/PaneDivider";
import { RowMarksIcons, rowMarkTitle, rowPaintAttrs } from "@/ui/toolPanel/RowMarks";
import { ToolDetail } from "@/ui/toolPanel/ToolDetail";
import { ToolRowMarksLegend, useShowsMarkings } from "@/ui/toolPanel/ToolRowMarksLegend";
import type { FitEditRequest, WireNode } from "@/workers/protocol";

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

/**
 * The panel's name in the legend's remembered states. Upstream's, so a reader
 * who has made the same choice in both editions keeps it.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.legend
 */
const FIT_PANEL = "FIT";

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
  const [focus, setFocus] = useState<number | undefined>(undefined);
  /**
   * The zone the outline is on — the row the user picked, what that row points
   * at, or the table itself.
   *
   * Kept beside `focus` because the row alone does not say which of them it is:
   * "go to the offset" moves the outline from a row to the component it points
   * at, and both are the same row's. Every display but the ones the three
   * setters below build carries the *row* in focus, so a re-read read from the
   * row key alone would slide the outline back — and the dump, which the shell
   * keeps bringing to whatever is in focus, would follow it out of what the
   * user was looking at.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.focusZone
   */
  const [focusZone, setFocusZone] = useState<string | undefined>(undefined);
  /** The whole table in focus, as a click on its name puts it. */
  const tableFocused = focusZone === TABLE_ZONE_ID;
  const [busy, setBusy] = useState(false);
  const [tableShare, setTableShare] = useState(storedTableShare);
  /**
   * Whether the table paints its rows — the legend's Show Markings switch,
   * which is remembered beside the legend's own state.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.legend
   */
  const [showsMarkings, setShowsMarkings] = useShowsMarkings(FIT_PANEL);
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
  /**
   * Which tree the report in hand was read against.
   *
   * The tree is the table's other half — a row is named by whatever node covers
   * the address it points at — so a report read against the tree before is not
   * an older table, it is a wrong one. Keeping the tree rather than a flag is
   * what lets the render below tell the two apart without waiting for an
   * effect: the effect that re-reads runs *after* the render that first carries
   * the new tree, and a flag set there would leave that one render painting the
   * table of the bytes before.
   */
  const readAgainst = useRef<readonly WireNode[] | undefined>(undefined);
  useEffect(() => {
    if (status !== "ready" || roots === undefined) return;
    let current = true;
    void readPaneFit(pane).then((found) => {
      if (!current) return;
      readAgainst.current = roots;
      setReport(found);
    });
    return () => {
      current = false;
    };
  }, [roots, status, pane]);

  // The verdicts ride on top of the display rather than inside the read: a
  // catalogue landing late must change the marks and nothing else. The outline
  // is put back where the user left it last, since a display built from the row
  // key alone would slide it back to the row on every re-read.
  const display: FITDisplay = useMemo(() => {
    if (report === undefined) return EMPTY_DISPLAY;
    const built = ratingLatest(fitDisplay(report, focus), catalogue.entries);
    return keepingTheOutline(built, focusZone);
  }, [report, focus, focusZone, catalogue.entries]);

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
      // Exactly one of the two is set: the plan's refusal, or what the write
      // did. Nothing at all when it landed and had nothing to add.
      const said = done.problem ?? done.summary;
      if (said !== undefined) context.report(said);
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
            // Nothing is *selected*: an active outline says "this is what you
            // asked for" without touching a selection the user may be
            // part-way through. The publish that moves it is the effect's, off
            // the display built from these two.
            setFocus(rowKey(row));
            setFocusZone(zoneToFocus(row));
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
      setFocusZone(row.zoneId);
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
    setFocusZone(TABLE_ZONE_ID);
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

  // The image the table is read against is the pane's, and it may never
  // arrive: a parse can fail, and a panel that waited for a tree that is not
  // coming would wait for ever while its own reason for stopping sat unread
  // one branch below. So the failure is asked about first, and the wait after
  // it — which is upstream's order too, where a tree that cannot be got ends
  // the reading, empties the display and says so.
  // @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.reparse
  // @upstream-differs upstream's "Reading…" is a line in the notice row with an
  // indeterminate bar beside it, and the table's own empty display stays
  // standing behind them; here the panel has nothing to lay out until the table
  // is read, so the wait is the panel — and it carries the parse's fraction,
  // the line the UEFI panel shows while it reads.
  const imageStatus = firmware?.status;
  if (imageStatus === "failed") {
    return <div className="tool-empty">{firmware?.problem ?? "Could not read the file."}</div>;
  }
  // Two waits wear the one line upstream gives them: the pane's parse of the
  // image, and the table's own read against the tree that parse left. Both are
  // asked about, since either can be the one running — and the first is the one
  // with something to measure, `fraction` being the parse's own count.
  //
  // The second is asked as provenance rather than as a flag: the table in hand
  // is the table of this tree or it is nothing, which is the one test that also
  // covers a tree that arrived without the read having started — the edit that
  // re-parses the pane does exactly that, and the render in between would
  // otherwise paint the table of the bytes before.
  const readingImage = imageStatus !== "ready";
  const readingTable = report === undefined || readAgainst.current !== roots;
  if (readingImage || readingTable) {
    return (
      <div className="tool-empty">
        <p>Reading…</p>
        {/* Only while the image is coming: once it is in hand the fraction is
            spent, and the table's own read is the few lookups below. */}
        {readingImage ? <progress value={firmware?.fraction ?? 0} max={1} /> : null}
      </div>
    );
  }
  if (report === undefined) {
    return <div className="tool-empty">{firmware?.problem ?? "That image could not be read."}</div>;
  }

  /** What a row of this display wears, decided once for the table below. */
  const marksOf = rowMarksOf(display);

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
        {/* The entries and their legend are one pane of the split: the legend
            takes its room at the pane's bottom edge and the table gives it up,
            so it never covers a row (`Design/ROW_MARKS.md` §6). */}
        <div className="tool-marked-list">
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
                      className="fit-row tool-marked-row"
                      data-backup={row.isBackup ? "" : undefined}
                      data-selected={!tableFocused && focus === rowKey(row) ? "" : undefined}
                      // The row's background in words, so nothing it says is said
                      // by colour alone (`Design/ROW_MARKS.md` §2). The Type cell
                      // keeps the version, which is its own tooltip.
                      title={rowMarkTitle(marksOf(row))}
                      {...rowPaintAttrs(marksOf(row), showsMarkings)}
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
                          <RowMarksIcons
                            marks={marksOf(row)}
                            verdict={verdict(row.latestState)}
                            size={12}
                          />
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

          <ToolRowMarksLegend
            panel={FIT_PANEL}
            marks={FIT_ROW_MARKS.legendMarks}
            showsMarkings={showsMarkings}
            onShowsMarkingsChange={setShowsMarkings}
          />
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
 * What a row wears besides its text, decided in the pure marks of the table
 * (`Design/ROW_MARKS.md` §5.2): the validator's problems for that row and the
 * badge on a component the IBB is checked against. The verdict is the table's
 * own and is passed to `RowMarksIcons` beside it, in the catalogue's order.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITToolViewController.marks(ofRow:)
 * @upstream Modules/FITTool/Sources/FITTool/FITRowMarks.swift#FITRowMarks.marks
 */
function rowMarksOf(display: FITDisplay): (row: FITDisplayRow) => ToolRowMarks {
  return (row) => fitRowMarks(row, display.problems);
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
