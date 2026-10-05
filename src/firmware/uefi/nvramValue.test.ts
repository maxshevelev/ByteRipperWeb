import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { DRIVER_GUID } from "@/firmware/testing/testImage";
import { authVssVariable, nvramVolume, ucs2, vssStore } from "@/firmware/testing/testNvram";
import { devicePathText } from "@/firmware/uefi/devicePath";
import { type EFIGUID, guid, guidBytes } from "@/firmware/uefi/efiGuid";
import {
  GLOBAL_VARIABLE,
  IMAGE_SECURITY_DATABASE,
  isActiveLoadOption,
  isLoadOptionName,
  type NvramContent,
  readNvramValue,
} from "@/firmware/uefi/nvramValue";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import {
  decodedVssName,
  readVssEntryIn,
  readVssVariable,
  timeText,
} from "@/firmware/uefi/vssVariable";

/**
 * Ported from `NvramValueTests.swift`: a variable's value read as its type — by the
 * spec where it defines the variable, by the attributes, by the bytes otherwise
 * (`UEFI_IMAGE_FORMAT.md` §9) — the device paths it is told by, and a VSS variable's
 * header taken apart by its form.
 */

const vendor: EFIGUID = { a: 0x1111_1111, b: 0x2222_2222, c: 0, d: 0 };
const text = (value: string) => Uint8Array.from([...value].map((one) => one.charCodeAt(0)));

function read(name: string, value: readonly number[], guid?: EFIGUID, attributes = 7) {
  return readNvramValue(name, guid ?? vendor, attributes, Uint8Array.from(value));
}

/** Device path nodes and signature lists, byte for byte. */
const PCI_ROOT = [2, 1, 12, 0, 0xd0, 0x41, 0x03, 0x0a, 0, 0, 0, 0];
const END = [0x7f, 0xff, 4, 0];
const pci = (device: number, fn: number) => [1, 1, 6, 0, fn, device];
const file = (path: string) => {
  const name = [...ucs2(path)];
  return [4, 4, 4 + name.length, 0, ...name];
};

function signatureList(type: string, entries: readonly (readonly number[])[]): number[] {
  const first = entries[0] ?? [];
  const signatureSize = 16 + first.length;
  const listSize = 28 + signatureSize * entries.length;
  const u32 = (value: number) => [0, 8, 16, 24].map((shift) => (value >>> shift) & 0xff);
  const owner = [...guidBytes({ a: 7, b: 0, c: 7, d: 0 })];
  return [
    ...guidBytes(guid(type)),
    ...u32(listSize),
    ...u32(0),
    ...u32(signatureSize),
    ...entries.flatMap((entry) => [...owner, ...entry]),
  ];
}

/**
 * A certificate as far as its subject: a TBSCertificate with a version, a serial,
 * empty algorithm, issuer and validity, and a subject whose one attribute is the
 * common name.
 */
function certificate(commonName: string): number[] {
  const der = (tag: number, content: readonly number[]): number[] =>
    content.length < 0x80
      ? [tag, content.length, ...content]
      : [tag, 0x82, content.length >> 8, content.length & 0xff, ...content];
  const name = der(0x0c, [...text(commonName)]);
  const subject = der(0x30, der(0x31, der(0x30, [...der(0x06, [0x55, 0x04, 0x03]), ...name])));
  const tbs = der(0x30, [
    ...der(0xa0, der(0x02, [2])),
    ...der(0x02, [1]),
    ...der(0x30, []),
    ...der(0x30, []),
    ...der(0x30, []),
    ...subject,
  ]);
  return der(0x30, [...tbs, ...der(0x30, []), ...der(0x03, [0])]);
}

const kind = (content: NvramContent) => content.kind;

describe("a variable's value, by the specification", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testTheSpecsVariablesAreReadAsItDefinesThem
  it("reads the spec's variables as it defines them", () => {
    expect(read("BootOrder", [0x03, 0x00, 0x01, 0x20], GLOBAL_VARIABLE)).toEqual({
      content: { kind: "optionList", numbers: [0x0003, 0x2001] },
      basis: "specification",
    });
    expect(read("BootNext", [0x01, 0x00], GLOBAL_VARIABLE).content).toEqual({
      kind: "optionNumber",
      number: 1,
    });
    expect(read("Timeout", [0x05, 0x00], GLOBAL_VARIABLE).content).toEqual({
      kind: "number",
      value: 5n,
      size: 2,
    });
    expect(read("SecureBoot", [0x01], GLOBAL_VARIABLE).content).toEqual({
      kind: "number",
      value: 1n,
      size: 1,
    });
    // The spec's text needs no terminator.
    expect(read("Lang", [...text("eng")], GLOBAL_VARIABLE).content).toEqual({
      kind: "text",
      text: "eng",
      encoding: "ascii",
    });
  });

  // The spec's name under a vendor's GUID reads the same, and says so.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testASpecNameUnderAVendorGuidIsReadByTheName
  it("reads a spec name under a vendor GUID by the name", () => {
    expect(read("BootOrder", [0x80, 0x00])).toEqual({
      content: { kind: "optionList", numbers: [0x80] },
      basis: "name",
    });
  });

  // A value of another shape than the spec's is read from its bytes.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testASpecNameWithTheWrongShapeIsReadFromItsBytes
  it("reads a spec name with the wrong shape from its bytes", () => {
    expect(read("Timeout", [0x05, 0x00, 0x00, 0x00], GLOBAL_VARIABLE)).toEqual({
      content: { kind: "number", value: 5n, size: 4 },
      basis: "content",
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testALoadOptionReadsItsDescriptionAndPath
  it("reads a load option's description and path", () => {
    const path = [...PCI_ROOT, ...pci(0x1f, 2), ...file("\\EFI\\BOOT\\BOOTX64.EFI"), ...END];
    const value = [
      0x01,
      0x00,
      0x00,
      0x00,
      path.length & 0xff,
      path.length >> 8,
      ...ucs2("Windows Boot Manager"),
      ...path,
      0xaa,
      0xbb,
    ];
    const found = read("Boot0003", value, GLOBAL_VARIABLE);
    expect(found.basis).toBe("specification");
    if (found.content.kind !== "loadOption") throw new Error(JSON.stringify(found));
    const option = found.content.option;
    expect(option.description).toBe("Windows Boot Manager");
    expect(option.devicePath).toBe("PciRoot(0x0)/Pci(0x1F,0x2)/\\EFI\\BOOT\\BOOTX64.EFI");
    expect(option.optionalDataSize).toBe(2);
    expect(isActiveLoadOption(option)).toBe(true);
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testOnlyFourUpperCaseHexDigitsMakeALoadOptionName
  it("takes only four upper-case hex digits for a load option name", () => {
    expect(isLoadOptionName("Boot00A1")).toBe(true);
    expect(isLoadOptionName("PlatformRecovery0000")).toBe(true);
    expect(isLoadOptionName("Boot00a1")).toBe(false);
    expect(isLoadOptionName("BootOrder")).toBe(false);
    expect(isLoadOptionName("Boot0001x")).toBe(false);
  });

  // A certificate is named by its subject; hashes are only counted.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testASignatureDatabaseNamesItsCertificates
  it("names the certificates of a signature database", () => {
    const lists = [
      ...signatureList("A5C059A1-94E4-4AA7-87B5-AB155C2BF072", [certificate("Test Platform Key")]),
      ...signatureList("C1C41626-504C-4092-ACA9-41F936934328", [
        new Array(32).fill(1),
        new Array(32).fill(2),
      ]),
    ];
    const found = read("db", lists, IMAGE_SECURITY_DATABASE);
    expect(found.basis).toBe("specification");
    if (found.content.kind !== "signatures") throw new Error(JSON.stringify(found));
    expect(found.content.lists.map((one) => one.typeName)).toEqual(["X.509", "SHA-256"]);
    expect(found.content.lists[0]?.signatures.map((one) => one.subject)).toEqual([
      "Test Platform Key",
    ]);
    expect(found.content.lists[1]?.signatures).toHaveLength(2);
  });
});

describe("a variable's value, by the attributes and the bytes", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testAHardwareErrorRecordIsToldByItsAttribute
  it("tells a hardware error record by its attribute", () => {
    expect(read("HwErrRec0001", [0x43, 0x50, 0x45, 0x52], undefined, 0x0f)).toEqual({
      content: { kind: "hardwareErrorRecord" },
      basis: "attributes",
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testTextIsToldByItsBytes
  it("tells text by its bytes", () => {
    expect(read("x", [...ucs2("shutdown")]).content).toEqual({
      kind: "text",
      text: "shutdown",
      encoding: "ucs2",
    });
    // UCS-2 without a terminator.
    expect(
      read(
        "x",
        [..."Capsule0000"].flatMap((one) => [one.charCodeAt(0), 0])
      ).content
    ).toEqual({ kind: "text", text: "Capsule0000", encoding: "ucs2" });
    expect(read("x", [...text("en-US"), 0]).content).toEqual({
      kind: "text",
      text: "en-US",
      encoding: "ascii",
    });
    expect(read("x", [...text("[FUB]\r\nFUB=CBW28\r\n")]).content).toEqual({
      kind: "text",
      text: "[FUB]\r\nFUB=CBW28\r\n",
      encoding: "ascii",
    });
    expect(read("x", [0x63, 0, 0x70, 0, 0, 0]).content).toEqual({
      kind: "text",
      text: "cp",
      encoding: "ucs2",
    });
  });

  // A counter whose bytes happen to be printable stays a number: as wide as a
  // register, a value is text only with a terminator after three characters.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testARegisterWideValueIsANumberBeforeItIsText
  it("reads a register-wide value as a number before it is text", () => {
    expect(read("MTC", [0x39, 0x20, 0x00, 0x00]).content).toEqual({
      kind: "number",
      value: 0x2039n,
      size: 4,
    });
    expect(read("x", [...text("e@7`")]).content).toEqual({
      kind: "number",
      value: 0x6037_4065n,
      size: 4,
    });
    expect(read("x", [...text("eng"), 0]).content).toEqual({
      kind: "text",
      text: "eng",
      encoding: "ascii",
    });
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testOtherValuesAreNumbersBySizeOrBytes
  it("reads other values as numbers by size, or as bytes", () => {
    expect(read("x", [0x2c, 0x01]).content).toEqual({ kind: "number", value: 300n, size: 2 });
    expect(read("x", [0, 0, 0, 0, 1, 0, 0, 0]).content).toEqual({
      kind: "number",
      value: 1n << 32n,
      size: 8,
    });
    expect(kind(read("x", [0x00, 0x50, 0x41]).content)).toBe("bytes");
    expect(kind(read("x", []).content)).toBe("empty");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#NvramValueTests.testADevicePathIsToldByItsBytes
  it("tells a device path by its bytes", () => {
    const path = [...PCI_ROOT, ...pci(2, 0), ...END];
    expect(read("ConOutDev", path, GLOBAL_VARIABLE)).toEqual({
      content: { kind: "devicePath", path: "PciRoot(0x0)/Pci(0x2,0x0)" },
      basis: "specification",
    });
    expect(read("efi-boot-device-data", path).content).toEqual({
      kind: "devicePath",
      path: "PciRoot(0x0)/Pci(0x2,0x0)",
    });
  });
});

describe("a device path in the spec's text form", () => {
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#DevicePathTests.testNodesReadInTheSpecsTextForm
  it("reads nodes in the spec's text form", () => {
    const sata = [3, 18, 10, 0, 0, 0, 0xff, 0xff, 0, 0];
    const partition = guid("3A5C66AD-43A7-491F-94C5-2A9428EEA3A9");
    const hd = [
      4,
      1,
      42,
      0,
      1,
      0,
      0,
      0,
      0x00,
      0x08,
      0,
      0,
      0,
      0,
      0,
      0,
      0x00,
      0x20,
      0x08,
      0,
      0,
      0,
      0,
      0,
      ...guidBytes(partition),
      2,
      2,
    ];
    const path = Uint8Array.from([...PCI_ROOT, ...pci(0x1f, 2), ...sata, ...hd, ...END]);
    expect(devicePathText(path)).toBe(
      "PciRoot(0x0)/Pci(0x1F,0x2)/Sata(0x0,0xFFFF,0x0)/HD(1,GPT,3A5C66AD-43A7-491F-94C5-2A9428EEA3A9,0x800,0x82000)"
    );
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#DevicePathTests.testInstancesAreSeparatedByCommas
  it("separates instances by commas", () => {
    const instanceEnd = [0x7f, 0x01, 4, 0];
    const path = Uint8Array.from([...PCI_ROOT, ...instanceEnd, ...PCI_ROOT, ...END]);
    expect(devicePathText(path)).toBe("PciRoot(0x0),PciRoot(0x0)");
  });

  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#DevicePathTests.testAnUnknownNodeIsNamedByItsTypes
  it("names an unknown node by its types", () => {
    expect(devicePathText(Uint8Array.from([3, 99, 6, 0, 1, 2, ...END]))).toBe("Path(3,99)");
  });

  // Anything that is not exactly a path is not one.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#DevicePathTests.testBytesThatAreNotExactlyAPathAreNot
  it("takes bytes that are not exactly a path for none", () => {
    const of = (...parts: number[][]) => devicePathText(Uint8Array.from(parts.flat()));
    expect(of(END)).toBeUndefined();
    expect(of(PCI_ROOT)).toBeUndefined();
    expect(of(PCI_ROOT, END, [0])).toBeUndefined();
    expect(of([9, 1, 4, 0], END)).toBeUndefined();
    expect(of([1, 1, 2, 0], END)).toBeUndefined();
  });
});

describe("a VSS variable's header", () => {
  // Intel's legacy form states only a total size: the name runs to its terminator,
  // however long, and the value is what follows.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#VSSVariableTests.testAnIntelLegacyVariablesNameRunsToItsTerminator
  it("runs an Intel legacy variable's name to its terminator", () => {
    const name = [...ucs2("Setup")];
    const data = [0x01, 0x02, 0x03];
    const variable = (state: number) => {
      const total = 28 + name.length + data.length;
      return Uint8Array.from([
        0xaa,
        0x55,
        state,
        0x00,
        0x07,
        0,
        0,
        0,
        total,
        0,
        0,
        0,
        ...guidBytes(DRIVER_GUID),
        ...name,
        ...data,
      ]);
    };
    const bytes = nvramVolume({
      stores: [vssStore({ variables: [variable(0xfc), variable(0xf8)] })],
    });
    const image = parseUefiImage(sourceOver(bytes));
    const store = (image.roots[0] as UEFINode).children[0] as UEFINode;
    const entries = store.children.filter((node) => node.kind === "vssEntry");
    expect(entries.map((node) => node.name)).toEqual(["Setup", "Invalid"]);
    // 0xF8 is Intel's invalid state.
    expect(entries.map((node) => node.subtype)).toEqual([Sub.intelVssEntry, Sub.invalidVssEntry]);

    const reader = new ImageReader(sourceOver(bytes));
    const parsed = readVssEntryIn(entries[0] as UEFINode, image, reader);
    expect(parsed?.form).toBe("intelLegacy");
    expect(reader.bytes(parsed?.data ?? { start: 0, end: 0 })).toEqual(Uint8Array.from(data));
    expect(parsed?.totalSize).toBe(28 + name.length + data.length);
    expect(parsed?.nameSize).toBeUndefined();
  });

  // The authenticated form's count, time stamp and key index, and the sizes after
  // them.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/NvramValueTests.swift#VSSVariableTests.testAnAuthenticatedVariablesHeaderIsReadWhole
  it("reads an authenticated variable's header whole", () => {
    const bytes = authVssVariable({ name: "db", data: Uint8Array.of(1, 2, 3) });
    bytes.set([5, 0, 0, 0, 0, 0, 0, 0], 8);
    bytes.set([0xe7, 0x07, 5, 1, 12, 34, 56], 16);
    bytes.set([9, 0, 0, 0], 32);
    const reader = new ImageReader(sourceOver(bytes));
    const parsed = readVssVariable(0, bytes.length, false, reader);
    expect(parsed?.form).toBe("authenticated");
    expect(parsed?.monotonicCount).toBe(5n);
    expect(parsed?.timestamp === undefined ? undefined : timeText(parsed.timestamp)).toBe(
      "2023-05-01 12:34:56"
    );
    expect(parsed?.publicKeyIndex).toBe(9);
    expect(parsed?.nameSize).toBe(6);
    expect(parsed?.dataSize).toBe(3);
    expect(parsed === undefined ? undefined : decodedVssName(parsed, reader)).toBe("db");
    expect(parsed?.data).toEqual({ start: 66, end: 69 });
  });
});
