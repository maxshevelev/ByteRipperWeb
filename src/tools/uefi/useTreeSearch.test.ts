import { describe, expect, it } from "vitest";
import { searchPlace } from "@/tools/uefi/useTreeSearch";
import type { WireNode } from "@/workers/protocol";

const node = (start: number, space: number[], children: WireNode[] = []): WireNode =>
  ({ id: [], header: [start, start + 4], space, children }) as unknown as WireNode;

describe("where the search is", () => {
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.showSearchProgress
  it("is the offset of the row in the file, over the file's size", () => {
    const roots = [node(0, [], [node(0x400, [])])];
    expect(searchPlace(roots, "0.0", 0x1000)).toBe(0.25);
    expect(searchPlace(roots, "0", 0x1000)).toBe(0);
  });

  /** Inside a compressed section the bytes are no bytes of the file: the section's offset. */
  it("is the section's offset for a row inside a compressed section", () => {
    const inside = node(0x10, [0x800]);
    const roots = [node(0, [], [node(0x800, [], [inside])])];
    expect(searchPlace(roots, "0.0.0", 0x1000)).toBe(0.5);
  });

  it("is nothing for an empty file", () => {
    expect(searchPlace([node(0, [])], "0", 0)).toBeUndefined();
  });
});
