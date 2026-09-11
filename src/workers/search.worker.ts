/// <reference lib="webworker" />

import { MatchSetBuilder } from "@/core/search/matchSet";
import { findOne, SearchCancelled, scanAll } from "@/core/search/searchEngine";
import type { SearchPattern } from "@/core/search/searchPattern";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import type {
  JobId,
  SearchIndexed,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "@/workers/protocol";

/**
 * Searching, off the main thread.
 *
 * It answers twice. First the match itself, found by scanning from the caret —
 * which is what a person is waiting for, and takes about a millisecond. Then
 * the index, streamed in behind it, which is what the greys, the count and the
 * results panel need and which for a common byte takes a hundred times longer.
 *
 * The partial index is published as it goes, so a dump greys in file order
 * while the scan is still running rather than staying blank until it finishes.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

let cancelledId: JobId | undefined;
let runningId: JobId | undefined;

/** How often a partial index is published while the scan runs. */
const PUBLISH_EVERY_MS = 120;

scope.addEventListener("message", (event: MessageEvent<SearchWorkerRequest>) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelledId = request.id;
    return;
  }
  // A new search supersedes the one in flight: its answer is already stale.
  if (runningId !== undefined) cancelledId = runningId;
  void run(request);
});

async function run(request: Extract<SearchWorkerRequest, { kind: "search" }>): Promise<void> {
  runningId = request.id;
  const storage = new FileBackedStorage(request.file, new ChunkCache());
  const cancelled = () => cancelledId === request.id;

  try {
    // The match first, always — and from the file's other end when the scan
    // from the caret finds nothing, so "not found" means nowhere in the file.
    const here = await findOne(request.pattern, storage, {
      from: request.from,
      direction: request.direction,
      folding: request.folding,
      shouldCancel: cancelled,
    });
    const wrappedFrom = request.direction === "forward" ? 0 : storage.size;
    const match =
      here ??
      (await findOne(request.pattern, storage, {
        from: wrappedFrom,
        direction: request.direction,
        folding: request.folding,
        shouldCancel: cancelled,
      }));

    post({
      kind: "first",
      id: request.id,
      ...(match === undefined ? {} : { match }),
      wrapped: here === undefined && match !== undefined,
    });

    if (!request.index || match === undefined) {
      if (runningId === request.id) runningId = undefined;
      return;
    }

    const pattern: SearchPattern = {
      bytes: request.patternBytes,
      encoding: request.encoding,
    };
    const builder = new MatchSetBuilder(pattern, request.folding, storage.size);
    let indexedUpTo = 0;
    let lastPublished = 0;

    await scanAll(request.pattern, storage, {
      folding: request.folding,
      shouldCancel: cancelled,
      onMatches: (starts) => builder.add(starts),
      onWindow: (upTo) => {
        indexedUpTo = upTo;
        const now = Date.now();
        if (now - lastPublished < PUBLISH_EVERY_MS) return;
        lastPublished = now;
        publish(request.id, builder.snapshot(indexedUpTo));
      },
      onProgress: (fraction) => post({ kind: "searchProgress", id: request.id, fraction }),
    });

    publish(request.id, builder.finish());
  } catch (error) {
    if (error instanceof SearchCancelled) post({ kind: "cancelled", id: request.id });
    else {
      post({
        kind: "error",
        id: request.id,
        message: error instanceof Error ? error.message : "The search failed.",
      });
    }
  } finally {
    if (runningId === request.id) runningId = undefined;
  }
}

/**
 * Sends a set across.
 *
 * The representation goes as it is: starts for a sparse set, the raw words for
 * a bitmap. Rebuilding a bitmap from a list of four million starts on the other
 * side would cost more than finding them did.
 */
function publish(id: JobId, set: ReturnType<MatchSetBuilder["finish"]>): void {
  const base = {
    kind: "indexed" as const,
    id,
    extent: set.extent,
    total: set.total,
    indexedUpTo: set.indexedUpTo,
  };

  if (set.storage.kind === "sparse") {
    const starts = set.storage.starts.slice();
    const message: SearchIndexed = { ...base, starts, countedOnly: false };
    post(message, [starts.buffer]);
    return;
  }
  if (set.storage.kind === "bitmap") {
    const words = set.storage.bitmap.rawWords.slice();
    const message: SearchIndexed = { ...base, bitmapWords: words, countedOnly: false };
    post(message, [words.buffer]);
    return;
  }
  post({ ...base, countedOnly: true });
}

function post(response: SearchWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(response, transfer);
}
