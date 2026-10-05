/**
 * What copying a selection of a panel's details puts on the clipboard: a field's name,
 * a tab and its value, a table's cells with a tab between them, and a line per row —
 * which a spreadsheet takes as the table it was.
 *
 * The browser selects the text of the details as it selects any text — a drag across
 * rows, a word by a double click, a row by a triple click, the whole list by Ctrl+A —
 * and copies it as it lays it out, where the name and the value of a field are blocks
 * of their own and read as two lines. So the copy is made here, from the selected
 * fragment: a row of the list is `name<TAB>value`, a row of a table its cells, and a
 * passed check's tick, which is drawn and not read, is not copied.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSelectableRows.swift#ToolSelectableRows
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolFieldList.swift#ToolFieldList
 * @upstream-differs the browser selects and measures the text of the details, where
 * upstream draws one view per row and selects across them itself; what is left of that
 * is the text a copy makes of what the browser selected
 */

/** The part of a DOM node the copy reads, so that it can be run on a fake. */
export interface CopyNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly className?: string | undefined;
  readonly textContent: string | null;
  readonly childNodes: ArrayLike<CopyNode>;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const hasClass = (node: CopyNode, name: string): boolean =>
  node.className?.split(/\s+/).includes(name) === true;

/** The text of a node, with a tick or any other drawn mark left out. */
function plain(node: CopyNode): string {
  if (node.nodeType === TEXT_NODE) return node.textContent ?? "";
  if (node.nodeName.toLowerCase() === "svg") return "";
  let text = "";
  for (const child of Array.from(node.childNodes)) text += plain(child);
  return text;
}

/**
 * The lines of a fragment: each row of the list, each row of a table, and any other text
 * as it stands.
 */
function lines(node: CopyNode, into: string[]): void {
  if (node.nodeType === TEXT_NODE) {
    const text = (node.textContent ?? "").trim();
    if (text.length > 0) into.push(text);
    return;
  }
  if (node.nodeType !== ELEMENT_NODE && node.nodeType !== 11) return;
  const name = node.nodeName.toLowerCase();
  if (name === "svg" || name === "script" || name === "style") return;
  if (hasClass(node, "tool-detail-row")) {
    const parts = Array.from(node.childNodes)
      .filter((child) => child.nodeType === ELEMENT_NODE)
      .map(plain);
    into.push(parts.join("\t"));
    return;
  }
  if (name === "tr") {
    const cells = Array.from(node.childNodes)
      .filter((child) => child.nodeType === ELEMENT_NODE)
      .map(plain);
    into.push(cells.join("\t"));
    return;
  }
  // A selection that begins inside a row has the cells without the row around them.
  if (name === "td" || name === "th") {
    into.push(plain(node));
    return;
  }
  for (const child of Array.from(node.childNodes)) lines(child, into);
}

/**
 * The clipboard text of a selected fragment (`Range.cloneContents()`), or nothing when
 * it holds no text.
 */
export function detailCopyText(fragment: CopyNode): string {
  const found: string[] = [];
  lines(fragment, found);
  return found.join("\n");
}
