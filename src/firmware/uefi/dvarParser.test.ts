import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { DVAR } from "@/firmware/uefi/dvarParser";
import { guid, guidBytes, guidEquals, guidKey } from "@/firmware/uefi/efiGuid";
import { itemType } from "@/firmware/uefi/itemClassification";
import { nvramStoreFillOf } from "@/firmware/uefi/nvramStoreFill";
import { variableHistoryOf, variableOf } from "@/firmware/uefi/nvramVariableHistory";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ItemType, Sub } from "@/firmware/uefi/uefiTypes";

/**
 * Ported from `DvarParserTests.swift`: Dell's DVAR store (§9), built byte for byte —
 * every field after the signature is stored as its complement.
 */

const NAMESPACE = guid("417ACEE0-6FA9-4A82-99D7-F9B1DD271E48");

/**
 * An entry: state, flags, type and attributes, the namespace id, the namespace's
 * GUID when the entry declares it, then an 8-bit name id and data size, and the
 * data — complemented as the store keeps them.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DvarParserTests.swift#DvarParserTests.entry
 */
function dvarEntry(options: {
  readonly state: number;
  readonly declares?: boolean;
  readonly namespaceId?: number;
  readonly nameId: number;
  readonly data: readonly number[];
  readonly type?: number;
}): number[] {
  const flags =
    options.declares === true ? DVAR.flagNameId | DVAR.flagNamespaceGuid : DVAR.flagNameId;
  const bytes = [
    0xff - options.state,
    0xff - flags,
    0xff - (options.type ?? DVAR.nameId8Size8),
    0xff - 0x07,
    0xff - (options.namespaceId ?? 1),
  ];
  if (options.declares === true) bytes.push(...guidBytes(NAMESPACE));
  bytes.push(0xff - options.nameId, 0xff - options.data.length);
  return [...bytes, ...options.data];
}

/**
 * `DVAR`, the complemented size and flags, the entries, erased bytes.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/DvarParserTests.swift#DvarParserTests.store
 */
function dvarStore(entries: readonly (readonly number[])[], size = 0x100): number[] {
  const bytes = [0x44, 0x56, 0x41, 0x52];
  const sizeC = 0xffff_ffff - size;
  for (let index = 0; index < 4; index++) bytes.push(Math.floor(sizeC / 2 ** (8 * index)) & 0xff);
  bytes.push(0xff - 0x83);
  for (const one of entries) bytes.push(...one);
  while (bytes.length < size) bytes.push(0xff);
  return bytes;
}

/** A store in a raw area, between erased bytes, as the scan finds it. */
function parse(store: readonly number[]) {
  const bytes = Uint8Array.from([
    ...new Array<number>(0x40).fill(0xff),
    ...store,
    ...new Array<number>(0x40).fill(0xff),
  ]);
  const image = parseUefiImage(sourceOver(bytes));
  return { image, store: image.allNodes.find((node) => node.kind === "dvarStore") };
}

describe("a DVAR store", () => {
  // The entries the reference shows: a declaration of the namespace, a copy no
  // longer stored, the current one under the namespace's GUID, and the free space
  // after them.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DvarParserTests.swift#DvarParserTests.testAStoresEntriesAreReadAsTheReferenceReadsThem
  it("reads its entries as the reference reads them", () => {
    const { image, store } = parse(
      dvarStore([
        dvarEntry({ state: DVAR.deleted, declares: true, nameId: 0x40, data: [1] }),
        dvarEntry({ state: DVAR.deleted, nameId: 0x40, data: [2] }),
        dvarEntry({ state: DVAR.stored, nameId: 0x40, data: [3, 3] }),
      ])
    );

    expect(store === undefined ? undefined : nodeRange(store)).toEqual({ start: 0x40, end: 0x140 });
    expect(store?.header.end).toBe((store?.header.start ?? 0) + 9);
    expect(store?.children.map((child) => child.kind)).toEqual([
      "dvarEntry",
      "dvarEntry",
      "dvarEntry",
      "freeSpace",
    ]);
    expect(store?.children.slice(0, 3).map((child) => child.subtype)).toEqual([
      Sub.namespaceGuidDvarEntry,
      Sub.invalidDvarEntry,
      Sub.nameIdDvarEntry,
    ]);
    expect(store?.children.slice(0, 3).map((child) => child.name)).toEqual(["40", "Invalid", "40"]);
    // Named by the namespace another entry declared.
    const guidOfThird = store?.children[2]?.guid;
    expect(guidOfThird !== undefined && guidEquals(guidOfThird, NAMESPACE)).toBe(true);
    const first = store?.children[0];
    expect(first === undefined ? 0 : first.header.end - first.header.start).toBe(5 + 16 + 2);
    const third = store?.children[2];
    expect(third === undefined ? 0 : third.body.end - third.body.start).toBe(2);
    expect(image.diagnostics).toEqual([]);
    expect(store === undefined ? undefined : itemType(store)).toBe(ItemType.dellDvarStore);
  });

  // A variable filed under a namespace nobody declared is Invalid, and said to be.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DvarParserTests.swift#DvarParserTests.testAnUndeclaredNamespaceIsReported
  it("reports an undeclared namespace", () => {
    const { image, store } = parse(
      dvarStore([dvarEntry({ state: DVAR.stored, namespaceId: 9, nameId: 0x10, data: [1] })])
    );
    const entry = store?.children[0];

    expect(entry?.name).toBe("Invalid");
    expect(entry?.subtype).toBe(Sub.nameIdDvarEntry);
    expect(image.diagnostics.map((one) => one.detail)).toEqual([{ kind: "dvarNamespaceMissing" }]);
  });

  // An entry of a type nobody has seen ends what can be read: the rest is padding,
  // and the store says so once.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DvarParserTests.swift#DvarParserTests.testAnEntryOfUnknownShapeEndsTheWalk
  it("ends the walk at an entry of unknown shape", () => {
    const { image, store } = parse(
      dvarStore([
        dvarEntry({ state: DVAR.stored, declares: true, nameId: 0x40, data: [1] }),
        dvarEntry({ state: DVAR.stored, nameId: 0x41, data: [2], type: 0x07 }),
      ])
    );

    expect(store?.children.map((child) => child.kind)).toEqual(["dvarEntry", "padding"]);
    const last = store?.children.at(-1);
    expect(last === undefined ? undefined : nodeRange(last).end).toBe(
      store === undefined ? undefined : nodeRange(store).end
    );
    expect(image.diagnostics.map((one) => one.detail)).toEqual([{ kind: "unknownDvarEntry" }]);
  });

  // A signature that is not a store — a size that does not fit what is left, or
  // entries that run past the store — is not a store, and no defect either.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DvarParserTests.swift#DvarParserTests.testASignatureThatIsNotAStoreLeavesNothing
  it("leaves nothing of a signature that is not a store", () => {
    const tooBig = dvarStore([], 0x20);
    tooBig[4] = 0x00; // a size far past the area
    expect(parse(tooBig).store).toBeUndefined();
    const cut = dvarStore(
      [
        dvarEntry({
          state: DVAR.stored,
          declares: true,
          nameId: 1,
          data: new Array<number>(40).fill(0),
        }),
      ],
      0x30
    );
    const parsed = parse(cut);
    expect(parsed.store).toBeUndefined();
    expect(parsed.image.diagnostics).toEqual([]);
  });

  // A copy is current when its state is stored; the others are its history, the
  // declaration's value among them.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/DvarParserTests.swift#DvarParserTests.testTheStoresCopiesAreCountedAndAreAHistory
  it("counts a store's copies and keeps them as a history", () => {
    const bytes = Uint8Array.from(
      dvarStore([
        dvarEntry({ state: DVAR.deleted, declares: true, nameId: 0x40, data: [1] }),
        dvarEntry({ state: DVAR.deleted, nameId: 0x40, data: [2] }),
        dvarEntry({ state: DVAR.stored, nameId: 0x40, data: [3] }),
        dvarEntry({ state: DVAR.deleted, nameId: 0x50, data: [4] }),
      ])
    );
    const image = parseUefiImage(sourceOver(bytes));
    const store = image.allNodes.find((node) => node.kind === "dvarStore") as UEFINode;
    const reader = new ImageReader(sourceOver(bytes));
    const fill = nvramStoreFillOf(store, reader);
    expect([fill?.current, fill?.superseded, fill?.deleted]).toEqual([1, 2, 1]);

    const history = variableHistoryOf(store.children[1] as UEFINode, store, reader);
    expect(history?.name).toBe("40");
    expect(history?.guid === undefined ? undefined : guidKey(history.guid)).toBe(
      guidKey(NAMESPACE)
    );
    expect(history?.versions.map((one) => one.state)).toEqual([
      "superseded",
      "superseded",
      "current",
    ]);
    expect(history?.versions.map((one) => [...(reader.bytes(one.value) ?? [])])).toEqual([
      [1],
      [2],
      [3],
    ]);
    expect(variableOf(store.children[3] as UEFINode, store, reader)?.name).toBe("50");
  });
});
