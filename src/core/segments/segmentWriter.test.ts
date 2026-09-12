import { describe, expect, it, vi } from "vitest";
import { type Segmentation, wholeFile } from "@/core/segments/segmentation";
import {
  type Part,
  type PartSink,
  type PartStream,
  partsFor,
  previewWrite,
  SegmentWriteCancelled,
  writeParts,
  writeTitle,
} from "@/core/segments/segmentWriter";
import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";
import { ContentUnreadable } from "@/core/storage/contentStream";
import { asArray, countingBytes, storageOver } from "@/core/testing/support";

/**
 * Ported from `SegmentSaveTests.swift`, which drives the whole flow through
 * `MainViewController` — the panels, the confirmation, the write. The panels
 * are the platform layer's and arrive with it; what is testable here is what
 * upstream's tests actually assert about the *bytes and names*: which range
 * becomes which file, what the preview says, and that a failure publishes
 * nothing.
 */

/** A sink that stages in memory and publishes only on commit. */
class RecordingSink implements PartSink {
  readonly published = new Map<string, number[]>();
  readonly staged = new Map<string, number[]>();
  readonly finished: string[] = [];
  discarded = false;
  /** The part whose stream throws on its first write. */
  failOn: string | undefined;

  open(part: Part): Promise<PartStream> {
    const bytes: number[] = [];
    this.staged.set(part.name, bytes);
    const stream: PartStream = {
      write: async (chunk: Bytes) => {
        if (this.failOn === part.name) throw new Error("the disk is full");
        bytes.push(...chunk);
      },
      finish: async () => {
        this.finished.push(part.name);
      },
    };
    return Promise.resolve(stream);
  }

  async commit(): Promise<void> {
    for (const [name, bytes] of this.staged) this.published.set(name, bytes);
  }

  async discard(): Promise<void> {
    this.discarded = true;
    this.staged.clear();
  }
}

/** A partition of `size` cut at every offset given. A refused cut is a bug in the test. */
const partitionOf = (size: number, ...cuts: number[]): Segmentation =>
  cuts.reduce((partition, cut) => {
    const next = partition.addCut(cut);
    if (next === undefined) throw new Error(`the fixture's cut at ${cut} was refused`);
    return next;
  }, wholeFile(size));

const segmentsOf = (size: number, ...cuts: number[]) => partitionOf(size, ...cuts).segments;

describe("the parts a partition becomes", () => {
  // Upstream: `testSaveAllPreviewsEveryPartWithItsNameAndSize` — one file per
  // piece, named `<base>_S<i>.bin` in file order.
  it("is one file per piece, named for the document", () => {
    expect(partsFor(segmentsOf(16, 8), "bios.bin")).toEqual([
      { start: 0, end: 8, name: "bios.bin_S0.bin" },
      { start: 8, end: 16, name: "bios.bin_S1.bin" },
    ]);
  });

  // Upstream: `testSaveAllNamesThePiecesAfterARenamedUnsavedPane` — the base is
  // the name the header shows, so renaming an unsaved pane is how its pieces
  // get one. Without it every copy's pieces arrive as `Untitled_S0.bin` and the
  // second copy's overwrite the first's.
  it("takes its base name from whatever the pane is called", () => {
    expect(partsFor(segmentsOf(16, 8), "patched").map((part) => part.name)).toEqual([
      "patched_S0.bin",
      "patched_S1.bin",
    ]);
  });

  // A piece the user named keeps its position in the file, and a name with a
  // slash in it is not a file name.
  it("names the file after the label, not the piece's own name", () => {
    const partition = partitionOf(16, 8).rename(1, "boot/region");
    expect(partsFor(partition.segments, "bios").map((part) => part.name)).toEqual([
      "bios_S0.bin",
      "bios_S1.bin",
    ]);
  });
});

describe("the preview shown before anything is written", () => {
  // Upstream asserts `S0 → bios.bin_S0.bin (8 B)` appears in the confirmation.
  it("names every part with its file name and size", () => {
    const preview = previewWrite(partsFor(segmentsOf(16, 8), "bios.bin"));
    expect(preview.lines).toEqual(["S0 → bios.bin_S0.bin (8 B)", "S1 → bios.bin_S1.bin (8 B)"]);
    expect(preview.replacing).toEqual([]);
  });

  // Upstream: `testSaveAllConfirmsTheFilesItWouldReplace` — the one
  // confirmation names the files that would be replaced, before the write.
  it("names the files it would replace, and only those", () => {
    const preview = previewWrite(partsFor(segmentsOf(16, 8), "bios.bin"), ["bios.bin_S0.bin"]);
    expect(preview.replacing).toEqual(["bios.bin_S0.bin"]);
  });

  it("asks the question in the plural only when it means it", () => {
    expect(writeTitle(1)).toBe("Save 1 Segment?");
    expect(writeTitle(2)).toBe("Save 2 Segments?");
  });
});

describe("the write", () => {
  it("puts each piece's own bytes under its own name", async () => {
    const storage = storageOver(countingBytes(16));
    const sink = new RecordingSink();

    await writeParts(partsFor(segmentsOf(16, 8), "bios"), storage, sink);

    expect([...sink.published.keys()]).toEqual(["bios_S0.bin", "bios_S1.bin"]);
    expect(sink.published.get("bios_S0.bin")).toEqual(asArray(countingBytes(8)));
    expect(sink.published.get("bios_S1.bin")).toEqual(asArray(countingBytes(8, 8)));
  });

  it("streams a large piece in bounded chunks rather than reading it whole", async () => {
    const storage = storageOver(countingBytes(4096));
    const sink = new RecordingSink();
    const reads: number[] = [];
    const counting: ByteStorage = {
      size: storage.size,
      read: (at, length) => {
        reads.push(length);
        return storage.read(at, length);
      },
      peek: (at, length) => storage.peek(at, length),
      prefetch: (at, length) => storage.prefetch(at, length),
    };

    await writeParts([{ start: 0, end: 4096, name: "part" }], counting, sink, { chunkSize: 1024 });

    expect(reads).toEqual([1024, 1024, 1024, 1024]);
    expect(sink.published.get("part")?.length).toBe(4096);
  });

  it("reports progress over the whole set, not over each part", async () => {
    const storage = storageOver(countingBytes(16));
    const onProgress = vi.fn();

    await writeParts(partsFor(segmentsOf(16, 8), "bios"), storage, new RecordingSink(), {
      chunkSize: 8,
      onProgress,
    });

    expect(onProgress.mock.calls.map(([fraction]) => fraction)).toEqual([0.5, 1]);
  });

  // Nothing to write is not a write: the destination is not touched at all.
  it("does not touch the destination when there is nothing to write", async () => {
    const sink = new RecordingSink();
    const commit = vi.spyOn(sink, "commit");

    await writeParts(partsFor(wholeFile(0).segments, "empty"), storageOver(new Uint8Array()), sink);

    expect(commit).not.toHaveBeenCalled();
    expect(sink.published.size).toBe(0);
  });
});

describe("all or nothing", () => {
  // The whole of the guarantee: a failure on part three never leaves parts one
  // and two published, looking exactly like a complete set.
  it("publishes nothing when a later part fails", async () => {
    const storage = storageOver(countingBytes(24));
    const sink = new RecordingSink();
    sink.failOn = "bios_S2.bin";

    await expect(
      writeParts(partsFor(segmentsOf(24, 8, 16), "bios"), storage, sink)
    ).rejects.toThrow("the disk is full");

    expect(sink.discarded).toBe(true);
    expect(sink.published.size).toBe(0);
  });

  it("publishes nothing when the write is cancelled part-way", async () => {
    const storage = storageOver(countingBytes(24));
    const sink = new RecordingSink();
    let checks = 0;

    await expect(
      writeParts(partsFor(segmentsOf(24, 8, 16), "bios"), storage, sink, {
        shouldCancel: () => ++checks > 2,
      })
    ).rejects.toThrow(SegmentWriteCancelled);

    expect(sink.discarded).toBe(true);
    expect(sink.published.size).toBe(0);
  });

  // Once every part is staged the commit runs to the end. Upstream measured the
  // alternative: cancelling during the renames published a *prefix* of the set
  // and reported a cancelled write.
  it("does not cancel once every part is staged", async () => {
    const storage = storageOver(countingBytes(16));
    const sink = new RecordingSink();

    await writeParts(partsFor(segmentsOf(16, 8), "bios"), storage, sink, {
      // True from the moment the last part is finished onwards.
      shouldCancel: () => sink.finished.length === 2,
    });

    expect(sink.published.size).toBe(2);
    expect(sink.discarded).toBe(false);
  });

  // A short read means the content shrank under us. Publishing the part anyway
  // would put a truncated piece on disk under its own name, with no error at
  // all — upstream measured a 3 MB part coming out 1 MB.
  it("refuses a short read rather than publishing a truncated piece", async () => {
    const truncating: ByteStorage = {
      size: 16,
      read: async () => new Uint8Array(4) as Bytes,
      peek: () => undefined,
      prefetch: async () => undefined,
    };
    const sink = new RecordingSink();

    await expect(
      writeParts([{ start: 0, end: 16, name: "part" }], truncating, sink, { chunkSize: 8 })
    ).rejects.toThrow(ContentUnreadable);

    expect(sink.discarded).toBe(true);
    expect(sink.published.size).toBe(0);
  });
});
