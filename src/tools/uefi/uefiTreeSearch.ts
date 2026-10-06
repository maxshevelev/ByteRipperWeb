import { FFS, fileTypeName } from "@/firmware/uefi/fileParser";
import { isKnownSectionType, sectionTypeName } from "@/firmware/uefi/sectionParser";
import { ItemType, typeName } from "@/firmware/uefi/uefiTypes";

/**
 * Searching the tree (`Design/UEFI_STRUCTURE_TOOL.md`, "Searching the tree"): what the
 * search asks for, the walk over the rows, and what it has opened. Pure: nothing here
 * knows how a row is drawn, which is what lets the walk be tested over a table of ids.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeQuery
 */

/**
 * What the tree's search asks for: a piece of a name or a GUID, and a type, and with a
 * file or a section a subtype — the three the Name, Type and Subtype columns already
 * show. Everything the query holds is a code or a string typed, never a word of the
 * interface, so a change of language leaves it as it was.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeQuery
 */
export interface UEFITreeQuery {
  /** Matched anywhere in the name and in the GUID, whatever the case. */
  readonly text: string;
  /** An item type — what the Type column says. */
  readonly type?: number | undefined;
  /** A file's or a section's type byte — what the Subtype column says. */
  readonly subtype?: number | undefined;
}

/** A query that asks for nothing. */
export const EMPTY_QUERY: UEFITreeQuery = { text: "" };

/**
 * The text with the whitespace around it gone: a trailing space is not part of what
 * anyone looks for.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeQuery.needle
 */
export const needleOf = (query: UEFITreeQuery): string => query.text.trim();

/**
 * A query that asks for nothing has nothing to find.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeQuery.isEmpty
 */
export const queryIsEmpty = (query: UEFITreeQuery): boolean =>
  needleOf(query).length === 0 && query.type === undefined;

/**
 * Whether a subtype means anything for the type: a file and a section have one worth
 * choosing among.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeQuery.hasSubtypes
 */
export const hasSubtypes = (type: number | undefined): boolean =>
  type === ItemType.file || type === ItemType.section;

/** Whether two queries ask for the same. */
export const sameQuery = (one: UEFITreeQuery, other: UEFITreeQuery): boolean =>
  one.text === other.text && one.type === other.type && one.subtype === other.subtype;

/** What a node is, for the query: the codes its Type and Subtype columns are made from. */
export interface SearchedNode {
  /** The item-type code, what the Type column says. */
  readonly itemType: number;
  /** A file's or a section's type byte; nothing for the other kinds. */
  readonly itemSubtype?: number | undefined;
  /** The node's own name — a file's, the one its name section gives. */
  readonly name: string;
  /** The GUID as text, dashes and all. */
  readonly guid?: string | undefined;
}

const contains = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

const isHex = (text: string): boolean => /^[0-9a-fA-F]+$/.test(text);

/**
 * Whether `node` answers it. `name` is the name the row shows, which the caller works
 * out (it needs the GUID catalogue); the node's own name and its GUID are read here, so
 * a file is found as `Setup` and as `899407D7-…` alike.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeQuery.matches
 */
export function matchesQuery(query: UEFITreeQuery, node: SearchedNode, name: string): boolean {
  if (query.type !== undefined && node.itemType !== query.type) return false;
  if (
    query.subtype !== undefined &&
    hasSubtypes(query.type) &&
    node.itemSubtype !== query.subtype
  ) {
    return false;
  }
  const needle = needleOf(query);
  if (needle.length === 0) return true;
  if (contains(name, needle) || contains(node.name, needle)) return true;
  if (node.guid === undefined) return false;
  if (contains(node.guid, needle)) return true;
  // Hex typed without the dashes: the GUID as the bytes are read off.
  return isHex(needle) && contains(node.guid.replaceAll("-", ""), needle);
}

/** One entry of a pop-up: the code stored, and the word the column uses. */
export interface SearchChoice {
  readonly code: number;
  readonly name: string;
}

/**
 * The file types a search can name, in the order of the type byte: the ones with a name
 * of their own. A vendor's `OEM file` and `Debug file` ranges are many codes under one
 * name, and are left out.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypeNames.swift#UEFITypeNames.fileTypes
 */
export const FILE_TYPES: readonly number[] = [
  ...Array.from({ length: 0x0f }, (_, index) => index + 1),
  FFS.padType,
];

/**
 * The section types the parser knows (§6.1), in the order of the type byte.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/UEFITypeNames.swift#UEFITypeNames.sectionTypes
 */
export const SECTION_TYPES: readonly number[] = Array.from(
  { length: 256 },
  (_, index) => index
).filter(isKnownSectionType);

/**
 * Every type a node of the tree can be, by the word the Type column uses — but for
 * `Root`, which no row has. A fixed list rather than the types the open image happens
 * to hold: the query is kept from one file to the next, and a choice that left the menu
 * with the file would be a query the reader can no longer see.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeSearchChoices.types
 */
export const searchTypes = (): SearchChoice[] =>
  Array.from({ length: 0x69 - 0x3d + 1 }, (_, index) => {
    const code = 0x3d + index;
    return { code, name: typeName(code) };
  });

/**
 * The subtypes of a type, by the word the Subtype column uses; none for a type that has
 * none worth choosing among.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeSearchChoices.subtypes
 */
export function searchSubtypes(type: number | undefined): SearchChoice[] {
  switch (type) {
    case ItemType.file:
      return FILE_TYPES.map((code) => ({ code, name: fileTypeName(code) }));
    case ItemType.section:
      return SECTION_TYPES.map((code) => ({ code, name: sectionTypeName(code) }));
    default:
      return [];
  }
}

/**
 * What the search reads of the tree: the rows the outline lists, and whether a branch has
 * been read yet. Rows are identified by their path, as a string key.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeSearchSource
 */
export interface UEFITreeSearchSource {
  /** The outline's top level, as listed. */
  topRows(): readonly string[];
  /**
   * The rows listed under `key`, or nothing when the branch has not been read and has to
   * be before anything can be said about what is in it. A node the search does not go
   * into — a leaf, the ME region — lists none.
   */
  listedChildren(key: string): readonly string[] | undefined;
}

export type SearchDirection = "forward" | "backward";

/**
 * What the walk says next.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeSearch.Advance
 */
export type SearchAdvance =
  /** The next row to test. */
  | { readonly kind: "candidate"; readonly key: string }
  /** A branch to read before the walk can go on; ask again once it is. */
  | { readonly kind: "expand"; readonly key: string }
  /** Every row has been offered. */
  | { readonly kind: "exhausted" };

type Position =
  | { readonly kind: "row"; readonly key: string }
  | { readonly kind: "expand"; readonly key: string }
  | { readonly kind: "end" };

const parentOf = (key: string): string => key.split(".").slice(0, -1).join(".");

/**
 * A walk over the tree's rows, one at a time, in the order the outline lists them with
 * everything open — down into a node before across to the next — forward or back, coming
 * round to the other end once.
 *
 * It decides nothing about what matches. It hands back each row in turn and the caller
 * tests it; and where the next row lies in a branch nobody has read, it says which branch
 * to read first and waits, so the caller can read it off the main thread and ask again.
 * The row the walk starts from is not handed back until the walk has come all the way
 * round to it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFITreeSearch
 */
export class UEFITreeSearch {
  readonly origin: string | undefined;
  readonly direction: SearchDirection;
  /** Whether the walk has gone off one end and come in at the other. */
  wrapped = false;
  private current: string | undefined;
  private finished = false;

  /**
   * A walk from `origin` — the row selected, or nothing for none, which starts at the top
   * (or the bottom, going back) and does not come round.
   */
  constructor(origin: string | undefined, direction: SearchDirection) {
    this.origin = origin;
    this.direction = direction;
    this.current = origin;
  }

  advance(source: UEFITreeSearchSource): SearchAdvance {
    while (!this.finished) {
      const next =
        this.direction === "forward"
          ? this.forward(this.current, source)
          : this.backward(this.current, source);
      switch (next.kind) {
        case "expand":
          return { kind: "expand", key: next.key };
        case "row":
          this.current = next.key;
          // The origin comes last, once the walk is round to it: a lone match is found
          // again, as a find in the hex view finds it.
          if (this.wrapped && next.key === this.origin) this.finished = true;
          return { kind: "candidate", key: next.key };
        case "end":
          if (this.wrapped || this.origin === undefined) {
            this.finished = true;
            return { kind: "exhausted" };
          }
          this.wrapped = true;
          this.current = undefined;
      }
    }
    return { kind: "exhausted" };
  }

  private forward(key: string | undefined, source: UEFITreeSearchSource): Position {
    if (key === undefined) {
      const first = source.topRows()[0];
      return first === undefined ? { kind: "end" } : { kind: "row", key: first };
    }
    const children = source.listedChildren(key);
    if (children === undefined) return { kind: "expand", key };
    const first = children[0];
    if (first !== undefined) return { kind: "row", key: first };
    // Nothing under it: the next row across, or across from the nearest row above that
    // has one.
    let row = key;
    for (;;) {
      const siblings = siblingsOf(row, source);
      const index = siblings.indexOf(row);
      if (index < 0) return { kind: "end" };
      const next = siblings[index + 1];
      if (next !== undefined) return { kind: "row", key: next };
      if (source.topRows().includes(row)) return { kind: "end" };
      row = parentOf(row);
    }
  }

  private backward(key: string | undefined, source: UEFITreeSearchSource): Position {
    if (key === undefined) {
      const last = source.topRows().at(-1);
      return last === undefined ? { kind: "end" } : deepestLast(last, source);
    }
    const siblings = siblingsOf(key, source);
    const index = siblings.indexOf(key);
    if (index < 0) return { kind: "end" };
    const before = siblings[index - 1];
    if (before !== undefined) return deepestLast(before, source);
    return source.topRows().includes(key) ? { kind: "end" } : { kind: "row", key: parentOf(key) };
  }
}

/** The last row at or under `key`: back through a row means through everything in it first. */
function deepestLast(key: string, source: UEFITreeSearchSource): Position {
  let row = key;
  for (;;) {
    const children = source.listedChildren(row);
    if (children === undefined) return { kind: "expand", key: row };
    const last = children.at(-1);
    if (last === undefined) return { kind: "row", key: row };
    row = last;
  }
}

function siblingsOf(key: string, source: UEFITreeSearchSource): readonly string[] {
  const top = source.topRows();
  if (top.includes(key)) return top;
  return source.listedChildren(parentOf(key)) ?? [];
}

/**
 * What the search has opened in the tree, so it can shut it again. A row the reader
 * opened is theirs and stays; a row the search opened for a match it has since left is
 * shut, deepest first, when the walk lands somewhere that does not need it — and a row
 * the reader then opens or shuts on a match is theirs from that moment.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFITreeSearch.swift#UEFISearchOpenings
 */
export class UEFISearchOpenings {
  private rows: string[] = [];

  /** The rows the search opened and has not shut, in the order it opened them. */
  get opened(): readonly string[] {
    return this.rows;
  }

  get isEmpty(): boolean {
    return this.rows.length === 0;
  }

  /** The search opened `key`. */
  record(key: string): void {
    if (!this.rows.includes(key)) this.rows.push(key);
  }

  /**
   * `key` is no longer the search's to shut: the reader opened or shut it themselves, or
   * it is shut already.
   */
  forget(key: string): void {
    this.rows = this.rows.filter((one) => one !== key);
  }

  /**
   * Everything the search opened becomes the reader's: they left by a click, closed the
   * bar or changed what they look for, and the tree stays as it is.
   */
  release(): void {
    this.rows = [];
  }

  /**
   * The rows to shut when the walk lands on `target`, deepest first: those the search
   * opened that are neither the match nor above it. A row above the match is on the way
   * to it and stays open as long as the match is.
   */
  closings(target: string): string[] {
    const onTheWay = (key: string) => target === key || target.startsWith(`${key}.`);
    return this.rows
      .filter((key) => !onTheWay(key))
      .sort((a, b) => b.split(".").length - a.split(".").length);
  }
}
