import { useEffect, useState } from "react";
import { searchPatternEntry } from "@/core/search/searchPatternEntry";
import { addFavorite, existingFavorite } from "@/state/favoritesStore";
import { Dialog } from "@/ui/dialogs/Dialog";
import { favoriteNameProblem, keepingDescription, type MenuSearch } from "@/ui/search/patternMenu";

/**
 * Keeps the pattern in the find bar's field, under a name (§11).
 *
 * The way a library actually fills up: nobody opens Settings to type a pattern
 * from memory, they keep the one that just worked. So the dialog asks for the
 * one thing the bar has not got — a name — and shows what is being kept above
 * it, unchangeably. The encoding is the bar's, which after a Smart Search is the
 * one that worked.
 *
 * @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController
 * @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.entry
 * @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.init
 * @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.loadView
 * @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.nameField
 * @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.firstField
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.askToKeepPattern
 * @upstream-differs a dialog over the favourites store
 */
export function AddFavoriteDialog({
  search,
  onKept,
  onClose,
}: {
  /** What the field describes, or `undefined` while the dialog is not wanted. */
  readonly search: MenuSearch | undefined;
  /** @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.onKeep */
  readonly onKept: (name: string) => void;
  readonly onClose: () => void;
}) {
  // Empty rather than the pattern: a name that repeats the pattern is a row
  // that says the same thing twice.
  const [name, setName] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (search === undefined) return;
    setName("");
    setTried(false);
  }, [search]);

  const problem =
    search === undefined ? undefined : favoriteNameProblem(name, search, existingFavorite(search));

  /** @upstream ByteRipperApp/Search/NamePatternSheetController.swift#NamePatternSheetController.handleSubmit */
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (search === undefined || problem !== undefined) return;
    const kept = name.trim();
    if (!addFavorite(searchPatternEntry({ ...search, name: kept }))) return;
    onClose();
    onKept(kept);
  };

  return (
    <Dialog open={search !== undefined} title="Add to Favorites" onClose={onClose}>
      <form className="dialog-body" onSubmit={submit}>
        <p className="dialog-message">{search === undefined ? "" : keepingDescription(search)}</p>
        <label className="dialog-field">
          Name:
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        <p className="dialog-help" aria-live="polite">
          {tried || name.trim() !== "" ? (problem ?? "") : ""}
        </p>
        <div className="dialog-actions">
          <button type="button" className="toolbar-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="toolbar-button">
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}
