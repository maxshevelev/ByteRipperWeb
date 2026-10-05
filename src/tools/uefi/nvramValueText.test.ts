import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import type { EFIGUID } from "@/firmware/uefi/efiGuid";
import { guidBytes } from "@/firmware/uefi/efiGuid";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { makeNode, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { ROW_LIMIT, variableRowOf, variableValueRow } from "@/tools/uefi/nvramValueText";
import { nodeName, showsValue } from "@/tools/uefi/uefiTreeDisplay";

/**
 * Ported from `UEFITreeDisplayTests` and `NvramValueText`: a variable's row says its
 * value after its name, as its type reads. The web's level is the row text the worker
 * reads and the name the panel then draws, the panel holding no bytes of its own.
 */

const vendor: EFIGUID = { a: 0x1111_1111, b: 0x2222_2222, c: 0, d: 0 };
const text = (value: string) => [...value].map((one) => one.charCodeAt(0));

function row(name: string, data: readonly number[]): string {
  const reader = new ImageReader(sourceOver(Uint8Array.from(data)));
  return variableValueRow(name, vendor, 7, { start: 0, end: data.length }, reader);
}

describe("a variable's row", () => {
  // With the image and its bytes, a live VSS row gives the value after the name, as
  // its type reads; a value it cannot read by its size.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeDisplayTests.swift#UEFITreeDisplayTests.testAVssRowSaysItsValue
  it("says its value after its name, as its type reads", () => {
    expect(row("BootOrder", [0x03, 0x00, 0x01, 0x20])).toBe("BootOrder = 0003, 2001");
    expect(row("Lang", [...text("eng"), 0])).toBe('Lang = "eng"');
    expect(row("Timeout", [0x2c, 0x01])).toBe("Timeout = 300 (0x12C)");
    expect(row("WRDD", [0x00, 0x50, 0x41])).toBe("WRDD = 00 50 41");
    expect(row("Setup", new Array(40).fill(0))).toBe("Setup (40 bytes)");
    expect(row("Empty", [])).toBe("Empty");
  });

  // An NVAR variable's row says its value too.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeDisplayTests.swift#UEFITreeDisplayTests.testAnNvarRowSaysItsValue
  it("says an NVAR variable's value too", () => {
    expect(row("Setup", [0x2c, 0x01])).toBe("Setup = 300 (0x12C)");
  });

  // A row that cuts a long value off says so.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeDisplayTests.swift#UEFITreeDisplayTests.testALongVssValueIsCutOffInTheRow
  it("cuts a long value off and says so", () => {
    const long = row("Long", [...text("a".repeat(100)), 0]);
    expect(long).toBe(`Long = "${"a".repeat(ROW_LIMIT - 1)}…`);
  });

  // A value too long to be read is not: a row is drawn on every scroll.
  it("does not read a value past the read limit", () => {
    const reader = new ImageReader(sourceOver(new Uint8Array(0x10)));
    expect(variableValueRow("Huge", vendor, 7, { start: 0, end: 0x20000 }, reader)).toBe(
      "Huge (131072 bytes)"
    );
  });
});

describe("the name the panel draws for a variable", () => {
  // Without the bytes, the name alone.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeDisplayTests.swift#UEFITreeDisplayTests.testAVssRowSaysItsValue
  it("is the row the worker read, or the name alone without it", () => {
    const node = { kind: "vssEntry", name: "BootOrder", guid: vendor };
    expect(nodeName(node, GuidsCatalogue.empty)).toBe("BootOrder");
    expect(nodeName({ ...node, valueRow: "BootOrder = 0003" }, GuidsCatalogue.empty)).toBe(
      "BootOrder = 0003"
    );
  });
});

describe("which rows say a value, and where it lies", () => {
  /** A `$VSS` variable `BootOrder` with two bytes of value, as an entry node. */
  function vssEntry(): { node: UEFINode; reader: ImageReader } {
    const name = [..."BootOrder"].flatMap((one) => [one.charCodeAt(0), 0]).concat([0, 0]);
    const bytes = Uint8Array.from([
      0xaa,
      0x55,
      0x7f,
      0,
      7,
      0,
      0,
      0,
      name.length,
      0,
      0,
      0,
      2,
      0,
      0,
      0,
      ...guidBytes(vendor),
      ...name,
      0x03,
      0x00,
    ]);
    const node = makeNode({
      kind: "vssEntry",
      subtype: Sub.standardVssEntry,
      name: "BootOrder",
      guid: vendor,
      header: { start: 0, end: 32 },
      body: { start: 32, end: bytes.length },
    });
    return { node, reader: new ImageReader(sourceOver(bytes)) };
  }

  // The panel hands the bytes to every row that says a value — the variables of all
  // three stores — and to no other.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeDisplayTests.swift#UEFITreeDisplayTests.testEveryVariableRowAsksForItsBytes
  it("asks for the bytes of every variable row, and of no other", () => {
    expect(showsValue({ kind: "vssEntry" })).toBe(true);
    expect(showsValue({ kind: "nvarEntry" })).toBe(true);
    expect(showsValue({ kind: "dvarEntry" })).toBe(true);
    expect(showsValue({ kind: "vssStore" })).toBe(false);
  });

  // The store decides where a VSS value is: a VSS2 variable's header is read as one.
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFITreeDisplayTests.swift#UEFITreeDisplayTests.testAVssRowIsReadByTheStoreItIsGiven
  it("reads a VSS row by the store it is given", () => {
    const { node, reader } = vssEntry();
    const store = makeNode({
      kind: "vss2Store",
      name: "",
      header: { start: 0, end: 0 },
      body: { start: 0, end: 0 },
    });
    expect(variableRowOf(node, undefined, reader)).toBe("BootOrder = 0003");
    expect(variableRowOf(node, store, reader)).toBe("BootOrder = 0003");
    // Nothing without the bytes.
    expect(variableRowOf(node, undefined, undefined)).toBeUndefined();
  });
});
