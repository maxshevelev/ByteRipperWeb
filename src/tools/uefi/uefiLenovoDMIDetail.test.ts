import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { LenovoDMIDecodedBlock } from "@/firmware/lenovoDmi/lenovoDmiValue";
import { LENVBlock } from "@/firmware/lenovoDmi/lenvBlock";
import { MTM, SERIAL, STANDARD_LOG, testBlock, testLog } from "@/firmware/testing/testLenovoDMI";
import { parseUefiImage, type UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode, type UEFINodeKind } from "@/firmware/uefi/uefiNode";
import type { NodeDetail } from "@/tools/toolDetail";
import { encodingRole, lenovoDMIRowText } from "@/tools/uefi/uefiLenovoDMIDetail";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { subtypeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * What the details and the tree say of Lenovo's DMI store: the store's row sums it up, and
 * every row below it says what it holds, decoded. The format is `src/firmware/lenovoDmi`'s
 * and the rows `lenovoDmiStore.ts`'s, tested there.
 *
 * @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFILenovoDMIDetailTests.swift#UEFILenovoDMIDetailTests
 */

/** Padding, the store at `0x4000` — block 1 at generation 3 with both entries, block 2 at generation 4 with the serial only — and padding. */
function parsed(): { image: UEFIImage; reader: ImageReader; bytes: Uint8Array } {
  const store = [
    ...testLog(STANDARD_LOG.slice(2), 0x77),
    ...testBlock({ generation: 3, key: 0x77, entries: [SERIAL, MTM] }),
    ...testBlock({ generation: 4, key: 0x77, entries: [SERIAL] }),
  ];
  const bytes = Uint8Array.from([
    ...new Array<number>(0x4000).fill(0xff),
    ...store,
    ...new Array<number>(0x4000).fill(0xff),
  ]);
  const source = sourceOver(bytes);
  return { image: parseUefiImage(source), reader: new ImageReader(source), bytes };
}

const nodeOf = (image: UEFIImage, kind: UEFINodeKind, index = 0): UEFINode => {
  const found = image.allNodes.filter((node) => node.kind === kind)[index];
  if (found === undefined) throw new Error(`no ${kind} ${index}`);
  return found;
};

const detailOf = (node: UEFINode, p: ReturnType<typeof parsed>): NodeDetail =>
  buildNodeDetail(node, p.image, p.reader);

const value = (label: string, detail: NodeDetail): string | undefined =>
  detail.fields.find((one) => one.label === label)?.value;

describe("Lenovo's DMI store in the detail", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFILenovoDMIDetailTests.swift#UEFILenovoDMIDetailTests.testTheStoreSaysWhichBlockIsInUseAndWhatItHolds
  it("says which block is in use and what it holds, each value a way to its row", () => {
    const p = parsed();
    const detail = detailOf(nodeOf(p.image, "lenovoDMIStore"), p);
    expect(value("Block in use", detail)).toBe("LENV block 2, generation 4");
    expect(
      detail.fields.some((one) => one.label === "Note" && one.value.includes("different values"))
    ).toBe(true);
    const table = detail.tables[0];
    expect(table?.title).toBe("Entries in use");
    expect(table?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["Baseboard serial number", "PF0TEST1"],
    ]);
    // Block 2's entry, not block 1's.
    expect(table?.rowTargets).toEqual([{ kind: "node", path: nodeOf(p.image, "lenvEntry", 2).id }]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFILenovoDMIDetailTests.swift#UEFILenovoDMIDetailTests.testABlockSaysWhetherTheFirmwareReadsIt
  it("says whether the firmware reads a block", () => {
    const p = parsed();
    const first = detailOf(nodeOf(p.image, "lenvBlock", 0), p);
    const second = detailOf(nodeOf(p.image, "lenvBlock", 1), p);
    expect(value("Type", first)).toBe("Not in use");
    expect(value("Type", second)).toBe("In use");
    expect(value("Firmware reads it", second)).toBe("Yes — the higher generation");
    expect(value("Generation", first)).toBe("3");
    expect(value("Checksum", first)?.endsWith("(Valid)")).toBe(true);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFILenovoDMIDetailTests.swift#UEFILenovoDMIDetailTests.testAnEntrySaysItsValueAndTheOtherCopy
  it("says an entry's value and what the other copy has", () => {
    const p = parsed();
    const mtm = detailOf(nodeOf(p.image, "lenvEntry", 1), p);
    expect(value("Value", mtm)).toBe("82XX0000GE");
    expect(value("Other copy", mtm)).toBe("Not in LENV block 2");
    const serial = detailOf(nodeOf(p.image, "lenvEntry", 0), p);
    expect(value("Other copy", serial)).toBe("The same in LENV block 2");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFILenovoDMIDetailTests.swift#UEFILenovoDMIDetailTests.testALogEntrySaysWhatWasWritten
  it("says what a log entry wrote", () => {
    const p = parsed();
    const write = detailOf(nodeOf(p.image, "ldbgEntry"), p);
    expect(value("Operation", write)).toBe("Set");
    expect(value("Entry", write)).toBe("Baseboard serial number");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFILenovoDMIDetailTests.swift#UEFILenovoDMIDetailTests.testABlocksRowSaysWhetherItIsEncoded
  it("says on a block's row whether it is encoded", () => {
    const p = parsed();
    const block = nodeOf(p.image, "lenvBlock", 1);
    expect(encodingRole(block, p.reader)).toEqual({
      kind: "encoded",
      words: "Encoded with the XOR key 0x77",
      decoded: false,
    });
    expect(encodingRole(nodeOf(p.image, "lenovoDMIStore"), p.reader)).toBeUndefined();
    expect(encodingRole(nodeOf(p.image, "lenvEntry"), p.reader)).toBeUndefined();

    const range = nodeRange(block);
    const stored = p.reader.bytes(range) as Uint8Array;
    const decoded = LenovoDMIDecodedBlock.decode(new LENVBlock(0, stored));
    const alone = parseUefiImage(sourceOver(decoded));
    expect(encodingRole(nodeOf(alone, "lenvBlock"), new ImageReader(sourceOver(decoded)))).toEqual({
      kind: "encoded",
      words: "Decoded: the key 0x77 encodes it again on the way back",
      decoded: true,
    });
    // On its own a block has no other to be chosen over: neither in use nor not, whatever the
    // store it came from says.
    const said = subtypeText(nodeOf(alone, "lenvBlock"));
    expect(said).not.toBe("Not in use");
    expect(said).not.toBe("In use");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/UEFILenovoDMIDetailTests.swift#UEFILenovoDMIDetailTests.testTheTreesRowsSayWhatTheyHold
  it("says in the tree's rows what they hold without being opened", () => {
    const p = parsed();
    const parentOf = (node: UEFINode) => p.image.node(node.id.slice(0, -1)) as UEFINode | undefined;
    const row = (node: UEFINode) => lenovoDMIRowText(node, parentOf(node), p.reader);
    expect(row(nodeOf(p.image, "lenvEntry", 1))).toBe("Machine type/model = 82XX0000GE");
    expect(row(nodeOf(p.image, "lenvBlock", 1))).toBe("LENV block 2 · Generation 4");
    expect(row(nodeOf(p.image, "ldbgEntry"))).toBe(
      "2022-06-29 20:30:25 · Set · Baseboard serial number"
    );
    expect(subtypeText(nodeOf(p.image, "lenvBlock", 1))).toBe("In use");
  });
});
