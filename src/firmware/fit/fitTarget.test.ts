import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import { fitSeverity } from "@/firmware/fit/fitProblem";
import { effectiveSize, type FITTarget, readFitTable, tableEntries } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testFit";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { makeSpan } from "@/firmware/uefi/uefiNode";

/** Ported from `FITTargetTests.swift`: what a row points at, checked by reading it. */

const TARGET = 0x2000;

const reportOf = (
  row: Test.TestRow,
  contents?: ReadonlyMap<number, Uint8Array>,
  image?: UEFIImage
) =>
  readFitTable(
    new ImageReader(
      sourceOver(
        Test.fitImage(contents === undefined ? { rows: [row] } : { rows: [row], contents })
      )
    ),
    image
  );

const targetOf = (
  row: Test.TestRow,
  contents?: ReadonlyMap<number, Uint8Array>,
  image?: UEFIImage
): FITTarget | undefined => {
  const table = reportOf(row, contents, image).table;
  return table === undefined ? undefined : tableEntries(table)[0]?.target;
};

describe("a microcode row", () => {
  /**
   * A microcode row's own `Size` is required to be zero and the truth is in the
   * component — which is why the size shown comes from there.
   */
  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testAMicrocodeRowLeadsToItsHeader
  it("leads to its header", () => {
    const report = reportOf(
      { type: FIT.microcodeType, target: TARGET },
      new Map([[TARGET, Test.fitMicrocode({ totalSize: 0x180 })]])
    );
    const found = tableEntries(report.table as never)[0];

    expect(found?.target.kind).toBe("microcode");
    if (found?.target.kind !== "microcode") throw new Error("expected a microcode target");
    expect(found.target.header.processorSignature).toBe(0x0008_06ea);
    expect(found.target.header.totalSize).toBe(0x180);
    expect(found.entry.size).toBe(0);
    expect(effectiveSize(found)).toBe(0x180);
  });

  // `FF FF FF FF` is a slot a vendor reserved for a later update, and the
  // specification allows a row to point at one. It is not a defect.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testAMicrocodeRowMayPointAtAnEmptySlot
  it("may point at an empty slot", () => {
    const report = reportOf({ type: FIT.microcodeType, target: TARGET });

    expect(tableEntries(report.table as never)[0]?.target).toEqual({
      kind: "emptyMicrocodeSlot",
      offset: TARGET,
    });
    expect(report.problems.some((one) => fitSeverity(one.detail) === "error")).toBe(false);
  });

  /**
   * An address off by one hex digit, landing on bytes that are not microcode
   * and not an empty slot. One read of forty-eight bytes catches the whole
   * class.
   */
  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testAMicrocodeRowPointingAtSomethingElseIsReported
  it("is reported when it points at something else", () => {
    const report = reportOf(
      { type: FIT.microcodeType, target: TARGET },
      new Map([[TARGET, new Uint8Array(0x100).fill(0x5a)]])
    );

    expect(tableEntries(report.table as never)[0]?.target).toEqual({
      kind: "bytes",
      offset: TARGET,
      description: undefined,
    });
    expect(
      report.problems.some(
        (one) =>
          one.detail.kind === "notMicrocodeAtTheAddress" &&
          one.detail.address === 0xffff_2000 &&
          one.entryIndex === 1
      )
    ).toBe(true);
  });
});

/**
 * A policy row at version 0 keeps an Index/IO register descriptor in the first
 * eight bytes. Reading it as an address is the mistake the format invites, and
 * it would put the dump somewhere meaningless.
 */
describe("a policy row", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testAPolicyRowAtVersionZeroIsNotAnAddress
  it("is not an address at version zero", () => {
    expect(
      targetOf({ type: FIT.tpmPolicyType, address: 0x0002_0001_0000_0080, version: 0 })
    ).toEqual({
      kind: "indexIORegisters",
      descriptor: {
        indexRegister: 0x0080,
        dataRegister: 0x0000,
        accessWidth: 1,
        bitPosition: 0,
        index: 0x0002,
      },
    });
    expect(targetOf({ type: FIT.txtPolicyType, address: 0x1234, version: 0 })).toEqual({
      kind: "indexIORegisters",
      descriptor: {
        indexRegister: 0x1234,
        dataRegister: 0,
        accessWidth: 0,
        bitPosition: 0,
        index: 0,
      },
    });
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testAPolicyRowAtVersionOneIsAnAddress
  it("is an address at version one", () => {
    expect(targetOf({ type: FIT.tpmPolicyType, target: TARGET, version: 1 })).toEqual({
      kind: "bytes",
      offset: TARGET,
      description: undefined,
    });
  });
});

describe("the rows that lead nowhere", () => {
  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testTheHeaderAndAnEmptySlotPointNowhere
  it("are the header and an empty slot", () => {
    const table = reportOf({ type: FIT.emptyType, address: 0 }).table;

    expect(table?.rows[0]?.target).toEqual({ kind: "nothing" });
    expect(tableEntries(table as never)[0]?.target).toEqual({ kind: "nothing" });
  });

  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testAnAddressOutsideTheImageLeadsNowhere
  it("include an address outside the image", () => {
    expect(targetOf({ type: FIT.startupACMType, address: 0x1234 })).toEqual({
      kind: "outsideTheImage",
    });
    expect(targetOf({ type: FIT.startupACMType, address: 0xffff_ffff_ffff_0000 })).toEqual({
      kind: "outsideTheImage",
    });
  });
});

describe("naming what a row points at", () => {
  // The difference between an address and a place.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testWhatARowPointsAtIsNamedByTheTree
  it("uses what the tree says covers the bytes", () => {
    const node = makeSpan({ kind: "volume", name: "FFSv2", range: { start: 0x1800, end: 0x3000 } });
    const image = new UEFIImage({ size: 0x1_0000, roots: [node], addressDiff: 0xffff_0000 });

    expect(targetOf({ type: FIT.startupACMType, target: TARGET }, undefined, image)).toEqual({
      kind: "bytes",
      offset: TARGET,
      description: "FFSv2",
    });
  });

  // A row whose type does not use `Size` shows nothing rather than a zero that
  // looks like a size.
  // @upstream Modules/FITTool/Tests/FITToolTests/FITTargetTests.swift#FITTargetTests.testARowWithNoSizeShowsNoSize
  it("shows no size for a row that has none", () => {
    const report = reportOf({ type: FIT.startupACMType, target: TARGET });
    const row = tableEntries(report.table as never)[0];

    expect(row === undefined ? undefined : effectiveSize(row)).toBeUndefined();
  });
});
