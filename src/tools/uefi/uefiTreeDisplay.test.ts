import { describe, expect, it } from "vitest";
import { type EFIGUID, guid, guidKey, guidText } from "@/firmware/uefi/efiGuid";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { FFS_V2, VOLUME_TOP_FILE } from "@/firmware/uefi/knownGuids";
import { makeNode, makeSpan, type UEFINode } from "@/firmware/uefi/uefiNode";
import { Sub } from "@/firmware/uefi/uefiTypes";
import {
  imageType,
  nodeName,
  present,
  subtypeText,
  summary,
  typeText,
} from "@/tools/uefi/uefiTreeDisplay";

/** Ported from upstream's `UEFITreeDisplayTests.swift`. */

const r = (start: number, end: number) => ({ start, end });
const APTIO_SIGNED = guid("4A3CA68B-7723-48FB-803D-578CC1FEC44D");

const volume = (children: UEFINode[] = []) =>
  makeNode({
    kind: "volume",
    subtype: 2,
    name: "FFSv2",
    guid: FFS_V2,
    header: r(0, 0x38),
    body: r(0x38, 0x1000),
    children,
  });
const file = (type = 0x07) =>
  makeNode({
    kind: "file",
    subtype: type,
    name: "Volume Top File",
    guid: VOLUME_TOP_FILE,
    header: r(0, 0x18),
    body: r(0x18, 0x100),
  });
const section = (type = 0x19) =>
  makeNode({ kind: "section", subtype: type, name: "Raw", header: r(0, 4), body: r(4, 0x40) });
const microcode = () =>
  makeNode({ kind: "microcode", name: "Microcode", header: r(0, 0x30), body: r(0x30, 0x100) });
const intelImage = () =>
  makeNode({
    kind: "intelImage",
    subtype: Sub.intelImage,
    name: "Intel image",
    header: r(0, 0),
    body: r(0, 0x1000),
  });
const wrapper = (children: UEFINode[]) =>
  makeNode({
    kind: "uefiImage",
    subtype: Sub.uefiImage,
    name: "UEFI image",
    header: r(0, 0),
    body: r(0, 0x1000),
    isFixed: true,
    children,
  });
const capsule = () =>
  makeNode({ kind: "capsule", name: "", guid: APTIO_SIGNED, header: r(0, 0), body: r(0, 0x100) });

const catalogue = (entries: readonly (readonly [EFIGUID, string])[]) =>
  new GuidsCatalogue(new Map(entries.map(([key, name]) => [guidKey(key), name])));

/** A node as the tree reads it: its column texts worked out, as the worker does. */
interface Shown {
  readonly kind: string;
  readonly name: string;
  readonly typeText: string;
  readonly subtypeText: string;
  readonly children: readonly Shown[];
}
const shown = (node: UEFINode): Shown => ({
  kind: node.kind,
  name: node.name,
  typeText: typeText(node),
  subtypeText: subtypeText(node),
  children: node.children.map(shown),
});

describe("the Type column", () => {
  it("reads the node in UEFITool's words", () => {
    expect(typeText(volume())).toBe("Volume");
    expect(typeText(file())).toBe("File");
    expect(typeText(section())).toBe("Section");
    expect(typeText(microcode())).toBe("Intel microcode");
    expect(typeText(intelImage())).toBe("Image");
    expect(typeText(makeSpan({ kind: "padding", name: "", range: r(0, 0x100) }))).toBe("Padding");
  });
});

describe("the Subtype column", () => {
  it("names a file and a section from the parser's own tables", () => {
    expect(subtypeText(file(0x07))).toBe("Driver");
    expect(subtypeText(file(0x7f))).toBe("File type 0x7F");
    expect(subtypeText(section(0x19))).toBe("Raw");
  });

  it("reads every other type from the generated tables", () => {
    expect(subtypeText(volume())).toBe("FFSv2");
    expect(subtypeText(intelImage())).toBe("Intel");
    expect(subtypeText(capsule())).toBe("Aptio signed");
    const region = makeNode({
      kind: "region",
      subtype: 7,
      name: "",
      header: r(0, 0),
      body: r(0, 0x100),
    });
    expect(subtypeText(region)).toBe("Microcode");
    const padding = makeSpan({ kind: "padding", name: "", range: r(0, 0x100), isErased: true });
    expect(subtypeText(padding)).toBe("Empty (FFh)");
  });

  it("says nothing for a node with no subtype", () => {
    expect(subtypeText(microcode())).toBe("");
    expect(subtypeText(makeSpan({ kind: "freeSpace", name: "", range: r(0, 0x100) }))).toBe("");
  });
});

describe("the title", () => {
  it("leads with the type of the top of the tree", () => {
    expect(imageType([shown(volume())])).toBe("Volume · FFSv2");
    expect(imageType([shown(intelImage())])).toBe("Image · Intel");
    expect(imageType([shown(capsule())])).toBe("Capsule · Aptio signed");
  });

  it("is just the type when the top has no subtype", () => {
    expect(imageType([shown(microcode())])).toBe("Intel microcode");
  });

  it("has nothing to lead with for an empty image", () => {
    expect(imageType([])).toBe("");
  });
});

describe("the name", () => {
  it("is the catalogue's for a GUID node, and the GUID until the catalogue has one", () => {
    const node = volume();
    expect(nodeName(node, GuidsCatalogue.empty)).toBe(guidText(FFS_V2));
    expect(nodeName(node, catalogue([[FFS_V2, "Firmware File System 2"]]))).toBe(
      "Firmware File System 2"
    );
  });

  it("shows a file's GUID until the catalogue names it", () => {
    expect(nodeName(file(), GuidsCatalogue.empty)).toBe(guidText(VOLUME_TOP_FILE));
    expect(nodeName(file(), catalogue([[VOLUME_TOP_FILE, "Volume Top File"]]))).toBe(
      "Volume Top File"
    );
  });

  // Many variables share the one vendor GUID that owns them; the decoded name
  // is the variable's identity.
  it("keeps a VSS variable's decoded name over its vendor GUID", () => {
    const vendor = guid("8BE4DF61-93CA-11D2-AA0D-00E098032B8C");
    const variable = makeNode({
      kind: "vssEntry",
      subtype: 0x8f,
      name: "BootOrder",
      guid: vendor,
      header: r(0, 0x20),
      body: r(0x20, 0x30),
    });
    expect(nodeName(variable, catalogue([[vendor, "Something else"]]))).toBe("BootOrder");
  });

  it("keeps the parser's name for a node without a GUID", () => {
    expect(
      nodeName(
        makeSpan({ kind: "freeSpace", name: "Tail", range: r(0, 0x100) }),
        GuidsCatalogue.empty
      )
    ).toBe("Tail");
  });

  it("falls back to the kind for a node with neither", () => {
    expect(
      nodeName(makeSpan({ kind: "padding", name: "", range: r(0, 0x100) }), GuidsCatalogue.empty)
    ).toBe("Padding");
  });

  it("reads the UEFI image root in the image and UEFI words", () => {
    const root = makeNode({
      kind: "uefiImage",
      subtype: Sub.uefiImage,
      name: "",
      header: r(0, 0),
      body: r(0, 0x100),
    });
    expect(typeText(root)).toBe("Image");
    expect(subtypeText(root)).toBe("UEFI");
    expect(nodeName(root, GuidsCatalogue.empty)).toBe("UEFI image");
  });
});

describe("the hidden top row", () => {
  it("folds an image root into the title", () => {
    const presented = present([shown(wrapper([volume()]))]);
    expect(presented.title?.kind).toBe("uefiImage");
    expect(presented.title?.name).toBe("UEFI image");
    expect(presented.rows.map((row) => row.kind)).toEqual(["volume"]);
  });

  // A container the tree opens on demand: folding it would mean deciding again
  // the moment somebody opened it.
  it("keeps a lone real root's row", () => {
    const roots = [shown(volume([file()]))];
    expect(present(roots).title).toBeUndefined();
    expect(present(roots).rows.map((row) => row.kind)).toEqual(["volume"]);
    expect(summary(roots)).toBe("Volume · FFSv2");
  });

  it("does not fold a root with several tops", () => {
    const roots = [
      shown(
        makeNode({
          kind: "capsule",
          name: "EFI capsule",
          header: r(0, 0x20),
          body: r(0x20, 0x1020),
        })
      ),
      shown(makeSpan({ kind: "padding", name: "", range: r(0x1020, 0x1120) })),
    ];
    expect(present(roots).title).toBeUndefined();
    expect(present(roots).rows.map((row) => row.kind)).toEqual(["capsule", "padding"]);
    expect(summary(roots)).toBe("Capsule");
  });

  it("does not fold an image root with nothing under it", () => {
    const roots = [shown(wrapper([]))];
    expect(present(roots).title).toBeUndefined();
    expect(present(roots).rows).toHaveLength(1);
    expect(summary(roots)).toBe("Image · UEFI");
  });

  it("says nothing looks like firmware for an empty image", () => {
    expect(summary([])).toBe("Nothing here looks like a firmware image.");
  });

  // It counts nothing: the tree is materialized branch by branch, so a count
  // would be a count of clicks.
  it("is the folded root's name alone", () => {
    expect(summary([shown(wrapper([volume()]))])).toBe("UEFI image");
  });
});
