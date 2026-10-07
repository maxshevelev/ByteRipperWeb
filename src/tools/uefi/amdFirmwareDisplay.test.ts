import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { EFS_SIGNATURE, fletcher32 } from "@/firmware/uefi/amdFirmware";
import { repairsForAMDDirectory } from "@/firmware/uefi/checksumRepair";
import { diagnosticMessage } from "@/firmware/uefi/diagnostic";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { parseUefiImage, type UEFIImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import { isProblemField } from "@/tools/toolDetail";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { nodeName, typeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * The AMD PSP's map in the panel: its rows read as padding and open the PSP's entry, the
 * details lead from the EFS to the directories and from a directory to its blobs, and a
 * directory's checksum is checked and fixed like any other.
 */

const MAPPED = 0xff80_0000;
const put32 = (bytes: Uint8Array, offset: number, value: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(offset, value >>> 0, true);
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

function entry(type: number, size: number, location: number, bios: boolean): Uint8Array {
  const bytes = new Uint8Array(bios ? 24 : 16);
  bytes[0] = type;
  put32(bytes, 4, size);
  put32(bytes, 8, location);
  if (bios) bytes.fill(0xff, 16, 24);
  return bytes;
}

function directory(
  bytes: Uint8Array,
  signature: string,
  offset: number,
  entries: Uint8Array[]
): void {
  bytes.set(ascii(signature), offset);
  put32(bytes, offset + 8, entries.length);
  put32(bytes, offset + 12, 0);
  const body = Uint8Array.from(entries.flatMap((one) => [...one]));
  bytes.set(body, offset + 16);
  put32(bytes, offset + 4, fletcher32(bytes.subarray(offset + 8, offset + 16 + body.length)));
}

/**
 * An 8 MiB flash: the EFS at `0x20000` → `$PSP` at `0x31000` with the boot loader at
 * `0x32000`, and `$BHD` at `0x40000` with the APCB at `0x41000`.
 */
function flash(): Uint8Array {
  const bytes = new Uint8Array(0x80_0000).fill(0xff);
  put32(bytes, 0x2_0000, EFS_SIGNATURE);
  for (let field = 4; field < 0x50; field += 4) put32(bytes, 0x2_0000 + field, 0);
  put32(bytes, 0x2_0014, MAPPED + 0x3_1000);
  put32(bytes, 0x2_0028, MAPPED + 0x4_0000);
  directory(bytes, "$PSP", 0x3_1000, [entry(0x01, 0x100, MAPPED + 0x3_2000, false)]);
  directory(bytes, "$BHD", 0x4_0000, [entry(0x60, 0x100, MAPPED + 0x4_1000, true)]);
  for (const start of [0x3_2000, 0x4_1000]) bytes.fill(0x11, start, start + 0x100);
  return bytes;
}

const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));
const row = (image: UEFIImage, kind: UEFINode["kind"], offset: number): UEFINode => {
  const found = image.allNodes.find((node) => node.kind === kind && node.header.start === offset);
  if (found === undefined) throw new Error(`no ${kind} at ${offset}`);
  return found;
};
const reader = (bytes: Uint8Array) => new ImageReader(sourceOver(bytes));

describe("the PSP's map in the panel", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/AMDFirmwareDisplayTests.swift#AMDFirmwareDisplayTests.testTheRowsReadAsPaddingAndOpenThePSPsEntry
  it("reads its rows as padding and opens the PSP's entry", () => {
    const image = parse(flash());
    const efs = row(image, "amdEFS", 0x2_0000);
    const dir = row(image, "amdDirectory", 0x3_1000);
    const blob = row(image, "amdFirmwareEntry", 0x3_2000);

    expect([efs, dir, blob].map(typeText)).toEqual(["Padding", "Padding", "Padding"]);
    expect(nodeName(dir, GuidsCatalogue.empty)).toBe("PSP directory $PSP");
    expect(blob.name).toBe("PSP_FW_BOOT_LOADER");
    for (const node of [efs, dir, blob]) expect(uefiHelpTerm(node)).toBe("amd-psp");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/AMDFirmwareDisplayTests.swift#AMDFirmwareDisplayTests.testTheEFSLeadsToItsDirectoriesAndADirectoryToItsBlobs
  it("leads from the EFS to its directories and from a directory to its blobs", () => {
    const bytes = flash();
    const image = parse(bytes);
    const efs = buildNodeDetail(row(image, "amdEFS", 0x2_0000), image, reader(bytes), []);
    const pointers = efs.tables.find((one) => one.title === "Directories");
    expect(pointers?.rows.map((one) => one[0]?.text)).toEqual(["+0x14", "+0x28"]);
    expect(pointers?.rows.map((one) => one[2]?.text)).toEqual([
      "PSP directory $PSP",
      "BIOS directory $BHD",
    ]);
    expect(pointers?.rowTargets).toEqual([
      { kind: "node", path: row(image, "amdDirectory", 0x3_1000).id },
      { kind: "node", path: row(image, "amdDirectory", 0x4_0000).id },
    ]);

    const bhd = buildNodeDetail(row(image, "amdDirectory", 0x4_0000), image, reader(bytes), []);
    const value = (label: string) => bhd.fields.find((one) => one.label === label)?.value;
    expect(value("Kind")).toBe("AMD firmware directory");
    expect(value("Type")).toBe("BIOS directory");
    expect(value("Address mode")).toBe("Memory-mapped address");
    expect(value("Checksum")?.endsWith("(Valid)")).toBe(true);
    const entries = bhd.tables.find((one) => one.title === "Entries");
    expect(entries?.rows[0]?.map((one) => one.text)).toEqual([
      "0",
      "APCB (0x60)",
      "0x100 (256)",
      "0x41000",
      "",
    ]);
    expect(entries?.rowTargets).toEqual([
      { kind: "node", path: row(image, "amdFirmwareEntry", 0x4_1000).id },
    ]);

    const blob = buildNodeDetail(
      row(image, "amdFirmwareEntry", 0x4_1000),
      image,
      reader(bytes),
      []
    );
    expect(
      blob.fields.some((one) => one.label === "Entry type" && one.value === "APCB (0x60)")
    ).toBe(true);
    const listed = blob.tables.find((one) => one.title === "Listed in");
    expect(listed?.rows.map((one) => one[0]?.text)).toEqual(["BIOS directory $BHD"]);
  });

  /**
   * A directory whose checksum is wrong is flagged, says what it should be, and the repair
   * writes it.
   *
   * @upstream Modules/UEFITool/Tests/UEFIToolTests/AMDFirmwareDisplayTests.swift#AMDFirmwareDisplayTests.testAWrongChecksumIsFlaggedAndRepaired
   */
  it("flags a wrong checksum, says what it should be, and repairs it", () => {
    const bytes = flash();
    const stored = Array.from(bytes.subarray(0x3_1004, 0x3_1008));
    bytes[0x3_1004] = (bytes[0x3_1004] ?? 0) ^ 0xff;
    const image = parse(bytes);
    const dir = row(image, "amdDirectory", 0x3_1000);

    const repairs = repairsForAMDDirectory(dir, reader(bytes));
    expect(repairs.map((one) => [one.offset, Array.from(one.bytes)])).toEqual([[0x3_1004, stored]]);
    expect(repairsForAMDDirectory(row(image, "amdDirectory", 0x4_0000), reader(bytes))).toEqual([]);
    // The parse says so, in words that name the structure.
    expect(
      image.diagnostics
        .map(diagnosticMessage)
        .filter((text) => text.includes("PSP directory checksum"))
    ).toHaveLength(1);

    const detail = buildNodeDetail(dir, image, reader(bytes), repairs);
    const checksum = detail.fields.find((one) => one.label === "Checksum");
    expect(checksum !== undefined && isProblemField(checksum)).toBe(true);
    expect(checksum?.value).toContain("should be");
  });
});
