import { useEffect, useRef, useState } from "react";
import { L } from "@/core/localization/localization";
import type { LibraryConflict } from "@/core/search/patternLibrary";
import { encodingTitle, SEARCH_ENCODINGS, type SearchEncoding } from "@/core/search/searchPattern";
import type { SearchPatternEntry } from "@/core/search/searchPatternEntry";
import type { FolderAdoption } from "@/core/sync/folderSync";
import { conflictId } from "@/core/sync/syncMerge";
import type { FilePickerType } from "@/platform/files/capabilities";
import { openFiles } from "@/platform/files/openFile";
import { saveText } from "@/platform/files/textSave";
import {
  abandonImport,
  adoptLibraryFile,
  allowFolderAccess,
  answerImport,
  canKeepLibraryFolder,
  chooseLibraryFolder,
  exportFavorites,
  type FavoritesState,
  type FolderLibraryFile,
  favoritesStore,
  folderLibraries,
  getFavoritesFromFolder,
  importFavorites,
  keepFavoritesInBrowser,
  type LibraryFolder,
  publishFavoritesTo,
  removeOwnFileFrom,
  replaceFavorites,
  resolveFavorites,
  syncProblem,
  whyNoLibraryFolder,
} from "@/state/favoritesStore";
import { useStore } from "@/state/useStore";
import { Dialog } from "@/ui/dialogs/Dialog";
import { LibraryConflictDialog } from "@/ui/search/LibraryConflictDialog";
import { IMPORT_WORDING, SHARED_WORDING } from "@/ui/search/libraryConflicts";
import {
  commitCase,
  commitEncoding,
  commitName,
  commitPattern,
  differs,
  hasDraft,
  importReport,
  moveRow,
  removeRow,
  storedRows,
  type TableEdit,
  type TabReport,
  withDraft,
} from "@/ui/settings/favoritesTable";

/** The library file, as the pickers offer it — in the language of the moment. */
const libraryFile = (): FilePickerType => ({
  description: L("ByteRipper pattern library"),
  accept: { "application/json": [".json"] },
});

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.times */
const time = (milliseconds: number) =>
  new Date(milliseconds).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const questionsKey = (conflicts: readonly LibraryConflict[]) =>
  conflicts.map((conflict) => `${conflict.kind}:${conflictId(conflict)}`).join(",");

/**
 * Where the library lives, said in one line: this browser, or a folder — and,
 * for a folder, when the two last agreed, or what stands in the way.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.refreshLocation
 */
export function locationLine(state: FavoritesState): {
  readonly text: string;
  readonly problem: boolean;
} {
  const problem = syncProblem(state);
  const count = state.conflicts.length;
  if (count > 0) {
    const named = problem ?? L("conflicting changes");
    if (state.answerDidNotTake) {
      return {
        text: L(
          "The shared library changed while you were answering — %1$@ to look at again",
          named
        ),
        problem: true,
      };
    }
    let text =
      count === 1
        ? L("%1$@ — the library is read-only until it is answered", named)
        : L("%1$@ — the library is read-only until they are answered", named);
    if (state.folder !== undefined && state.folder.access !== "granted") {
      text += L(". This visit may not write to the library folder — Allow Access… first");
    } else if (state.publishError !== undefined) {
      text += L(". Answering cannot be published: %1$@", state.publishError);
    }
    return { text, problem: true };
  }
  if (state.folder === undefined) {
    return { text: L("Pattern library: in this browser only"), problem: false };
  }
  const text = L("Library folder: %1$@", state.folder.name);
  if (state.folder.access === "prompt") {
    return {
      text:
        text +
        L(" — this visit has not been allowed to write there yet; Allow Access… to carry on"),
      problem: true,
    };
  }
  if (state.folder.access === "denied") {
    return {
      text:
        text +
        L(" — the browser refused to let the app write there; choose the folder again with Move…"),
      problem: true,
    };
  }
  if (state.publishError !== undefined) {
    const last =
      state.lastPublished === undefined
        ? ""
        : L(" (last published %1$@)", time(state.lastPublished));
    return {
      text: text + L(" — cannot be published: %1$@", state.publishError) + last,
      problem: true,
    };
  }
  return {
    text:
      state.lastPublished === undefined
        ? text + L(" — not published yet")
        : text + L(" — published %1$@", time(state.lastPublished)),
    problem: false,
  };
}

/**
 * The Search Patterns tab (§11): the named patterns the user keeps, in the order they
 * keep them in, and where the library lives.
 *
 * Every other tab applies live, so this one does too — a commit writes the
 * store, and the find bar's menu reads it. While a merge has a question
 * outstanding the library is read-only: nothing may be written until the user
 * answers, so the table stops offering to change it, and still shows it.
 *
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.rows
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.table
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.addButton
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.removeButton
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.messageLabel
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.loadView
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.makeTable
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.makeFooter
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.show
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.reloadUnlessDrafting
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.refreshTable
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.pendingRefresh
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.isEditingACell
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.updateRemoveButton
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.tableViewSelectionDidChange
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.beginEditing
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.makeLocationRow
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.locationLabel
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.moveButton
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.keepHereButton
 * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.resolveButton
 * @upstream-differs rows of inputs, reordered by dragging a row or with Alt+↑/↓; This Was Me is offered for an earlier file of this browser's, and nothing else in the folder is shown; Export and Import, and a read-only fetch from a folder, are the web's own
 */
// help: settings.favorites
export function FavoritesTab() {
  const library = useStore(favoritesStore);
  const { favorites, pendingImport, conflicts, folder } = library;
  const readOnly = conflicts.length > 0;
  const keepsFolder = canKeepLibraryFolder();
  /** Why a folder cannot be kept here, when it is something the user can change. */
  const whyNoFolder = keepsFolder ? undefined : whyNoLibraryFolder();
  const [rows, setRows] = useState<readonly SearchPatternEntry[]>(favorites);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  /** What the last command did, when it did not go wrong. */
  const [report, setReport] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const [dropAbove, setDropAbove] = useState<number | undefined>(undefined);
  /** A folder that already holds a library, waiting for how to join it. */
  const [joining, setJoining] = useState<
    { readonly folder: LibraryFolder; readonly count: number } | undefined
  >(undefined);
  /** The folder the library has just left, whose copy of this browser's file may go. */
  const [leftBehind, setLeftBehind] = useState<LibraryFolder | undefined>(undefined);
  /**
   * The questions the resolver is asking, while it is open.
   *
   * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.openResolver
   */
  const [asked, setAsked] = useState<readonly LibraryConflict[] | undefined>(undefined);
  const answeringHere = useRef(false);
  const [files, setFiles] = useState<readonly FolderLibraryFile[]>([]);
  const editing = useRef(false);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const focusName = useRef<string | undefined>(undefined);

  // The store is not only written from here: the find bar keeps patterns too,
  // and the folder brings other machines'. A row being typed into, or a draft,
  // is not taken away for it.
  useEffect(() => {
    if (editing.current || hasDraft(rows)) return;
    if (differs(rows, favorites)) setRows(favorites);
  }, [favorites, rows]);

  useEffect(() => {
    const id = focusName.current;
    if (id === undefined) return;
    focusName.current = undefined;
    nameInputs.current.get(id)?.focus();
  });

  // What is in the folder, looked at again whenever the library and the folder agree anew.
  const folderName = folder?.name;
  const folderAccess = folder?.access;
  const published = library.lastPublished;
  const deviceId = library.device.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a publish and a change of identity are what change the files in the folder, so they are the reasons to look again
  useEffect(() => {
    if (folderName === undefined || folderAccess !== "granted") {
      setFiles([]);
      return;
    }
    let current = true;
    void folderLibraries().then((listed) => {
      if (current) setFiles(listed);
    });
    return () => {
      current = false;
    };
  }, [folderName, folderAccess, published, deviceId]);

  // An answer given on another machine settles the same question here, so a
  // resolver left open would ask about something already decided. It goes, and
  // the tab says why: a dialog that vanishes on its own is otherwise a mystery.
  // @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.closeResolverIfItsQuestionsChanged
  useEffect(() => {
    if (asked === undefined || answeringHere.current) return;
    if (questionsKey(asked) === questionsKey(conflicts)) return;
    setAsked(undefined);
    setMessage(undefined);
    setReport(
      conflicts.length === 0
        ? L("Those questions were answered on another machine, so they are settled here too.")
        : L(
            "The library changed on another machine — open Resolve… again for the questions that are left."
          )
    );
  }, [asked, conflicts]);

  /** Applies an edit: what it was refused for is said, and what it kept is stored. */
  const apply = (edit: TableEdit) => {
    setMessage(edit.message);
    setReport(undefined);
    if (edit.message !== undefined) return false;
    setRows(edit.rows);
    replaceFavorites(storedRows(edit.rows));
    return true;
  };

  const add = () => {
    const { rows: next, draft } = withDraft(rows);
    setMessage(undefined);
    setRows(next);
    setSelected(draft);
    focusName.current = next[draft]?.id;
  };

  const remove = () => {
    if (selected === undefined || selected >= rows.length) return;
    const next = removeRow(rows, selected);
    setSelected(undefined);
    apply({ rows: next });
  };

  const move = (from: number, destination: number) => {
    apply({ rows: moveRow(rows, from, destination) });
    setSelected(from < destination ? destination - 1 : destination);
  };

  const say = (said: TabReport) => {
    setMessage(said.problem);
    setReport(said.report);
  };

  /**
   * Saves the list as this browser's library file — through the save picker,
   * so it can go straight into a shared folder, or as a download.
   */
  const exportLibrary = async () => {
    say({});
    const { name, contents } = exportFavorites();
    try {
      const outcome = await saveText(contents, name, libraryFile());
      if (outcome === "saved") say({ report: L("Exported as “%1$@”.", name) });
      else if (outcome === "downloaded") say({ report: L("Downloaded “%1$@”.", name) });
    } catch (error) {
      say({ problem: L("The pattern library could not be exported: %1$@", reason(error)) });
    }
  };

  /** Merges a library file into the list; questions open the resolver. */
  const importLibrary = async () => {
    say({});
    try {
      const [file] = await openFiles({ types: [libraryFile()] });
      if (file === undefined) return;
      const contents = await (file.source as Blob).text();
      say(importReport(importFavorites(contents, file.name), file.name));
    } catch (error) {
      say({ problem: L("The file could not be read: %1$@", reason(error)) });
    }
  };

  /**
   * Puts the library in a folder of the user's choosing: what is already there
   * decides whether anything is asked.
   *
   * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.movePressed
   * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.publish
   * @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.chooseSharedFolder
   */
  const moveLibrary = async () => {
    say({});
    try {
      const chosen = await chooseLibraryFolder();
      if (chosen === undefined) return;
      if ("refused" in chosen) {
        say({ problem: L("The browser did not let the app write to “%1$@”.", chosen.refused) });
        return;
      }
      if (chosen.holds.kind === "unreadable") {
        // Publishing into a library that could not be read would write over
        // something unread — most often a file still downloading.
        say({
          problem: L(
            "The pattern library already in “%1$@” cannot be read yet — if it is still downloading, wait for it and try again.",
            chosen.folder.name
          ),
        });
        return;
      }
      if (chosen.holds.kind === "patterns") {
        setJoining({ folder: chosen.folder, count: chosen.holds.count });
        return;
      }
      await join(chosen.folder, "merge");
    } catch (error) {
      say({ problem: L("The folder could not be used: %1$@", reason(error)) });
    }
  };

  const join = async (picked: LibraryFolder, adopting: FolderAdoption) => {
    setJoining(undefined);
    const previous = await publishFavoritesTo(picked, adopting);
    if (previous !== undefined) setLeftBehind(previous);
  };

  /** @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.keepHerePressed */
  const keepHere = async () => {
    say({});
    const previous = await keepFavoritesInBrowser();
    if (previous !== undefined) setLeftBehind(previous);
  };

  /** @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.offerToTrash */
  const removeLeftBehind = async (previous: LibraryFolder) => {
    setLeftBehind(undefined);
    try {
      await removeOwnFileFrom(previous);
      say({ report: L("This browser's file was removed from “%1$@”.", previous.name) });
    } catch (error) {
      say({
        problem: L(
          "This browser's file in “%1$@” could not be removed: %2$@",
          previous.name,
          reason(error)
        ),
      });
    }
  };

  /** @web-only a browser that lost its data takes its old file back */
  const adopt = async (file: FolderLibraryFile) => {
    say({});
    try {
      if (await adoptLibraryFile(file.name)) {
        say({ report: L("This browser carries on writing “%1$@”.", file.name) });
      } else {
        say({ problem: L("“%1$@” does not say which browser wrote it.", file.name) });
      }
    } catch (error) {
      say({ problem: L("“%1$@” could not be taken back: %2$@", file.name, reason(error)) });
    }
  };

  /** @web-only Firefox and Safari read a folder the user picks */
  const fetchFromFolder = async () => {
    say({});
    try {
      const result = await getFavoritesFromFolder();
      if (result === undefined) return;
      if (result.read === 0 && result.problems === 0) {
        say({ problem: L("“%1$@” holds no pattern library.", result.folder) });
      } else if (result.problems > 0) {
        say({
          problem:
            result.problems === 1
              ? L("One library file in “%1$@” could not be read.", result.folder)
              : L(
                  "%1$@ library files in “%2$@” could not be read.",
                  String(result.problems),
                  result.folder
                ),
        });
      } else {
        say({
          report:
            result.read === 1
              ? L("Took what “%1$@” holds from one machine.", result.folder)
              : L("Took what “%1$@” holds from %2$@ machines.", result.folder, String(result.read)),
        });
      }
    } catch (error) {
      say({ problem: L("The folder could not be read: %1$@", reason(error)) });
    }
  };

  const line = locationLine(library);

  return (
    <section className="settings-favorites" aria-label={L("Search Patterns")}>
      <div className="favorites-location">
        <p
          className={
            line.problem ? "favorites-location-line is-problem" : "favorites-location-line"
          }
          aria-live="polite"
        >
          {line.text}
        </p>
        <div className="favorites-location-actions">
          {readOnly ? (
            <button
              type="button"
              className="toolbar-button"
              onClick={() => {
                answeringHere.current = false;
                setAsked(conflicts);
              }}
            >
              {L("Resolve…")}
            </button>
          ) : null}
          {folder !== undefined && folder.access === "prompt" ? (
            <button
              type="button"
              className="toolbar-button"
              onClick={() => void allowFolderAccess()}
            >
              {L("Allow Access…")}
            </button>
          ) : null}
          {keepsFolder && !readOnly ? (
            <button
              type="button"
              className="toolbar-button"
              title={L(
                "Keep the pattern library in a folder of your own — a synced one puts it on your other machines, and one that already has a library joins it"
              )}
              onClick={() => void moveLibrary()}
            >
              {L("Move…")}
            </button>
          ) : null}
          {keepsFolder && !readOnly && folder !== undefined ? (
            <button
              type="button"
              className="toolbar-button"
              title={L(
                "Stop publishing to the folder and keep the pattern library in this browser — your other machines stop seeing your changes"
              )}
              onClick={() => void keepHere()}
            >
              {L("Keep in This Browser")}
            </button>
          ) : null}
          {keepsFolder ? null : (
            <button
              type="button"
              className="toolbar-button"
              title={L(
                "Take the patterns other machines keep in a library folder, without writing to it"
              )}
              onClick={() => void fetchFromFolder()}
            >
              {L("Get Patterns from a Folder…")}
            </button>
          )}
        </div>
        {/* What is in the folder is the loop's business, not the reader's. The
            one file worth a word is an earlier one of this browser's own — left
            by a browser whose data was cleared — since only the user can say it
            was theirs. */}
        {readOnly
          ? null
          : files
              .filter((file) => file.adoptable)
              .map((file) => (
                <p key={file.name} className="favorites-earlier">
                  <span>
                    {L(
                      "The folder holds an earlier library written by “%1$@”. If that was this browser before its data was cleared, carry on with it.",
                      file.machine
                    )}
                  </span>
                  <button
                    type="button"
                    className="toolbar-button"
                    title={L("Carry on writing that library instead of keeping a second one")}
                    onClick={() => void adopt(file)}
                  >
                    {L("This Was Me")}
                  </button>
                </p>
              ))}
      </div>

      <div className="favorites-table">
        {/* The column titles are for the eye; each field carries its own label. */}
        <div className="favorites-row is-head" aria-hidden="true">
          <span />
          <span>{L("Name")}</span>
          <span>{L("Pattern")}</span>
          <span>{L("Encoding")}</span>
          <span>{L("Match Case")}</span>
        </div>
        <ol className="favorites-body" aria-label={L("Search Patterns")}>
          {rows.length === 0 ? (
            <li className="favorites-empty">
              {L(
                "No search patterns yet. Keep a search with Save Search Pattern in the Find bar's menu, or press +."
              )}
            </li>
          ) : null}
          {rows.map((entry, index) => (
            <li
              key={entry.id}
              className={`favorites-row${selected === index ? " is-selected" : ""}${
                dropAbove === index ? " is-drop-above" : ""
              }${dropAbove === rows.length && index === rows.length - 1 ? " is-drop-below" : ""}`}
              onFocusCapture={() => setSelected(index)}
              onPointerDown={() => setSelected(index)}
              onDragOver={(event) => {
                if (dragging === undefined) return;
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                setDropAbove(event.clientY < box.top + box.height / 2 ? index : index + 1);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging !== undefined && dropAbove !== undefined) move(dragging, dropAbove);
                setDragging(undefined);
                setDropAbove(undefined);
              }}
              onKeyDown={(event) => {
                if (!event.altKey || readOnly) return;
                if (event.key === "ArrowUp" && index > 0) {
                  event.preventDefault();
                  move(index, index - 1);
                } else if (event.key === "ArrowDown" && index < rows.length - 1) {
                  event.preventDefault();
                  move(index, index + 2);
                }
              }}
            >
              {/* A handle to drag by, and to focus for Alt+↑/↓: the row's fields
                  are for typing into, not for picking up. */}
              <button
                type="button"
                className="favorites-grip"
                draggable={!readOnly}
                disabled={readOnly}
                title={L("Drag to reorder, or Alt+↑/↓")}
                aria-label={L("Reorder")}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", String(index));
                  setDragging(index);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                  setDropAbove(undefined);
                }}
              >
                ⋮⋮
              </button>
              <span>
                <input
                  ref={(element) => {
                    if (element === null) nameInputs.current.delete(entry.id);
                    else nameInputs.current.set(entry.id, element);
                  }}
                  key={`name-${entry.name}`}
                  defaultValue={entry.name}
                  readOnly={readOnly}
                  placeholder={L("Name")}
                  aria-label={L("Name")}
                  spellCheck={false}
                  onFocus={() => {
                    editing.current = true;
                  }}
                  onBlur={(event) => {
                    editing.current = false;
                    if (!readOnly && event.target.value.trim() !== entry.name) {
                      apply(commitName(rows, index, event.target.value));
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </span>
              <span>
                <input
                  key={`pattern-${entry.pattern}`}
                  className="favorites-pattern"
                  defaultValue={entry.pattern}
                  readOnly={readOnly}
                  placeholder={L("Pattern")}
                  aria-label={L("Pattern")}
                  spellCheck={false}
                  onFocus={() => {
                    editing.current = true;
                  }}
                  onBlur={(event) => {
                    editing.current = false;
                    const input = event.target;
                    if (readOnly || input.value.trim() === entry.pattern) return;
                    // Refused: back to what it held.
                    if (!apply(commitPattern(rows, index, input.value)))
                      input.value = entry.pattern;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                />
              </span>
              <span>
                <select
                  className="settings-select"
                  aria-label={L("Encoding")}
                  value={entry.encoding}
                  disabled={readOnly}
                  onChange={(event) =>
                    apply(commitEncoding(rows, index, event.target.value as SearchEncoding))
                  }
                >
                  {SEARCH_ENCODINGS.map((encoding) => (
                    <option key={encoding} value={encoding}>
                      {encodingTitle(encoding)}
                    </option>
                  ))}
                </select>
              </span>
              <span className="favorites-case">
                {/* Hex is byte-exact whatever the flag holds: nothing to tick. */}
                <input
                  type="checkbox"
                  aria-label={L("Match Case")}
                  checked={entry.caseSensitive && entry.encoding !== "hex"}
                  disabled={readOnly || entry.encoding === "hex"}
                  onChange={(event) => apply(commitCase(rows, index, event.target.checked))}
                />
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="favorites-footer">
        <button
          type="button"
          className="table-addremove"
          aria-label={L("Add Pattern")}
          title={L("Add a pattern")}
          disabled={readOnly}
          onClick={add}
        >
          +
        </button>
        <button
          type="button"
          className="table-addremove"
          aria-label={L("Remove Pattern")}
          title={L("Remove the selected pattern")}
          disabled={readOnly || selected === undefined || selected >= rows.length}
          onClick={remove}
        >
          −
        </button>
        <span className="favorites-footer-gap" />
        <button
          type="button"
          className="toolbar-button"
          disabled={readOnly}
          onClick={() => void importLibrary()}
        >
          {L("Import…")}
        </button>
        <button type="button" className="toolbar-button" onClick={() => void exportLibrary()}>
          {L("Export…")}
        </button>
      </div>
      <p
        className={
          message === undefined && report !== undefined
            ? "settings-problem is-report"
            : "settings-problem"
        }
        aria-live="polite"
      >
        {message ?? report ?? ""}
      </p>

      {/* Upstream's caption up to its last sentence, which names a Mac; where
          the library can live here is the next paragraph's business. */}
      <p className="settings-caption">
        {L(
          "Patterns you keep, with the encoding they are read in. They appear under Search Patterns in the Find bar's search menu, where picking one fills the bar and searches. Drag rows to reorder them — the menu lists them in this order."
        )}
      </p>
      {/* The same browser at a network address looks exactly like one that
          cannot keep folders; the reason, and what to do, is said instead. */}
      {whyNoFolder === undefined ? null : (
        <p className="favorites-location-line is-problem">{whyNoFolder}</p>
      )}
      <p className="settings-caption">
        {keepsFolder
          ? L(
              "Move… keeps the pattern library in a folder you choose. Each browser and each Mac writes its own file there and reads the others, so a folder your computer syncs — iCloud Drive, OneDrive, Dropbox — carries the library to your other machines."
            )
          : whyNoFolder !== undefined
            ? L(
                "Until then, Get Patterns from a Folder… takes the patterns your other machines keep in their library folder, and Export… saves this browser's list as a file you can put in that folder by hand."
              )
            : L(
                "This browser can read a folder but not keep one. Get Patterns from a Folder… takes the patterns your other machines keep in their library folder; Export… saves this browser's list as a file you can put in that folder by hand."
              )}{" "}
        {L(
          "Export… and Import… carry the list as a single file, and an import merges into this list rather than replacing it."
        )}
      </p>

      {/* The three answers to "that folder already holds a library".
          @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.askAboutFile */}
      <Dialog
        open={joining !== undefined}
        title={joining === undefined ? "" : L("“%1$@” already holds patterns", joining.folder.name)}
        onClose={() => setJoining(undefined)}
      >
        <div className="dialog-body">
          <p className="dialog-message">
            {L(
              "Merging keeps both lists, which is usually what you want when setting up a second machine."
            )}
          </p>
          <div className="dialog-actions">
            <button type="button" className="toolbar-button" onClick={() => setJoining(undefined)}>
              {L("Cancel")}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => joining !== undefined && void join(joining.folder, "replaceTheFile")}
            >
              {L("Replace What Is There")}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => joining !== undefined && void join(joining.folder, "takeTheFile")}
            >
              {L("Use the Folder's Patterns")}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => joining !== undefined && void join(joining.folder, "merge")}
            >
              {L("Merge")}
            </button>
          </div>
        </div>
      </Dialog>

      {/* Asked rather than done, and never by default: the file may be in a
          folder another machine publishes to.
          @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.askAboutRemoving */}
      <Dialog
        open={leftBehind !== undefined}
        title={L("Remove this browser's file from the old folder?")}
        onClose={() => setLeftBehind(undefined)}
      >
        <div className="dialog-body">
          <p className="dialog-message">
            {leftBehind === undefined
              ? ""
              : L(
                  "“%1$@” is no longer where the pattern library lives, and this browser's copy of the patterns there will not be updated again. If it is a synced folder, removing the file removes it on your other machines too — keep it if one of them publishes there.",
                  leftBehind.name
                )}
          </p>
          <div className="dialog-actions">
            <button
              type="button"
              className="toolbar-button"
              onClick={() => setLeftBehind(undefined)}
            >
              {L("Keep It")}
            </button>
            <button
              type="button"
              className="toolbar-button"
              onClick={() => leftBehind !== undefined && void removeLeftBehind(leftBehind)}
            >
              {L("Remove")}
            </button>
          </div>
        </div>
      </Dialog>

      {/* @upstream ByteRipperApp/Settings/FavoritePatternsSettingsViewController.swift#FavoritePatternsSettingsViewController.resolvePressed */}
      <LibraryConflictDialog
        conflicts={asked}
        wording={SHARED_WORDING()}
        cancelTitle={L("Later")}
        onResolve={(answers) => {
          answeringHere.current = true;
          setAsked(undefined);
          void resolveFavorites(answers).finally(() => {
            answeringHere.current = false;
          });
        }}
        onCancel={() => setAsked(undefined)}
      />

      <LibraryConflictDialog
        conflicts={pendingImport?.outcome.conflicts}
        wording={IMPORT_WORDING()}
        cancelTitle={L("Cancel Import")}
        onResolve={(answers) => {
          const fileName = pendingImport?.fileName ?? "";
          const result = answerImport(answers);
          if (result !== undefined) say(importReport(result, fileName));
        }}
        onCancel={() => {
          // The dialog also reports its own closing after an answer, when there
          // is nothing left to cancel.
          if (pendingImport === undefined) return;
          abandonImport();
          say({ report: L("Nothing was imported.") });
        }}
      />
    </section>
  );
}
