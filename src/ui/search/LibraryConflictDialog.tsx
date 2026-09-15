import { useEffect, useState } from "react";
import type { LibraryConflict, LibraryResolution } from "@/core/search/patternLibrary";
import { conflictId } from "@/core/sync/syncMerge";
import { Dialog } from "@/ui/dialogs/Dialog";
import {
  answeringAll,
  type ConflictWording,
  conflictSubject,
  conflictTitle,
  ourSide,
  resolutionChoices,
  resolutionTitles,
  theirSide,
} from "@/ui/search/libraryConflicts";

/**
 * The questions a merge could not answer, put to the user (§11).
 *
 * One row per conflict, not one dialog per file, and two bulk answers for the
 * common case where one side was simply the right one. Every row starts on this
 * browser's version — the state already shown — so applying without touching a
 * row changes nothing. Nothing is written until the dialog is answered: a
 * half-merged list must never be saved.
 *
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.init
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.loadView
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.sheetInset
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.makeTable
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.table
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.ColumnID
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.ColumnID.pattern
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.ColumnID.ours
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.ColumnID.theirs
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.ColumnID.choice
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.numberOfRows
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.tableView
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.label
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.cell
 * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.makeBulkRow
 * @upstream-differs a table in a dialog; the other side is named by `wording`, and what the second button does is the owner's — an import is cancelled whole, where the folder's questions wait for later
 */
export function LibraryConflictDialog({
  conflicts,
  wording,
  cancelTitle,
  onResolve,
  onCancel,
}: {
  /**
   * What is being asked, or `undefined` while nothing is.
   *
   * @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.conflicts
   */
  readonly conflicts: readonly LibraryConflict[] | undefined;
  readonly wording: ConflictWording;
  readonly cancelTitle: string;
  /** @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.onResolve */
  readonly onResolve: (answers: ReadonlyMap<string, LibraryResolution>) => void;
  readonly onCancel: () => void;
}) {
  /** @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.answers */
  const [answers, setAnswers] = useState<ReadonlyMap<string, LibraryResolution>>(new Map());

  useEffect(() => {
    if (conflicts !== undefined) setAnswers(answeringAll(conflicts, "keepOurs"));
  }, [conflicts]);

  const list = conflicts ?? [];

  /** @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.handleSubmit */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onResolve(answers);
  };

  return (
    <Dialog
      open={conflicts !== undefined}
      title={conflictTitle(list.length)}
      onClose={onCancel}
      className="conflict-dialog"
    >
      <form className="dialog-body" onSubmit={submit}>
        <p className="dialog-message">{wording.message}</p>
        <div className="conflict-scroll">
          <table className="panel-table conflict-table">
            <caption className="visually-hidden">Conflicting changes</caption>
            <thead>
              <tr>
                <th scope="col">Entry</th>
                <th scope="col">{wording.ours}</th>
                <th scope="col">{wording.theirs}</th>
                <th scope="col">Keep</th>
              </tr>
            </thead>
            <tbody>
              {list.map((conflict) => {
                const id = conflictId(conflict);
                const subject = conflictSubject(conflict);
                const titles = resolutionTitles(conflict, wording);
                return (
                  <tr key={`${conflict.kind}-${id}`}>
                    <td>{subject}</td>
                    <td>{ourSide(conflict)}</td>
                    <td>{theirSide(conflict, wording)}</td>
                    <td>
                      <select
                        className="settings-select"
                        aria-label={`Keep for ${subject}`}
                        value={answers.get(id) ?? "keepOurs"}
                        // @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.choiceChanged
                        onChange={(event) => {
                          const answer = event.target.value as LibraryResolution;
                          setAnswers((current) => new Map(current).set(id, answer));
                        }}
                      >
                        {resolutionChoices(conflict).map((choice, index) => (
                          <option key={choice} value={choice}>
                            {titles[index]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="conflict-bulk">
          <button
            type="button"
            className="toolbar-button"
            // @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.keepAllMine
            onClick={() => setAnswers(answeringAll(list, "keepOurs"))}
          >
            Keep All Mine
          </button>
          <button
            type="button"
            className="toolbar-button"
            // @upstream ByteRipperApp/Search/LibraryConflictSheetController.swift#LibraryConflictSheetController.keepAllTheirs
            onClick={() => setAnswers(answeringAll(list, "keepTheirs"))}
          >
            Keep All Theirs
          </button>
        </div>
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onCancel}>
            {cancelTitle}
          </button>
          <button type="submit" className="toolbar-button">
            Apply
          </button>
        </div>
      </form>
    </Dialog>
  );
}
