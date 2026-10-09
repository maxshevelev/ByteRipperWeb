/**
 * The keyboard chords the help names, as they are spelled for the edition and
 * platform it is being read on.
 *
 * The book is written on a Mac, where the important modifier is the Command key
 * (`⌘`). The same application on Windows and Linux takes those chords under
 * Control, and the difference navigation — which the Mac spells with Option —
 * moves its Option to Alt. A page must not say `⌘F` to a reader whose search is
 * `Ctrl+F`, so a chord in the text is written as `[[key:find]]` and resolved
 * here at read time rather than spelled in each language.
 *
 * The mapping is the one the shell's own menu uses when it builds its native
 * accelerators — `⌘`→Control, `⌥`→Alt, `⇧`→Shift, `⌃`→Control — so a chord the
 * menu shows and a chord the help shows can never disagree. What is *whether a
 * key exists at all in an edition* (the browser keeps some of them for its own
 * tabs) is a question of the page's words, answered by the edition's own page;
 * this table answers only how a chord that does exist is spelled.
 *
 * Pure: it takes the platform it is asked for and returns the spelling, so a
 * test can pin the whole mapping without a browser or a shell.
 */

/** A Mac-style keyboard, where the primary modifier is Command, or one that is not. */
export type HelpPlatform = "apple" | "other";

/** The chord the help can name. Each is one the app binds, in both editions. */
export type HelpCommand =
  | "undo"
  | "save"
  | "paste"
  | "find"
  | "goTo"
  | "minimap"
  | "bookmark"
  | "editBookmark"
  | "back"
  | "forward"
  | "nextDifference"
  | "previousDifference"
  | "nextSameBlock"
  | "previousSameBlock"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "help"
  | "settings"
  | "tool1"
  | "tool2"
  | "tool3"
  | "tool4"
  | "tool5"
  | "tool6"
  | "tool7"
  | "tool8"
  | "tool9";

/** Both spellings of one chord: on a Mac, and everywhere else. */
export interface KeySpelling {
  readonly apple: string;
  readonly other: string;
}

/**
 * A reader of the book: something that answers "how is this chord spelled
 * here?" with a string. The renderer hands in one bound to its platform, and
 * search hands in one bound to the platform its reader is on; the plain text
 * with no resolver in hand reads chords the way the book was written.
 */
export type HelpKeyResolver = (command: string) => string;

/**
 * The mapping. Each row is the same chord two ways: the Mac's hand, and the
 * hand on Windows and Linux. The `other` column is not written by hand — it is
 * the `apple` column run through {@link macToOther}, and the test proves that
 * for every row, which is what makes the mapping valid rather than merely
 * asserted.
 *
 * @web-only the Mac app spells these as menu key equivalents; the page resolves
 * them at read time instead, so the one table serves both editions
 */
export const HELP_KEY_SPELLINGS: Readonly<Record<HelpCommand, KeySpelling>> = {
  undo: { apple: "⌘Z", other: "Ctrl+Z" },
  save: { apple: "⌘S", other: "Ctrl+S" },
  paste: { apple: "⌘V", other: "Ctrl+V" },
  find: { apple: "⌘F", other: "Ctrl+F" },
  goTo: { apple: "⌘L", other: "Ctrl+L" },
  minimap: { apple: "⌘M", other: "Ctrl+M" },
  bookmark: { apple: "⌘D", other: "Ctrl+D" },
  editBookmark: { apple: "⇧⌘D", other: "Ctrl+Shift+D" },
  back: { apple: "⌘[", other: "Ctrl+[" },
  forward: { apple: "⌘]", other: "Ctrl+]" },
  nextDifference: { apple: "⌥⌘→", other: "Ctrl+Alt+→" },
  previousDifference: { apple: "⌥⌘←", other: "Ctrl+Alt+←" },
  nextSameBlock: { apple: "⇧⌥⌘→", other: "Ctrl+Alt+Shift+→" },
  previousSameBlock: { apple: "⇧⌥⌘←", other: "Ctrl+Alt+Shift+←" },
  zoomIn: { apple: "⌘+", other: "Ctrl++" },
  zoomOut: { apple: "⌘−", other: "Ctrl+-" },
  zoomReset: { apple: "⌘0", other: "Ctrl+0" },
  help: { apple: "⌘/", other: "Ctrl+/" },
  settings: { apple: "⌘,", other: "Ctrl+," },
  tool1: { apple: "⌘1", other: "Ctrl+1" },
  tool2: { apple: "⌘2", other: "Ctrl+2" },
  tool3: { apple: "⌘3", other: "Ctrl+3" },
  tool4: { apple: "⌘4", other: "Ctrl+4" },
  tool5: { apple: "⌘5", other: "Ctrl+5" },
  tool6: { apple: "⌘6", other: "Ctrl+6" },
  tool7: { apple: "⌘7", other: "Ctrl+7" },
  tool8: { apple: "⌘8", other: "Ctrl+8" },
  tool9: { apple: "⌘9", other: "Ctrl+9" },
};

/**
 * How a Mac chord is carried over to the other platform: each modifier takes
 * the name it has there — Command becomes Control, Option becomes Alt, Control
 * becomes Control, Shift stays Shift — and the modifiers are written in the
 * order that platform reads them (Control, then Alt, then Shift) before the key.
 *
 * This is the rule behind the `other` column of {@link HELP_KEY_SPELLINGS}, and
 * it is the shell's own menu mapping for the same chords, so the help and the
 * menu agree by construction. It is what answers "is the Mac→Windows mapping
 * valid?": apply it to a Mac chord and you get the chord the shell binds.
 */
export function macToOther(macChord: string): string {
  const modifiers: string[] = [];
  let key = "";
  for (const glyph of Array.from(macChord)) {
    if (glyph === "⌘" || glyph === "⌃") modifiers.push("Ctrl");
    else if (glyph === "⌥") modifiers.push("Alt");
    else if (glyph === "⇧") modifiers.push("Shift");
    // The Mac menu prints the minus as U+2212; the shell prints the hyphen it
    // binds, so the rule carries the glyph over with the modifiers.
    else key = glyph === "−" ? "-" : glyph;
  }
  // Windows and Linux read Control first, then Alt, then Shift; a modifier the
  // chord does not carry is left out, and Control may only come once (Command
  // and Control both name it, and a chord never carries both).
  const present = new Set(modifiers);
  const ordered = ["Ctrl", "Alt", "Shift"].filter((name) => present.has(name));
  return [...ordered, key].join("+");
}

/**
 * The spelling of `command` on `platform`, or nothing when the chord is not one
 * the book knows. The caller reads the platform with its own keyboard probe and
 * hands it in, so this stays pure.
 */
export function resolveHelpKey(command: HelpCommand, platform: HelpPlatform): string | undefined {
  const spelling = HELP_KEY_SPELLINGS[command];
  if (spelling === undefined) return undefined;
  return platform === "apple" ? spelling.apple : spelling.other;
}

/**
 * The Mac spelling of a chord, for the places that read the book's words without
 * a platform in hand — the search index and a one-line preview. What is written
 * on the screen is the platform's own spelling; what is indexed is the one form
 * the book was authored in.
 */
export function canonicalHelpKey(command: HelpCommand): string {
  return HELP_KEY_SPELLINGS[command]?.apple ?? command;
}

/**
 * The spelling of a chord as it is written in the content, on `platform` — or,
 * when the id is not one the table knows, the id itself, read as it was typed.
 *
 * This takes a `string` rather than a {@link HelpCommand} because the span a
 * page holds is the id the author wrote, and a page that invents a chord the
 * table does not carry should read as its id — visibly wrong — rather than
 * throw. The closed set the book may name is enforced where it belongs, by the
 * edition check that reviews the content.
 */
export function spellHelpKey(command: string, platform: HelpPlatform): string {
  const spelling = (HELP_KEY_SPELLINGS as Record<string, KeySpelling>)[command];
  if (spelling === undefined) return command;
  return platform === "apple" ? spelling.apple : spelling.other;
}

/**
 * A {@link HelpKeyResolver} bound to the Mac's hand: the form the book was
 * written in, and the one the plain text falls back to when no platform is at
 * hand. A chord the table does not carry reads as its id, as {@link spellHelpKey} does.
 */
export const canonicalKeyResolver: HelpKeyResolver = (command) => spellHelpKey(command, "apple");
