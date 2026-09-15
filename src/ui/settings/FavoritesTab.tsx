import { useEffect, useRef, useState } from "react";
import { encodingTitle, SEARCH_ENCODINGS, type SearchEncoding } from "@/core/search/searchPattern";
import type { SearchPatternEntry } from "@/core/search/searchPatternEntry";
import type { FilePickerType } from "@/platform/files/capabilities";
import { openFiles } from "@/platform/files/openFile";
import { saveText } from "@/platform/files/textSave";
import {
  abandonImport,
  answerImport,
  exportFavorites,
  favoritesStore,
  importFavorites,
  replaceFavorites,
} from "@/state/favoritesStore";
import { useStore } from "@/state/useStore";
import { LibraryConflictDialog } from "@/ui/search/LibraryConflictDialog";
import { IMPORT_WORDING } from "@/ui/search/libraryConflicts";
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

/** The library file, as the pickers offer it. */
const LIBRARY_FILE: FilePickerType = {
  description: "ByteRipper pattern library",
  accept: { "application/json": [".json"] },
};

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The Favorites tab (§11): the named patterns the user keeps, in the order they
 * keep them in.
 *
 * Every other tab applies live, so this one does too — a commit writes the
 * store, and the find bar's menu reads it. There is nothing to confirm and
 * nothing to lose, which is what lets the whole tab be a table.
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
 * @upstream-differs rows of inputs, reordered by dragging a row or with Alt+↑/↓; Export and Import are the web's own, and where the library lives arrives with stage 4
 */
export function FavoritesTab() {
  const { favorites, pendingImport } = useStore(favoritesStore);
  const [rows, setRows] = useState<readonly SearchPatternEntry[]>(favorites);
  const [selected, setSelected] = useState<number | undefined>(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  /** What the last export or import did, when it did not go wrong. */
  const [report, setReport] = useState<string | undefined>(undefined);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const [dropAbove, setDropAbove] = useState<number | undefined>(undefined);
  const editing = useRef(false);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  const focusName = useRef<string | undefined>(undefined);

  // The store is not only written from here: the find bar keeps patterns too.
  // A row being typed into, or a draft, is not taken away for it.
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
      const outcome = await saveText(contents, name, LIBRARY_FILE);
      if (outcome === "saved") say({ report: `Exported as "${name}".` });
      else if (outcome === "downloaded") say({ report: `Downloaded "${name}".` });
    } catch (error) {
      say({ problem: `The favorites could not be exported: ${reason(error)}` });
    }
  };

  /** Merges a library file into the list; questions open the resolver. */
  const importLibrary = async () => {
    say({});
    try {
      const [file] = await openFiles({ types: [LIBRARY_FILE] });
      if (file === undefined) return;
      const contents = await (file.source as Blob).text();
      say(importReport(importFavorites(contents, file.name), file.name));
    } catch (error) {
      say({ problem: `The file could not be read: ${reason(error)}` });
    }
  };

  return (
    <section className="settings-favorites" aria-label="Favorites">
      <h3 className="settings-heading">Favorites</h3>
      <div className="favorites-table">
        {/* The column titles are for the eye; each field carries its own label. */}
        <div className="favorites-row is-head" aria-hidden="true">
          <span />
          <span>Name</span>
          <span>Pattern</span>
          <span>Encoding</span>
          <span>Match Case</span>
        </div>
        <ol className="favorites-body" aria-label="Favorite patterns">
          {rows.length === 0 ? (
            <li className="favorites-empty">
              No favorites yet. Keep a search with Add to Favorites in the Find bar's menu, or press
              +.
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
                if (!event.altKey) return;
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
                draggable
                title="Drag to reorder, or Alt+↑/↓"
                aria-label="Reorder"
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
                  placeholder="Name"
                  aria-label="Name"
                  spellCheck={false}
                  onFocus={() => {
                    editing.current = true;
                  }}
                  onBlur={(event) => {
                    editing.current = false;
                    if (event.target.value.trim() !== entry.name) {
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
                  placeholder="Pattern"
                  aria-label="Pattern"
                  spellCheck={false}
                  onFocus={() => {
                    editing.current = true;
                  }}
                  onBlur={(event) => {
                    editing.current = false;
                    const input = event.target;
                    if (input.value.trim() === entry.pattern) return;
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
                  aria-label="Encoding"
                  value={entry.encoding}
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
                  aria-label="Match Case"
                  checked={entry.caseSensitive && entry.encoding !== "hex"}
                  disabled={entry.encoding === "hex"}
                  onChange={(event) => apply(commitCase(rows, index, event.target.checked))}
                />
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className="favorites-footer">
        <button type="button" className="toolbar-button" aria-label="Add a favorite" onClick={add}>
          +
        </button>
        <button
          type="button"
          className="toolbar-button"
          aria-label="Remove the selected favorite"
          disabled={selected === undefined || selected >= rows.length}
          onClick={remove}
        >
          −
        </button>
        <span className="favorites-footer-gap" />
        <button type="button" className="toolbar-button" onClick={() => void importLibrary()}>
          Import…
        </button>
        <button type="button" className="toolbar-button" onClick={() => void exportLibrary()}>
          Export…
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
      <p className="settings-caption">
        Patterns you keep, with the encoding they are read in. They appear under Favorites in the
        Find bar's search menu, where picking one fills the bar and searches. Drag rows to reorder
        them — the menu lists them in this order.
      </p>
      <p className="settings-caption">
        Export… saves the list as a file another browser can import, or that can be put into a
        shared library folder by hand. Import… merges such a file into this list, and asks about
        anything both sides changed.
      </p>
      <LibraryConflictDialog
        conflicts={pendingImport?.outcome.conflicts}
        wording={IMPORT_WORDING}
        cancelTitle="Cancel Import"
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
          say({ report: "Nothing was imported." });
        }}
      />
    </section>
  );
}
