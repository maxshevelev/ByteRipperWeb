import { sourceOver } from "@/firmware/byteSource";
import { FIT, FIT_ENTRY_SIZE } from "@/firmware/fit/fitEntry";
import type { FITTable } from "@/firmware/fit/fitTable";
import type { ImageRange, ImageReader } from "@/firmware/imageReader";
import { ImageReader as Reader } from "@/firmware/imageReader";
import { OverlayByteSource } from "@/firmware/overlayByteSource";
import { repairsForFile } from "@/firmware/uefi/checksumRepair";
import { alignUp, sum8, sum32Of } from "@/firmware/uefi/checksums";
import {
  type MicrocodeHeader,
  microcodeRange,
  readMicrocodeHeader,
} from "@/firmware/uefi/microcodeParser";
import type { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import type { ToolTransaction, ToolWrite } from "@/tools/toolTransaction";

/**
 * The two changes this tool makes to a table: adding a microcode entry and
 * taking one out.
 *
 * Both come back as a {@link ToolTransaction} rather than as writes performed
 * here: a whole edit — the component, the rows shifted around it, the header's
 * count and its checksum — has to land as one undoable step or not at all.
 * Neither changes the file's size, which the specification requires: a flash
 * dump is the size of the chip it came off.
 *
 * Ported from `Modules/FITTool/FITEditor.swift`.
 */

/**
 * Why a change to the table cannot be made.
 *
 * Each of these is a rule from the specification, and each is worth saying in a
 * sentence rather than refusing silently: the user is at a bench with a dump
 * that has to boot afterwards.
 */
export type FITEditProblem =
  /** The file this tool was pointed at is not a microcode image. */
  | { readonly kind: "notMicrocode" }
  /** Its dword checksum does not come out at zero. */
  | { readonly kind: "microcodeChecksumIsWrong" }
  /**
   * There is no microcode in the table to put the new one after, so there is no
   * telling where this image keeps them.
   */
  | { readonly kind: "noMicrocodeToFollow" }
  /**
   * The table has no empty slot and the bytes after it are not free, so it
   * cannot grow. Carries what is in the way, because "no empty slot" on its own
   * leaves nobody anywhere to go.
   */
  | { readonly kind: "theTableCannotGrow"; readonly after: string }
  /**
   * The run would have to grow further than there is room for. Carries how much
   * more it needs and what it would have to grow through — a refusal that says
   * neither leaves the user with nowhere to go.
   */
  | { readonly kind: "theRunCannotGrow"; readonly needed: number; readonly inside: string }
  /** The header is not an entry to be removed. */
  | { readonly kind: "cannotRemoveTheHeader" }
  /** A table needs at least one microcode entry. */
  | { readonly kind: "cannotRemoveTheLastMicrocode" }
  /**
   * The row is not a microcode, and only a microcode is removed: the extent of
   * anything else a row can point at is not something this tool knows, and
   * moving bytes it cannot measure is not a thing to guess at.
   */
  | { readonly kind: "notAMicrocodeRow" }
  | { readonly kind: "noSuchEntry" }
  /** Nothing to add to. */
  | { readonly kind: "noTable" };

export function fitEditProblemMessage(problem: FITEditProblem): string {
  switch (problem.kind) {
    case "notMicrocode":
      return "That file does not start with an Intel microcode header.";
    case "microcodeChecksumIsWrong":
      return "That microcode's checksum does not add up — its dwords should sum to zero.";
    case "noMicrocodeToFollow":
      return "There is no microcode in this table to put a new one after.";
    case "theTableCannotGrow":
      return (
        "The table has no empty slot, and the sixteen bytes after it are not free — " +
        `they are ${problem.after}.`
      );
    case "theRunCannotGrow":
      return (
        `The microcode run needs 0x${problem.needed.toString(16).toUpperCase()} more bytes ` +
        `than are free after it, in ${problem.inside}.`
      );
    case "cannotRemoveTheHeader":
      return "The header is not an entry.";
    case "cannotRemoveTheLastMicrocode":
      return "A FIT needs at least one microcode entry.";
    case "notAMicrocodeRow":
      return "Only a microcode entry can be removed.";
    case "noSuchEntry":
      return "That entry is no longer in the table.";
    case "noTable":
      return "There is no FIT table in this file to change.";
  }
}

/** What a change to the table turned out to be, for the sentence said after. */
export interface FITEditOutcome {
  /** A new row for a CPUID the table did not name, or one it already named. */
  readonly kind: "added" | "replaced";
  /** Where the component went. */
  readonly range: ImageRange;
  /** The row that names it. */
  readonly entryIndex: number;
  /** What the replaced component was, when there was one. */
  readonly replaced: MicrocodeHeader | undefined;
  /**
   * How many components behind it moved, because the new one is a different
   * size from the old.
   */
  readonly moved: number;
}

/** What a removal came to. */
export interface FITRemovalOutcome {
  readonly entryIndex: number;
  /** How many components moved up into the space the removed one left. */
  readonly moved: number;
  /** The bytes the move freed at the end of the run, now erased. */
  readonly erased: ImageRange | undefined;
}

export type FITEdit<T> =
  | { readonly ok: true; readonly transaction: ToolTransaction; readonly outcome: T }
  | { readonly ok: false; readonly problem: FITEditProblem };

const refuse = <T>(problem: FITEditProblem): FITEdit<T> => ({ ok: false, problem });

/** A microcode image the user picked, checked before anything is written. */
export function readPickedMicrocode(
  bytes: Uint8Array
):
  | { readonly ok: true; readonly header: MicrocodeHeader }
  | { readonly ok: false; readonly problem: FITEditProblem } {
  const reader = new Reader(sourceOver(bytes));
  const header = readMicrocodeHeader(0, reader);
  if (header === undefined || microcodeRange(header).end > reader.count) {
    return { ok: false, problem: { kind: "notMicrocode" } };
  }
  if (sum32Of(microcodeRange(header), reader) !== 0) {
    return { ok: false, problem: { kind: "microcodeChecksumIsWrong" } };
  }
  return { ok: true, header };
}

/**
 * Adds a microcode, or replaces the one already there for its CPUID.
 *
 * A dump is for one board, and the ordinary reason to open this form is that a
 * CPUID already in the table has a newer revision. Adding a second row for the
 * same processor would leave the FIT naming two microcodes for it — legal,
 * wasteful, and not what anybody meant.
 *
 * Replacing has two shapes. Where the new component is no bigger than the old
 * one it goes exactly where that one was, the tail of the old one is erased
 * behind it, and *nothing about the table changes* — not the row, not the
 * count, not even the checksum. Where it is bigger it goes wherever a new one
 * would, and the row that named the old one is repointed. The old bytes are
 * left where they are either way: erasing them is the riskier half of the edit.
 */
export function addOrReplaceMicrocode(
  component: Uint8Array,
  table: FITTable,
  image: UEFIImage | undefined,
  reader: ImageReader,
  addressDiff: number
): FITEdit<FITEditOutcome> {
  const read = readPickedMicrocode(component);
  if (!read.ok) return refuse(read.problem);
  // Exactly what the header claims, so a file with something after it does not
  // drag the extra bytes into the image.
  const bytes = component.subarray(0, read.header.totalSize);

  const row = rowNaming(read.header, table);
  if (row === undefined) {
    return addingNewRow(bytes, read.header, table, image, reader, addressDiff);
  }
  return replacing(row, bytes, read.header, table, image, reader, addressDiff);
}

/**
 * Swaps the microcode a specific row names for another, whatever the new one's
 * CPUID.
 *
 * This is the row's "Replace Microcode": the user pointed at one entry and said
 * "put a different microcode here", so the row is the target, not a CPUID
 * match. The new component may be for a different processor — a row that named
 * one CPUID now names another — and the table keeps the same number of rows.
 */
export function replaceMicrocodeAt(
  index: number,
  component: Uint8Array,
  table: FITTable,
  image: UEFIImage | undefined,
  reader: ImageReader,
  addressDiff: number
): FITEdit<FITEditOutcome> {
  const read = readPickedMicrocode(component);
  if (!read.ok) return refuse(read.problem);
  const bytes = component.subarray(0, read.header.totalSize);

  const row = table.rows[index];
  if (index <= 0 || row === undefined || row.target.kind !== "microcode") {
    return refuse({ kind: "noSuchEntry" });
  }
  return replacing(
    { index, component: row.target.header },
    bytes,
    read.header,
    table,
    image,
    reader,
    addressDiff
  );
}

/**
 * Takes a microcode entry out, body and all.
 *
 * A microcode run is one block, and a hole in the middle of it is not what a
 * bench wants back: the component's bytes go, everything after it in the run
 * moves up into the space, the rows that name those components are repointed,
 * and the bytes the move frees at the end are erased. The table loses the row
 * and the header's count comes down with it.
 *
 * A component only moves if everything between it and the one before it is
 * erased — so nothing that is not part of the run can be written over, and the
 * compaction stops at the first thing that is.
 *
 * Moving a component changes its address, which anything outside the FIT that
 * named it will not know about. What this *can* put right it does: a run inside
 * an FFS file leaves that file's checksums describing what used to be there,
 * and those are recomputed into the same transaction.
 */
export function removeMicrocodeAt(
  index: number,
  table: FITTable,
  image: UEFIImage | undefined,
  reader: ImageReader,
  addressDiff: number
): FITEdit<FITRemovalOutcome> {
  if (index <= 0) return refuse({ kind: "cannotRemoveTheHeader" });
  const target = table.rows[index];
  if (target === undefined) return refuse({ kind: "noSuchEntry" });
  // Only a microcode is removed: the extent of anything else a row can point at
  // is not something this tool knows.
  if (target.target.kind !== "microcode") return refuse({ kind: "notAMicrocodeRow" });
  const removed = target.target.header;

  const rows = rowBytes(table, reader);
  if (rows === undefined || index >= rows.length) return refuse({ kind: "noSuchEntry" });
  // The last one is not removed at all: a table without it will not boot the
  // machine it came out of.
  if (rows.filter((row) => typeOf(row) === FIT.microcodeType).length === 1) {
    return refuse({ kind: "cannotRemoveTheLastMicrocode" });
  }

  // Dropping a component is re-laying the run with nothing in its place, which
  // is the same operation as replacing it with something of another size.
  const run = runOf(table, reader);
  const first = run[0];
  const last = run.at(-1);
  if (first?.kind !== "existing" || last?.kind !== "existing") {
    return refuse({ kind: "noSuchEntry" });
  }
  const items = run.filter(
    (item) => item.kind !== "existing" || item.header.offset !== removed.offset
  );
  const plan = relayRun(items, first.header.offset, microcodeRange(last.header).end, image, reader);
  if (!plan.ok) return refuse(plan.problem);

  const writes: ToolWrite[] = [];
  if (plan.layout.write !== undefined) writes.push(plan.layout.write);
  if (plan.layout.growth !== undefined) writes.push(plan.layout.growth.write);
  for (const move of plan.layout.moves) {
    writeAddress(rows[move.rowIndex], move.newOffset + addressDiff);
  }

  rows.splice(index, 1);
  // The sixteen bytes the table gives up are wiped behind it, so no stale row
  // is left for another parser to trip over — with the fill the file the table
  // sits in already uses, so the tail stays the one uniform stretch that the
  // next edit can read as free.
  const element = image?.innermostNodeContaining(table.range.start);
  const fill = fillByte(
    table.range.end,
    element === undefined ? reader.count : nodeRange(element).end,
    reader
  );
  const assembled = new Uint8Array(rows.length * FIT_ENTRY_SIZE + FIT_ENTRY_SIZE).fill(fill);
  assembled.set(assemble(rows, table.checksumIsChecked));
  writes.push({ offset: table.range.start, bytes: assembled });

  return {
    ok: true,
    transaction: withContainerRepairs(
      { name: "Remove Microcode", writes },
      image,
      reader,
      undefined
    ),
    outcome: {
      entryIndex: index,
      moved: plan.layout.moves.length,
      erased: plan.layout.erased,
    },
  };
}

// MARK: - Adding and replacing

/** A row of the table and the component it names. */
interface NamedRow {
  readonly index: number;
  readonly component: MicrocodeHeader;
}

/**
 * The row whose component is for this processor.
 *
 * One CPUID can have several rows, one per platform mask, and they are not
 * interchangeable: a microcode for platform 02 does not belong in the row that
 * names platform 22's. So an exact mask wins, an overlapping one is next, and
 * only if neither is there does the first row for the CPUID answer.
 */
function rowNaming(header: MicrocodeHeader, table: FITTable): NamedRow | undefined {
  const candidates: NamedRow[] = [];
  for (const row of table.rows) {
    if (row.target.kind !== "microcode") continue;
    if (row.target.header.processorSignature !== header.processorSignature) continue;
    candidates.push({ index: row.entry.index, component: row.target.header });
  }
  return (
    candidates.find((one) => one.component.platformIDs === header.platformIDs) ??
    candidates.find((one) => (one.component.platformIDs & header.platformIDs) !== 0) ??
    candidates[0]
  );
}

/**
 * The shared half of a replacement: lay the run down again with the row's
 * component swapped for the new bytes, and repoint the row only when the move
 * demands it.
 */
function replacing(
  row: NamedRow,
  bytes: Uint8Array,
  header: MicrocodeHeader,
  table: FITTable,
  image: UEFIImage | undefined,
  reader: ImageReader,
  addressDiff: number
): FITEdit<FITEditOutcome> {
  const old = row.component;
  const run = runOf(table, reader);
  const at = run.findIndex((item) => item.kind === "existing" && item.header.offset === old.offset);
  const first = run[0];
  const last = run.at(-1);
  if (at < 0 || first?.kind !== "existing" || last?.kind !== "existing") {
    return refuse({ kind: "noSuchEntry" });
  }
  const items = [...run];
  items[at] = { kind: "fresh", bytes };

  const plan = relayRun(items, first.header.offset, microcodeRange(last.header).end, image, reader);
  if (!plan.ok) return refuse(plan.problem);
  const layout = plan.layout;

  const writes: ToolWrite[] = [];
  if (layout.write !== undefined) writes.push(layout.write);
  if (layout.growth !== undefined) writes.push(layout.growth.write);

  const ownRowMoved = layout.freshOffset !== undefined && layout.freshOffset !== old.offset;
  if (layout.moves.length > 0 || ownRowMoved) {
    // Only when something moved: a transaction that writes the table back
    // unchanged is a step in the undo history that undoes nothing.
    const rows = rowBytes(table, reader);
    if (rows === undefined) return refuse({ kind: "noSuchEntry" });
    for (const move of layout.moves)
      writeAddress(rows[move.rowIndex], move.newOffset + addressDiff);
    if (layout.freshOffset !== undefined) {
      writeAddress(rows[row.index], layout.freshOffset + addressDiff);
    }
    writes.push({
      offset: table.range.start,
      bytes: assemble(rows, table.checksumIsChecked),
    });
  }

  const landed = layout.freshOffset ?? old.offset;
  return {
    ok: true,
    transaction: withContainerRepairs(
      { name: "Replace Microcode", writes },
      image,
      reader,
      layout.growth?.grown
    ),
    outcome: {
      kind: "replaced",
      range: { start: landed, end: landed + header.totalSize },
      entryIndex: row.index,
      replaced: old,
      moved: layout.moves.length,
    },
  };
}

function addingNewRow(
  bytes: Uint8Array,
  header: MicrocodeHeader,
  table: FITTable,
  image: UEFIImage | undefined,
  reader: ImageReader,
  addressDiff: number
): FITEdit<FITEditOutcome> {
  const run = runOf(table, reader);
  const first = run[0];
  const last = run.at(-1);
  if (first?.kind !== "existing" || last?.kind !== "existing") {
    return refuse({ kind: "noMicrocodeToFollow" });
  }

  // The run is laid out again with the new component on the end, so a gap an
  // earlier removal left is used rather than stepped over.
  const plan = relayRun(
    [...run, { kind: "fresh", bytes }],
    first.header.offset,
    microcodeRange(last.header).end,
    image,
    reader
  );
  if (!plan.ok) return refuse(plan.problem);
  const layout = plan.layout;
  const landed = layout.freshOffset;
  if (landed === undefined) return refuse({ kind: "noSuchEntry" });

  const rows = rowBytes(table, reader);
  if (rows === undefined) return refuse({ kind: "noSuchEntry" });
  for (const move of layout.moves) writeAddress(rows[move.rowIndex], move.newOffset + addressDiff);

  // Rows do not decrease in type, so a microcode row goes after the last one
  // there is.
  const lastMicrocode = rows.reduce(
    (found, row, index) => (typeOf(row) === FIT.microcodeType ? index : found),
    0
  );
  const insertion = lastMicrocode + 1;

  const room = roomAfterTheTable(table, image, reader);
  if (room.free) {
    // The table grows by a row and the header's count goes up with it, which
    // needs the sixteen bytes after the table to be free.
    rows.splice(insertion, 0, entryBytes(landed + addressDiff));
  } else {
    const slot = rows.findIndex(
      (row, index) => index >= insertion && typeOf(row) === FIT.emptyType
    );
    if (slot < 0) return refuse({ kind: "theTableCannotGrow", after: room.what });
    // Nowhere to grow into, so an empty slot is eaten instead. The table keeps
    // its length and the count stays as it was — the fallback rather than the
    // first choice, because a slot in the middle of the run is not where a
    // reader expects the spare room.
    rows.splice(slot, 1);
    rows.splice(insertion, 0, entryBytes(landed + addressDiff));
  }

  const writes: ToolWrite[] = [];
  if (layout.write !== undefined) writes.push(layout.write);
  if (layout.growth !== undefined) writes.push(layout.growth.write);
  writes.push({ offset: table.range.start, bytes: assemble(rows, table.checksumIsChecked) });

  return {
    ok: true,
    transaction: withContainerRepairs(
      { name: "Add Microcode", writes },
      image,
      reader,
      layout.growth?.grown
    ),
    outcome: {
      kind: "added",
      range: { start: landed, end: landed + header.totalSize },
      entryIndex: insertion,
      replaced: undefined,
      moved: layout.moves.length,
    },
  };
}

/**
 * Whether the sixteen bytes behind the table are anybody's.
 *
 * Erased is the plain case, but a byte is not the only evidence: a volume
 * erased with `0x00` leaves free space that is not `0xFF`, and the tree knows
 * which nodes were never written to. Where the answer is no, what is there is
 * named — "no empty slot" on its own leaves nobody anywhere to go.
 */
function roomAfterTheTable(
  table: FITTable,
  image: UEFIImage | undefined,
  reader: ImageReader
): { readonly free: true } | { readonly free: false; readonly what: string } {
  const end = table.range.end;
  const needed: ImageRange = { start: end, end: end + FIT_ENTRY_SIZE };
  const bytes = reader.has(needed) ? reader.bytes(needed) : undefined;
  if (bytes === undefined) return { free: false, what: "past the end of the image" };

  const whatIsThere = () => ({
    free: false as const,
    what: `${[...bytes.subarray(0, 4)]
      .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
      .join(" ")}… at 0x${end.toString(16).toUpperCase()}`,
  });

  // Whose are they? Bytes in the same element as the table are nobody else's —
  // the table's own file has room in it, and the checksums that covers are put
  // right with everything else. Free space and padding belong to nobody at all.
  // Anything else is another structure.
  if (image === undefined) {
    return reader.isFilled(needed, 0xff) ? { free: true } : whatIsThere();
  }
  const mine = image.innermostNodeContaining(table.range.start);
  const theirs = image.innermostNodeContaining(end);
  if (theirs === undefined) {
    return reader.isFilled(needed, 0xff) ? { free: true } : whatIsThere();
  }
  const sameElement = mine !== undefined && mine.id.join(".") === theirs.id.join(".");
  if (!SPARE_KINDS.has(theirs.kind) && !sameElement) {
    return {
      free: false,
      what: `inside ${theirs.name} at 0x${nodeRange(theirs).start.toString(16).toUpperCase()}`,
    };
  }
  // Filler to the end of whatever holds it, whatever byte the tool that built
  // the image chose.
  return isFree(needed, nodeRange(theirs).end, reader) ? { free: true } : whatIsThere();
}

// MARK: - The run

/** One thing to lay down in the run. */
type RunItem =
  /** A component already in the image, and the row that names it. */
  | { readonly kind: "existing"; readonly row: number; readonly header: MicrocodeHeader }
  /** A component that is not in the image yet. */
  | { readonly kind: "fresh"; readonly bytes: Uint8Array };

/**
 * The microcodes of the run, in offset order, ending at the last one the table
 * names.
 *
 * A component belongs to the run only if everything between it and the one
 * before it is erased. That is what keeps the re-layout from writing over
 * something that merely happens to sit between two microcodes.
 */
function runOf(table: FITTable, reader: ImageReader): RunItem[] {
  const components: { row: number; header: MicrocodeHeader }[] = [];
  for (const row of table.rows) {
    if (row.target.kind !== "microcode") continue;
    components.push({ row: row.entry.index, header: row.target.header });
  }
  components.sort((left, right) => left.header.offset - right.header.offset);

  // Backwards from the last, so the run is the block the newest microcode is in
  // rather than whichever block comes first in the image.
  const run: { row: number; header: MicrocodeHeader }[] = [];
  for (const item of [...components].reverse()) {
    const first = run[0];
    if (first !== undefined) {
      const gap: ImageRange = {
        start: microcodeRange(item.header).end,
        end: first.header.offset,
      };
      if (gap.start > gap.end) break;
      if (gap.start < gap.end && !reader.isFilled(gap, 0xff)) break;
    }
    run.unshift(item);
  }
  return run.map((one) => ({ kind: "existing", row: one.row, header: one.header }));
}

interface Relayout {
  /**
   * The whole re-laid stretch as one write: what goes in the hole, the
   * components behind it packed and aligned, and erase bytes for anything the
   * move left over. Nothing when the layout comes out byte for byte what is
   * already there.
   */
  readonly write: ToolWrite | undefined;
  readonly moves: readonly { readonly rowIndex: number; readonly newOffset: number }[];
  readonly erased: ImageRange | undefined;
  /** The file the run lives in, grown to cover a run that got longer. */
  readonly growth: { readonly write: ToolWrite; readonly grown: UEFINode } | undefined;
  /** Where the component that was not in the image yet ended up. */
  readonly freshOffset: number | undefined;
}

/**
 * Lays `items` down from `start`, packed and sixteen-byte aligned, and erases
 * whatever the layout leaves over up to `oldEnd`.
 *
 * This is the one operation behind all three edits: removing drops an item from
 * the list, replacing swaps one, adding appends one. What comes out is a run
 * with no holes in it — which is what a microcode run is, and why adding after a
 * removal does not leave the gap the removal made.
 *
 * Growing is bounded by the element that holds the run. Where that element is a
 * file with free space directly behind it, the file grows to cover the
 * difference and the run stays inside a structure.
 */
function relayRun(
  items: readonly RunItem[],
  start: number,
  oldEnd: number,
  image: UEFIImage | undefined,
  reader: ImageReader
):
  | { readonly ok: true; readonly layout: Relayout }
  | { readonly ok: false; readonly problem: FITEditProblem } {
  const area = spareArea(start, image, reader);
  // The same fill the run already sits in, for the few bytes alignment leaves
  // between components.
  const alignmentFill = fillByte(oldEnd, area.range.end, reader);

  const parts: Uint8Array[] = [];
  const moves: { rowIndex: number; newOffset: number }[] = [];
  let freshOffset: number | undefined;
  let next = start;

  for (const item of items) {
    // Every FIT address is aligned to sixteen, so a component whose size is not
    // a multiple of it leaves a gap in front of the next one.
    const at = alignUp(next, 16) ?? next;
    if (at > next) parts.push(new Uint8Array(at - next).fill(alignmentFill));
    if (item.kind === "existing") {
      const bytes = reader.bytes(microcodeRange(item.header));
      if (bytes === undefined) break;
      parts.push(bytes);
      if (at !== item.header.offset) moves.push({ rowIndex: item.row, newOffset: at });
      next = at + item.header.totalSize;
    } else {
      parts.push(item.bytes);
      freshOffset = at;
      next = at + item.bytes.length;
    }
  }

  let growth: Relayout["growth"];
  if (next > oldEnd) {
    const where =
      `${area.name} at 0x${area.range.start.toString(16).toUpperCase()}` +
      `–0x${area.range.end.toString(16).toUpperCase()}`;
    if (next > reader.count || !isFree({ start: oldEnd, end: next }, area.range.end, reader)) {
      return {
        ok: false,
        problem: { kind: "theRunCannotGrow", needed: next - oldEnd, inside: where },
      };
    }
    if (next > area.range.end) {
      const found = fileGrowth(next, start, image, reader);
      if (found === undefined) {
        return {
          ok: false,
          problem: { kind: "theRunCannotGrow", needed: next - area.range.end, inside: where },
        };
      }
      growth = found;
    }
  } else if (oldEnd > next) {
    // Tidied with the fill this image uses, not with a byte of our own
    // choosing.
    parts.push(new Uint8Array(oldEnd - next).fill(fillByte(oldEnd, area.range.end, reader)));
  }

  const payload = concat(parts);
  // Only the part that differs is written. A run whose first components do not
  // move must not be rewritten with the bytes it already holds: the dump would
  // colour every one of them as changed, and the undo step would take back more
  // than the edit did.
  let write: ToolWrite | undefined = { offset: start, bytes: payload };
  const current = reader.bytes({ start, end: start + payload.length });
  if (current !== undefined) {
    // Both ends: a replacement in the middle of a run leaves the components in
    // front of it and behind it exactly as they were.
    let from = 0;
    while (from < payload.length && payload[from] === current[from]) from++;
    if (from === payload.length) {
      write = undefined;
    } else {
      let to = payload.length - 1;
      while (to > from && payload[to] === current[to]) to--;
      write = { offset: start + from, bytes: payload.subarray(from, to + 1) };
    }
  }

  return {
    ok: true,
    layout: {
      write,
      moves,
      erased: oldEnd > next ? { start: next, end: oldEnd } : undefined,
      growth,
      freshOffset,
    },
  };
}

/**
 * The element the run lives in: the innermost node that is *space* rather than
 * a structure. A microcode component's own node is a structure, so what holds
 * the run is whatever contains it — and where nothing does, which is what a
 * microcode found by the raw scan of a plain image looks like, the rest of the
 * file does.
 *
 * This is what bounds a run that has to *grow in place*: pushing the last
 * component past the end of its file or its region would put it inside the next
 * structure along.
 */
function spareArea(
  offset: number,
  image: UEFIImage | undefined,
  reader: ImageReader
): { readonly range: ImageRange; readonly name: string } {
  const rest = { range: { start: offset, end: reader.count }, name: "the rest of the file" };
  if (image === undefined) return rest;
  const chain = image.nodesContaining(offset);
  for (const node of [...chain].reverse()) {
    if (node.kind === "microcode") continue;
    return { range: nodeRange(node), name: node.name };
  }
  return rest;
}

/**
 * The file the run lives in, grown to cover `end`.
 *
 * A component placed behind that file would otherwise sit loose in the volume's
 * free space, where the volume's own walk meets it as bytes nobody claimed —
 * which is what UEFITool draws as "non-UEFI data" and what a rebuild would not
 * know to keep. Growing the file puts it inside a structure, and the volume's
 * free space shrinks by exactly as much without anything having to record it:
 * free space is whatever the walk finds erased after the last file.
 *
 * Only into space that belongs to nothing: the bytes between the file's end and
 * `end` have to be the volume's free space or erased padding, and erased.
 * Anything else there — another file, most of all — and the file stays the size
 * it is.
 */
function fileGrowth(
  end: number,
  offset: number,
  image: UEFIImage | undefined,
  reader: ImageReader
): { readonly write: ToolWrite; readonly grown: UEFINode } | undefined {
  if (image === undefined) return undefined;
  const chain = image.nodesContaining(offset);
  const fileIndex = lastIndexWhere(chain, (node) => node.kind === "file");
  const file = fileIndex === undefined ? undefined : chain[fileIndex];
  if (file === undefined || end <= nodeRange(file).end) return undefined;

  // Everything from the file's end to `end` must belong to nothing.
  const parent = chain[fileIndex === undefined ? -1 : fileIndex - 1];
  if (parent === undefined) return undefined;
  let covered = nodeRange(file).end;
  for (const child of parent.children) {
    if (nodeRange(child).start < nodeRange(file).end) continue;
    if (nodeRange(child).start !== covered || !isSpare(child, reader)) break;
    covered = nodeRange(child).end;
  }
  if (covered < end) return undefined;
  if (!isFree({ start: nodeRange(file).end, end }, covered, reader)) return undefined;

  const size = end - file.header.start;
  const header = reader.bytes(file.header);
  if (header === undefined) return undefined;
  const grownHeader = Uint8Array.from(header);
  if (grownHeader.length >= 0x20) {
    // An FFSv3 large file keeps its size in a 64-bit field of its own, where a
    // plain one has a 24-bit field in the header.
    for (let index = 0; index < 8; index++) {
      grownHeader[0x18 + index] = Math.floor(size / 2 ** (8 * index)) & 0xff;
    }
  } else {
    if (size > 0xff_ffff) return undefined;
    for (let index = 0; index < 3; index++) {
      grownHeader[0x14 + index] = (size >>> (8 * index)) & 0xff;
    }
  }

  // The checksums that go with the new size are the container repair's,
  // computed over the image as this transaction will leave it.
  const grown: UEFINode = { ...file, body: { start: file.body.start, end } };
  return { write: { offset: file.header.start, bytes: grownHeader }, grown };
}

/**
 * The checksums a change breaks on its way out, recomputed and folded into the
 * same transaction.
 *
 * Microcode does not always live in a raw region: on plenty of boards the run
 * sits inside an FFS file, and then changing those bytes leaves that file's own
 * `IntegrityCheck` describing what used to be there. The repairs are computed
 * over the image *as this transaction will leave it* — a checksum describes
 * bytes as they will be, not as they are — which is what the overlay is for.
 *
 * A volume needs nothing: its checksum covers its own header and not its body,
 * which is the one mercy in this format.
 */
function withContainerRepairs(
  transaction: ToolTransaction,
  image: UEFIImage | undefined,
  reader: ImageReader,
  grownFile: UEFINode | undefined
): ToolTransaction {
  if (image === undefined) return transaction;
  const after = new Reader(
    new OverlayByteSource(
      reader.source,
      transaction.writes.map((write) => ({ offset: write.offset, bytes: write.bytes }))
    )
  );

  const writes: ToolWrite[] = [...transaction.writes];
  const done = new Set<string>();
  for (const write of transaction.writes) {
    const chain = image.nodesContaining(write.offset);
    const index = lastIndexWhere(chain, (node) => node.kind === "file");
    let file = index === undefined ? undefined : chain[index];
    if (file === undefined) continue;
    const key = file.id.join(".");
    if (done.has(key)) continue;
    done.add(key);
    // A file that grew is checked over its new extent, not the one the parse
    // found.
    if (grownFile !== undefined && grownFile.id.join(".") === key) file = grownFile;
    const revision = chain.filter((node) => node.kind === "volume").at(-1)?.subtype ?? 2;

    for (const repair of repairsForFile(file, revision, after)) {
      const end = repair.offset + repair.bytes.length;
      const covering = writes.findIndex(
        (one) => one.offset <= repair.offset && end <= one.offset + one.bytes.length
      );
      if (covering >= 0) {
        // The repair falls inside a write this transaction is already making —
        // a file header that grew, most of all — so it is patched into that
        // write rather than added beside it, which a transaction refuses as
        // overlapping.
        const one = writes[covering];
        if (one === undefined) continue;
        const patched = Uint8Array.from(one.bytes);
        patched.set(repair.bytes, repair.offset - one.offset);
        writes[covering] = { offset: one.offset, bytes: patched };
      } else {
        writes.push(repair);
      }
    }
  }
  return { name: transaction.name, writes };
}

// MARK: - What counts as free

/** The node kinds that are space rather than content. */
const SPARE_KINDS: ReadonlySet<string> = new Set(["freeSpace", "padding", "nonUEFIData"]);

/**
 * Whether `range` is filler rather than content.
 *
 * Erased flash reads `0xFF`, a volume erased with polarity 0 reads `0x00` — and
 * the tools that build images pad with whatever they like: a file holding a FIT
 * table padded to its end with `0x20` is a real one. The specification says
 * nothing about what unused space *inside a file* has to contain.
 *
 * So what marks filler is not the byte but the uniformity: one value, unbroken,
 * from here to the end of the element that holds it. Sixteen identical bytes in
 * the middle of content would not pass that, and a vendor's padding does.
 */
export function isFree(range: ImageRange, end: number, reader: ImageReader): boolean {
  if (range.end <= range.start) return false;
  // Erased flash, which needs no argument.
  if (reader.isFilled(range, 0xff)) return true;
  // Or a fill: one value, unbroken, from here to the end of the element that
  // holds it.
  if (range.end > end) return false;
  const byte = reader.uint8(range.start);
  if (byte === undefined) return false;
  return reader.isFilled({ start: range.start, end }, byte);
}

/**
 * What this image pads with, at `offset`.
 *
 * Tidying up after an edit means leaving the same fill the image already uses:
 * sixteen bytes of `0xFF` in the middle of a `0x20`-padded file are litter of a
 * new kind, and they break the uniformity the *next* edit reads as free space.
 */
export function fillByte(offset: number, end: number, reader: ImageReader): number {
  if (offset >= end) return 0xff;
  const byte = reader.uint8(offset);
  if (byte === undefined) return 0xff;
  return reader.isFilled({ start: offset, end }, byte) ? byte : 0xff;
}

/** Space nothing has claimed, and nothing has been written into. */
function isSpare(node: UEFINode, reader: ImageReader): boolean {
  if (!SPARE_KINDS.has(node.kind)) return false;
  return node.children.length === 0 && reader.isFilled(nodeRange(node), 0xff);
}

// MARK: - Rows as bytes

/**
 * The table as sixteen-byte rows, read back rather than rebuilt from what was
 * parsed: a row carries fields this tool does not model, and rewriting one from
 * a struct would quietly drop them.
 */
function rowBytes(table: FITTable, reader: ImageReader): Uint8Array[] | undefined {
  const bytes = reader.bytes(table.range);
  if (bytes === undefined || bytes.length % FIT_ENTRY_SIZE !== 0) return undefined;
  const rows: Uint8Array[] = [];
  for (let at = 0; at < bytes.length; at += FIT_ENTRY_SIZE) {
    rows.push(Uint8Array.from(bytes.subarray(at, at + FIT_ENTRY_SIZE)));
  }
  return rows;
}

const typeOf = (row: Uint8Array): number => (row[0x0e] ?? 0) & 0x7f;

function writeAddress(row: Uint8Array | undefined, address: number): void {
  if (row === undefined) return;
  for (let index = 0; index < 8; index++) {
    row[index] = Math.floor(address / 2 ** (8 * index)) & 0xff;
  }
}

/**
 * The header's count and the checksum, which are the two fields that depend on
 * every other byte of the table.
 */
function assemble(rows: readonly Uint8Array[], checksumIsChecked: boolean): Uint8Array {
  const header = rows[0];
  if (header === undefined) return new Uint8Array(0);
  const count = rows.length;
  for (let index = 0; index < 3; index++) header[0x08 + index] = (count >>> (8 * index)) & 0xff;
  header[0x0f] = 0;
  const bytes = concat(rows);
  if (checksumIsChecked) bytes[0x0f] = (0x100 - sum8(bytes)) & 0xff;
  return bytes;
}

/** One new row: an address, no size, version 0x0100, type microcode. */
function entryBytes(address: number): Uint8Array {
  const row = new Uint8Array(FIT_ENTRY_SIZE);
  writeAddress(row, address);
  row[0x0c] = 0x00;
  row[0x0d] = 0x01; // Version 0x0100
  row[0x0e] = FIT.microcodeType; // with ChecksumValid clear
  return row;
}

// MARK: - Small helpers

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, one) => sum + one.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

function lastIndexWhere<T>(items: readonly T[], test: (item: T) => boolean): number | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item !== undefined && test(item)) return index;
  }
  return undefined;
}
