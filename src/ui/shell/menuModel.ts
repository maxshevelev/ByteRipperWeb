/**
 * What a menu is made of, wherever it is shown.
 *
 * The toolbar's menu and every right-click menu are the same list of commands
 * in the same shape — upstream builds both out of `NSMenu` and so does this,
 * which is what keeps "Toggle Bookmark at 0x00001000" saying the same thing
 * whether it was reached from the bar or from the dump.
 */

export interface MenuAction {
  readonly kind?: "action";
  readonly label: string;
  /** Shown greyed at the right — the shortcut, not a second control. */
  readonly shortcut?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** Drawn with a tick: a setting that is on, or the chosen one of a group. */
  readonly checked?: boolean | undefined;
  /** A group of mutually exclusive choices reads as radio, not checkbox. */
  readonly exclusive?: boolean | undefined;
  /** Drawn in the warning colour — a command that removes or overwrites. */
  readonly destructive?: boolean | undefined;
  /**
   * The desktop shell's menu answers this shortcut itself. Every other key is
   * answered by the page and only drawn by the menu; a command the page has no
   * key handler for — the shell's zoom — needs the menu to register it.
   */
  readonly shellKey?: boolean | undefined;
  /** What a pause over the row says — the phrase upstream's `ControlHelp.describe` sets on an item. */
  readonly tooltip?: string | undefined;
  readonly onSelect: () => void;
}

export interface MenuSeparator {
  readonly kind: "separator";
}

export interface MenuHeading {
  readonly kind: "heading";
  readonly label: string;
  /**
   * A heading that is a menu of its own — File, Edit, View — rather than the
   * title of a group inside one. The page's menu draws both alike; the desktop
   * shell's menu bar makes the first kind its top-level menus.
   */
  readonly opensMenu?: boolean | undefined;
}

export type MenuEntry = MenuAction | MenuSeparator | MenuHeading;

export const isMenuAction = (entry: MenuEntry): entry is MenuAction =>
  entry.kind === undefined || entry.kind === "action";

/** Narrows a list so a section with nothing in it takes no space. */
export function compactEntries(entries: readonly (MenuEntry | undefined)[]): MenuEntry[] {
  const kept = entries.filter((entry): entry is MenuEntry => entry !== undefined);
  const result: MenuEntry[] = [];
  for (const entry of kept) {
    const previous = result[result.length - 1];
    // No separator to open a menu, and never two in a row.
    if (entry.kind === "separator" && (previous === undefined || previous.kind === "separator")) {
      continue;
    }
    // A heading with no commands under it is a promise the menu does not keep.
    if (previous?.kind === "heading" && entry.kind === "separator") {
      result.pop();
      continue;
    }
    result.push(entry);
  }
  // A separator or a heading at the end has nothing after it to separate or
  // to title.
  while (result.length > 0) {
    const last = result[result.length - 1];
    if (last === undefined || isMenuAction(last)) break;
    result.pop();
  }
  return result;
}
