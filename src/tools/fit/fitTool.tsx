import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { FITProblem } from "@/firmware/fit/fitProblem";
import { fitProblemMessage, fitSeverity } from "@/firmware/fit/fitProblem";
import type { FITReport } from "@/firmware/fit/fitTable";
import { firmwareStore, parsePaneFirmware, readPaneFit } from "@/state/firmwareStore";
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
  focusingRow,
  focusingTarget,
  offsetToGoTo,
  rowCommands,
} from "@/tools/fit/fitDisplay";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { openContextMenu } from "@/ui/shell/ContextMenu";

/**
 * FIT Table: what the Firmware Interface Table names, read as things rather
 * than as addresses.
 *
 * The panel is a list of rows and one detail below it, and neither decides
 * anything: `fitDisplay` builds both from the report, and this lays out what it
 * says. What is in a row's right-button menu is the display's answer too — an
 * item that does not apply to the row is absent rather than greyed.
 *
 * Ported from `Modules/FITTool/FITToolUI`.
 */

function FitToolView({ context }: { readonly context: ToolContext }) {
  const pane = context.pane;
  const firmware = useStore(firmwareStore).panes[pane];
  const [report, setReport] = useState<FITReport | undefined>(undefined);
  const [reading, setReading] = useState(true);
  const [focus, setFocus] = useState<number | undefined>(undefined);

  // The image is parsed once for this pane. The table is read against the
  // tree — a row is named by whatever node covers the address it points at —
  // so this has to happen before the reading below, and it is what causes it.
  useEffect(() => {
    void parsePaneFirmware(context.pane);
    // The zones go when the panel does: a gutter still marking a tool nobody
    // has open is a promise about bytes nothing is watching.
    return () => clearZones(context.pane);
  }, [context.pane]);

  // Read the table whenever the tree changes. It changes twice for the ordinary
  // reason — the parse lands, then a branch somebody opened arrives — and a
  // row's name follows it: an address whose branch nobody had opened reads as an
  // address until it is opened. Reading the table does not touch the tree, so
  // this settles rather than chasing itself.
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

  const display: FITDisplay = useMemo(
    () => (report === undefined ? EMPTY_DISPLAY : fitDisplay(report, focus)),
    [report, focus]
  );

  // Whatever the panel has decided is worth drawing, handed to the shell. The
  // zones are the whole of what this tool asks the application to draw.
  useEffect(() => {
    if (display.zones.zones.length === 0) clearZones(context.pane);
    else publishZones(context.pane, display.zones);
  }, [display.zones, context.pane]);

  const run = useCallback(
    (command: FITRowCommand) => {
      switch (command.kind) {
        case "goToOffset": {
          const row = display.rows.find((one) => offsetToGoTo(one) === command.offset);
          const range = row?.targetRange;
          context.reveal(command.offset, range?.end ?? command.offset + 16);
          if (row !== undefined) {
            setFocus(row.index);
            publishZones(context.pane, focusingTarget(display, row.index).zones);
          }
          return;
        }
        case "copyCPUID":
          void navigator.clipboard
            .writeText(command.cpuid)
            .catch(() => context.report("This browser would not let the clipboard be written."));
          return;
        case "fixChecksum": {
          const fix = display.checksumFix;
          if (fix === undefined) return;
          void applyTransaction(pane, fix).then((problem) => {
            if (problem !== undefined) {
              context.report(problem);
              return;
            }
            // Nothing to do afterwards: the bytes changed, and the rule that
            // re-reads a pane a tool has open catches this edit the same way it
            // catches the user's own typing — and its undo.
          });
          return;
        }
        case "replaceMicrocode":
        case "removeMicrocode":
          // The editing half is not in this build yet; the reading half says so
          // rather than offering a command that does nothing.
          context.report("Editing the table is not in this build yet.");
          return;
      }
    },
    [display, context, pane]
  );

  const choose = useCallback(
    (row: FITDisplayRow) => {
      setFocus(row.index);
      publishZones(context.pane, focusingRow(display, row.index).zones);
      // The row's own sixteen bytes: selecting a row is about the row, and
      // going to what it points at is the menu's own command.
      context.reveal(row.rowStart, row.rowStart + 16);
    },
    [display, context]
  );

  if (reading) return <div className="tool-empty">Reading the table…</div>;
  if (report === undefined) {
    return <div className="tool-empty">{firmware?.problem ?? "That image could not be read."}</div>;
  }

  return (
    <div className="fit-tool">
      <p className="fit-summary">{display.summary}</p>

      {display.rows.length === 0 ? null : (
        <div className="fit-rows">
          <table className="panel-table fit-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Type</th>
                <th scope="col">Address</th>
                <th scope="col">Size</th>
                <th scope="col">Rev.</th>
                <th scope="col">What is there</th>
              </tr>
            </thead>
            <tbody>
              {display.rows.map((row) => (
                <tr
                  key={row.index}
                  className="fit-row"
                  data-problem={row.hasProblem ? "" : undefined}
                  data-selected={focus === row.index ? "" : undefined}
                  onClick={() => choose(row)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    choose(row);
                  }}
                  onContextMenu={(event) => {
                    choose(row);
                    openContextMenu(
                      event,
                      rowCommands(row).map((command) => ({
                        label: fitCommandTitle(command),
                        onSelect: () => run(command),
                      }))
                    );
                  }}
                  tabIndex={-1}
                >
                  <td className="fit-number">{displayNumber(row)}</td>
                  <td>{row.typeText}</td>
                  <td className="fit-mono">{row.addressText}</td>
                  <td className="fit-mono">{row.sizeText}</td>
                  <td className="fit-mono">{row.versionText}</td>
                  <td className="fit-target">{row.targetText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {display.detail.title.length === 0 ? null : (
        <div className="fit-detail">
          <h3>{display.detail.title}</h3>
          <dl className="fit-fields">
            {display.detail.fields.map((field) => (
              <Fragment key={field.label}>
                <dt>{field.label}</dt>
                <dd data-problem={field.isProblem ? "" : undefined}>{field.value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}

      {display.problems.length === 0 ? null : (
        <ul className="fit-problems">
          {display.problems.map((problem) => (
            <li key={problemKey(problem)} data-severity={fitSeverity(problem.detail)}>
              <button
                type="button"
                className="fit-problem"
                onClick={() => {
                  if (problem.offset === undefined) return;
                  context.reveal(problem.offset, problem.offset + 1);
                }}
              >
                {fitProblemMessage(problem)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A problem is identified by what it is about, which is where it points. */
const problemKey = (problem: FITProblem): string =>
  `${problem.detail.kind}:${problem.entryIndex ?? -1}:${problem.offset ?? -1}`;

export const fitTool: ToolModule = {
  id: "fit-table",
  title: "FIT Table",
  summary: "The Firmware Interface Table: what it names, and whether it adds up.",
  View: FitToolView,
};
