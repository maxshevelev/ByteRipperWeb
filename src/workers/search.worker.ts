/// <reference lib="webworker" />

import { ByteFindContent } from "@/core/search/byteFindContent";
import { SearchCancelled } from "@/core/search/searchEngine";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import type {
  JobId,
  SearchFirstMatchRequest,
  SearchMatchStartsRequest,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "@/workers/protocol";

/**
 * A file's scans, off the main thread: the two a search's content asks for (`FindContent`) —
 * the first match from a place, and every match in batches — each a request of its own.
 *
 * What a search does with them — the pass round the end and through the encodings, the index
 * built from the batches, the steps — is the page's `FindIndexer`, one per pane. So several
 * requests run here at once, each stopped by its own id: a search in one pane never stops the
 * search in another.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** The jobs asked to stop, until they have. */
const cancelled = new Set<JobId>();

/** How often a scan's batch of starts is sent while it runs. */
const POST_EVERY_MS = 50;

scope.addEventListener("message", (event: MessageEvent<SearchWorkerRequest>) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelled.add(request.id);
    return;
  }
  void (request.kind === "firstMatch" ? firstMatch(request) : matchStarts(request)).finally(() =>
    cancelled.delete(request.id)
  );
});

/** The file's bytes as the dump's search scans them: the page's own `ByteFindContent`. */
const contentOf = (file: Blob) =>
  new ByteFindContent(new FileBackedStorage(file, new ChunkCache()));

async function firstMatch(request: SearchFirstMatchRequest): Promise<void> {
  try {
    const match = await contentOf(request.file).firstMatch(
      request.query,
      request.from,
      request.direction,
      () => cancelled.has(request.id),
      (fraction) => post({ kind: "searchProgress", id: request.id, fraction })
    );
    post({ kind: "first", id: request.id, ...(match === undefined ? {} : { match }) });
  } catch (error) {
    fail(request.id, error);
  }
}

async function matchStarts(request: SearchMatchStartsRequest): Promise<void> {
  const content = contentOf(request.file);
  let pending: number[] = [];
  let lastPosted = 0;
  const send = (scannedUpTo: number) => {
    const starts = Float64Array.from(pending);
    pending = [];
    lastPosted = Date.now();
    post({ kind: "batch", id: request.id, starts, scannedUpTo }, [starts.buffer]);
  };
  try {
    let covered = 0;
    for await (const batch of content.matchStarts(
      request.query,
      () => cancelled.has(request.id),
      (fraction) => post({ kind: "searchProgress", id: request.id, fraction })
    )) {
      for (let index = 0; index < batch.starts.length; index++) {
        pending.push(batch.starts[index] ?? 0);
      }
      covered = batch.scannedUpTo;
      if (Date.now() - lastPosted >= POST_EVERY_MS) send(covered);
    }
    if (cancelled.has(request.id)) throw new SearchCancelled();
    send(Math.max(covered, content.extent));
    post({ kind: "scanned", id: request.id });
  } catch (error) {
    fail(request.id, error);
  }
}

function fail(id: JobId, error: unknown): void {
  if (error instanceof SearchCancelled) {
    post({ kind: "cancelled", id });
    return;
  }
  post({
    kind: "error",
    id,
    message: error instanceof Error ? error.message : "The search failed.",
  });
}

function post(response: SearchWorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(response, transfer);
}
