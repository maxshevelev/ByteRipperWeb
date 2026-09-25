/**
 * Ported from `SegmentLinkTests.swift` — the app-flow half of §21.7: what a
 * join does to the links, what the image it leaves is painted against, and
 * what a save changes and does not.
 *
 * What upstream drives through `PaneViewModel` and its save panel, the web
 * drives through the workspace store; the save panel is the platform layer's,
 * so the one test that needs "after a save" drives the state a save leaves
 * directly, the way `segmentReplacer.test.ts` drives a swap through the
 * document rather than through an open panel.
 *
 * The partition follows the document here the way the shell makes it: without
 * the shell's `onEdit` wiring a join's insert would leave the partition behind
 * and the seam's cut would be refused.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ByteSource } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import type { OpenedFile } from "@/platform/files/openedFile";
import type { Segment } from "@/core/segments/segmentation";
import { applySegments, noteSegmentEdit, segmentsFor } from "@/state/segmentsStore";
import {
  baselineFor,
  baselineMarksAnything,
  baselineReferenceAt,
  clearSources,
  segmentSource,
} from "@/state/segmentSources";
import { forgetActs, undoLast } from "@/state/undoRouter";
import {
  editingHooks,
  joinIntoPane,
  openEmptyInPane,
  openInPane,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";

const file = (name: string, bytes: Uint8Array<ArrayBuffer>): OpenedFile => ({
  name,
  size: bytes.length,
  lastModified: 0,
  source: new Blob([bytes]),
});

const donorStorage = (source: ByteSource) =>
  new FileBackedStorage(source, new ChunkCache());

const pieces = (pane: "a") => segmentsFor(pane)?.segments ?? [];

const piece = (index: number): Segment => {
  const found = pieces("a")[index];
  if (found === undefined) throw new Error(`the pane has no piece at ${index}`);
  return found;
};

/**
 * Whether the byte at `offset` reads as modified against the pane's baseline,
 * the way a hex row asks of it: the reference the byte is measured against,
 * read from its storage, compared with the document's byte.
 */
const modifiedAt = async (offset: number): Promise<boolean> => {
  const document = paneState("a")?.document;
  if (document === undefined) throw new Error("the pane is not open");
  const reference = baselineReferenceAt(baselineFor("a"), offset);
  if (reference.kind === "beyond") return true;
  if (reference.kind === "unmarked") return false;
  const mine = await document.read(offset, 1);
  const theirs = await reference.span.storage.read(reference.sourceAt, 1);
  return mine[0] !== theirs[0];
};

beforeEach(() => {
  editingHooks.onEdit = (pane, edit) => {
    noteSegmentEdit(pane, edit, paneState(pane)?.document.size ?? 0);
  };
});

afterEach(() => {
  editingHooks.onEdit = undefined;
  clearSources("a");
  clearSources("b");
  forgetActs("a");
  forgetActs("b");
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
  }));
});

// @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testAJoinLinksBothSides
describe("a join links both sides", () => {
  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testAJoinLinksBothSides
  it("links both the donor's piece and the pane's own content to their files", async () => {
    const original = file("chip1.bin", new Uint8Array(16).fill(0xaa));
    const donor = file("chip2.bin", new Uint8Array(8).fill(0xbb));
    openInPane("a", original);
    await joinIntoPane({
      pane: "a",
      source: donorStorage(donor.source),
      sourceName: donor.name,
      position: "end",
      sourceFile: donor,
    });

    expect(pieces("a").length).toBe(2);
    expect(
      segmentSource("a", piece(0))?.name,
      "the content the pane already held is linked to the file it came from"
    ).toBe("chip1.bin");
    expect(piece(0).link?.start).toBe(0);
    expect(piece(0).link?.end).toBe(16);
    expect(segmentSource("a", piece(1))?.name).toBe("chip2.bin");
    expect(piece(1).link?.start).toBe(0);
    expect(piece(1).link?.end).toBe(8);
  });

  // An append names and links the *last* piece, whichever piece the seam's cut
  // split — not piece 1, which is only the last one in a dump that was never
  // cut (§21.7). The old seam cut renamed piece 0 to the pane's name and linked
  // a piece that was not the joined bytes; this is the pinning test.
  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testAnAppendLinksTheLastPieceOfAPartitionedDump
  it("names and links the last piece of a dump that was cut before the join", async () => {
    const original = file("chip1.bin", new Uint8Array(16).fill(0xaa));
    const donor = file("chip2.bin", new Uint8Array(8).fill(0xbb));
    openInPane("a", original);
    expect(applySegments("a", (partition) => partition.addCut(8)), "the dump is cut before the join").toBe(
      true
    );
    await joinIntoPane({
      pane: "a",
      source: donorStorage(donor.source),
      sourceName: donor.name,
      position: "end",
      sourceFile: donor,
    });

    expect(pieces("a").length).toBe(3);
    expect(
      piece(2).name,
      "the joined bytes are the last piece, and wear the donor's name"
    ).toBe("chip2.bin");
    expect(segmentSource("a", piece(2))?.name).toBe("chip2.bin");
    expect(piece(2).link?.start).toBe(0);
    expect(piece(2).link?.end).toBe(8);
    expect(
      piece(1).name,
      "the pane's own pieces keep the names they had"
    ).toBe("");
  });

  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testUndoingAJoinTakesTheLinksWithIt
  it("takes the links with it when the join is undone", async () => {
    const original = file("chip1.bin", new Uint8Array(16).fill(0xaa));
    const donor = file("chip2.bin", new Uint8Array(8).fill(0xbb));
    openInPane("a", original);
    await joinIntoPane({
      pane: "a",
      source: donorStorage(donor.source),
      sourceName: donor.name,
      position: "end",
      sourceFile: donor,
    });

    expect(await undoLast("a", false)).toBe(true);

    const parts = pieces("a");
    expect(parts.length).toBe(1);
    expect(parts[0]?.link, "the pane is attached to its file again, so nothing needs a link").toBeUndefined();
    expect(paneState("a")?.untitled).toBe(false);
  });
});

// @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testAJoinedImagePaintsEachHalfAgainstItsOwnFile
describe("what the bytes are painted against", () => {
  // The bug this feature exists for: an image a join left had no baseline at
  // all, so a patch in it was not painted modified. Now each half is measured
  // against its own file (§21.7).
  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testAJoinedImagePaintsEachHalfAgainstItsOwnFile
  it("paints each half of a joined image against its own file", async () => {
    const original = file("chip1.bin", new Uint8Array(16).fill(0xaa));
    const donor = file("chip2.bin", new Uint8Array(8).fill(0xbb));
    openInPane("a", original);
    await joinIntoPane({
      pane: "a",
      source: donorStorage(donor.source),
      sourceName: donor.name,
      position: "end",
      sourceFile: donor,
    });
    expect(
      paneState("a")?.saved,
      "a join leaves an image with no file of its own"
    ).toBeUndefined();
    expect(
      baselineMarksAnything(baselineFor("a")),
      "and it is still painted against something"
    ).toBe(true);

    // A byte patched in each half.
    const document = paneState("a")?.document;
    if (document === undefined) throw new Error("the pane is not open");
    await document.overwrite(2, new Uint8Array([0x01]));
    await document.overwrite(20, new Uint8Array([0x02]));

    expect(await modifiedAt(2), "the patch in the first chip's half is red").toBe(true);
    expect(await modifiedAt(20), "and so is the one in the second chip's").toBe(true);
    expect(await modifiedAt(3), "bytes that still match their source are not").toBe(false);
    expect(await modifiedAt(19)).toBe(false);
  });

  // Once the image has a file of its own, that file answers the question again:
  // red means "not saved yet", and the links stay for everything else (§21.7).
  // The save panel is the platform layer's — in a test the save route is a
  // download that leaves the pane where it was — so the test drives the state
  // a save leaves: the pane attached to a file that now holds the image.
  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testSavingHandsTheBaselineBackToTheSavedFile
  it("hands the baseline back to the saved file once the image is saved", async () => {
    const original = file("chip1.bin", new Uint8Array(16).fill(0xaa));
    const donor = file("chip2.bin", new Uint8Array(8).fill(0xbb));
    openInPane("a", original);
    await joinIntoPane({
      pane: "a",
      source: donorStorage(donor.source),
      sourceName: donor.name,
      position: "end",
      sourceFile: donor,
    });
    const document = paneState("a")?.document;
    if (document === undefined) throw new Error("the pane is not open");
    await document.overwrite(2, new Uint8Array([0x01]));

    // What a save leaves: the pane attached to a file that holds the image.
    const bytes = new Uint8Array(await document.read(0, document.size));
    const saved = new FileBackedStorage(new Blob([bytes]), new ChunkCache());
    workspaceStore.update((state) => {
      const current = state.panes.a;
      if (current === undefined) return state;
      return {
        ...state,
        panes: {
          ...state.panes,
          a: { ...current, name: "chip1-2.bin", saved, untitled: false },
        },
      };
    });

    expect(
      await modifiedAt(2),
      "the patch is on disk now, so nothing is unsaved"
    ).toBe(false);
    expect(pieces("a")[0]?.link, "but the piece still knows where its bytes came from").toBeDefined();
  });

  // A piece nothing brought in is never painted modified in an untitled image
  // — the rule an untitled document always followed (§21.7).
  // @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testAPieceWithNoLinkIsUnmarkedInAnUntitledImage
  it("leaves a piece with no link unmarked in an untitled image", async () => {
    openEmptyInPane("a");
    const document = paneState("a")?.document;
    if (document === undefined) throw new Error("the pane is not open");
    // The bytes go in as the shell would put them: one edit, the partition moved
    // with it.
    await document.insert(0, new Uint8Array(16).fill(0xaa));
    noteSegmentEdit("a", { kind: "insert", at: 0, length: 16 }, 16);

    const donor = file("chip2.bin", new Uint8Array(8).fill(0xbb));
    await joinIntoPane({
      pane: "a",
      source: donorStorage(donor.source),
      sourceName: donor.name,
      position: "end",
      sourceFile: donor,
    });

    expect(
      await modifiedAt(2),
      "the bytes that came from nowhere are unmarked"
    ).toBe(false);
    expect(await modifiedAt(19), "and the donor's still match its file").toBe(false);
    await document.overwrite(19, new Uint8Array([0x02]));
    expect(
      await modifiedAt(19),
      "a patch in the donor's half is measured against the donor"
    ).toBe(true);
  });
});
