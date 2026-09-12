import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { BinaryWriter, DRIVER_GUID, microcode, volume } from "@/firmware/testing/testImage";
import * as N from "@/firmware/testing/testNvram";
import { guid } from "@/firmware/uefi/efiGuid";
import type { Limits } from "@/firmware/uefi/parserState";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `NvramParseTests.swift`: reading an NVRAM volume body as a run of
 * stores, starting with the VSS store.
 */

const parse = (bytes: Uint8Array, limits?: Limits) =>
  parseUefiImage(sourceOver(bytes), limits === undefined ? {} : { limits });
const kinds = (nodes: readonly UEFINode[]) => nodes.map((node) => node.kind);
const range = (node: UEFINode | undefined) => (node === undefined ? undefined : nodeRange(node));
const root = (bytes: Uint8Array, limits?: Limits) => parse(bytes, limits).roots[0] as UEFINode;

describe("a VSS store", () => {
  const oneVariable = () =>
    N.nvramVolume({ stores: [N.vssStore({ variables: [N.vssVariable({ name: "BootOrder" })] })] });

  it("is what an NVRAM volume expands to", () => {
    const parsed = root(oneVariable());

    expect(parsed.kind).toBe("volume");
    expect(kinds(parsed.children)).toEqual(["vssStore"]);
    const vss = parsed.children[0] as UEFINode;
    expect(vss.name).toBe("VSS store");
    expect(vss.header).toEqual({ start: 0x48, end: 0x58 });
    expect(vss.body).toEqual({ start: 0x58, end: 0x9e });
    expect(range(vss)).toEqual({ start: 0x48, end: 0x9e });
  });

  it("names a variable by its decoded name", () => {
    const entry = root(oneVariable()).children[0]?.children[0] as UEFINode;

    expect(entry.kind).toBe("vssEntry");
    expect(entry.subtype).toBe(Sub.standardVssEntry);
    expect(entry.name).toBe("BootOrder");
    expect(entry.header).toEqual({ start: 0x58, end: 0x78 });
    expect(entry.body).toEqual({ start: 0x78, end: 0x8e });
    // The variable's vendor GUID is on the node — the details panel shows it
    // without reading the bytes back, whatever form the variable is.
    expect(entry.guid).toEqual(DRIVER_GUID);
  });

  /**
   * An authenticated variable — the shape a secure variable like PK is — keeps
   * its vendor GUID in the header's last sixteen bytes (offset 44 of its
   * 60-byte header), not at the 16 a standard 32-byte header does. The
   * monotonic counter, timestamp and key index in between are zeros or noise;
   * reading them as a GUID would show a null or a wrong owner.
   */
  it("keeps an authenticated variable's vendor GUID", () => {
    const efiGlobalVariable = guid("8BE4DF61-93CA-11D2-AA0D-00E098032B8C");
    const pk = N.authVssVariable({
      name: "PK",
      data: new Uint8Array(0x3bb).fill(0xab),
      vendorGuid: efiGlobalVariable,
    });
    const entry = root(N.nvramVolume({ stores: [N.vssStore({ variables: [pk] })] })).children[0]
      ?.children[0] as UEFINode;

    expect(entry.kind).toBe("vssEntry");
    expect(entry.subtype).toBe(Sub.authVssEntry);
    expect(entry.name).toBe("PK");
    expect(entry.header).toEqual({ start: 0x58, end: 0x94 });
    expect(entry.body).toEqual({ start: 0x94, end: 0x455 });
    expect(entry.guid).toEqual(efiGlobalVariable);
  });

  it("finds the free space after the variables", () => {
    const children = root(oneVariable()).children[0]?.children ?? [];

    expect(kinds(children)).toEqual(["vssEntry", "freeSpace"]);
    expect(range(children[1])).toEqual({ start: 0x8e, end: 0x9e });
    expect(children[1]?.isErased).toBe(true);
  });

  it("calls a deleted variable invalid", () => {
    const deleted = N.vssVariable({ name: "BootOrder", state: 0xfd });
    const entry = root(N.nvramVolume({ stores: [N.vssStore({ variables: [deleted] })] }))
      .children[0]?.children[0] as UEFINode;

    expect(entry.subtype).toBe(Sub.invalidVssEntry);
    expect(entry.name).toBe("Invalid");
  });

  it("finds both of two variables", () => {
    const store = N.vssStore({
      variables: [N.vssVariable({ name: "BootOrder" }), N.vssVariable({ name: "SetupMode" })],
    });
    const entries = root(N.nvramVolume({ stores: [store] })).children[0]?.children ?? [];

    expect(kinds(entries)).toEqual(["vssEntry", "vssEntry", "freeSpace"]);
    expect(entries[0]?.name).toBe("BootOrder");
    expect(entries[1]?.name).toBe("SetupMode");
  });

  // A store whose size field is the "no size" marker is not a store at all: the
  // reference parser refuses it, so the body is padding.
  it("is not made out of a no-size marker", () => {
    const store = N.vssStore({
      variables: [N.vssVariable({ name: "BootOrder" })],
      size: 0xffff_ffff,
    });
    expect(kinds(root(N.nvramVolume({ stores: [store] })).children)).toEqual(["padding"]);
  });

  // A store whose size field overruns the body is cut at the body's end, not
  // believed past it.
  it("is cut when its size overruns the body", () => {
    const store = N.vssStore({ variables: [N.vssVariable({ name: "BootOrder" })], size: 0x100 });
    const vss = root(N.nvramVolume({ stores: [store] })).children[0] as UEFINode;

    expect(vss.kind).toBe("vssStore");
    expect(range(vss)).toEqual({ start: 0x48, end: 0x9e });
  });
});

describe("the walk over an NVRAM body", () => {
  // An all-erased NVRAM volume has no stores: its body is one run of free
  // space, and it is not an unknown file system.
  it("reads an erased volume as free space", () => {
    const parsed = parse(N.nvramVolume({ stores: [], length: 0x400 }));

    expect(kinds(parsed.roots[0]?.children ?? [])).toEqual(["freeSpace"]);
    expect(range(parsed.roots[0]?.children[0])).toEqual({ start: 0x48, end: 0x400 });
    expect(parsed.diagnostics).toEqual([]);
  });

  /**
   * A store that sits after a long erased run is still found: the walk jumps
   * the free space whole (a run of the erase byte cannot start a store) instead
   * of probing its recognisers byte by byte, and lands on the store.
   */
  it("finds a store after a long run of free space", () => {
    const vss = N.vssStore({ variables: [N.vssVariable({ name: "First" })] });
    const vss2 = N.vss2Store({ variables: [N.vss2Variable({ name: "Second" })] });
    const gap = 0x2000;
    const body = new BinaryWriter().raw(vss).fill(gap, 0xff).raw(vss2);
    const vssEnd = 0x48 + vss.length;
    const bytes = volume({
      fileSystem: N.NVRAM_VOLUME_GUID,
      length: 0x48 + body.count,
      files: [],
      trailing: body.bytes,
    });

    const parsed = parse(bytes);
    const children = parsed.roots[0]?.children ?? [];
    expect(kinds(children)).toEqual(["vssStore", "freeSpace", "vss2Store"]);
    expect(range(children[1])).toEqual({ start: vssEnd, end: vssEnd + gap });
    expect(children[1]?.isErased).toBe(true);
    expect(range(children[2])?.start).toBe(vssEnd + gap);
    expect(parsed.diagnostics).toEqual([]);
  });
});

describe("a VSS2 store", () => {
  const oneVariable = () =>
    N.nvramVolume({
      stores: [N.vss2Store({ variables: [N.vss2Variable({ name: "BootOrder" })] })],
    });

  // A VSS2 store is led by a 16-byte store GUID and is 28 bytes of header.
  it("expands to its variables", () => {
    const children = root(oneVariable()).children;

    expect(kinds(children)).toEqual(["vss2Store"]);
    const vss2 = children[0] as UEFINode;
    expect(vss2.name).toBe("VSS2 store");
    expect(vss2.header).toEqual({ start: 0x48, end: 0x64 });
    expect(vss2.body).toEqual({ start: 0x64, end: 0xac });
    expect(range(vss2)).toEqual({ start: 0x48, end: 0xac });
  });

  // A VSS2 variable's header includes its name; the data is the body.
  it("names a variable by its decoded name", () => {
    const entry = root(oneVariable()).children[0]?.children[0] as UEFINode;

    expect(entry.kind).toBe("vssEntry");
    expect(entry.subtype).toBe(Sub.standardVssEntry);
    expect(entry.name).toBe("BootOrder");
    expect(entry.header).toEqual({ start: 0x64, end: 0x98 });
    expect(entry.body).toEqual({ start: 0x98, end: 0x9a });
    expect(entry.guid).toEqual(DRIVER_GUID);
  });

  // The 4-byte alignment padding after a variable is a node of its own.
  it("keeps the alignment padding and the free space", () => {
    const children = root(oneVariable()).children[0]?.children ?? [];

    expect(kinds(children)).toEqual(["vssEntry", "padding", "freeSpace"]);
    expect(range(children[1])).toEqual({ start: 0x9a, end: 0x9c });
    expect(range(children[2])).toEqual({ start: 0x9c, end: 0xac });
    expect(children[2]?.isErased).toBe(true);
  });

  it("calls a deleted variable invalid", () => {
    const deleted = N.vss2Variable({ name: "BootOrder", state: 0xfd });
    const entry = root(N.nvramVolume({ stores: [N.vss2Store({ variables: [deleted] })] }))
      .children[0]?.children[0] as UEFINode;

    expect(entry.subtype).toBe(Sub.invalidVssEntry);
    expect(entry.name).toBe("Invalid");
  });
});

describe("an FTW working block", () => {
  it("is found when its header CRC matches", () => {
    const store = N.ftwStore({ writeQueue: Uint8Array.of(0x01, 0x02, 0x03, 0x04) });
    const parsed = parse(N.nvramVolume({ stores: [store] }));
    const ftw = parsed.roots[0]?.children[0] as UEFINode;

    expect(ftw.kind).toBe("ftwStore");
    expect(ftw.name).toBe("FTW store");
    expect(parsed.diagnostics).toEqual([]);
  });

  it("is reported when its header CRC no longer matches", () => {
    const store = N.ftwStore({
      writeQueue: Uint8Array.of(0x01, 0x02, 0x03, 0x04),
      crc: 0xdead_beef,
    });
    const parsed = parse(N.nvramVolume({ stores: [store] }));

    expect(kinds(parsed.roots[0]?.children ?? [])).toEqual(["ftwStore"]);
    const detail = parsed.diagnostics[0]?.detail;
    expect(detail).toMatchObject({
      kind: "checksumMismatch",
      structure: "nvramStore",
      stored: 0xdead_beef,
    });
  });
});

describe("the stores that nest", () => {
  /**
   * An Insyde FDC store wraps an NVRAM body of its own, and a `$VSS` store
   * inside it that says "no size" means the whole FDC body — so the store is
   * cut at the FDC's end, not refused.
   */
  it("recurses into an FDC body with the size override", () => {
    const inner = N.vssStore({
      variables: [N.vssVariable({ name: "BootOrder" })],
      size: 0xffff_ffff,
    });
    const parsed = root(N.nvramVolume({ stores: [N.fdcStore({ stores: [inner] })] }));

    expect(kinds(parsed.children)).toEqual(["fdcStore"]);
    const fdc = parsed.children[0] as UEFINode;
    expect(fdc.name).toBe("Insyde FDC store");
    expect(fdc.header).toEqual({ start: 0x48, end: 0x98 });
    expect(fdc.body).toEqual({ start: 0x98, end: parsed.body.end });

    expect(kinds(fdc.children)).toEqual(["vssStore"]);
    const vss = fdc.children[0] as UEFINode;
    expect(vss.name).toBe("VSS store");
    // The size marker resolved to the FDC body's length: the store spans it.
    expect(range(vss)).toEqual(fdc.body);
    expect(kinds(vss.children)).toEqual(["vssEntry", "freeSpace"]);
    expect(vss.children[0]?.name).toBe("BootOrder");
  });

  // A firmware volume nested whole inside an NVRAM body is handed to the volume
  // parser, which reads it as the volume it is — not as padding.
  it("hands a nested firmware volume to the volume parser", () => {
    const parsed = parse(N.nvramVolume({ stores: [volume({ length: 0x200 })] }));
    const outer = parsed.roots[0] as UEFINode;

    expect(kinds(outer.children)).toEqual(["volume"]);
    const nested = outer.children[0] as UEFINode;
    expect(nested.name).toBe("FFSv2");
    expect(range(nested)).toEqual(outer.body);
    expect(kinds(nested.children)).toEqual(["freeSpace"]);
    expect(parsed.diagnostics).toEqual([]);
  });

  // An Intel microcode image sitting in an NVRAM body is handed to the
  // microcode parser, which names it and keeps its whole image whole.
  it("hands microcode to the microcode parser", () => {
    const parsed = parse(N.nvramVolume({ stores: [microcode()] }));
    const outer = parsed.roots[0] as UEFINode;

    expect(kinds(outer.children)).toEqual(["microcode"]);
    expect(range(outer.children[0])).toEqual(outer.body);
    expect(outer.children[0]?.name.startsWith("Microcode ")).toBe(true);
    expect(parsed.diagnostics).toEqual([]);
  });
});

/**
 * An FDC store nests another NVRAM body, which can hold another FDC store, so
 * the walk refuses to descend past its depth budget. One level below the volume
 * is spent by the volume's own body; a second FDC nest is refused.
 */
describe("the depth budget over nested stores", () => {
  const nested = () => {
    const middle = N.fdcStore({
      stores: [N.vssStore({ variables: [N.vssVariable({ name: "BootOrder" })] })],
    });
    return N.nvramVolume({ stores: [N.fdcStore({ stores: [middle], freeSpace: 0 })] });
  };

  it("stops the nesting past the limit", () => {
    const parsed = parse(nested(), { maxDepth: 2 });
    const outer = parsed.roots[0] as UEFINode;

    expect(kinds(outer.children)).toEqual(["fdcStore"]);
    expect(kinds(outer.children[0]?.children ?? [])).toEqual(["fdcStore"]);
    expect(outer.children[0]?.children[0]?.children).toEqual([]);
    expect(parsed.diagnostics.some((one) => one.detail.kind === "recursionLimit")).toBe(true);
  });

  // The boundary is inclusive, not a refusal of the deepest allowed level.
  it("reads the same nesting one level shallower", () => {
    const parsed = parse(nested(), { maxDepth: 3 });
    const outer = parsed.roots[0] as UEFINode;

    expect(kinds(outer.children)).toEqual(["fdcStore"]);
    expect(kinds(outer.children[0]?.children ?? [])).toEqual(["fdcStore"]);
    expect(kinds(outer.children[0]?.children[0]?.children ?? [])).toEqual([
      "vssStore",
      "freeSpace",
    ]);
    expect(kinds(outer.children[0]?.children[0]?.children[0]?.children ?? [])).toEqual([
      "vssEntry",
      "freeSpace",
    ]);
    expect(parsed.diagnostics).toEqual([]);
  });
});
