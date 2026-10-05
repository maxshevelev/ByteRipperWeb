import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { dvarCopies } from "@/firmware/uefi/dvarParser";
import { type EFIGUID, guidKey } from "@/firmware/uefi/efiGuid";
import { isDataOnlyEntry, NVAR, readNvarEntryIn } from "@/firmware/uefi/nvarParser";
import { variableName } from "@/firmware/uefi/nvramStoreFill";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { readVssEntry } from "@/firmware/uefi/vssVariable";

/**
 * The copies an NVRAM store keeps of one variable, oldest first
 * (`UEFI_IMAGE_FORMAT.md` §9).
 *
 * A store is written by appending: a variable that changes gets a new entry, and
 * the old one is marked rather than overwritten, until the firmware reclaims the
 * store. So until then the store holds the variable's earlier values as well —
 * the boot order before the last boot, Setup before the last change in it — and
 * two copies side by side say what the change was.
 *
 * A copy belongs to a variable by name and GUID. A VSS entry carries both,
 * marked or not, and its name is read from the bytes, since the tree calls a
 * marked entry `Invalid` as UEFITool does. An NVAR variable is a chain — the
 * first entry carries the name and GUID, later links only data — or a run of
 * whole entries, each superseded one with its valid bit cleared; a superseded
 * entry's name, GUID and value are read as if it were valid. A Dell DVAR variable
 * is a name id in a namespace, and an entry's state says whether it is the copy in
 * force (`dvarCopies`).
 *
 * The history is the store's, not the image's: the defaults a board keeps in
 * another store are another variable's copies.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory
 */
export interface NvramVariableHistory {
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.name */
  readonly name: string;
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.guid */
  readonly guid: EFIGUID | undefined;
  /**
   * In store order, which is the order they were written in.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.versions
   */
  readonly versions: readonly NvramVariableVersion[];
}

/**
 * The variable's value now, a value a later copy replaced, or the last copy of a
 * variable the store no longer holds.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Version.State
 */
export type NvramVariableState = "current" | "superseded" | "deleted";

/**
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Version
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Version.entry
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Version.offset
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Version.value
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Version.state
 */
export interface NvramVariableVersion {
  /** The entry the copy is. */
  readonly entry: readonly number[];
  /** Where the entry starts. */
  readonly offset: number;
  /** The variable's value in this copy. */
  readonly value: ImageRange;
  readonly state: NvramVariableState;
}

/**
 * What one copy changed against the copy before it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Change
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Change.oldSize
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Change.newSize
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Change.changed
 */
export interface NvramVariableChange {
  readonly oldSize: number;
  readonly newSize: number;
  /** The bytes that differ, as runs of offsets into the value, over the length both copies have. */
  readonly changed: readonly ImageRange[];
}

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Change.isNone */
export const isNoChange = (change: NvramVariableChange): boolean =>
  change.oldSize === change.newSize && change.changed.length === 0;

/** @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.Change.changedBytes */
export const changedBytes = (change: NvramVariableChange): number =>
  change.changed.reduce((sum, run) => sum + (run.end - run.start), 0);

interface Key {
  readonly name: string;
  readonly guid: EFIGUID | undefined;
}

interface Copy {
  readonly entry: readonly number[];
  readonly offset: number;
  readonly key: Key;
  readonly value: ImageRange;
  readonly isCurrent: boolean;
}

const keyText = (key: Key): string =>
  `${key.name}\u0000${key.guid === undefined ? "" : guidKey(key.guid)}`;
const sameId = (left: readonly number[], right: readonly number[]): boolean =>
  left.length === right.length && left.every((part, index) => part === right[index]);
const isVariableEntry = (node: UEFINode): boolean =>
  node.kind === "vssEntry" || node.kind === "nvarEntry" || node.kind === "dvarEntry";

/**
 * The history of the variable `entry` is a copy of, in the store whose entries
 * are `store`'s children. Nothing when `entry` is not a VSS or NVAR entry, its
 * variable cannot be told, or the store keeps one copy of it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.of
 */
export function variableHistoryOf(
  entry: UEFINode,
  store: UEFINode,
  reader: ImageReader
): NvramVariableHistory | undefined {
  if (!isVariableEntry(entry)) return undefined;
  const all = copiesIn(store, reader);
  const mine = all.find((copy) => sameId(copy.entry, entry.id));
  if (mine === undefined) return undefined;
  const wanted = keyText(mine.key);
  const versions = all.filter((copy) => keyText(copy.key) === wanted);
  if (versions.length <= 1) return undefined;

  const shown: NvramVariableVersion[] = versions.map((copy) => ({
    entry: copy.entry,
    offset: copy.offset,
    value: copy.value,
    state: copy.isCurrent ? "current" : "superseded",
  }));
  // With no current copy the variable was deleted, and the last copy is the one it
  // was deleted as.
  if (!shown.some((one) => one.state === "current")) {
    const last = shown[shown.length - 1];
    if (last !== undefined) shown[shown.length - 1] = { ...last, state: "deleted" };
  }
  return { name: mine.key.name, guid: mine.key.guid, versions: shown };
}

/**
 * The variable `entry` is a copy of — its name and GUID — read from the bytes
 * where the tree cannot name it. Nothing when it cannot be told.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.variable
 */
export function variableOf(
  entry: UEFINode,
  store: UEFINode,
  reader: ImageReader
): { readonly name: string; readonly guid: EFIGUID | undefined } | undefined {
  if (!isVariableEntry(entry)) return undefined;
  const found = copiesIn(store, reader).find((copy) => sameId(copy.entry, entry.id));
  return found === undefined ? undefined : { name: found.key.name, guid: found.key.guid };
}

/**
 * The copies a tree can leave out of a store's rows, each with the copy that stands
 * for its variable instead: every copy a later one replaced, mapped to the
 * variable's current copy — or, for a variable the store no longer holds, to the
 * copy it was deleted as, which stays, so a deleted variable does not vanish. A
 * current copy is never left out, nor an entry whose variable cannot be told. Empty
 * for a node that is not a store of VSS, NVAR or DVAR entries.
 *
 * Keyed by the entry's id as text (`1.4.2`).
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.supersededCopies
 */
export function supersededCopies(
  store: UEFINode,
  reader: ImageReader
): Map<string, readonly number[]> {
  const hidden = new Map<string, readonly number[]>();
  if (!store.children.some(isVariableEntry)) return hidden;
  const byVariable = new Map<string, Copy[]>();
  for (const copy of copiesIn(store, reader)) {
    const key = keyText(copy.key);
    const list = byVariable.get(key);
    if (list === undefined) byVariable.set(key, [copy]);
    else list.push(copy);
  }
  for (const versions of byVariable.values()) {
    if (versions.length <= 1) continue;
    const standing = versions.findLast((copy) => copy.isCurrent) ?? versions[versions.length - 1];
    if (standing === undefined) continue;
    for (const copy of versions) {
      if (!copy.isCurrent && !sameId(copy.entry, standing.entry)) {
        hidden.set(copy.entry.join("."), standing.entry);
      }
    }
  }
  return hidden;
}

/**
 * `to` against `from`: their sizes, and the runs of bytes that differ.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.change
 */
export function variableChange(
  from: NvramVariableVersion,
  to: NvramVariableVersion,
  reader: ImageReader
): NvramVariableChange | undefined {
  const old = reader.bytes(from.value);
  const now = reader.bytes(to.value);
  if (old === undefined || now === undefined) return undefined;
  const runs: ImageRange[] = [];
  let open: number | undefined;
  const common = Math.min(old.length, now.length);
  for (let index = 0; index < common; index++) {
    if (old[index] !== now[index]) {
      if (open === undefined) open = index;
    } else if (open !== undefined) {
      runs.push({ start: open, end: index });
      open = undefined;
    }
  }
  if (open !== undefined) runs.push({ start: open, end: common });
  return { oldSize: old.length, newSize: now.length, changed: runs };
}

// MARK: - Reading the copies

/** Every entry of the store that can be told whose copy it is. */
function copiesIn(store: UEFINode, reader: ImageReader): Copy[] {
  if (store.kind === "dvarStore") {
    return dvarCopies(store, reader).map((copy) => ({
      entry: copy.node.id,
      offset: copy.node.header.start,
      key: { name: copy.name, guid: copy.guid },
      value: copy.node.body,
      isCurrent: copy.isCurrent,
    }));
  }
  const entries = store.children.filter(isVariableEntry);
  const first = entries[0];
  if (first === undefined) return [];
  return first.kind === "vssEntry"
    ? vssCopies(entries, store.kind === "vss2Store", reader)
    : nvarCopies(entries, store.body, reader);
}

function vssCopies(entries: readonly UEFINode[], inVss2: boolean, reader: ImageReader): Copy[] {
  const copies: Copy[] = [];
  for (const entry of entries) {
    const isCurrent = entry.subtype !== Sub.invalidVssEntry;
    // The same reading for a marked entry and a live one, so the two name a
    // variable alike.
    const name = variableName(entry, inVss2, reader) ?? (isCurrent ? entry.name : undefined);
    if (name === undefined) continue;
    copies.push({
      entry: entry.id,
      offset: entry.header.start,
      key: { name, guid: entry.guid },
      value: vssValue(entry, inVss2, reader),
      isCurrent,
    });
  }
  return copies;
}

/**
 * A VSS2 entry's body is its value. A `$VSS` entry's body opens with the name, as
 * long as the header says.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/NvramVariableHistory.swift#NvramVariableHistory.vssValue
 */
function vssValue(entry: UEFINode, inVss2: boolean, reader: ImageReader): ImageRange {
  if (inVss2) return entry.body;
  return readVssEntry(entry, false, reader)?.data ?? entry.body;
}

/**
 * NVAR entries, read as if each were valid: a whole entry names its variable, a
 * later link takes the name of the entry whose `next` points at it — the nearest
 * one before it, being the last written.
 */
function nvarCopies(entries: readonly UEFINode[], store: ImageRange, reader: ImageReader): Copy[] {
  const linkedFrom = new Map<number, Key>();
  const copies: Copy[] = [];
  for (const node of entries) {
    const offset = node.header.start;
    const entry = readNvarEntryIn(reader, offset, store, true);
    if (entry === undefined) continue;
    let key: Key | undefined;
    if (isDataOnlyEntry(entry)) {
      key = linkedFrom.get(offset);
    } else {
      let guid = entry.localGuid;
      if (guid === undefined && entry.guidIndex !== undefined) {
        const back = NVAR.guidSize * (entry.guidIndex + 1);
        if (store.end - store.start >= back) guid = reader.guid(store.end - back);
      }
      const name = entry.text ?? "";
      key = {
        name: name === "" ? (guid === undefined ? "" : guidKey(guid)) : name,
        guid,
      };
    }
    if (entry.next !== NVAR.noNext && key !== undefined) linkedFrom.set(offset + entry.next, key);
    if (key === undefined || key.name === "") continue;
    copies.push({
      entry: node.id,
      offset,
      key,
      value: { start: entry.dataStart, end: entry.extendedStart },
      isCurrent: node.subtype === Sub.fullNvarEntry || node.subtype === Sub.dataNvarEntry,
    });
  }
  return copies;
}
