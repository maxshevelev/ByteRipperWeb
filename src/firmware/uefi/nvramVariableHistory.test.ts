import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { DRIVER_GUID } from "@/firmware/testing/testImage";
import {
  nvarDataEntry,
  nvarEntry,
  nvarStore,
  nvarVolume,
  supersededNvarEntry,
} from "@/firmware/testing/testNvar";
import { nvramVolume, vssStore, vssVariable } from "@/firmware/testing/testNvram";
import {
  changedBytes,
  isNoChange,
  supersededCopies,
  variableChange,
  variableHistoryOf,
  variableOf,
  variablesIn,
} from "@/firmware/uefi/nvramVariableHistory";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";

/**
 * Ported from `NvramVariableHistoryTests.swift`: the copies a store keeps of one
 * variable, oldest first, and what each one changed (§9).
 */

const MARKED = 0x3c;
const bytes = (...values: number[]) => Uint8Array.from(values);

/** The parsed store — the node whose children are the entries — and a reader over the bytes. */
function parsedStore(image: Uint8Array): { store: UEFINode; reader: ImageReader } {
  const store = parseUefiImage(sourceOver(image)).roots[0]?.children[0];
  if (store === undefined) throw new Error("no store");
  return { store, reader: new ImageReader(sourceOver(image)) };
}
const vss = (variables: Uint8Array[]) =>
  parsedStore(nvramVolume({ stores: [vssStore({ variables, freeSpace: 0x40 })] }));
const nvar = (entries: Uint8Array[]) => parsedStore(nvarVolume({ body: nvarStore(entries) }));
const variableEntries = (store: UEFINode) =>
  store.children.filter((node) => node.kind === "vssEntry" || node.kind === "nvarEntry");

describe("a variable's copies", () => {
  // Two marked copies and the current one, read from any of the three, and each
  // copy's value without the name before it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testAVSSVariablesCopiesAreItsHistory
  it("makes a VSS variable's copies its history", () => {
    const { store, reader } = vss([
      vssVariable({ name: "BootOrder", data: bytes(1, 0), state: MARKED }),
      vssVariable({ name: "Lang", data: bytes(0x65) }),
      vssVariable({ name: "BootOrder", data: bytes(1, 0, 2, 0), state: MARKED }),
      vssVariable({ name: "BootOrder", data: bytes(2, 0, 1, 0) }),
    ]);
    const entries = variableEntries(store);
    const history = variableHistoryOf(entries[0] as UEFINode, store, reader);

    expect(history?.name).toBe("BootOrder");
    expect(history?.versions.map((one) => one.entry)).toEqual([
      entries[0]?.id,
      entries[2]?.id,
      entries[3]?.id,
    ]);
    expect(history?.versions.map((one) => one.state)).toEqual([
      "superseded",
      "superseded",
      "current",
    ]);
    expect(history?.versions.map((one) => [...(reader.bytes(one.value) ?? [])])).toEqual([
      [1, 0],
      [1, 0, 2, 0],
      [2, 0, 1, 0],
    ]);
    // The same from the current copy.
    expect(variableHistoryOf(entries[3] as UEFINode, store, reader)).toEqual(history);
    // One copy is no history.
    expect(variableHistoryOf(entries[1] as UEFINode, store, reader)).toBeUndefined();
  });

  // The tree calls a marked entry Invalid; the variable is read from it.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testAMarkedEntrySaysWhoseCopyItIs
  it("says whose copy a marked entry is", () => {
    const { store, reader } = vss([vssVariable({ name: "Setup", state: MARKED })]);
    const entry = variableEntries(store)[0] as UEFINode;

    expect(entry.name).toBe("Invalid");
    expect(variableOf(entry, store, reader)?.name).toBe("Setup");
  });

  // A variable with no current copy was deleted, as its last copy.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testAVariableWithNoCurrentCopyWasDeleted
  it("calls the last copy of a variable with no current one deleted", () => {
    const { store, reader } = vss([
      vssVariable({ name: "Gone", state: MARKED }),
      vssVariable({ name: "Gone", state: MARKED }),
    ]);
    const entry = variableEntries(store)[0] as UEFINode;

    expect(variableHistoryOf(entry, store, reader)?.versions.map((one) => one.state)).toEqual([
      "superseded",
      "deleted",
    ]);
  });

  // An NVAR chain is one variable: the head names it, the links carry its later
  // values, the last is current. A superseded whole entry — valid bit cleared —
  // is read for its name too.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testAnNVARVariablesChainAndSupersededEntriesAreItsHistory
  it("reads an NVAR chain and superseded entries as history", () => {
    const head = nvarEntry({
      next: nvarEntry({ data: bytes(1) }).length,
      name: "Setup",
      data: bytes(1),
    });
    const { store, reader } = nvar([
      head,
      nvarDataEntry({ data: bytes(3) }),
      supersededNvarEntry("Lang", bytes(0x65, 0x6e)),
      nvarEntry({ name: "Lang", data: bytes(0x64, 0x65) }),
    ]);
    const entries = variableEntries(store);
    const setup = variableHistoryOf(entries[1] as UEFINode, store, reader);
    expect(setup?.name).toBe("Setup");
    expect(setup?.versions.map((one) => one.state)).toEqual(["superseded", "current"]);
    expect(setup?.versions.map((one) => [...(reader.bytes(one.value) ?? [])])).toEqual([[1], [3]]);

    const lang = variableHistoryOf(entries[2] as UEFINode, store, reader);
    expect(entries[2]?.name).toBe("Invalid");
    expect(lang?.versions.map((one) => one.state)).toEqual(["superseded", "current"]);
    expect(lang?.versions.map((one) => [...(reader.bytes(one.value) ?? [])])).toEqual([
      [0x65, 0x6e],
      [0x64, 0x65],
    ]);
  });

  // A store's variables, one each, in the order the copies standing for them were
  // written: the current copy, or the last of a deleted one.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testAStoresVariablesAreTheCopiesStandingForThem
  it("lists a store's variables as the copies standing for them", () => {
    const { store, reader } = vss([
      vssVariable({ name: "BootOrder", data: bytes(1, 0), state: MARKED }),
      vssVariable({ name: "Gone", state: MARKED }),
      vssVariable({ name: "Lang", data: bytes(0x65) }),
      vssVariable({ name: "BootOrder", data: bytes(2, 0) }),
    ]);
    const e = variableEntries(store).map((node) => node.id);
    const variables = variablesIn(store, reader);

    expect(variables.map((one) => one.name)).toEqual(["Gone", "Lang", "BootOrder"]);
    expect(variables.map((one) => one.entry)).toEqual([e[1], e[2], e[3]]);
    expect(variables.map((one) => one.state)).toEqual(["deleted", "current", "current"]);
    expect(variables.map((one) => one.copies)).toEqual([1, 1, 2]);
    expect([...(reader.bytes(variables[2]?.value ?? { start: 0, end: 0 }) ?? [])]).toEqual([2, 0]);
    expect(variables[1]?.guid).toEqual(DRIVER_GUID);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testAnNVARChainIsOneVariable
  it("lists an NVAR chain as one variable", () => {
    const head = nvarEntry({
      next: nvarEntry({ data: bytes(1) }).length,
      name: "Setup",
      data: bytes(1),
    });
    const { store, reader } = nvar([head, nvarDataEntry({ data: bytes(3) })]);
    const variables = variablesIn(store, reader);

    expect(variables.map((one) => one.name)).toEqual(["Setup"]);
    expect([...(reader.bytes(variables[0]?.value ?? { start: 0, end: 0 }) ?? [])]).toEqual([3]);
    expect(variables[0]?.copies).toBe(2);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testANodeThatIsNoStoreHasNoVariables
  it("lists nothing for a node that is no store", () => {
    const image = nvramVolume({ stores: [] });
    const root = parseUefiImage(sourceOver(image)).roots[0];
    expect(
      root === undefined ? ["no root"] : variablesIn(root, new ImageReader(sourceOver(image)))
    ).toEqual([]);
  });

  // What a tree can leave out: each replaced copy, standing behind the current
  // one; a deleted variable keeps its last copy; a variable with one copy, and every
  // current one, stays.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testSupersededCopiesStandBehindTheCopyThatReplacedThem
  it("stands each superseded copy behind the copy that replaced it", () => {
    const { store, reader } = vss([
      vssVariable({ name: "BootOrder", state: MARKED }),
      vssVariable({ name: "Gone", state: MARKED }),
      vssVariable({ name: "BootOrder", state: MARKED }),
      vssVariable({ name: "Gone", state: MARKED }),
      vssVariable({ name: "Lang" }),
      vssVariable({ name: "BootOrder" }),
    ]);
    const ids = variableEntries(store).map((node) => node.id);

    expect(supersededCopies(store, reader)).toEqual(
      new Map([
        [ids[0]?.join(".") ?? "", ids[5]],
        [ids[2]?.join(".") ?? "", ids[5]],
        [ids[1]?.join(".") ?? "", ids[3]],
      ])
    );
  });

  // The bytes that differ, as runs over the length both copies have, and the
  // sizes.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramVariableHistoryTests.swift#NvramVariableHistoryTests.testAChangeIsItsSizesAndTheRunsThatDiffer
  it("takes a change to be the sizes and the runs that differ", () => {
    const { store, reader } = vss([
      vssVariable({ name: "Setup", data: bytes(0, 0, 0, 0, 0, 0), state: MARKED }),
      vssVariable({ name: "Setup", data: bytes(0, 1, 1, 0, 2, 0, 9) }),
    ]);
    const versions =
      variableHistoryOf(variableEntries(store)[0] as UEFINode, store, reader)?.versions ?? [];
    const [first, second] = versions;
    const change = variableChange(first as never, second as never, reader);

    expect(change?.oldSize).toBe(6);
    expect(change?.newSize).toBe(7);
    expect(change?.changed).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 5 },
    ]);
    expect(change === undefined ? 0 : changedBytes(change)).toBe(3);
    expect(change === undefined ? true : isNoChange(change)).toBe(false);
    const same = variableChange(first as never, first as never, reader);
    expect(same === undefined ? false : isNoChange(same)).toBe(true);
  });
});
