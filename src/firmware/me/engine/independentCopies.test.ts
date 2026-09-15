import { describe, expect, it } from "vitest";
import { type IndependentSlot, mergingRedundantCopies } from "@/firmware/me/engine/analyzer";

/**
 * An independent firmware CSE Redundancy stores twice — in Boot 1 and in its
 * backup, Boot 2 — is one table saying where the copy is; copies that differ
 * stay two, and are warned about. Ported from upstream's
 * `IndependentCopiesTests.swift`.
 */

/** A region with `parts` laid end to end, and where each one is. */
function region(parts: readonly (readonly number[])[]) {
  const bytes: number[] = [];
  const at: { start: number; end: number }[] = [];
  for (const part of parts) {
    at.push({ start: bytes.length, end: bytes.length + part.length });
    bytes.push(...part);
  }
  return { data: Uint8Array.from(bytes), at };
}

const slot = (name: string, range: { start: number; end: number } | undefined, place: string) => ({
  name,
  start: range?.start ?? 0,
  end: range?.end ?? 0,
  place,
});

describe("redundant copies of an independent firmware", () => {
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IndependentCopiesTests.swift#IndependentCopiesTests.testAByteIdenticalCopyIsFoldedIntoTheFirst
  it("folds a byte-identical copy into the first", () => {
    const pmc = new Array<number>(16).fill(0x11);
    const pchc = new Array<number>(8).fill(0x22);
    const { data, at } = region([pmc, pchc, pmc, pchc]);
    const slots: IndependentSlot[] = [
      slot("PMCP", at[0], "Boot 1"),
      slot("PMCP", at[2], "Boot 2"),
      slot("PCHC", at[1], "Boot 1"),
      slot("PCHC", at[3], "Boot 2"),
    ];

    const merged = mergingRedundantCopies(slots, data);

    expect(merged.unique.map((one) => one.slot)).toEqual([slots[0], slots[2]]);
    expect(merged.unique.map((one) => one.copies)).toEqual([["Boot 2"], ["Boot 2"]]);
    expect(merged.differing).toEqual([]);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IndependentCopiesTests.swift#IndependentCopiesTests.testCopiesThatDifferStayTwoAndAreNamed
  it("keeps copies that differ as two, and names them", () => {
    const newer = new Array<number>(16).fill(0x11);
    newer[3] = 0x12;
    const { data, at } = region([new Array<number>(16).fill(0x11), newer]);
    const slots: IndependentSlot[] = [slot("PMCP", at[0], "Boot 1"), slot("PMCP", at[1], "Boot 2")];

    const merged = mergingRedundantCopies(slots, data);

    expect(merged.unique.map((one) => one.slot)).toEqual(slots);
    expect(merged.unique.map((one) => one.copies)).toEqual([[], []]);
    expect(merged.differing.map((one) => one.name)).toEqual(["PMCP"]);
    expect(merged.differing.map((one) => one.places)).toEqual([["Boot 1", "Boot 2"]]);
  });

  // The same bytes under another partition name are another firmware's slot,
  // not a copy.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/IndependentCopiesTests.swift#IndependentCopiesTests.testOnlyTheSamePartitionIsACopy
  it("counts only the same partition as a copy", () => {
    const bytes = new Array<number>(8).fill(0x33);
    const { data, at } = region([bytes, bytes]);
    const slots: IndependentSlot[] = [slot("PPHY", at[0], "Boot 1"), slot("NPHY", at[1], "Boot 1")];

    const merged = mergingRedundantCopies(slots, data);

    expect(merged.unique).toHaveLength(2);
    expect(merged.differing).toEqual([]);
  });
});
