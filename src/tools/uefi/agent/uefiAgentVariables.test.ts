import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, member } from "@/core/agent/json";
import { nvramVolume, vssStore, vssVariable } from "@/firmware/testing/testNvram";
import { agentTreeOver } from "@/tools/uefi/agent/uefiAgentTree";
import {
  differingRuns,
  variableRows,
  variablesAnswer,
  variablesCompareAnswer,
} from "@/tools/uefi/agent/uefiAgentVariables";

/**
 * The NVRAM variables of an image for an agent, and two images' variables set side by side.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAgentVariablesTests.swift#UEFIAgentVariablesTests
 */

const MARKED = 0x3c;
const bytes = (...values: number[]) => Uint8Array.from(values);
const args = (values: { [key: string]: Json } = {}) => new AgentArguments(values);

const imageWith = (variables: Uint8Array[]) =>
  nvramVolume({ stores: [vssStore({ variables, freeSpace: 0x40 })] });

const rowsOf = (variables: Uint8Array[]) => variableRows(agentTreeOver(imageWith(variables)));
const names = (answer: Json, key = "variables") =>
  (member(answer, key) as Json[]).map((one) => member(one, "name"));

describe("the rows of a store", () => {
  it("are the copies standing for the variables, in the order they were written", () => {
    const rows = rowsOf([
      vssVariable({ name: "BootOrder", data: bytes(1, 0), state: MARKED }),
      vssVariable({ name: "Gone", state: MARKED }),
      vssVariable({ name: "Lang", data: bytes(0x65) }),
      vssVariable({ name: "BootOrder", data: bytes(2, 0) }),
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Gone", "Lang", "BootOrder"]);
    expect(rows.map((row) => row.copies)).toEqual([1, 1, 2]);
    expect(rows.map((row) => row.isDeleted)).toEqual([true, false, false]);
    expect([...(rows[2]?.bytes ?? [])]).toEqual([2, 0]);
  });
});

describe("variables", () => {
  // @upstream ByteRipperTests/AgentFirmwareToolsTests.swift#AgentFirmwareToolsTests.testVariablesListsTheCopyInForceOfEach
  it("lists the standing copies with their stores, and not the deleted ones unless asked", () => {
    const rows = rowsOf([
      vssVariable({ name: "Lang", data: bytes(0x65, 0x6e) }),
      vssVariable({ name: "Gone", state: MARKED }),
    ]);
    const answer = variablesAnswer(rows, args(), 1);
    expect(names(answer)).toEqual(["Lang"]);
    expect(member(answer, "total")).toBe(1);
    expect((member(answer, "stores") as Json[]).length).toBe(1);
    expect(member((member(answer, "stores") as Json[])[0], "variables")).toBe(2);
    expect(names(variablesAnswer(rows, args({ deleted: true }), 1)).sort()).toEqual([
      "Gone",
      "Lang",
    ]);
  });

  it("filter by a part of the name and by store, and say when the image has none", () => {
    const rows = rowsOf([vssVariable({ name: "BootOrder" }), vssVariable({ name: "Lang" })]);
    expect(names(variablesAnswer(rows, args({ name: "BOOT" }), 1))).toEqual(["BootOrder"]);
    const store = member(
      (member(variablesAnswer(rows, args(), 1), "stores") as Json[])[0],
      "id"
    ) as string;
    expect(names(variablesAnswer(rows, args({ store }), 1)).length).toBe(2);
    expect(names(variablesAnswer(rows, args({ store: "9.9" }), 1))).toEqual([]);
    expect(member(variablesAnswer([], args(), 1), "note")).toMatch(/No VSS, NVAR/);
  });

  it("read a value as its type", () => {
    const rows = rowsOf([vssVariable({ name: "Lang", data: bytes(0x65, 0x6e, 0x67, 0) })]);
    const value = member(
      (member(variablesAnswer(rows, args(), 1), "variables") as Json[])[0],
      "value"
    );
    expect(typeof value).toBe("string");
  });
});

describe("variables_compare", () => {
  it("sets two images' variables side by side by name and GUID", () => {
    const mine = rowsOf([
      vssVariable({ name: "Same", data: bytes(1) }),
      vssVariable({ name: "Differs", data: bytes(1, 2, 3, 4) }),
      vssVariable({ name: "OnlyHere", data: bytes(9) }),
    ]);
    const theirs = rowsOf([
      vssVariable({ name: "Same", data: bytes(1) }),
      vssVariable({ name: "Differs", data: bytes(1, 9, 3, 7) }),
      vssVariable({ name: "OnlyThere", data: bytes(8) }),
    ]);
    const answer = variablesCompareAnswer(mine, theirs, args(), [1, 1]);
    expect(member(answer, "same")).toBe(1);
    expect(member(answer, "counts")).toEqual({
      only_in_document: 1,
      only_in_against: 1,
      changed: 1,
    });
    expect(names(answer, "only_in_document")).toEqual(["OnlyHere"]);
    expect(names(answer, "only_in_against")).toEqual(["OnlyThere"]);
    const changed = (member(answer, "changed") as Json[])[0];
    expect(member(changed, "name")).toBe("Differs");
    expect(member(changed, "differing_bytes")).toBe(2);
    expect(member(changed, "runs")).toEqual(["0x1", "0x3"]);
  });

  it("pages the three lists as one sequence", () => {
    const mine = rowsOf([
      vssVariable({ name: "A", data: bytes(1) }),
      vssVariable({ name: "B", data: bytes(2) }),
    ]);
    const theirs = rowsOf([
      vssVariable({ name: "A", data: bytes(9) }),
      vssVariable({ name: "C", data: bytes(3) }),
    ]);
    const first = variablesCompareAnswer(mine, theirs, args({ limit: 2 }), [1, 1]);
    expect(names(first, "changed")).toEqual(["A"]);
    expect(names(first, "only_in_document")).toEqual(["B"]);
    expect(names(first, "only_in_against")).toEqual([]);
    const next = member(first, "next") as string;
    const second = variablesCompareAnswer(mine, theirs, args({ limit: 2, after: next }), [1, 1]);
    expect(names(second, "only_in_against")).toEqual(["C"]);
    expect(member(second, "next")).toBeNull();
  });
});

describe("the differing runs", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFIAgentVariablesTests.swift#UEFIAgentVariablesTests.testRunsOfDifferingBytes
  it("are the offsets that differ, and the longer one's tail as one run", () => {
    expect(differingRuns(bytes(1, 2, 3), bytes(1, 9, 3))).toEqual([{ start: 1, end: 2 }]);
    expect(differingRuns(bytes(1, 2), bytes(1, 2, 3, 4))).toEqual([{ start: 2, end: 4 }]);
    expect(differingRuns(bytes(1, 2, 3), bytes(1, 2, 9, 4))).toEqual([{ start: 2, end: 4 }]);
    expect(differingRuns(bytes(1), bytes(1))).toEqual([]);
  });
});
