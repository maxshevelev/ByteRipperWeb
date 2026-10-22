import { Sha256 } from "@/core/crypto/sha256";
import type { Selection } from "@/core/document/selectionModel";
import {
  invertOperation,
  type KeptTransaction,
  type UndoOperation,
  type UndoTransaction,
} from "@/core/edit/undoHistory";
import {
  BLOB_MAGIC,
  COPY_SLICE,
  concat,
  EMPTY_HASH,
  type JournalStore,
  UndoBytes,
  UndoJournal,
  u64,
} from "@/core/edit/undoJournal";
import type { EditableByteStorage } from "@/core/storage/byteStorage";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";

/**
 * A document's transactions written down beside a workspace (`Design/PERSISTENT_UNDO_PLAN.md`
 * upstream, "The journal").
 *
 * Append-only. A record is never rewritten; each carries the SHA-256 of the previous record's hash
 * and its own bytes, so appending costs what is appended, and the manifest pins the log by its
 * length and the hash at that length. Bytes past that length — written after the last manifest,
 * before a crash — are not part of it.
 *
 * A record: `BRT1`, the body's length (u64), the body, the 32-byte hash. The body: serial, parent,
 * the selections before and after, the series id, the label, and the operations with their bytes
 * — a fill's as its pattern. `BRS1` records, framed the same way, refine the selection after a
 * transaction written before the command that made it had placed it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog
 */

const ascii = (text: string) => Uint8Array.from(text, (unit) => unit.charCodeAt(0));

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.magic */
const TRANSACTION_MAGIC = ascii("BRT1");
/**
 * A refined selection after a transaction already written: serial, then the selection.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.selectionMagic
 */
const SELECTION_MAGIC = ascii("BRS1");
/**
 * The segments paired with a transaction already written: serial, side (0 before it, 1 after
 * it), then the encoding — or, flagged, the same as the last such record in the log.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.segmentsMagic
 */
const SEGMENTS_MAGIC = ascii("BRP1");

/**
 * Why a kept history could not be put back.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogError
 */
export class HistoryLogError extends Error {
  /**
   * `unreadable`: the log is shorter than its manifest says, a record does not parse, or the
   * chained hash does not come out as written down. `noPath`: no way leads from the state the
   * base holds to the one asked for. `doesNotFit`: an operation does not fit the content it is
   * laid over.
   */
  readonly kind: "unreadable" | "noPath" | "doesNotFit";

  constructor(kind: "unreadable" | "noPath" | "doesNotFit") {
    super(`The kept history is ${kind}.`);
    this.kind = kind;
  }
}

const sameBytes = (one: Uint8Array, other: Uint8Array): boolean =>
  one.length === other.length && one.every((byte, index) => byte === other[index]);

/** The serials from `serial` up through the parents `parentOf` names, `serial` first. */
function lineage(serial: number, parentOf: (serial: number) => number | undefined): number[] {
  const line = [serial];
  const seen = new Set(line);
  let at = serial;
  for (
    let parent = parentOf(at);
    parent !== undefined && !seen.has(parent);
    parent = parentOf(at)
  ) {
    seen.add(parent);
    at = parent;
    line.push(at);
  }
  return line;
}

/**
 * The operations that take the content from the state `base` names to the one `head` names: back
 * up from `base` to the state the two descend from, each transaction undone, then down to `head`,
 * each one done. Nothing when the transactions in `records` lead from neither to a state the other
 * came from.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.path
 */
export function historyPath(
  base: number,
  head: number,
  records: ReadonlyMap<number, UndoTransaction>
): UndoOperation[] | undefined {
  const parentOf = (serial: number) => records.get(serial)?.parent;
  const up = lineage(base, parentOf);
  const down = lineage(head, parentOf);
  const upSet = new Set(up);
  const meet = down.findIndex((serial) => upSet.has(serial));
  if (meet < 0) return undefined;
  const common = down[meet];
  const ops: UndoOperation[] = [];
  for (const serial of up) {
    if (serial === common) break;
    ops.push(...[...(records.get(serial)?.ops ?? [])].reverse().map(invertOperation));
  }
  for (const serial of down.slice(0, meet).reverse()) ops.push(...(records.get(serial)?.ops ?? []));
  return ops;
}

/**
 * The undo and redo sides of a kept history, from the transactions in its log: the undo side is
 * the way from `undoBase` to `head`, oldest first; the redo side the way from `head` down to
 * `redoTip`, cut into steps of `redoSizes`, the next to redo first. Nothing when the log does not
 * hold the way to `undoBase`; a redo side that does not add up is left empty — what can be undone
 * is not lost over what could be redone.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.sides
 */
export function historySides(options: {
  readonly head: number;
  readonly undoBase: number;
  readonly redoTip: number | undefined;
  readonly redoSizes: readonly number[];
  readonly records: ReadonlyMap<number, KeptTransaction>;
}): { undo: KeptTransaction[]; redo: KeptTransaction[][] } | undefined {
  const { records } = options;
  const undo: KeptTransaction[] = [];
  for (let at = options.head; at !== options.undoBase; ) {
    const record = records.get(at);
    if (record === undefined || undo.length > records.size) return undefined;
    undo.push(record);
    at = record.transaction.parent;
  }
  undo.reverse();
  if (options.redoTip === undefined) return { undo, redo: [] };
  const way: KeptTransaction[] = [];
  for (let at = options.redoTip; at !== options.head; ) {
    const record = records.get(at);
    if (record === undefined || way.length > records.size) return { undo, redo: [] };
    way.push(record);
    at = record.transaction.parent;
  }
  way.reverse();
  const sizes = options.redoSizes;
  if (!sizes.every((size) => size > 0) || sizes.reduce((sum, size) => sum + size, 0) !== way.length)
    return { undo, redo: [] };
  const redo: KeptTransaction[][] = [];
  let from = 0;
  for (const size of sizes) {
    redo.push(way.slice(from, from + size));
    from += size;
  }
  return { undo, redo };
}

/**
 * Whether the transactions whose parents `parents` lists lead from the state `a` names to the one
 * `b` names — what {@link historyPath} needs, known without the operations themselves.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.connects
 */
export function historyConnects(
  a: number,
  b: number,
  parents: ReadonlyMap<number, number>
): boolean {
  const parentOf = (serial: number) => parents.get(serial);
  const up = new Set(lineage(a, parentOf));
  return lineage(b, parentOf).some((serial) => up.has(serial));
}

/**
 * Does `ops` to `storage`, in order, checking each fits before it is done.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.apply
 */
export async function applyHistory(
  ops: readonly UndoOperation[],
  storage: EditableByteStorage
): Promise<void> {
  for (const op of ops) {
    switch (op.kind) {
      case "overwrite":
        if (op.at + op.after.count > storage.size) throw new HistoryLogError("doesNotFit");
        await storage.overwrite(op.at, await op.after.load());
        break;
      case "insert":
        if (op.at > storage.size) throw new HistoryLogError("doesNotFit");
        await storage.insert(op.at, await op.bytes.load());
        break;
      case "delete":
        if (op.at + op.bytes.count > storage.size) throw new HistoryLogError("doesNotFit");
        await storage.delete(op.at, op.at + op.bytes.count);
        break;
    }
  }
}

// MARK: - Reading

/**
 * Reads the records in the first `length` bytes of the log `file`, checking each one's hash and
 * the last against `hash`. The operations' bytes are not read into memory: they point into the
 * log, which a restored history then goes on writing.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.read
 */
export async function readHistoryLog(
  file: UndoJournal,
  length: number,
  hash: Uint8Array,
  progress?: (bytes: number) => void
): Promise<KeptTransaction[]> {
  if (length === 0) {
    if (!sameBytes(hash, EMPTY_HASH)) throw new HistoryLogError("unreadable");
    return [];
  }
  const reader = new Reader(file, length, progress);
  let chain: Uint8Array = EMPTY_HASH;
  const records: KeptTransaction[] = [];
  const index = new Map<number, number>();
  let lastSegments: Uint8Array | undefined;
  try {
    while (reader.at < length) {
      const kind = await reader.bytes(4, false);
      const known = [TRANSACTION_MAGIC, SELECTION_MAGIC, SEGMENTS_MAGIC, BLOB_MAGIC].find((magic) =>
        sameBytes(magic, kind)
      );
      if (known === undefined) throw new HistoryLogError("unreadable");
      const bodyLength = await reader.u64(false);
      if (bodyLength > length - reader.at) throw new HistoryLogError("unreadable");
      reader.hasher = new Sha256().update(chain);
      const bodyEnd = reader.at + bodyLength;
      if (known === BLOB_MAGIC) {
        reader.blobs.set(reader.at, bodyLength);
        await reader.skip(bodyLength);
      } else if (known === TRANSACTION_MAGIC) {
        const record = await reader.transaction();
        index.set(record.transaction.serial, records.length);
        records.push(record);
      } else if (known === SEGMENTS_MAGIC) {
        const serial = await reader.u64();
        const after = (await reader.u8()) !== 0;
        let data: Uint8Array;
        if ((await reader.u8()) === 0) {
          if (lastSegments === undefined) throw new HistoryLogError("unreadable");
          data = lastSegments;
        } else {
          data = await reader.bytes(await reader.u32());
        }
        lastSegments = data;
        const at = index.get(serial);
        const record = at === undefined ? undefined : records[at];
        if (at === undefined || record === undefined) throw new HistoryLogError("unreadable");
        records[at] = after
          ? { ...record, segmentsAfter: data }
          : { ...record, segmentsBefore: data };
      } else {
        const serial = await reader.u64();
        const selection = await reader.selection();
        const at = index.get(serial);
        const record = at === undefined ? undefined : records[at];
        if (at === undefined || record === undefined) throw new HistoryLogError("unreadable");
        records[at] = {
          ...record,
          transaction: { ...record.transaction, selectionAfter: selection },
        };
      }
      if (reader.at !== bodyEnd) throw new HistoryLogError("unreadable");
      const digest = reader.hasher.digest();
      if (!sameBytes(await reader.bytes(32, false), digest))
        throw new HistoryLogError("unreadable");
      chain = digest;
    }
  } catch {
    throw new HistoryLogError("unreadable");
  }
  if (!sameBytes(chain, hash)) throw new HistoryLogError("unreadable");
  return records;
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader */
class Reader {
  at = 0;
  hasher = new Sha256();
  /**
   * The edits' bytes read past so far: where each starts, its length.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.blobs
   */
  readonly blobs = new Map<number, number>();

  private readonly file: UndoJournal;
  private readonly end: number;
  private readonly progress: ((bytes: number) => void) | undefined;

  constructor(file: UndoJournal, end: number, progress: ((bytes: number) => void) | undefined) {
    this.file = file;
    this.end = end;
    this.progress = progress;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.bytes */
  async bytes(count: number, hashing = true): Promise<Uint8Array> {
    if (count > this.end - this.at) throw new HistoryLogError("unreadable");
    const bytes = await this.file.read(this.at, count);
    if (hashing) this.hasher.update(bytes);
    this.at += count;
    this.progress?.(count);
    return bytes;
  }

  /**
   * Passes over `count` bytes, hashing them, a slice at a time.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.skip
   */
  async skip(count: number): Promise<void> {
    for (let left = count; left > 0; ) {
      const slice = Math.min(left, COPY_SLICE);
      await this.bytes(slice);
      left -= slice;
    }
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.u64 */
  async u64(hashing = true): Promise<number> {
    const view = new DataView((await this.bytes(8, hashing)).buffer);
    return view.getUint32(0, true) + view.getUint32(4, true) * 2 ** 32;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.u32 */
  async u32(): Promise<number> {
    return new DataView((await this.bytes(4)).buffer).getUint32(0, true);
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.u8 */
  async u8(): Promise<number> {
    return (await this.bytes(1))[0] as number;
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.selection */
  async selection(): Promise<Selection> {
    const start = await this.u64();
    const end = await this.u64();
    const fileSize = await this.u64();
    if (start > end) throw new HistoryLogError("unreadable");
    return { start, end, fileSize };
  }

  /**
   * A payload: in the log itself, hashed as it is passed over but not kept, or a pattern.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.payload
   */
  async payload(): Promise<UndoBytes> {
    switch (await this.u8()) {
      case 0: {
        const count = await this.u64();
        if (count > this.end - this.at) throw new HistoryLogError("unreadable");
        const start = this.at;
        await this.skip(count);
        // Written into the record, and named from here on like an edit's own bytes.
        this.blobs.set(start, count);
        return UndoBytes.stored(this.file, start, count);
      }
      case 2: {
        // The bytes of an edit written before, by where they start.
        const start = await this.u64();
        const count = await this.u64();
        if (this.blobs.get(start) !== count) throw new HistoryLogError("unreadable");
        return UndoBytes.stored(this.file, start, count);
      }
      case 1: {
        const count = await this.u64();
        const pattern = await this.bytes(await this.u32());
        return UndoBytes.pattern(pattern, count);
      }
      default:
        throw new HistoryLogError("unreadable");
    }
  }

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLog.Reader.transaction */
  async transaction(): Promise<KeptTransaction> {
    const serial = await this.u64();
    const parent = await this.u64();
    const selectionBefore = await this.selection();
    const selectionAfter = await this.selection();
    const hasSeries = await this.u8();
    const series = await this.u64();
    const labelLength = await this.u32();
    const label = labelLength === 0 ? undefined : decodeUtf8(await this.bytes(labelLength));
    const count = await this.u32();
    const ops: UndoOperation[] = [];
    for (let index = 0; index < count; index++) {
      const kind = await this.u8();
      const a = await this.u64();
      const b = await this.u64();
      switch (kind) {
        case 0: {
          if (a > b) throw new HistoryLogError("unreadable");
          const before = await this.payload();
          const after = await this.payload();
          ops.push({ kind: "overwrite", at: a, before, after });
          break;
        }
        case 1:
          ops.push({ kind: "insert", at: a, bytes: await this.payload() });
          break;
        case 2:
          if (a > b) throw new HistoryLogError("unreadable");
          ops.push({ kind: "delete", at: a, bytes: await this.payload() });
          break;
        default:
          throw new HistoryLogError("unreadable");
      }
    }
    return {
      transaction: { ops, selectionBefore, selectionAfter, serial, parent },
      seriesId: hasSeries !== 0 ? series : undefined,
      label,
    };
  }
}

// MARK: - Writing

const u32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
};

const selectionBytes = (selection: Selection): Uint8Array =>
  concat(u64(selection.start), u64(selection.end), u64(selection.fileSize));

/** How a payload is written: named by where it lies in this journal, as a pattern, or whole. */
type Form =
  | { readonly kind: "named"; readonly offset: number; readonly count: number }
  | { readonly kind: "pattern"; readonly pattern: Uint8Array; readonly count: number }
  | { readonly kind: "written"; readonly bytes: UndoBytes };

/**
 * Appends a kept history's records to its journal: the transactions — naming the bytes the
 * journal already holds rather than writing them again — the refined selections and the segments
 * paired with them.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.init
 */
export class HistoryLogWriter {
  /** The segments last appended, so the same ones again cost a flag. */
  private lastSegments: Uint8Array | undefined;

  /** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.journal */
  readonly journal: UndoJournal;

  constructor(journal: UndoJournal) {
    this.journal = journal;
  }

  /**
   * A new, empty log.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.init
   */
  static creating(store?: JournalStore): HistoryLogWriter {
    return new HistoryLogWriter(new UndoJournal(store));
  }

  /**
   * The log as a manifest pinned it: appending goes on from `length`, and anything past it is
   * written over.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.init
   */
  static appendingTo(store: JournalStore, length: number, hash: Uint8Array): HistoryLogWriter {
    return new HistoryLogWriter(new UndoJournal(store, { length, hash }));
  }

  /**
   * Where the next record goes: the length a manifest pins the log at.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.length
   */
  get length(): number {
    return this.journal.length;
  }

  /**
   * The length and the chained hash at it, once what was appended has landed.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.hash
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.synchronize
   */
  pin(): Promise<{ readonly length: number; readonly hash: Uint8Array } | undefined> {
    return this.journal.pin();
  }

  /**
   * Appends one transaction. Bytes already in this journal are named by where they start; bytes
   * elsewhere — in memory, in another journal — are written into the record; a fill's are its
   * pattern.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.append
   */
  append(kept: KeptTransaction): void {
    const transaction = kept.transaction;
    const label = encodeUtf8(kept.label ?? "");
    const head = concat(
      u64(transaction.serial),
      u64(transaction.parent),
      selectionBytes(transaction.selectionBefore),
      selectionBytes(transaction.selectionAfter),
      Uint8Array.of(kept.seriesId === undefined ? 0 : 1),
      u64(kept.seriesId ?? 0),
      u32(label.length),
      label,
      u32(transaction.ops.length)
    );
    const form = (bytes: UndoBytes): Form => {
      const pattern = bytes.patternForm;
      if (pattern !== undefined) return { kind: "pattern", ...pattern };
      const storage = bytes.storage;
      if (storage.kind === "stored" && storage.journal === this.journal)
        return { kind: "named", offset: storage.offset, count: storage.count };
      return { kind: "written", bytes };
    };
    const size = (one: Form): number =>
      one.kind === "named"
        ? 1 + 16
        : one.kind === "pattern"
          ? 1 + 8 + 4 + one.pattern.length
          : 1 + 8 + one.bytes.count;
    const parts = transaction.ops.map((op) =>
      op.kind === "overwrite"
        ? {
            fixed: concat(Uint8Array.of(0), u64(op.at), u64(op.at + op.after.count)),
            payloads: [form(op.before), form(op.after)],
          }
        : {
            fixed: concat(
              Uint8Array.of(op.kind === "insert" ? 1 : 2),
              u64(op.at),
              u64(op.kind === "insert" ? 0 : op.at + op.bytes.count)
            ),
            payloads: [form(op.bytes)],
          }
    );
    const bodyLength =
      head.length +
      parts.reduce(
        (total, part) =>
          total + part.fixed.length + part.payloads.reduce((sum, one) => sum + size(one), 0),
        0
      );
    this.journal.appendRecord(TRANSACTION_MAGIC, bodyLength, async (emit) => {
      await emit(head);
      for (const part of parts) {
        await emit(part.fixed);
        for (const payload of part.payloads) {
          switch (payload.kind) {
            case "named":
              await emit(concat(Uint8Array.of(2), u64(payload.offset), u64(payload.count)));
              break;
            case "pattern":
              await emit(
                concat(
                  Uint8Array.of(1),
                  u64(payload.count),
                  u32(payload.pattern.length),
                  payload.pattern
                )
              );
              break;
            case "written":
              await emit(concat(Uint8Array.of(0), u64(payload.bytes.count)));
              await payload.bytes.forEachSlice(emit);
              break;
          }
        }
      }
    });
  }

  /**
   * Appends the segments the pane paired with the transaction `serial`, already in the log: those
   * before it, or — `after` — those after it.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.appendSegments
   */
  appendSegments(serial: number, after: boolean, data: Uint8Array): void {
    const same = this.lastSegments !== undefined && sameBytes(data, this.lastSegments);
    const body = same
      ? concat(u64(serial), Uint8Array.of(after ? 1 : 0, 0))
      : concat(u64(serial), Uint8Array.of(after ? 1 : 0, 1), u32(data.length), data);
    this.journal.appendRecord(SEGMENTS_MAGIC, body.length, (emit) => emit(body));
    this.lastSegments = data;
  }

  /**
   * Appends a refined selection after the transaction `serial`, already in the log.
   *
   * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/HistoryLog.swift#HistoryLogWriter.appendSelection
   */
  appendSelection(serial: number, selection: Selection): void {
    const body = concat(u64(serial), selectionBytes(selection));
    this.journal.appendRecord(SELECTION_MAGIC, body.length, (emit) => emit(body));
  }
}
