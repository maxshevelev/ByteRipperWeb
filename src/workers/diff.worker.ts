/// <reference lib="webworker" />

import { DiffCancelled, scanDiff } from "@/core/diff/diffEngine";
import { DiffHunkIndex } from "@/core/diff/diffHunkIndex";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { StorageError } from "@/core/storage/storageError";
import {
  type DiffDone,
  type DiffWorkerRequest,
  type DiffWorkerResponse,
  type JobId,
  transferablesOf,
} from "@/workers/protocol";

/**
 * The comparison, off the main thread.
 *
 * A full scan of two 64 MB dumps is thirty milliseconds of solid work — two
 * dropped frames if it ran where the grid is drawn, and a hundred of them on a
 * machine a tenth as fast. It runs here instead, reports progress as it goes,
 * and stops within one chunk of being told to.
 *
 * Only one job runs at a time. A second `diff` request cancels the first: the
 * inputs have changed, so its answer is already wrong.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** The job currently running, if any. Read by the scan between chunks. */
let runningId: JobId | undefined;
let cancelledId: JobId | undefined;

scope.addEventListener("message", (event: MessageEvent<DiffWorkerRequest>) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelledId = request.id;
    return;
  }
  // A new job supersedes whatever is in flight: its inputs are stale.
  if (runningId !== undefined) cancelledId = runningId;
  void run(request);
});

async function run(request: Extract<DiffWorkerRequest, { kind: "diff" }>): Promise<void> {
  runningId = request.id;

  // A chunk cache is keyed by chunk index alone, so each side gets its own —
  // one shared between the two files would serve the wrong file's bytes.
  const left = new FileBackedStorage(request.left, new ChunkCache());
  const right = new FileBackedStorage(request.right, new ChunkCache());

  try {
    const index = await scanDiff(left, right, {
      ...(request.chunkSize === undefined ? {} : { chunkSize: request.chunkSize }),
      shouldCancel: () => cancelledId === request.id,
      onProgress: (fraction) => post({ kind: "progress", id: request.id, fraction }),
    });

    const hunks = DiffHunkIndex.from(index, request.gap);
    const flattened = new Float64Array(hunks.count * 2);
    for (let i = 0; i < hunks.count; i++) {
      const hunk = hunks.hunks[i];
      if (hunk === undefined) continue;
      flattened[i * 2] = hunk.start;
      flattened[i * 2 + 1] = hunk.end;
    }

    const done: DiffDone = {
      kind: "done",
      id: request.id,
      leftSize: index.leftSize,
      rightSize: index.rightSize,
      ...columnsOf(index),
      hunks: flattened,
      gap: request.gap,
      differingBytes: index.differingBytes,
    };
    post(done, transferablesOf(done));
  } catch (error) {
    if (error instanceof DiffCancelled) {
      post({ kind: "cancelled", id: request.id });
    } else if (error instanceof StorageError) {
      post({ kind: "error", id: request.id, message: error.message, code: error.code });
    } else {
      post({
        kind: "error",
        id: request.id,
        message: error instanceof Error ? error.message : "The comparison failed.",
      });
    }
  } finally {
    if (runningId === request.id) runningId = undefined;
  }
}

/**
 * The index's columns, copied out of it.
 *
 * The index owns its arrays and a transfer would detach them, so the copy is
 * deliberate: the worker keeps nothing after a job anyway, but a detached array
 * inside a live object is the kind of bug that surfaces three milestones later.
 */
function columnsOf(index: {
  blockCount: number;
  block: (i: number) => { kind: "same" | "different"; start: number; end: number } | undefined;
}): { starts: Float64Array; ends: Float64Array; kinds: Uint8Array } {
  const starts = new Float64Array(index.blockCount);
  const ends = new Float64Array(index.blockCount);
  const kinds = new Uint8Array(index.blockCount);
  for (let i = 0; i < index.blockCount; i++) {
    const block = index.block(i);
    if (block === undefined) continue;
    starts[i] = block.start;
    ends[i] = block.end;
    kinds[i] = block.kind === "same" ? 0 : 1;
  }
  return { starts, ends, kinds };
}

function post(response: DiffWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(response, transfer);
}
