import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import { isObject, type Json } from "@/core/agent/json";
import type { ImageReader } from "@/firmware/imageReader";
import { guidText } from "@/firmware/uefi/efiGuid";
import { readNvramValue } from "@/firmware/uefi/nvramValue";
import { variablesIn } from "@/firmware/uefi/nvramVariableHistory";
import { nodeFileRange, nodeIdText, type UEFINode } from "@/firmware/uefi/uefiNode";
import { readVssEntry } from "@/firmware/uefi/vssVariable";
import { hexText } from "@/tools/uefi/agent/uefiAgentQueries";
import { type AgentTree, allNodes, openEverything } from "@/tools/uefi/agent/uefiAgentTree";
import { hexBytes, nvarValueAttributes, shortText } from "@/tools/uefi/nvramValueText";
import { ownName, typeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * The NVRAM variables of an image for an agent, and two images' variables set side by side.
 *
 * A variable is what the firmware reads, not an entry of a store: the copy that stands for it — the
 * current one, or for a deleted variable the copy it was deleted as — with the number of copies the
 * store keeps. Every store of VSS, VSS2, NVAR, Dell DVAR and GPNV entries in the image is read, those
 * inside compressed sections too, in the tree's order.
 *
 * Two images are compared by what a variable is, never by where it is: its name and GUID, and — for
 * a name and GUID the image keeps more than once, a board's defaults beside its live store — which
 * time it is met, in the tree's order.
 *
 * The worker reads the rows, since the tree and its decompressed buffers are there; the page filters,
 * pages and compares them, which is the half that is the same for one document and for two.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables
 */

/** The longest value read as its type; past it, only the size. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.valueReadLimit */
export const VALUE_READ_LIMIT = 0x10000;
/** The longest value spelled out as hex when it reads as nothing else. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.hexLimit */
export const HEX_LIMIT = 32;
/** The most runs of differing bytes one changed variable lists. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.runLimit */
export const RUN_LIMIT = 16;

/** The store a row is in, as the answer names it. */
export interface VariableStore {
  readonly id: string;
  readonly summary: { [key: string]: Json };
}

/**
 * One variable, as it crosses from the worker: plain data. `bytes` is the whole value, for the
 * comparison; `valueText` is it read as its type, or hex when it is short.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.Variable
 */
export interface VariableRow {
  readonly store: VariableStore;
  readonly name: string;
  readonly guid: string | undefined;
  readonly entry: string;
  readonly size: number;
  /** The value's bytes in the file; nothing inside a decompressed section. */
  readonly range: { readonly start: number; readonly end: number } | undefined;
  readonly isDeleted: boolean;
  readonly copies: number;
  readonly valueText: string | undefined;
  readonly bytes: Uint8Array;
}

const isEntry = (node: UEFINode): boolean =>
  node.kind === "vssEntry" ||
  node.kind === "nvarEntry" ||
  node.kind === "dvarEntry" ||
  node.kind === "gpnvRecord";

/**
 * The attributes in VSS bits, which is what `NvramValue` reads a value by: a VSS entry's own, an NVAR
 * entry's hardware error record flag, and none for the formats that keep none.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.attributes
 */
function attributesOf(entry: UEFINode, store: UEFINode, reader: ImageReader): number {
  switch (entry.kind) {
    case "vssEntry":
      return readVssEntry(entry, store.kind === "vss2Store", reader)?.attributes ?? 0;
    case "nvarEntry":
      return nvarValueAttributes(entry, reader);
    default:
      return 0;
  }
}

/**
 * The value read as its type, or as hex when it is short.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.valueText
 */
function valueTextOf(
  name: string,
  guid: Parameters<typeof readNvramValue>[1],
  attributes: number,
  bytes: Uint8Array
): string | undefined {
  if (bytes.length > VALUE_READ_LIMIT) return undefined;
  const value = readNvramValue(name, guid, attributes, bytes);
  const text = shortText(value);
  if (text !== undefined) return text;
  return value.content.kind === "bytes" && bytes.length <= HEX_LIMIT ? hexBytes(bytes) : undefined;
}

/**
 * Every variable of every store in the tree, opened to the last container, in tree order.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.variables
 */
export function variableRows(tree: AgentTree): VariableRow[] {
  openEverything(tree);
  const rows: VariableRow[] = [];
  for (const store of allNodes(tree)) {
    if (!store.children.some(isEntry)) continue;
    const reader = tree.spaceReaders.readerFor(store.space);
    if (reader === undefined) continue;
    const entries = new Map<string, UEFINode>();
    for (const child of store.children) {
      const key = nodeIdText(child.id);
      if (!entries.has(key)) entries.set(key, child);
    }
    const type = typeText(store);
    const storeName = ownName(store) ?? store.name;
    const range = nodeFileRange(store);
    const summary: { [key: string]: Json } = { id: nodeIdText(store.id), type };
    if (storeName !== type) summary.name = storeName;
    if (range !== undefined) {
      summary.start = hexText(range.start);
      summary.end = hexText(range.end);
    }
    for (const variable of variablesIn(store, reader)) {
      const entry = entries.get(nodeIdText(variable.entry));
      if (entry === undefined) continue;
      const bytes = reader.bytes(variable.value) ?? new Uint8Array(0);
      const attributes = attributesOf(entry, store, reader);
      rows.push({
        store: { id: nodeIdText(store.id), summary },
        name: variable.name,
        guid: variable.guid === undefined ? undefined : guidText(variable.guid),
        entry: nodeIdText(entry.id),
        size: variable.value.end - variable.value.start,
        range: nodeFileRange(entry) === undefined ? undefined : variable.value,
        isDeleted: variable.state === "deleted",
        copies: variable.copies,
        valueText: valueTextOf(variable.name, variable.guid, attributes, bytes),
        bytes,
      });
    }
  }
  return rows;
}

// MARK: - variables

export const VARIABLES = {
  name: "variables",
  title: "NVRAM variables",
  description:
    "The NVRAM variables the image keeps, from every VSS, VSS2, NVAR, Dell DVAR and GPNV store — " +
    "those inside compressed sections too, so the first call on a large image takes a few seconds. " +
    "`stores` lists the stores the rows are in, with how many variables each holds. " +
    "One row per variable: the copy that stands for it now. `copies` above 1 says the store still " +
    "keeps earlier values (`uefi_node` on the entry lists them); `deleted: true` is a variable the " +
    "store no longer holds, listed only with `deleted`. Each row: name, GUID, the store's and the " +
    "entry's node ids, the value's bytes (`start`, `end`, `size`), and `value` — the value read as " +
    "its type (a number, text, a boot option, a device path, a signature list) or as hex when it " +
    "is short. Other stores (EVSA, Apple SysF, flash maps) are in `uefi_tree`. Pages: `limit` is " +
    "a ceiling — a page also stops before the answer passes the size bound and then says " +
    '`truncated: "size"`; pass `next` back as `after` until it is null. `total` counts every row. ' +
    'A row too large alone comes without its `value`, marked `truncated: "item"`; `read` its bytes.',
  properties: {
    name: AgentSchema.string("Part of the variable's name, any case."),
    guid: AgentSchema.string("The vendor GUID, exact."),
    store: AgentSchema.string("Only this store's variables: its node id from an earlier answer."),
    deleted: AgentSchema.boolean("Also list variables the store no longer holds. Default false."),
    limit: AgentSchema.limit(80, 300),
    after: AgentSchema.after,
  },
} as const;

/** One row of the `variables` answer without its store. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.brief */
function brief(row: VariableRow): { [key: string]: Json } {
  const members: { [key: string]: Json } = { name: row.name, size: row.size };
  if (row.guid !== undefined) members.guid = row.guid;
  if (row.valueText !== undefined) members.value = row.valueText;
  return members;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.row */
function rowAnswer(row: VariableRow): { [key: string]: Json } {
  const members = brief(row);
  members.store = row.store.id;
  members.entry = row.entry;
  if (row.copies > 1) members.copies = row.copies;
  if (row.isDeleted) members.deleted = true;
  if (row.range !== undefined) {
    members.start = hexText(row.range.start);
    members.end = hexText(row.range.end);
  } else {
    members.in_compressed = true;
  }
  return members;
}

/** The `variables` answer over a document's rows. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.variables */
export function variablesAnswer(
  all: readonly VariableRow[],
  args: AgentArguments,
  contentVersion: number
): Json {
  const name = args.optionalString("name")?.toLowerCase();
  const guid = args.optionalString("guid")?.toUpperCase();
  const store = args.optionalString("store");
  const deleted = args.bool("deleted", false);
  const limit = args.limit(80, 300);
  const paging = new AgentPage(
    args,
    AgentPage.fingerprint([contentVersion, name ?? null, guid ?? null, store ?? null, deleted])
  );
  const chosen = all.filter((row) => {
    if (!deleted && row.isDeleted) return false;
    if (name !== undefined && !row.name.toLowerCase().includes(name)) return false;
    if (guid !== undefined && row.guid?.toUpperCase() !== guid) return false;
    if (store !== undefined && row.store.id !== store) return false;
    return true;
  });
  // The stores the rows are in, each with all it holds: of every row that may go on the page while
  // the page is cut to fit, then of the rows that did — fewer, so the answer only gets shorter.
  const storesOf = (rows: readonly VariableRow[]): Json[] => {
    const stores = new Map<string, VariableStore>();
    for (const row of rows) stores.set(row.store.id, row.store);
    return [...stores.values()]
      .sort((left, right) => comparePath(left.id, right.id))
      .map((one) => ({
        ...one.summary,
        variables: all.filter((row) => row.store.id === one.id).length,
      }));
  };
  const candidates = chosen.slice(paging.first, paging.first + limit);
  const envelope: { [key: string]: Json } = { total: chosen.length, stores: storesOf(candidates) };
  if (all.length === 0) envelope.note = "No VSS, NVAR, DVAR or GPNV store in this image.";
  const answer = paging.answer(
    envelope,
    "variables",
    candidates.map(rowAnswer),
    chosen.length,
    args.answerBound,
    (item) => {
      if (!isObject(item) || item.value === undefined) return undefined;
      const { value: _value, ...rest } = item;
      return { ...rest, truncated: "item" };
    }
  );
  if (isObject(answer) && Array.isArray(answer.variables)) {
    answer.stores = storesOf(candidates.slice(0, answer.variables.length));
  }
  return answer;
}

const comparePath = (left: string, right: string): number => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.length - b.length;
};

// MARK: - variables_compare

export const VARIABLES_COMPARE = {
  name: "variables_compare",
  title: "Compare NVRAM variables",
  description:
    "Sets the NVRAM variables of two documents side by side — `document` and `against` — by name " +
    "and GUID, not by address, so two dumps of different boards or BIOS versions compare as well " +
    "as two of one board. A name and GUID kept twice in an image (live and default stores) is " +
    "paired by which time it is met. Answers the variables only in one of them, those whose values " +
    "differ — with both sizes, the bytes that differ as offsets into the value, and both values " +
    "read as their type — and how many are the same. Variables a store no longer holds are left " +
    "out. `survey` with this tool and a fixed `against` compares a folder of dumps with one. " +
    "Pages: the three lists are one sequence — `changed`, then `only_in_document`, then " +
    "`only_in_against` — and `limit` is the most items of it on one page, a ceiling: a page also " +
    'stops before the answer passes the size bound and then says `truncated: "size"`. Pass `next` ' +
    "back as `after` until it is null; `counts` and `same` are of the whole comparison. A changed " +
    'variable too large alone comes without its values, marked `truncated: "item"`.',
  properties: {
    name: AgentSchema.string("Only variables whose name contains this, any case."),
    limit: AgentSchema.limit(40, 200),
    after: AgentSchema.after,
  },
} as const;

/**
 * The runs of offsets at which `a` and `b` differ, as half-open ranges into the value — over the
 * length both have, then the tail only the longer one has as one run.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.differingRuns
 */
export function differingRuns(
  a: Uint8Array,
  b: Uint8Array
): { readonly start: number; readonly end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let open: number | undefined;
  const common = Math.min(a.length, b.length);
  for (let index = 0; index < common; index++) {
    if (a[index] !== b[index]) {
      if (open === undefined) open = index;
    } else if (open !== undefined) {
      runs.push({ start: open, end: index });
      open = undefined;
    }
  }
  if (open !== undefined) runs.push({ start: open, end: common });
  if (a.length !== b.length) {
    const tail = { start: common, end: Math.max(a.length, b.length) };
    const last = runs.at(-1);
    if (last !== undefined && last.end === common) last.end = tail.end;
    else runs.push(tail);
  }
  return runs;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.difference */
function difference(mine: VariableRow, theirs: VariableRow): { [key: string]: Json } {
  const runs = differingRuns(mine.bytes, theirs.bytes);
  const hex = (value: number) => hexText(value);
  const members: { [key: string]: Json } = {
    name: mine.name,
    size: mine.bytes.length,
    against_size: theirs.bytes.length,
    differing_bytes: runs.reduce((sum, run) => sum + (run.end - run.start), 0),
    runs: runs
      .slice(0, RUN_LIMIT)
      .map((run) =>
        run.end - run.start === 1 ? hex(run.start) : `${hex(run.start)}–${hex(run.end)}`
      ),
    entry: mine.entry,
    against_entry: theirs.entry,
  };
  if (mine.guid !== undefined) members.guid = mine.guid;
  if (runs.length > RUN_LIMIT) members.runs_total = runs.length;
  if (mine.valueText !== undefined) members.value = mine.valueText;
  if (theirs.valueText !== undefined) members.against_value = theirs.valueText;
  return members;
}

/** The pair keys the comparison matches by: name, GUID and which time the image meets the pair. */
function keyed(rows: readonly VariableRow[], name: string | undefined): [string, VariableRow][] {
  const seen = new Map<string, number>();
  const result: [string, VariableRow][] = [];
  for (const row of rows) {
    if (row.isDeleted || (name !== undefined && !row.name.toLowerCase().includes(name))) continue;
    const pair = `${row.name}\u0000${row.guid ?? ""}`;
    const occurrence = seen.get(pair) ?? 0;
    seen.set(pair, occurrence + 1);
    result.push([`${pair}\u0000${occurrence}`, row]);
  }
  return result;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);

/** The `variables_compare` answer over two documents' rows. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentVariables.swift#UEFIAgentVariables.compare */
export function variablesCompareAnswer(
  mineRows: readonly VariableRow[],
  theirRows: readonly VariableRow[],
  args: AgentArguments,
  versions: readonly [number, number]
): Json {
  const name = args.optionalString("name")?.toLowerCase();
  const limit = args.limit(40, 200);
  const paging = new AgentPage(
    args,
    AgentPage.fingerprint([versions[0], versions[1], name ?? null])
  );
  const mine = keyed(mineRows, name);
  const theirs = keyed(theirRows, name);
  const theirsByKey = new Map<string, VariableRow>();
  for (const [key, row] of theirs) if (!theirsByKey.has(key)) theirsByKey.set(key, row);
  const mineKeys = new Set(mine.map(([key]) => key));

  const onlyHere: VariableRow[] = [];
  const changed: [VariableRow, VariableRow][] = [];
  let same = 0;
  for (const [key, row] of mine) {
    const other = theirsByKey.get(key);
    if (other === undefined) {
      onlyHere.push(row);
    } else if (sameBytes(row.bytes, other.bytes)) {
      same += 1;
    } else {
      changed.push([row, other]);
    }
  }
  const onlyThere = theirs.filter(([key]) => !mineKeys.has(key)).map(([, row]) => row);

  // The page's items, built only for the stretch of the sequence it may hold.
  const total = changed.length + onlyHere.length + onlyThere.length;
  const items: { key: string; item: Json }[] = [];
  for (let index = paging.first; index < Math.min(total, paging.first + limit); index++) {
    if (index < changed.length) {
      const [row, other] = changed[index] as [VariableRow, VariableRow];
      items.push({ key: "changed", item: difference(row, other) });
    } else if (index < changed.length + onlyHere.length) {
      items.push({
        key: "only_in_document",
        item: brief(onlyHere[index - changed.length] as VariableRow),
      });
    } else {
      items.push({
        key: "only_in_against",
        item: brief(onlyThere[index - changed.length - onlyHere.length] as VariableRow),
      });
    }
  }
  const envelope: { [key: string]: Json } = {
    same,
    counts: {
      only_in_document: onlyHere.length,
      only_in_against: onlyThere.length,
      changed: changed.length,
    },
  };
  return paging.answerLists(
    envelope,
    ["changed", "only_in_document", "only_in_against"],
    items,
    total,
    args.answerBound,
    (item) => {
      if (!isObject(item) || (item.value === undefined && item.against_value === undefined)) {
        return undefined;
      }
      const { value: _value, against_value: _against, ...rest } = item;
      return { ...rest, truncated: "item" };
    }
  );
}
