/// <reference lib="webworker" />

import { NO_BASELINE } from "@/core/segments/baseline";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import { buildOverviewRows, OverviewCancelled } from "@/render/minimap/overviewBuild";
import type { MinimapWorkerRequest, MinimapWorkerResponse } from "@/workers/protocol";

/**
 * The overview's density pass, off the main thread.
 *
 * One read per pixel row of the picture — a couple of thousand reads over the
 * whole file — which is why it cannot run per repaint and why it is worth a
 * worker at all. Progress is reported as rows finish, and a superseded build is
 * abandoned mid-file rather than run to completion nobody is waiting for.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

let cancelledId: number | undefined;
let runningId: number | undefined;

/** Often enough for a bar to move, rare enough to cost nothing. */
const REPORT_EVERY_MS = 100;

scope.addEventListener("message", (event: MessageEvent<MinimapWorkerRequest>) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelledId = request.id;
    return;
  }
  // A new picture supersedes the one being built: its rows are already stale.
  if (runningId !== undefined) cancelledId = runningId;
  void run(request);
});

async function run(request: Extract<MinimapWorkerRequest, { kind: "overview" }>): Promise<void> {
  runningId = request.id;
  const storage = new FileBackedStorage(request.file, new ChunkCache());

  try {
    let done = 0;
    let lastReported = 0;
    const built = await buildOverviewRows(
      // The density pass alone: the masks are rebuilt on the main thread from
      // the pane's baseline, which the worker cannot hold.
      { size: storage.size, storage, baseline: NO_BASELINE },
      request.extent,
      request.rowCount,
      { from: 0, to: request.rowCount },
      {
        shouldCancel: () => cancelledId === request.id,
        onRows: (rows) => {
          done += rows;
          const now = Date.now();
          if (now - lastReported < REPORT_EVERY_MS) return;
          lastReported = now;
          post({
            kind: "overviewProgress",
            id: request.id,
            fraction: Math.min(1, done / Math.max(1, request.rowCount)),
          });
        },
      }
    );
    if (built === undefined) {
      post({ kind: "cancelled", id: request.id });
      return;
    }

    const density = built.density;
    post(
      {
        kind: "overviewDone",
        id: request.id,
        extent: request.extent,
        rowCount: request.rowCount,
        density,
      },
      [density.buffer]
    );
  } catch (error) {
    if (error instanceof OverviewCancelled) post({ kind: "cancelled", id: request.id });
    else {
      post({
        kind: "error",
        id: request.id,
        message: error instanceof Error ? error.message : "The minimap could not be built.",
      });
    }
  } finally {
    if (runningId === request.id) runningId = undefined;
  }
}

function post(response: MinimapWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(response, transfer);
}
