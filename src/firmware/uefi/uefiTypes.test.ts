import { describe, expect, it } from "vitest";
import { guid } from "@/firmware/uefi/efiGuid";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { itemSubtype, itemType } from "@/firmware/uefi/itemClassification";
import { FFS_V2, FFS_V3 } from "@/firmware/uefi/knownGuids";
import { makeNode, type UEFINode, type UEFINodeKind } from "@/firmware/uefi/uefiNode";
import { ItemType, regionName, Sub, subtypeName, typeName } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `UEFITypesTests.swift`.
 *
 * The words the tree shows for a type and a subtype are UEFITool's, read from
 * the generated tables. These pin the transcription: a code that stops mapping
 * to the word UEFITool uses is a table that drifted from `common/types.cpp`.
 */

describe("the type tables", () => {
  it("read the item types", () => {
    expect(typeName(60)).toBe("Root");
    expect(typeName(61)).toBe("Capsule");
    expect(typeName(63)).toBe("Region");
    expect(typeName(65)).toBe("Volume");
    expect(typeName(87)).toBe("Intel microcode");
  });

  // A code the table does not know keeps its number — the honest answer for a
  // vendor type nobody has named.
  it("keep an unknown type's number", () => {
    expect(typeName(59)).toBe("Unknown 3Bh");
    expect(regionName(99)).toBe("Unknown 63h");
  });

  it("read the flash-descriptor regions", () => {
    expect(regionName(0)).toBe("Descriptor");
    expect(regionName(1)).toBe("BIOS");
    expect(regionName(7)).toBe("Microcode");
    expect(regionName(18)).toBe("PSP file");
  });

  it("answer a subtype per type", () => {
    expect(subtypeName(61, 100)).toBe("Aptio signed");
    expect(subtypeName(61, 102)).toBe("UEFI 2.0");
    expect(subtypeName(62, 90)).toBe("Intel");
    expect(subtypeName(65, 111)).toBe("FFSv2");
    expect(subtypeName(65, 113)).toBe("NVRAM");
    expect(subtypeName(64, 120)).toBe("Empty (00h)");
    expect(subtypeName(64, 122)).toBe("Non-empty");
  });

  // A region's subtype is answered by the region table, folded in under the
  // Region item type — the same delegation the C++ makes.
  it("answer a region subtype from the region table", () => {
    expect(subtypeName(63, 1)).toBe("BIOS");
    expect(subtypeName(63, 7)).toBe("Microcode");
  });

  // File and Section delegate to the FFS and section type tables, which live in
  // other files and are named at run time.
  it("have no generated answer for a file or a section", () => {
    expect(subtypeName(66, 7)).toBeUndefined();
    expect(subtypeName(67, 0x19)).toBeUndefined();
    expect(subtypeName(99, 0)).toBeUndefined();
  });
});

/**
 * Ported from `UEFIItemClassificationTests`. The mapping reads what the parser
 * stored, so a node classifies the same way on every parse.
 */
describe("classifying a node", () => {
  const node = (
    kind: UEFINodeKind,
    extra: Partial<Pick<UEFINode, "subtype" | "guid" | "isErased">> = {}
  ) =>
    makeNode({
      kind,
      name: "",
      header: { start: 0, end: 0 },
      body: { start: 0, end: 0x100 },
      ...extra,
    });

  it("reads each kind as its ItemTypes code", () => {
    expect(itemType(node("capsule"))).toBe(ItemType.capsule);
    // The whole of an Intel flash image is an Image, the same as a capsule —
    // and so is the UEFI image root that wraps any other file.
    expect(itemType(node("intelImage"))).toBe(ItemType.image);
    expect(itemType(node("uefiImage"))).toBe(ItemType.image);
    expect(itemType(node("flashDescriptor"))).toBe(ItemType.region);
    expect(itemType(node("region"))).toBe(ItemType.region);
    expect(itemType(node("volume"))).toBe(ItemType.volume);
    expect(itemType(node("file"))).toBe(ItemType.file);
    expect(itemType(node("section"))).toBe(ItemType.section);
    expect(itemType(node("microcode"))).toBe(ItemType.intelMicrocode);
    expect(itemType(node("vssStore"))).toBe(ItemType.vssStore);
    expect(itemType(node("vss2Store"))).toBe(ItemType.vss2Store);
    expect(itemType(node("ftwStore"))).toBe(ItemType.ftwStore);
    expect(itemType(node("fdcStore"))).toBe(ItemType.fdcStore);
    expect(itemType(node("sysFStore"))).toBe(ItemType.sysFStore);
    expect(itemType(node("flashMapStore"))).toBe(ItemType.phoenixFlashMapStore);
    expect(itemType(node("evsaStore"))).toBe(ItemType.evsaStore);
    expect(itemType(node("cmdbStore"))).toBe(ItemType.cmdbStore);
    expect(itemType(node("slicData"))).toBe(ItemType.slicData);
    expect(itemType(node("vssEntry"))).toBe(ItemType.vssEntry);
    expect(itemType(node("sysFEntry"))).toBe(ItemType.sysFEntry);
    expect(itemType(node("evsaEntry"))).toBe(ItemType.evsaEntry);
    expect(itemType(node("flashMapEntry"))).toBe(ItemType.phoenixFlashMapEntry);
    expect(itemType(node("padding"))).toBe(ItemType.padding);
    expect(itemType(node("freeSpace"))).toBe(ItemType.freeSpace);
    // Unclaimed data reads as a file, the way a raw region does.
    expect(itemType(node("nonUEFIData"))).toBe(ItemType.file);
  });

  it("names a capsule by its GUID", () => {
    const withGuid = (text: string) => node("capsule", { guid: guid(text) });
    expect(itemSubtype(withGuid("4A3CA68B-7723-48FB-803D-578CC1FEC44D"))).toBe(
      Sub.aptioSignedCapsule
    );
    expect(itemSubtype(withGuid("14EEBB90-890A-43DB-AED1-5D3C4588A418"))).toBe(
      Sub.aptioUnsignedCapsule
    );
    expect(itemSubtype(withGuid("3BE07062-1D51-45D2-832B-F093257ED461"))).toBe(Sub.toshibaCapsule);
    // Everything else that is a capsule reads as a plain UEFI 2.0 one.
    expect(itemSubtype(withGuid("DFC08A91-C8CA-4DB9-8F2F-8E6F6A32B65A"))).toBe(Sub.uefiCapsule);
    // No GUID, no capsule to name.
    expect(itemSubtype(node("capsule"))).toBeUndefined();
  });

  it("keeps a region's descriptor type", () => {
    expect(itemSubtype(node("region", { subtype: 7 }))).toBe(7);
    expect(itemSubtype(node("flashDescriptor"))).toBe(Sub.descriptorRegion);
  });

  // The two image roots are the same type, told apart by subtype.
  it("tells the two image roots apart by subtype", () => {
    expect(itemSubtype(node("intelImage"))).toBe(Sub.intelImage);
    expect(itemSubtype(node("uefiImage"))).toBe(Sub.uefiImage);
  });

  it("names a volume by its file-system GUID", () => {
    expect(itemSubtype(node("volume", { guid: FFS_V2 }))).toBe(Sub.ffs2Volume);
    expect(itemSubtype(node("volume", { guid: FFS_V3 }))).toBe(Sub.ffs3Volume);
    expect(
      itemSubtype(node("volume", { guid: guid("FFF12B8D-7696-4C8B-A985-2747075B4F50") }))
    ).toBe(Sub.nvramVolume);
    expect(
      itemSubtype(node("volume", { guid: guid("153D2197-29BD-44DC-AC59-887F70E41A6B") }))
    ).toBe(Sub.appleMicrocodeVolume);
    // A file system nobody documented is an unknown volume, and so is a volume
    // with no GUID at all.
    expect(
      itemSubtype(node("volume", { guid: guid("11111111-2222-3333-4444-555555555555") }))
    ).toBe(Sub.unknownVolume);
    expect(itemSubtype(node("volume"))).toBe(Sub.unknownVolume);
  });

  it("keeps a file's and a section's type byte", () => {
    expect(itemSubtype(node("file", { subtype: 7 }))).toBe(7);
    expect(itemSubtype(node("section", { subtype: 0x19 }))).toBe(0x19);
  });

  // A store is one kind and no more: the entry subtypes live on the children.
  it("gives a store and the microcode no subtype", () => {
    const stores: UEFINodeKind[] = [
      "vssStore",
      "vss2Store",
      "ftwStore",
      "fdcStore",
      "sysFStore",
      "flashMapStore",
      "evsaStore",
      "cmdbStore",
    ];
    for (const kind of stores) expect(itemSubtype(node(kind))).toBeUndefined();
    expect(itemSubtype(node("microcode"))).toBeUndefined();
    expect(itemSubtype(node("freeSpace"))).toBeUndefined();
    expect(itemSubtype(node("nonUEFIData"))).toBeUndefined();
  });

  // An entry and a SLIC blob carry the subtype the parser derived, not a byte
  // read off the node.
  it("keeps an entry's derived subtype", () => {
    expect(itemSubtype(node("vssEntry", { subtype: Sub.standardVssEntry }))).toBe(
      Sub.standardVssEntry
    );
    expect(itemSubtype(node("sysFEntry", { subtype: Sub.normalSysFEntry }))).toBe(
      Sub.normalSysFEntry
    );
    expect(itemSubtype(node("evsaEntry", { subtype: Sub.dataEvsaEntry }))).toBe(Sub.dataEvsaEntry);
    expect(itemSubtype(node("flashMapEntry", { subtype: Sub.dataFlashMapEntry }))).toBe(
      Sub.dataFlashMapEntry
    );
    expect(itemSubtype(node("slicData", { subtype: Sub.pubkeySlicData }))).toBe(Sub.pubkeySlicData);
  });

  it("names padding by whether it is erased", () => {
    expect(itemSubtype(node("padding", { isErased: true }))).toBe(Sub.onePadding);
    expect(itemSubtype(node("padding", { isErased: false }))).toBe(Sub.dataPadding);
  });
});

/** Ported from `GuidsCatalogueTests`. */
describe("the GUID catalogue", () => {
  const ffsV2 = "8C8CE578-8A3D-4F1C-9935-896185C32DD3";

  it("parses UUID,Name lines", () => {
    const catalogue = GuidsCatalogue.parse(
      `${ffsV2},FFSv2\n5473C07A-3DCB-4DCA-BD6F-1E9689E7349A,FFSv3\n`
    );
    expect(catalogue.nameOf(guid(ffsV2))).toBe("FFSv2");
    expect(catalogue.nameOf(guid("5473C07A-3DCB-4DCA-BD6F-1E9689E7349A"))).toBe("FFSv3");
    expect(catalogue.names.size).toBe(2);
  });

  // A blank line and a line with no name are skipped, not an error — a trailing
  // blank line is not worth failing a catalogue over.
  it("skips blank and nameless lines", () => {
    const catalogue = GuidsCatalogue.parse(`${ffsV2},FFSv2\n\n${ffsV2},\nnot-a-guid,Name\n`);
    expect(catalogue.names.size).toBe(1);
    expect(catalogue.nameOf(guid(ffsV2))).toBe("FFSv2");
  });

  // The name is everything after the first comma, so a name that itself
  // contains a comma survives.
  it("keeps a name with a comma in it", () => {
    expect(GuidsCatalogue.parse(`${ffsV2},FFS, v2\n`).nameOf(guid(ffsV2))).toBe("FFS, v2");
  });

  // The file is CRLF on Windows, where much of it is edited.
  it("accepts CRLF line endings", () => {
    expect(GuidsCatalogue.parse(`${ffsV2},FFSv2\r\n`).nameOf(guid(ffsV2))).toBe("FFSv2");
  });

  // The tree starts with this: no names, so a GUID node shows the GUID itself
  // until a download fills the catalogue in.
  it("starts empty", () => {
    expect(GuidsCatalogue.empty.names.size).toBe(0);
    expect(GuidsCatalogue.empty.nameOf(guid(ffsV2))).toBeUndefined();
  });
});
