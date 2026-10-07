import { useEffect, useState } from "react";
import { L } from "@/core/localization/localization";
import {
  isIdentical,
  nameText,
  stateText,
  summary,
  type UEFIUpdateComparison,
  writesByDefault,
} from "@/tools/uefi/uefiUpdateComparison";
import { Dialog } from "@/ui/dialogs/Dialog";

/**
 * The dialog over a dump compared with a vendor's update file: one row per part the file's
 * table names, what state it is in, and a tick for each part that differs, saying whether
 * Write puts the update's bytes there.
 *
 * It decides nothing — the comparison, the defaults and the transaction are
 * `uefiUpdateComparison`'s, which is tested without a window. What it owns is the ticks the
 * user changes.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIUpdateViewController.swift#UEFIUpdateViewController
 * @upstream-differs a modal `<dialog>` where upstream is a sheet; and no read-only state of a file, which the
 * browser has none of, so Write is always offered where there is something ticked
 */
export interface UefiUpdateDialogProps {
  readonly comparison: UEFIUpdateComparison;
  readonly fileName: string;
  readonly blockCount: number;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIUpdateViewController.swift#UEFIUpdateViewController.onWrite */
  readonly onWrite: (chosen: ReadonlySet<number>) => void;
  /** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIUpdateViewController.swift#UEFIUpdateViewController.onCancel */
  readonly onCancel: () => void;
  /**
   * A row was selected: the session shows that part in the dump.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIUpdateViewController.swift#UEFIUpdateViewController.onSelectRow
   */
  readonly onSelectRow: (row: number | undefined) => void;
}

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIUpdateViewController.swift#UEFIUpdateViewController.loadView */
export function UefiUpdateDialog({
  comparison,
  fileName,
  blockCount,
  onWrite,
  onCancel,
  onSelectRow,
}: UefiUpdateDialogProps) {
  /** The rows Write will write. */
  const [chosen, setChosen] = useState<ReadonlySet<number>>(
    () => new Set(comparison.rows.flatMap((row, index) => (writesByDefault(row) ? [index] : [])))
  );
  const [selected, setSelected] = useState<number | undefined>(undefined);

  useEffect(() => {
    onSelectRow(selected);
  }, [selected, onSelectRow]);

  /**
   * Ticks or unticks a row, as its checkbox does.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIUpdateViewController.swift#UEFIUpdateViewController.setChosen
   */
  const setRow = (index: number, on: boolean) => {
    const row = comparison.rows[index];
    if (row === undefined || isIdentical(row)) return;
    const next = new Set(chosen);
    if (on) next.add(index);
    else next.delete(index);
    setChosen(next);
  };

  const { region } = comparison;
  return (
    <Dialog
      open
      title={L("Compare with PFAT Update File")}
      onClose={onCancel}
      className="update-dialog"
    >
      <div className="dialog-body">
        <p className="update-note">
          {L(
            "%1$@: AMI BIOS Guard update for %2$@, %3$@ blocks. BIOS region of this dump: %4$@–%5$@.",
            fileName,
            comparison.platform,
            blockCount,
            hex(region.start),
            hex(region.end - 1)
          )}
        </p>
        <p className="update-note update-scope">
          {L(
            "Only the BIOS region is compared. An update file carries no descriptor, and an ME image it may carry is an update image, not the region."
          )}
        </p>
        <div className="segments-scroll update-scroll">
          <table className="panel-table update-table">
            <thead>
              <tr>
                <th scope="col">{L("Write", { context: "action" })}</th>
                <th scope="col">{L("Name")}</th>
                <th scope="col">{L("Offset")}</th>
                <th scope="col">{L("Size")}</th>
                <th scope="col">{L("State")}</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row, index) => (
                <tr
                  key={`${row.range.start}`}
                  tabIndex={0}
                  data-selected={selected === index ? "" : undefined}
                  onPointerDown={() => setSelected(index)}
                  onFocus={() => setSelected(index)}
                >
                  <td>
                    {isIdentical(row) ? null : (
                      <input
                        type="checkbox"
                        checked={chosen.has(index)}
                        title={L("Write this part from the update file")}
                        aria-label={L("Write this part from the update file")}
                        onChange={(event) => setRow(index, event.target.checked)}
                      />
                    )}
                  </td>
                  <td>{nameText(row)}</td>
                  <td className="update-number">{hex(row.range.start)}</td>
                  <td className="update-number">{hex(row.range.end - row.range.start)}</td>
                  <td
                    data-tone={isIdentical(row) ? "quiet" : row.isBoardData ? "caution" : "plain"}
                  >
                    {stateText(row)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="update-note update-summary">{summary(comparison, chosen)}</p>
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onCancel}>
            {L("Cancel")}
          </button>
          <button
            type="button"
            className="toolbar-button"
            disabled={chosen.size === 0}
            title={L("Write the ticked parts from the update file into the dump, as one undo step")}
            onClick={() => onWrite(chosen)}
          >
            {L("Write", { context: "action" })}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
