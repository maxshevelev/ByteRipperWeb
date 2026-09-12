import { describe, expect, it } from "vitest";
import {
  type ToolTransaction,
  type ToolWrite,
  transactionSpan,
  validateTransaction,
} from "@/tools/toolTransaction";

/**
 * What a transaction has to be before anything is written — upstream's
 * `ToolTransactionTests`, which is the specification this is checked against.
 */

const transaction = (writes: ToolWrite[]): ToolTransaction => ({
  name: "Add Microcode",
  writes,
});

const write = (offset: number, count: number, byte = 0xaa): ToolWrite => ({
  offset,
  bytes: new Uint8Array(count).fill(byte),
});

function checked(one: ToolTransaction): ToolTransaction {
  const result = validateTransaction(one);
  if (!result.ok) throw new Error(`refused: ${result.problem.kind}`);
  return result.transaction;
}

describe("validateTransaction", () => {
  it("brings the writes back in offset order", () => {
    const result = checked(transaction([write(0x200, 4), write(0x10, 4), write(0x100, 4)]));

    expect(result.writes.map((one) => one.offset)).toEqual([0x10, 0x100, 0x200]);
  });

  it("makes one write of two that touch", () => {
    // So the document patches one range instead of three.
    const result = checked(transaction([write(0x10, 4, 0x01), write(0x14, 4, 0x02)]));

    expect(result.writes).toHaveLength(1);
    expect(result.writes[0]?.offset).toBe(0x10);
    expect([...(result.writes[0]?.bytes ?? [])]).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
  });

  it("leaves writes with gaps between them separate", () => {
    // A FIT entry is four writes that are nowhere near each other: the
    // component, the row, the header's count, its checksum. They stay four.
    const result = checked(
      transaction([
        write(0xb8fc60, 0x30),
        write(0xe00140, 16),
        write(0xe00108, 3),
        write(0xe0010f, 1),
      ])
    );

    expect(result.writes.map((one) => one.offset)).toEqual([
      0xb8fc60, 0xe00108, 0xe0010f, 0xe00140,
    ]);
  });

  it("refuses two writes over the same byte", () => {
    // It means an offset was computed wrong, and no ordering rule should
    // decide that quietly.
    expect(validateTransaction(transaction([write(0x10, 8), write(0x14, 8)]))).toEqual({
      ok: false,
      problem: { kind: "overlappingWrites", offset: 0x14 },
    });
  });

  it("refuses a write of no bytes", () => {
    expect(validateTransaction(transaction([{ offset: 0x40, bytes: new Uint8Array(0) }]))).toEqual({
      ok: false,
      problem: { kind: "emptyWrite", offset: 0x40 },
    });
  });

  it("refuses a transaction with no writes", () => {
    expect(validateTransaction(transaction([]))).toEqual({
      ok: false,
      problem: { kind: "noWrites" },
    });
  });

  it("refuses a transaction without a name", () => {
    // The name becomes `Undo <name>`, so a blank one is not a name.
    expect(validateTransaction({ name: "  \n", writes: [write(0x10, 4)] })).toEqual({
      ok: false,
      problem: { kind: "unnamed" },
    });
  });
});

describe("transactionSpan", () => {
  it("reaches from the first byte written to the last", () => {
    expect(transactionSpan(transaction([write(0xe00140, 16), write(0xb8fc60, 0x30)]))).toEqual({
      start: 0xb8fc60,
      end: 0xe00150,
    });
    expect(transactionSpan(transaction([]))).toBeUndefined();
  });
});
