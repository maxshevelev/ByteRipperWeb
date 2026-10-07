import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import { biosGuardFile, block } from "@/firmware/testing/testBiosGuard";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
import { uefiHelpTerm } from "@/tools/uefi/uefiHelpTerms";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import {
  type CompressedSectionNode,
  contentOf,
  decompressedBody,
  partName,
  type ZonedNode,
} from "@/tools/uefi/uefiPresenter";
import { typeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * An AMI BIOS Guard update file in the panel: the update's row says what it is and lists its
 * table, its entries open as stretches of the region, the region itself is offered as a file,
 * and `?` opens the update's entry.
 */

/** Two entries, `/B FV_BB` of one block and `/P FV_MAIN` of two, every block signed. */
const FILE = biosGuardFile([
  { key: "/B", name: "FV_BB", blocks: [block(0xff, 0x100)] },
  { key: "/P", name: "FV_MAIN", blocks: [block(0xff, 0x200), block(0xff, 0x80)] },
]);

const wire = (node: UEFINode): ZonedNode & CompressedSectionNode => ({
  id: node.id,
  kind: node.kind,
  name: node.name,
  header: [node.header.start, node.header.end] as const,
  body: [node.body.start, node.body.end] as const,
  tail: [node.tail.start, node.tail.end] as const,
  space: node.space,
  compression: node.compression,
  isExpandable: node.isExpandable,
  children: node.children.map(wire),
});

function parsed() {
  const image = parseUefiImage(sourceOver(FILE));
  const update = image.roots.find((root) => root.kind === "biosGuardUpdate");
  if (update === undefined) throw new Error("no update row");
  return { image, update };
}

describe("an AMI BIOS Guard update in the panel", () => {
  // @upstream Modules/UEFITool/Tests/UEFIToolTests/BIOSGuardDisplayTests.swift#BIOSGuardDisplayTests.testTheUpdatesRowSaysWhatItIsAndListsItsTable
  it("says what the row is and lists its table", () => {
    const { image, update } = parsed();
    const detail = buildNodeDetail(update, image, new ImageReader(sourceOver(FILE)), []);
    const value = (label: string) => detail.fields.find((one) => one.label === label)?.value;

    expect(value("Kind")).toBe("BIOS Guard update");
    expect(value("Platform")).toBe("RAPTORLAKE");
    expect(value("Blocks")).toBe("3");
    const table = detail.tables.find((one) => one.title === "Update table");
    expect(table?.columns).toEqual(["Name", "Switch", "Blocks", "Offset in the region", "Size"]);
    expect(table?.rows.map((row) => row.map((cell) => cell.text))).toEqual([
      ["FV_BB", "/B", "1", "0x0", "0x100"],
      ["FV_MAIN", "/P", "2", "0x100", "0x280"],
    ]);
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/BIOSGuardDisplayTests.swift#BIOSGuardDisplayTests.testTheEntriesAreRowsOfTheirOwnInTheRegion
  it("shows the entries as rows of their own in the region", () => {
    const { update } = parsed();
    expect(update.children.map((child) => child.name)).toEqual(["FV_BB", "FV_MAIN"]);
    expect(update.children.map(typeText)).toEqual(["Padding", "Padding"]);
    expect(update.children.every((child) => child.space.length === 1 && child.space[0] === 0)).toBe(
      true
    );
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/BIOSGuardDisplayTests.swift#BIOSGuardDisplayTests.testTheRegionIsOfferedAsAFileByWhatItIs
  it("offers the region as a file, by what it is", () => {
    const { update } = parsed();
    const body = decompressedBody(wire(update));
    expect(body?.space).toEqual([0]);
    expect(body?.openTitle).toBe("Open Assembled BIOS Region");
    expect(body?.saveTitle).toBe("Save Assembled BIOS Region as…");
    expect(partName(body?.suggestedName ?? "", "X1704VAPF.306")).toBe("X1704VAPF_BIOS region.bin");
    expect(contentOf(wire(update))).toBe("decompressedBody");
  });

  // @upstream Modules/UEFITool/Tests/UEFIToolTests/BIOSGuardDisplayTests.swift#BIOSGuardDisplayTests.testTheQuestionMarkOpensTheUpdatesEntry
  it("opens the update's help entry from the question mark", () => {
    const { update } = parsed();
    expect(uefiHelpTerm(update)).toBe("bios-guard-update");
    const first = update.children[0];
    expect(first && uefiHelpTerm(first)).toBe("bios-guard-update");
  });
});
