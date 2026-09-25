/**
 * Ported from `SegmentLinkTests.swift` — the Revert Segment half of §21.7:
 * what the link's standing says, and what a revert puts back.
 *
 * Upstream drives these through `PaneViewModel.revertSegment` and the
 * length-change question in `MainViewController.revertPiece`; the web drives
 * them through the command, which asks and swaps in one step. The one test
 * that upstream expresses as a throw (`…RefusesALengthChange`) is expressed
 * here as the question being declined: a refused length change changes nothing.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ByteSource } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import type { OpenedFile } from "@/platform/files/openedFile";
import type { Segment } from "@/core/segments/segmentation";
import { noteSegmentEdit, segmentsFor } from "@/state/segmentsStore";
import { clearSources, segmentLinkState } from "@/state/segmentSources";
import { forgetActs } from "@/state/undoRouter";
import {
  editingHooks,
  joinIntoPane,
  openInPane,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";
import { revertPiece, segmentAsks } from "@/ui/segments/segmentCommands";

const file = (name: string, bytes: Uint8Array<ArrayBuffer>): OpenedFile => ({
  name,
  size: bytes.length,
  lastModified: 0,
  source: new Blob([bytes]),
});

const donorStorage = (source: ByteSource) => new FileBackedStorage(source, new ChunkCache());

const pieces = (pane: "a") => segmentsFor(pane)?.segments ?? [];

const piece = (index: number): Segment => {
  const found = pieces("a")[index];
  if (found === undefined) throw new Error(`the pane has no piece at ${index}`);
  return found;
};

const document = (): NonNullable<ReturnType<typeof paneState>>["document"] => {
  const doc = paneState("a")?.document;
  if (doc === undefined) throw new Error("the pane is not open");
  return doc;
};

/** A delete the shell would make: the bytes go and the partition moves with them. */
const deleteBytes = async (start: number, end: number) => {
  const size = document().size;
  await document().delete(start, end);
  noteSegmentEdit("a", { kind: "delete", start, end }, size - (end - start));
};

/** An insert the shell would make: the bytes come and the partition moves with them. */
const insertBytes = async (at: number, bytes: Uint8Array) => {
  const size = document().size;
  await document().insert(at, bytes);
  noteSegmentEdit("a", { kind: "insert", at, length: bytes.length }, size + bytes.length);
};

beforeEach(() => {
  // The partition follows the document here the way the shell makes it.
  editingHooks.onEdit = (pane, edit) => {
    noteSegmentEdit(pane, edit, paneState(pane)?.document.size ?? 0);
  };
});

afterEach(() => {
  editingHooks.onEdit = undefined;
  segmentAsks.lengthChange = undefined;
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

// @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testTheLinkStateFollowsThePiece
it("the link's state follows the piece", async () => {
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

  expect(await segmentLinkState("a", piece(1))).toEqual({ kind: "matching" });

  // A patched piece no longer is what its file holds.
  await document().overwrite(20, new Uint8Array([0x02]));
  expect(await segmentLinkState("a", piece(1))).toEqual({ kind: "edited" });

  // And an insert leaves it longer than the stretch it came from.
  await insertBytes(20, new Uint8Array([0x03]));
  expect(await segmentLinkState("a", piece(1))).toEqual({
    kind: "lengthChanged",
    pieceLength: 9,
    sourceLength: 8,
  });
});

// @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testRevertSegmentPutsThePieceBack
it("a same-length revert puts the piece back", async () => {
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
  await document().overwrite(20, new Uint8Array([0x02]));

  await revertPiece("a", piece(1));

  expect(await document().read(20, 1)).toEqual(new Uint8Array([0xbb]));
  expect(await segmentLinkState("a", piece(1))).toEqual({ kind: "matching" });
  expect(piece(1).link, "the bytes are still that file's").toBeDefined();
  expect(document().size, "a same-length revert moves nothing").toBe(24);
});

// @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testRevertSegmentRestoresTheSourcesLength
it("a revert that restores the source's length moves the closing cut with it", async () => {
  const original = file("chip1.bin", new Uint8Array(16).fill(0xaa));
  const donor = file("chip2.bin", new Uint8Array(8).fill(0xbb));
  openInPane("a", original);
  // The donor goes in at the start, so there is a piece after it to move.
  await joinIntoPane({
    pane: "a",
    source: donorStorage(donor.source),
    sourceName: donor.name,
    position: "start",
    sourceFile: donor,
  });
  // Four bytes cut out of the donor's half: it is now shorter than its file.
  await deleteBytes(2, 6);
  expect(piece(0).start).toBe(0);
  expect(piece(0).end).toBe(4);

  segmentAsks.lengthChange = async () => true; // Restore Length
  await revertPiece("a", piece(0));

  expect(document().size, "the four bytes are back").toBe(24);
  expect([piece(0).start, piece(0).end], "they belong to the piece that was reverted").toEqual([
    0, 8,
  ]);
  expect([piece(1).start, piece(1).end]).toEqual([8, 24]);
  expect(await document().read(0, 8)).toEqual(new Uint8Array(8).fill(0xbb));
  expect(await segmentLinkState("a", piece(0))).toEqual({ kind: "matching" });
});

// @upstream ByteRipperTests/SegmentLinkTests.swift#SegmentLinkTests.testRevertSegmentRefusesALengthChangeItWasNotAllowed
it("a length change it was not allowed changes nothing", async () => {
  const original = file("chip1.bin", new Uint8Array(16).fill(0xaa));
  const donor = file("chip2.bin", new Uint8Array(8).fill(0xbb));
  openInPane("a", original);
  await joinIntoPane({
    pane: "a",
    source: donorStorage(donor.source),
    sourceName: donor.name,
    position: "start",
    sourceFile: donor,
  });
  await deleteBytes(2, 6);

  // The question is asked and declined: the same refusal a replace makes.
  let asked = false;
  segmentAsks.lengthChange = async () => {
    asked = true;
    return false;
  };
  await revertPiece("a", piece(0));

  expect(asked, "a mismatch is a question, not a quiet refusal").toBe(true);
  expect(document().size, "nothing moved").toBe(20);
  expect([piece(0).start, piece(0).end]).toEqual([0, 4]);
  expect(await segmentLinkState("a", piece(0))).toEqual({
    kind: "lengthChanged",
    pieceLength: 4,
    sourceLength: 8,
  });
});
