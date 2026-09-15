/**
 * Everything one action of a tool writes, as one thing.
 *
 * A transaction is the unit of undo, and it is a list rather than a single
 * write because the work has that shape. Adding a microcode entry to a FIT
 * table is four writes that are not next to each other — the component, the
 * table row, the entry count in the header, and the header's checksum — and an
 * image carrying three of the four is worse than an image carrying none of
 * them. So they land together, they undo together, and they are named once for
 * both.
 *
 * Overwrite is the only write here, which is less of a restriction than it
 * reads as: a dump's size is the flash chip's size, and the operations that
 * change it — insert, delete — are the ones the application already warns about
 * for typing. When a tool needs one it arrives under that same rule rather than
 * as a second kind of transaction.
 *
 * Ported from `Packages/ToolModuleKit/ToolTransaction.swift`.
 */

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction.Write */
export interface ToolWrite {
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction.Write.offset */
  readonly offset: number;
  /**
   * A write replaces exactly as much as it carries.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction.Write.bytes
   */
  readonly bytes: Uint8Array;
}

/** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction */
export interface ToolTransaction {
  /**
   * What the user is about to be able to undo — "Add Microcode", not "Write 16
   * bytes". It becomes the Edit menu's `Undo <name>`, so it is written from the
   * user's side of the action.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction.name
   */
  readonly name: string;
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction.writes */
  readonly writes: readonly ToolWrite[];
}

/**
 * What a write covers.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction.Write.range
 */
export const writeEnd = (write: ToolWrite): number => write.offset + write.bytes.length;

/**
 * From the first byte written to the last — what the dump has to redraw, and
 * what a tool's own re-read can be narrowed to. Nothing for a transaction with
 * nothing in it.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction.span
 */
export function transactionSpan(
  transaction: ToolTransaction
): { readonly start: number; readonly end: number } | undefined {
  if (transaction.writes.length === 0) return undefined;
  const start = Math.min(...transaction.writes.map((write) => write.offset));
  const end = Math.max(...transaction.writes.map(writeEnd));
  return { start, end };
}

/**
 * Why a transaction cannot be applied.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransactionError
 */
export type ToolTransactionProblem =
  | { readonly kind: "unnamed" }
  | { readonly kind: "noWrites" }
  | { readonly kind: "emptyWrite"; readonly offset: number }
  | { readonly kind: "overlappingWrites"; readonly offset: number };

export function transactionProblemMessage(problem: ToolTransactionProblem): string {
  switch (problem.kind) {
    case "unnamed":
      return "A step the user can undo has to say what it was.";
    case "noWrites":
      return "That change writes nothing.";
    case "emptyWrite":
      return `A write at 0x${problem.offset.toString(16).toUpperCase()} carries no bytes.`;
    case "overlappingWrites":
      return `Two writes cover 0x${problem.offset.toString(16).toUpperCase()}.`;
  }
}

export type ValidatedTransaction =
  | { readonly ok: true; readonly transaction: ToolTransaction }
  | { readonly ok: false; readonly problem: ToolTransactionProblem };

/**
 * The transaction as it will be applied, or the reason it cannot be — checked
 * before anything is written, because the point of a transaction is that the
 * file never sees half of one.
 *
 * What it repairs: the writes come back sorted by offset, and writes that touch
 * end to end are merged, so the host applies one range where a tool emitted
 * four adjacent ones.
 *
 * What it refuses:
 *
 * - **Two writes over the same byte.** Which of them wins is not something an
 *   ordering rule should decide quietly — it means the tool computed an offset
 *   wrong, which is precisely the class of mistake that ends with one hex digit
 *   silently written into free space.
 * - **A write of no bytes**, which asks for nothing and usually means a length
 *   was computed as zero.
 * - **No writes at all**, and a **blank name**.
 *
 * Bounds are not checked here — the file's size belongs to the document, and it
 * checks them when it applies.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolTransaction.swift#ToolTransaction.validated
 */
export function validateTransaction(transaction: ToolTransaction): ValidatedTransaction {
  if (transaction.name.trim().length === 0) return { ok: false, problem: { kind: "unnamed" } };
  if (transaction.writes.length === 0) return { ok: false, problem: { kind: "noWrites" } };
  const empty = transaction.writes.find((write) => write.bytes.length === 0);
  if (empty !== undefined) {
    return { ok: false, problem: { kind: "emptyWrite", offset: empty.offset } };
  }

  const sorted = [...transaction.writes].sort((left, right) => left.offset - right.offset);
  const merged: ToolWrite[] = [];
  for (const write of sorted) {
    const last = merged.at(-1);
    if (last === undefined) {
      merged.push(write);
      continue;
    }
    if (write.offset < writeEnd(last)) {
      return { ok: false, problem: { kind: "overlappingWrites", offset: write.offset } };
    }
    if (write.offset === writeEnd(last)) {
      const joined = new Uint8Array(last.bytes.length + write.bytes.length);
      joined.set(last.bytes);
      joined.set(write.bytes, last.bytes.length);
      merged[merged.length - 1] = { offset: last.offset, bytes: joined };
      continue;
    }
    merged.push(write);
  }
  return { ok: true, transaction: { name: transaction.name, writes: merged } };
}
