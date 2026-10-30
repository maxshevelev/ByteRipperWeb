import { describe, expect, it } from "vitest";
import { CopyPartCodec, GatherPartCodec } from "@/core/parts/partCodec";
import type { MFSFile } from "@/firmware/me/models/fileSystemFacts";
import { meaPartOpen } from "@/tools/meaParts";
import { analysisWith, mfsVolumeFixture } from "@/tools/meaTesting";
import { type MEANode, presentMEA } from "@/tools/meaTree";

/** What a row of the ME tree opens as in a fragment panel, and which file rows are drawn as empty. */

const row = (title: string, extra: Partial<MEANode> = {}): MEANode => ({
  path: [0],
  title,
  subtitle: "",
  range: undefined,
  fields: [],
  children: [],
  isEmptySection: false,
  marks: undefined,
  helpTerm: undefined,
  ...extra,
});

function find(title: string, nodes: readonly MEANode[] | undefined): MEANode | undefined {
  for (const node of nodes ?? []) {
    if (node.title === title) return node;
    const found = find(title, node.children);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("a row of the ME tree opened as a fragment", () => {
  // A row with one range opens as a copy of it, named by its title.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEAPartsTests.swift#MEAPartsTests.testARowWithARangeOpensAsACopy
  it("is a copy of a row with a range", () => {
    const open = meaPartOpen(row("FTPR", { path: [1, 0], range: { start: 0x1000, end: 0x2000 } }));

    expect(open?.name).toBe("FTPR");
    expect(open?.source).toEqual([0x1000, 0x2000]);
    expect(open?.codec).toBeInstanceOf(CopyPartCodec);
  });

  // A file opens as its chunks gathered in the file's order, linked to their span, and is named
  // as it would be saved: the last path component.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEAPartsTests.swift#MEAPartsTests.testAFileOpensAsItsChunksGathered
  it("is a file's chunks gathered", () => {
    const open = meaPartOpen(
      row("/home/mctp/smt2_devices", {
        path: [2, 0, 5],
        extents: [
          { start: 0x9000, end: 0x9040 },
          { start: 0x8000, end: 0x8040 },
        ],
      })
    );

    expect(open?.name).toBe("smt2_devices");
    expect(open?.source).toEqual([0x8000, 0x9040]);
    const gather = open?.codec;
    expect(gather).toBeInstanceOf(GatherPartCodec);
    expect((gather as GatherPartCodec).stretches).toEqual([
      [0x9000, 0x9040],
      [0x8000, 0x8040],
    ]);
  });

  // A row without bytes of its own, and an empty file, open nothing.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEAPartsTests.swift#MEAPartsTests.testARowWithoutBytesOpensNothing
  it("is nothing for a row without bytes", () => {
    expect(meaPartOpen(row("Manifest"))).toBeUndefined();
    expect(meaPartOpen(row("empty", { path: [2, 0, 6], extents: [] }))).toBeUndefined();
  });

  // A file whose chain carries only its Integrity table holds no data: its row reads empty, as its
  // subtitle does. One with data does not.
  // @upstream Packages/MEPresentation/Tests/MEPresentationTests/MEAPartsTests.swift#MEAPartsTests.testAFileWithNoContentIsDrawnEmpty
  it("leaves a file with no content drawn empty", () => {
    const file = (index: number, size: number, contentSize?: number): MFSFile => ({
      index,
      size,
      extents: [{ start: 0x100 * index, end: 0x100 * index + size }],
      ...(contentSize === undefined ? {} : { contentSize }),
    });
    const roots = presentMEA(
      analysisWith({
        mfsVolume: {
          ...mfsVolumeFixture(),
          files: [file(1, 0x34, 0), file(2, 0x40, 0x0c), file(3, 0x20)],
        },
      }),
      undefined
    );

    // A chain of nothing but its Integrity table is an empty file.
    expect(find("File 1", roots)?.isEmptySection).toBe(true);
    expect(find("File 2", roots)?.isEmptySection).toBe(false);
    expect(find("File 3", roots)?.isEmptySection).toBe(false);
  });
});
