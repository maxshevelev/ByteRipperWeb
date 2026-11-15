import type { FindContent, FindRange, MatchBatch, SearchDirection } from "@/core/find/findContent";
import { type ByteQuery, sameByteQuery } from "@/core/search/byteFindContent";
import { foldedPattern, SearchCancelled } from "@/core/search/searchEngine";
import type { JobId, SearchWorkerRequest, SearchWorkerResponse } from "@/workers/protocol";

/**
 * A file's bytes as something a pane's `FindIndexer` searches, scanned in the search worker.
 *
 * The worker is handed the *file*, so this is a pane's content only while its document is the
 * file — no unsaved edits. A document with edits is searched where it is (`ByteFindContent`
 * over the document), or the answer would be about the bytes on disk while the screen shows
 * others.
 *
 * Every scan is a request of its own, told apart by its id, and stopped by asking: the indexer
 * says when through `shouldCancel`, which is read on every word from the worker and on a short
 * timer between them.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/ByteFindContent.swift#ByteFindContent
 * @upstream-differs the scans run in a worker over the file, where upstream's run on a background
 * queue over the storage
 */
export class WorkerByteFindContent implements FindContent<ByteQuery> {
  private readonly file: Blob;
  readonly extent: number;

  constructor(file: Blob, extent: number) {
    this.file = file;
    this.extent = extent;
  }

  matchLength(query: ByteQuery): number {
    return Math.max(query.pattern.bytes.length, 1);
  }

  sameQuery(a: ByteQuery, b: ByteQuery): boolean {
    return sameByteQuery(a, b);
  }

  firstMatch(
    query: ByteQuery,
    anchor: number,
    direction: SearchDirection,
    shouldCancel: () => boolean,
    progress: (fraction: number) => void
  ): Promise<FindRange | undefined> {
    return new Promise((resolve, reject) => {
      run(
        (id) => ({
          kind: "firstMatch",
          id,
          file: this.file,
          pattern: foldedPattern(query.pattern.bytes, query.folding),
          encoding: query.pattern.encoding,
          folding: query.folding,
          from: anchor,
          direction,
        }),
        shouldCancel,
        (response, done) => {
          if (response.kind === "searchProgress") progress(response.fraction);
          else if (response.kind === "first") {
            done();
            resolve(response.match);
          } else if (response.kind === "cancelled" || response.kind === "error") {
            done();
            reject(failure(response));
          }
        }
      );
    });
  }

  async *matchStarts(
    query: ByteQuery,
    shouldCancel: () => boolean,
    progress: (fraction: number) => void
  ): AsyncIterable<MatchBatch> {
    const queue: MatchBatch[] = [];
    let finished = false;
    let error: Error | undefined;
    let wake: (() => void) | undefined;
    run(
      (id) => ({
        kind: "matchStarts",
        id,
        file: this.file,
        pattern: foldedPattern(query.pattern.bytes, query.folding),
        encoding: query.pattern.encoding,
        folding: query.folding,
      }),
      shouldCancel,
      (response, done) => {
        if (response.kind === "searchProgress") progress(response.fraction);
        else if (response.kind === "batch") {
          queue.push({ starts: response.starts, scannedUpTo: response.scannedUpTo });
        } else if (response.kind === "scanned") {
          done();
          finished = true;
        } else if (response.kind === "cancelled" || response.kind === "error") {
          done();
          finished = true;
          error = failure(response);
        }
        wake?.();
      }
    );
    for (;;) {
      const next = queue.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = undefined;
    }
    if (error !== undefined) throw error;
  }
}

/** What a request that did not answer rejects with. */
function failure(response: SearchWorkerResponse): Error {
  return response.kind === "error" ? new Error(response.message) : new SearchCancelled();
}

/** How often a scan in flight asks whether it should stop, between the worker's own words. */
const CANCEL_POLL_MS = 30;

let worker: Worker | undefined;
let nextJobId: JobId = 1;
/** What hears each request's answers, by its id. */
const listeners = new Map<JobId, (response: SearchWorkerResponse) => void>();

function ensureWorker(): Worker {
  if (worker !== undefined) return worker;
  worker = new Worker(new URL("../workers/search.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<SearchWorkerResponse>) => {
    listeners.get(event.data.id)?.(event.data);
  });
  return worker;
}

/**
 * Sends one request and hands its answers to `hear` until it says it is done; asks the worker to
 * stop it once `shouldCancel` says so.
 */
function run(
  request: (id: JobId) => SearchWorkerRequest,
  shouldCancel: () => boolean,
  hear: (response: SearchWorkerResponse, done: () => void) => void
): void {
  const id = nextJobId++;
  const port = ensureWorker();
  let asked = false;
  const askToStop = () => {
    if (asked || !shouldCancel()) return;
    asked = true;
    port.postMessage({ kind: "cancel", id } satisfies SearchWorkerRequest);
  };
  const poll = setInterval(askToStop, CANCEL_POLL_MS);
  const done = () => {
    clearInterval(poll);
    listeners.delete(id);
  };
  listeners.set(id, (response) => {
    askToStop();
    hear(response, done);
  });
  port.postMessage(request(id));
}
