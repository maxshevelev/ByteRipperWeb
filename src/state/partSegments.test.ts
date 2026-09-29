import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { applySegments, segmentsFor, undoSegments } from "@/state/segmentsStore";
import { closePart, openPart, workspaceStore } from "@/state/workspaceStore";

/**
 * A fragment panel is a document of its own, and cutting it into segments is
 * one of the things a document does. Its partition had never been made, so
 * every segment command on a panel acted on nothing and said nothing.
 */

afterEach(() => {
  workspaceStore.update((state) => ({ ...state, parts: {}, dock: EMPTY_DOCK }));
});

const bytes = Uint8Array.from({ length: 0x200 }, (_, index) => index & 0xff);

describe("a part's segments", () => {
  // @upstream ByteRipperApp/Segments/SegmentStore.swift#SegmentStore.reset
  it("start as one piece covering the part", () => {
    const part = openPart(bytes, "region.bin");

    const pieces = segmentsFor(part)?.segments ?? [];
    expect(pieces.map((piece) => [piece.start, piece.end])).toEqual([[0, 0x200]]);
  });

  it("take a cut, and give it back on undo", () => {
    const part = openPart(bytes, "region.bin");

    expect(applySegments(part, (partition) => partition.addCut(0x100))).toBe(true);
    expect(segmentsFor(part)?.segments.map((piece) => piece.start)).toEqual([0, 0x100]);

    expect(undoSegments(part)).toBe(true);
    expect(segmentsFor(part)?.segments.map((piece) => piece.start)).toEqual([0]);
  });

  it("go when the part closes", () => {
    const part = openPart(bytes, "region.bin");
    closePart(part);

    expect(segmentsFor(part)).toBeUndefined();
  });
});
