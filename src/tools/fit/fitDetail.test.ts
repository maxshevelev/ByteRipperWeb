import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { FIT } from "@/firmware/fit/fitEntry";
import { readFitTable, tableEntries } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import { fitImage, fitMicrocode, type TestRow } from "@/firmware/testing/testFit";
import { checksumText } from "@/firmware/uefi/checksums";
import {
  buildDetail,
  EMPTY_DETAIL,
  type FITDetailField,
  type FITRowDetail,
} from "@/tools/fit/fitDetail";
import { fitDisplay } from "@/tools/fit/fitDisplay";

/**
 * What the detail panel says about a row: the entry's own sixteen bytes, and
 * what its address leads to, read rather than assumed — upstream's
 * `FITDetailTests`.
 */

const MICROCODE = 0x2000;

const field = (detail: FITRowDetail, label: string): FITDetailField | undefined =>
  detail.fields.find((one) => one.label === label);

const value = (detail: FITRowDetail, label: string): string | undefined =>
  field(detail, label)?.value;

function detailOf(
  rows: readonly TestRow[],
  contents: ReadonlyMap<number, Uint8Array> = new Map()
): FITRowDetail {
  const bytes = fitImage({ rows, contents });
  const report = readFitTable(new ImageReader(sourceOver(bytes)));
  const row = report.table === undefined ? undefined : tableEntries(report.table)[0];
  if (row === undefined) throw new Error("the fixture has no rows");
  return buildDetail(row);
}

describe("buildDetail", () => {
  it("says a microcode row's own fields and its header", () => {
    const detail = detailOf(
      [{ type: FIT.microcodeType, target: MICROCODE }],
      new Map([[MICROCODE, fitMicrocode({ totalSize: 0x180 })]])
    );

    expect(detail.title).toBe("#2 Microcode");
    // The fields open with what the row is, not where it sits.
    expect(detail.fields[0]?.label).toBe("Type");

    // The row's own sixteen bytes.
    expect(value(detail, "Type")).toBe("Microcode · 0x01");
    expect(value(detail, "Offset")).toBe("0x00001010");
    expect(value(detail, "Address")).toBe("0xFFFF2000");
    // A row whose own Size field is zero says so in words: the area holds
    // nothing, and "0" reads like a number that was measured.
    expect(value(detail, "Size")).toBe("Empty");
    expect(value(detail, "Revision")).toBe("1.00");
    // The checksum byte is the header's, so a row that is not the header does
    // not show one.
    expect(value(detail, "Checksum")).toBeUndefined();

    // What the row points at, read from the component.
    expect(value(detail, "CPUID")).toBe("806EA");
    expect(value(detail, "Update revision")).toBe("0xF0");
    expect(value(detail, "Date")).toBe("2019-07-15");
    expect(value(detail, "Data size")).toBe("0x40 (64)");
    expect(value(detail, "Total size")).toBe("0x180 (384)");
    expect(value(detail, "Platform IDs")).toBe("0x1");
    // The test image's dwords sum to zero.
    expect(value(detail, "Image checksum")?.endsWith(" (Valid)")).toBe(true);
  });

  it("says the header row's count and its signature", () => {
    // The header is a row like any other, but its `Size` counts entries rather
    // than bytes and its `Address` is the signature, not a pointer.
    const bytes = fitImage({ rows: [{ type: FIT.microcodeType, target: MICROCODE }] });
    const header = readFitTable(new ImageReader(sourceOver(bytes))).table?.rows[0];
    if (header === undefined) throw new Error("the fixture has no header row");
    const detail = buildDetail(header);

    expect(detail.title).toBe("#1 FIT Header");
    expect(value(detail, "Address")).toBe("_FIT_");
    expect(value(detail, "Size")).toBe("2 rows");
    // The fixture's checksum is the one that makes the table sum to zero.
    expect(value(detail, "Checksum")?.endsWith(" (Valid)")).toBe(true);
    // The header points nowhere, so there are no target fields.
    expect(value(detail, "Points at")).toBeUndefined();
    expect(value(detail, "CPUID")).toBeUndefined();
  });

  it("marks a wrong header checksum as the problem it is", () => {
    // The panel colours that one value red — the same contract the UEFI detail
    // has. Whether it checks out is the validator's word about the whole table,
    // so this reads the detail the display builds.
    const row: TestRow = { type: FIT.microcodeType, target: MICROCODE };
    const headerDetail = (bytes: Uint8Array) => {
      const report = readFitTable(new ImageReader(sourceOver(bytes)));
      return { table: report.table, detail: fitDisplay(report, 0).detail };
    };

    const wrong = headerDetail(fitImage({ rows: [row], checksum: 0xcc }));
    expect(field(wrong.detail, "Checksum")?.isProblem).toBe(true);
    // The wrong byte says what it should be — the byte the whole table has to
    // sum to — not just that it is wrong.
    const shouldBe = wrong.table?.computedChecksum ?? 0;
    expect(field(wrong.detail, "Checksum")?.value).toBe(
      `0xCC (Invalid), should be 0x${shouldBe.toString(16).toUpperCase().padStart(2, "0")}`
    );

    // A right checksum is not a problem — a detail that reddens every checksum
    // says nothing.
    const right = headerDetail(fitImage({ rows: [row] }));
    expect(field(right.detail, "Checksum")?.value.endsWith(" (Valid)")).toBe(true);
    expect(field(right.detail, "Checksum")?.isProblem).toBe(false);

    // A header that says its checksum does not count says so in as many words:
    // the byte is not wrong, it is not looked at — and "Invalid" is kept for a
    // checksum that really is.
    const unchecked = headerDetail(fitImage({ rows: [row], checksum: 0xcc, checksumValid: false }));
    expect(field(unchecked.detail, "Checksum")?.value).toBe("0xCC (Not checked)");
    expect(field(unchecked.detail, "Checksum")?.isProblem).toBe(false);
  });

  it("marks a wrong microcode checksum as a problem, and says what it should be", () => {
    // It is read from the image the row points at, and a wrong one is what a
    // bad edit leaves behind.
    const good = fitMicrocode({ totalSize: 0x180 });
    const shouldBe = new ImageReader(sourceOver(good)).uint32(0x10);
    const image = Uint8Array.from(good);
    image[0x10] = (image[0x10] ?? 0) ^ 0xff; // the header's checksum dword
    const stored = new ImageReader(sourceOver(image)).uint32(0x10) ?? 0;

    const detail = detailOf(
      [{ type: FIT.microcodeType, target: MICROCODE }],
      new Map([[MICROCODE, image]])
    );

    expect(field(detail, "Image checksum")?.isProblem).toBe(true);
    expect(field(detail, "Image checksum")?.value).toBe(
      checksumText({ value: stored, valid: false, expected: shouldBe, digits: 4 })
    );
  });

  it("reads a policy row's Index/IO registers", () => {
    // A policy row at version 0 keeps a descriptor in the first eight bytes,
    // and the detail reads it as such rather than as the pointer it is shaped
    // like.
    const detail = detailOf([
      { type: FIT.tpmPolicyType, address: 0x0002_0001_0000_0080, version: 0 },
    ]);

    expect(value(detail, "Index register")).toBe("0x0080");
    expect(value(detail, "Data register")).toBe("0x0000");
    expect(value(detail, "Access width")).toBe("1 byte");
    expect(value(detail, "Bit position")).toBe("0");
    expect(value(detail, "Index")).toBe("0x0002");
  });

  it("says where and how long for a row that leads somewhere else", () => {
    // Nothing has read at that offset here — no tree was handed over — so there
    // is no "Points at" line to draw. The name of what is there is the tree's
    // to give, and it arrives once the branch covering the address is opened.
    const detail = detailOf([{ type: FIT.startupACMType, target: 0x3000, size: 0x10 }]);

    // The row's own size field, in bytes.
    expect(value(detail, "Size")).toBe("0x100 (256)");
    expect(value(detail, "Points at")).toBeUndefined();
    expect(value(detail, "Component")).toBe("0x00003000");
    expect(value(detail, "Length")).toBe("0x100 (256)");
  });

  it("gives a row that points nowhere no target fields", () => {
    // The entry's own bytes are the whole of what there is to say.
    const detail = detailOf([{ type: FIT.emptyType, address: 0 }]);

    expect(value(detail, "Points at")).toBeUndefined();
    expect(value(detail, "CPUID")).toBeUndefined();
    expect(value(detail, "Index register")).toBeUndefined();
  });

  it("says nothing when there is no row to speak of", () => {
    expect(EMPTY_DETAIL.fields).toEqual([]);
    expect(EMPTY_DETAIL.title).toBe("");
  });
});
