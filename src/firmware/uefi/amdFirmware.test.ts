import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { zlibEncode } from "@/firmware/compression/zlibCodec";
import { ImageReader } from "@/firmware/imageReader";
import * as Test from "@/firmware/testing/testImage";
import {
  amdBlobs,
  amdEntryName,
  amdRomSize,
  directoryAddressMode,
  directoryChecksumMatches,
  EFS_SIGNATURE,
  entryInstance,
  entryIsCompressed,
  entryIsCopy,
  entryIsReset,
  entryIsValue,
  fletcher32,
  readAMDFirmware,
} from "@/firmware/uefi/amdFirmware";
import { itemType } from "@/firmware/uefi/itemClassification";
import { SpaceReaders } from "@/firmware/uefi/spaceReaders";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { planRebuild } from "@/firmware/uefi/uefiRebuild";
import { ItemType } from "@/firmware/uefi/uefiTypes";

/**
 * The AMD PSP's map (`AMDFirmware`): the EFS found, the directories walked from it — combo,
 * first and second level, a slot header — their entries' locations read in each address
 * mode, and every structure laid into the padding as a row, a compressed BIOS image opening
 * to what it inflates to.
 */

const SIZE = 0x80_0000;
/** Where an 8 MiB flash is mapped: its top at 4 GiB. */
const MAPPED = 0xff80_0000;

const put32 = (bytes: Uint8Array, offset: number, value: number) =>
  new DataView(bytes.buffer, bytes.byteOffset).setUint32(offset, value >>> 0, true);
const put64 = (bytes: Uint8Array, offset: number, value: bigint) =>
  new DataView(bytes.buffer, bytes.byteOffset).setBigUint64(offset, value, true);
const ascii = (text: string) => Uint8Array.from(text, (character) => character.charCodeAt(0));

/** A directory at `offset`: its signature, entries, and the checksum the PSP checks. */
function directory(
  bytes: Uint8Array,
  signature: string,
  offset: number,
  entries: readonly Uint8Array[],
  options: { info?: number; header?: number } = {}
): void {
  const header = options.header ?? 0x10;
  bytes.set(ascii(signature), offset);
  put32(bytes, offset + 8, entries.length);
  put32(bytes, offset + 12, options.info ?? 0);
  if (header > 0x10) bytes.fill(0, offset + 0x10, offset + header);
  let at = offset + header;
  for (const entry of entries) {
    bytes.set(entry, at);
    at += entry.length;
  }
  put32(bytes, offset + 4, fletcher32(bytes.subarray(offset + 8, at)));
}

function pspEntry(type: number, size: number, location: bigint, flags = 0): Uint8Array {
  const entry = new Uint8Array(16);
  entry[0] = type;
  entry[2] = flags & 0xff;
  entry[3] = flags >> 8;
  put32(entry, 4, size);
  put64(entry, 8, location);
  return entry;
}

function biosEntry(
  type: number,
  size: number,
  location: bigint,
  options: { flags?: number; destination?: bigint } = {}
): Uint8Array {
  const entry = new Uint8Array(24);
  entry.set(pspEntry(type, size, location, options.flags ?? 0));
  put64(entry, 16, options.destination ?? 0xffff_ffff_ffff_ffffn);
  return entry;
}

const mapped = (offset: number) => BigInt(MAPPED) + BigInt(offset);

interface Fixture {
  bytes: Uint8Array;
  stream: number;
  volume: Uint8Array;
}

/**
 * An 8 MiB AMD flash:
 *
 * - EFS at `0x20000`; `+0x14` names the combo directory by flash offset, `+0x28` the BIOS
 *   directory by its mapped address.
 * - `2PSP` at `0x30000`, one entry for PSP id `0xBC0C0140` → `$PSP` at `0x31000`: a boot
 *   loader with room for `0x100`, a soft fuse value, a gasket blob around the EFS
 *   (`0x1F000`–`0x21000`), and `$PL2`.
 * - `$PL2` at `0x33000`, entries relative to it: the trusted OS at `+0x400`, and the boot
 *   loader again, `0x80` long.
 * - `$BHD` at `0x40000`: APCB, APOB (no location), a compressed BIOS image at `0x50000`, and
 *   `$BL2` at `0x42000` with a microcode patch.
 */
function fixture(): Fixture {
  const bytes = new Uint8Array(SIZE).fill(0xff);
  const efs = 0x2_0000;
  put32(bytes, efs, EFS_SIGNATURE);
  for (let field = 4; field < 0x50; field += 4) put32(bytes, efs + field, 0);
  put32(bytes, efs + 0x14, 0x3_0000);
  put32(bytes, efs + 0x28, MAPPED + 0x4_0000);

  const combo = new Uint8Array(16);
  put32(combo, 4, 0xbc0c_0140);
  put64(combo, 8, 0x3_1000n);
  directory(bytes, "2PSP", 0x3_0000, [combo], { header: 0x20 });

  directory(bytes, "$PSP", 0x3_1000, [
    pspEntry(0x01, 0x100, mapped(0x3_2000)),
    pspEntry(0x0b, 0xffff_ffff, 0x1000_8041n),
    pspEntry(0x24, 0x2000, mapped(0x1_f000)),
    pspEntry(0x40, 0x400, mapped(0x3_3000)),
  ]);
  // Mode 2 (bits 29–30): the entries say for themselves; these are relative to the
  // directory, but for the boot loader's mapped address.
  directory(
    bytes,
    "$PL2",
    0x3_3000,
    [pspEntry(0x02, 0x200, 0x8000_0000_0000_0400n), pspEntry(0x01, 0x80, mapped(0x3_2000))],
    { info: 0x4000_0000 }
  );

  const volume = Test.volume({
    length: 0x1000,
    files: [Test.file({ body: new Uint8Array(0x40).fill(0x5a) })],
  });
  const stream = zlibEncode(volume);
  const header = new Uint8Array(0x100);
  put32(header, 0x14, stream.length);
  bytes.set(header, 0x5_0000);
  bytes.set(stream, 0x5_0100);

  directory(bytes, "$BHD", 0x4_0000, [
    biosEntry(0x60, 0x100, mapped(0x4_1000)),
    biosEntry(0x61, 0, 0n, { destination: 0x9f0_0000n }),
    biosEntry(0x62, volume.length, mapped(0x5_0000), { flags: 0x0b, destination: 0x9a0_0000n }),
    biosEntry(0x70, 0x400, mapped(0x4_2000)),
  ]);
  directory(bytes, "$BL2", 0x4_2000, [biosEntry(0x66, 0x40, mapped(0x4_3000), { flags: 0x10 })]);
  // Written, so none of the blobs is erased space.
  for (const start of [0x1_f000, 0x3_2000, 0x3_3400, 0x4_1000, 0x4_3000]) {
    bytes.fill(0x11, start, start + 0x40);
  }
  return { bytes, stream: stream.length, volume };
}

const read = (bytes: Uint8Array) => readAMDFirmware(new ImageReader(sourceOver(bytes)));
const parse = (bytes: Uint8Array) => parseUefiImage(sourceOver(bytes));

describe("the PSP's map", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDFirmwareTests.swift#AMDFirmwareTests.testTheWalkFollowsTheEFSThroughEveryLevel
  it("follows the EFS through every level", () => {
    const { bytes, stream } = fixture();
    const firmware = read(bytes);
    if (firmware === undefined) throw new Error("no map");

    expect(firmware.efsOffset).toBe(0x2_0000);
    expect(firmware.romSize).toBe(0x80_0000);
    expect(firmware.pointers.map((one) => one.field)).toEqual([0x14, 0x28]);
    expect(firmware.directories.map((one) => one.kind)).toEqual([5, 1, 2, 3, 4]);
    expect(firmware.directories.map((one) => one.offset)).toEqual([
      0x3_0000, 0x3_1000, 0x3_3000, 0x4_0000, 0x4_2000,
    ]);
    expect(firmware.directories.every(directoryChecksumMatches)).toBe(true);
    // The combo entry chose it for that id.
    expect(firmware.directories[1]?.pspID).toBe(0xbc0c_0140);
    expect(directoryAddressMode(firmware.directories[2] as never)).toBe(2);

    const psp = firmware.directories[1]?.entries ?? [];
    // A mapped address.
    expect(psp[0]?.range).toEqual({ start: 0x3_2000, end: 0x3_2100 });
    // A soft fuse is a value.
    expect(psp[1] && entryIsValue(psp[1])).toBe(true);
    expect(psp[1]?.range).toBeUndefined();
    // Relative to the directory; the entry's own mode.
    expect(firmware.directories[2]?.entries[0]?.range).toEqual({ start: 0x3_3400, end: 0x3_3600 });
    expect(firmware.directories[2]?.entries[1]?.range).toEqual({ start: 0x3_2000, end: 0x3_2080 });

    const bios = firmware.directories[3]?.entries ?? [];
    expect(bios.map((one) => amdEntryName({ ...one, flags: 0 }))).toEqual([
      "APCB",
      "APOB",
      "BIOS",
      "BIOS_L2_PTR",
    ]);
    // The APOB has a destination and no blob.
    expect(bios[1]?.range).toBeUndefined();
    expect(bios[1]?.destination).toBe(0x9f0_0000n);
    const image = bios[2];
    expect(image && entryIsCompressed(image) && entryIsReset(image) && entryIsCopy(image)).toBe(
      true
    );
    expect(image?.isStoredCompressed).toBe(true);
    // The header and the stream, not the size it inflates to.
    expect(image?.range).toEqual({ start: 0x5_0000, end: 0x5_0100 + stream });
    const microcode = firmware.directories[4]?.entries[0];
    expect(microcode && entryInstance(microcode)).toBe(1);
    expect(microcode && amdEntryName(microcode)).toBe("MICROCODE_PATCH, instance 1");

    // One blob for the boot loader both levels name, at the smaller size.
    const loaders = amdBlobs(firmware)
      .map((blob) => blob.entry.range)
      .filter((range) => range?.start === 0x3_2000);
    expect(loaders).toEqual([{ start: 0x3_2000, end: 0x3_2080 }]);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDFirmwareTests.swift#AMDFirmwareTests.testAChecksumThatDoesNotMatchIsSaid
  it("says a checksum that does not match", () => {
    const { bytes } = fixture();
    bytes[0x3_1000 + 0x10 + 4] = (bytes[0x3_1000 + 0x10 + 4] ?? 0) ^ 1;
    const firmware = read(bytes);
    expect(firmware && directoryChecksumMatches(firmware.directories[1] as never)).toBe(false);
    expect(firmware && directoryChecksumMatches(firmware.directories[0] as never)).toBe(true);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDFirmwareTests.swift#AMDFirmwareTests.testFletcher32IsThePSPs
  it("has the PSP's Fletcher-32", () => {
    // PSPTool's `fletcher32`, little-endian.
    expect(fletcher32(Uint8Array.of(1, 2, 3, 4))).toBe(0x0805_0604);
    const ramp = Uint8Array.from({ length: 256 }, (_, index) => index);
    const three = Uint8Array.from([...ramp, ...ramp, ...ramp]);
    // Past the fold at 360 words.
    expect(fletcher32(three)).toBe(0x0060_bf40);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDFirmwareTests.swift#AMDFirmwareTests.testNoEFSIsNoMap
  it("is no map without an EFS that leads to a directory", () => {
    expect(read(new Uint8Array(SIZE).fill(0xff))).toBeUndefined();
    // Smaller than any AMD flash.
    expect(read(new Uint8Array(0x10_0000).fill(0xff))).toBeUndefined();
    const orphan = new Uint8Array(SIZE).fill(0xff);
    put32(orphan, 0x2_0000, EFS_SIGNATURE);
    put32(orphan, 0x2_0014, 0x3_0000);
    expect(read(orphan)).toBeUndefined();
    // A dump with bytes appended is still its chip.
    expect(amdRomSize(SIZE + 0x300)).toBe(0x80_0000);
  });
});

describe("the PSP's rows", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDFirmwareTests.swift#AMDFirmwareTests.testEveryStructureIsARowInThePadding
  it("makes every structure a row in the padding", () => {
    const image = parse(fixture().bytes);
    const rows = image.allNodes.filter(
      (node) =>
        node.kind === "amdEFS" || node.kind === "amdDirectory" || node.kind === "amdFirmwareEntry"
    );

    expect(rows.filter((node) => node.kind === "amdDirectory").map((node) => node.name)).toEqual([
      "PSP combo directory 2PSP",
      "PSP directory $PSP",
      "PSP level 2 directory $PL2",
      "BIOS directory $BHD",
      "BIOS level 2 directory $BL2",
    ]);
    const first = rows.find((node) => node.kind === "amdDirectory");
    expect(first && [first.header.start, first.body.end]).toEqual([0x3_0000, 0x3_0030]);
    const names = rows.filter((node) => node.kind === "amdFirmwareEntry").map((node) => node.name);
    expect(new Set(names)).toEqual(
      new Set([
        "PSP_FW_BOOT_LOADER",
        "SEC_GASKET",
        "PSP_FW_TRUSTED_OS",
        "APCB",
        "BIOS",
        "MICROCODE_PATCH, instance 1",
      ])
    );
    // Padding to UEFITool, and the PSP finds them by address.
    expect(rows.every((node) => itemType(node) === ItemType.padding)).toBe(true);
    expect(rows.every((node) => node.isFixed)).toBe(true);

    // A blob around a row already read takes it in.
    const gasket = rows.find((node) => node.name === "SEC_GASKET");
    expect(gasket && [gasket.header.start, gasket.body.end]).toEqual([0x1_f000, 0x2_1000]);
    expect(gasket?.children.map((node) => node.kind)).toEqual(["padding", "amdEFS", "padding"]);
  });
});

describe("the compressed BIOS image", () => {
  /**
   * The BIOS image the PSP inflates opens to what it inflates to, read as a stretch of flash:
   * its volume and the files in it.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDFirmwareTests.swift#AMDFirmwareTests.testTheCompressedBIOSImageOpens
   */
  it("opens to what it inflates to", () => {
    const { bytes, volume } = fixture();
    const image = parse(bytes);
    const bios = image.allNodes.find(
      (node) => node.kind === "amdFirmwareEntry" && node.name === "BIOS"
    );

    expect(bios?.compression).toEqual({ algorithm: "Zlib (AMD)", decodes: true });
    expect(bios?.header).toEqual({ start: 0x5_0000, end: 0x5_0100 });
    const inside = bios?.children[0];
    expect(inside?.kind).toBe("volume");
    expect(inside?.space).toEqual([0x5_0000]);
    expect(inside && [inside.header.start, inside.body.end]).toEqual([0, volume.length]);
    expect(inside?.children.some((node) => node.kind === "file")).toBe(true);

    const reader = new SpaceReaders(new ImageReader(sourceOver(bytes))).readerFor([0x5_0000]);
    expect(Array.from(reader?.bytes(reader.all) ?? [])).toEqual(Array.from(volume));
  });

  /**
   * Nothing compresses it again the way the PSP reads it, so a change inside is refused, by
   * name.
   *
   * @upstream Packages/UEFIImage/Tests/UEFIImageTests/AMDFirmwareTests.swift#AMDFirmwareTests.testAChangeInsideTheInflatedImageIsRefused
   */
  it("refuses a change inside it", () => {
    const { bytes, volume } = fixture();
    const result = planRebuild(volume, { space: [0x5_0000] }, bytes);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.refusal.message).toContain("the PSP inflates");
  });
});
