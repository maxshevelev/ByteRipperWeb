import { DiffBlockIndex } from "@/core/diff/diffBlock";
import {
  applyEdit,
  collapseEdits,
  DiffCancelled,
  type DiffEdit,
  scanDiff,
} from "@/core/diff/diffEngine";
import { DiffHunkIndex, type HunkRange } from "@/core/diff/diffHunkIndex";
import { createStore } from "@/state/store";
import { workspaceStore } from "@/state/workspaceStore";
import type { DiffWorkerRequest, DiffWorkerResponse, JobId } from "@/workers/protocol";

/**
 * The comparison, as the interface sees it.
 *
 * Owns the worker, starts a job whenever the inputs change, and cancels the one
 * in flight when they change again — a scan whose inputs have moved is
 * answering a question nobody is asking any more.
 *
 * Replies are matched by job id and anything stale is dropped. That is the only
 * defence against a slow scan landing after a fast one and painting the wrong
 * answer, and it is why every request carries an id.
 */

export type DiffStatus = "idle" | "scanning" | "ready" | "failed";

export interface DiffState {
  readonly status: DiffStatus;
  /** In `[0, 1]` while scanning. */
  readonly progress: number;
  readonly index: DiffBlockIndex | undefined;
  readonly hunks: DiffHunkIndex | undefined;
  readonly differingBytes: number;
  readonly sameBytes: number;
  readonly problem: string | undefined;
}

const IDLE: DiffState = {
  status: "idle",
  progress: 0,
  index: undefined,
  hunks: undefined,
  differingBytes: 0,
  sameBytes: 0,
  problem: undefined,
};

export const diffStore = createStore<DiffState>(IDLE);

let worker: Worker | undefined;
let nextJobId: JobId = 1;
let currentJobId: JobId | undefined;
/** What the running job was started for, so an unchanged workspace does not restart it. */
let currentInputs: string | undefined;

function ensureWorker(): Worker {
  if (worker !== undefined) return worker;
  worker = new Worker(new URL("../workers/diff.worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (event: MessageEvent<DiffWorkerResponse>) => {
    const response = event.data;
    // A reply to a superseded job is an answer to an old question.
    if (response.id !== currentJobId) return;

    switch (response.kind) {
      case "progress":
        diffStore.update((state) => ({
          ...state,
          status: "scanning",
          progress: response.fraction,
        }));
        break;
      case "done": {
        const index = DiffBlockIndex.fromColumns(
          response.leftSize,
          response.rightSize,
          response.starts,
          response.ends,
          response.kinds
        );
        const hunks: HunkRange[] = [];
        for (let i = 0; i + 1 < response.hunks.length; i += 2) {
          hunks.push({ start: response.hunks[i] ?? 0, end: response.hunks[i + 1] ?? 0 });
        }
        diffStore.update(() => ({
          status: "ready",
          progress: 1,
          index,
          hunks: new DiffHunkIndex(hunks, response.gap, index.maxSize),
          differingBytes: response.differingBytes,
          sameBytes: response.sameBytes,
          problem: undefined,
        }));
        currentJobId = undefined;
        break;
      }
      case "cancelled":
        currentJobId = undefined;
        break;
      case "error":
        diffStore.update((state) => ({
          ...state,
          status: "failed",
          progress: 0,
          problem: response.message,
        }));
        currentJobId = undefined;
        break;
    }
  });
  return worker;
}

function send(request: DiffWorkerRequest): void {
  ensureWorker().postMessage(request);
}

/**
 * Starts or restarts the comparison for the workspace as it stands.
 *
 * With fewer than two files there is nothing to compare, and the store goes
 * back to idle rather than keeping a stale answer on screen.
 */
export function refreshComparison(): void {
  const { panes, groupingGap } = workspaceStore.getSnapshot();
  const left = panes.a;
  const right = panes.b;

  if (left === undefined || right === undefined) {
    cancelRunning();
    currentInputs = undefined;
    diffStore.update(() => IDLE);
    return;
  }

  // Files are identified by name, size and modification time — enough to notice
  // a different file in a slot without reading a byte of either.
  const inputs = [
    left.name,
    left.file.size,
    left.file.lastModified,
    right.name,
    right.file.size,
    right.file.lastModified,
    groupingGap,
    // Whether each side is edited: a scan run against the files is not the
    // scan to keep once one of them stops matching its file.
    left.document.isDirty,
    right.document.isDirty,
  ].join("|");
  if (inputs === currentInputs && diffStore.getSnapshot().status !== "idle") return;
  currentInputs = inputs;

  cancelRunning();
  const id = nextJobId++;
  currentJobId = id;
  diffStore.update((state) => ({ ...state, status: "scanning", progress: 0, problem: undefined }));

  // The worker is given the two *files*. A document with unsaved edits is not
  // its file — so comparing them there would show the dump as it is on disk
  // while the screen shows the dump as it is now, which is the one thing this
  // application must never get wrong. That case scans here instead, against the
  // live documents, chunked with an await between chunks so the frame is never
  // held.
  const leftBlob = blobOf(left.file.source);
  const rightBlob = blobOf(right.file.source);
  const canUseWorker =
    !left.document.isDirty &&
    !right.document.isDirty &&
    leftBlob !== undefined &&
    rightBlob !== undefined;

  if (!canUseWorker) {
    void scanOnThisThread(id, groupingGap);
    return;
  }

  send({ kind: "diff", id, left: leftBlob, right: rightBlob, gap: groupingGap });
}

/**
 * The full scan, against the documents rather than the files.
 *
 * Slower than the worker and deliberately so: correctness first, and the reads
 * it awaits are what keep the main thread answering between chunks.
 */
async function scanOnThisThread(id: JobId, gap: number): Promise<void> {
  const { panes } = workspaceStore.getSnapshot();
  const left = panes.a?.document;
  const right = panes.b?.document;
  if (left === undefined || right === undefined) return;

  try {
    const index = await scanDiff(left, right, {
      chunkSize: INCREMENTAL_CHUNK_SIZE,
      shouldCancel: () => currentJobId !== id,
      onProgress: (fraction: number) => {
        if (currentJobId === id) {
          diffStore.update((state) => ({ ...state, status: "scanning", progress: fraction }));
        }
      },
    });
    if (currentJobId !== id) return;
    publishIndex(index, gap);
    currentJobId = undefined;
  } catch (error) {
    if (error instanceof DiffCancelled) return;
    if (currentJobId !== id) return;
    diffStore.update((state) => ({
      ...state,
      status: "failed",
      problem: error instanceof Error ? error.message : "The comparison failed.",
    }));
    currentJobId = undefined;
  }
}

function cancelRunning(): void {
  if (currentJobId === undefined) return;
  send({ kind: "cancel", id: currentJobId });
  currentJobId = undefined;
}

/**
 * A `ByteSource` that is really a `Blob`, which is what a worker can be handed.
 *
 * Everything the file layer produces is one; the check exists because
 * `ByteSource` is a structural interface a test double also satisfies, and a
 * double cannot cross a worker boundary.
 */
function blobOf(source: unknown): Blob | undefined {
  return source instanceof Blob ? source : undefined;
}

/** Publishes an index and the navigation hunks derived from it. */
function publishIndex(index: DiffBlockIndex, gap: number): void {
  const summary = index.summary;
  diffStore.update(() => ({
    status: "ready",
    progress: 1,
    index,
    hunks: DiffHunkIndex.from(index, gap),
    differingBytes: summary.differing,
    sameBytes: summary.same,
    problem: undefined,
  }));
}

/**
 * Notes an edit, so the comparison catches up without a full rescan.
 *
 * This is what M3's incremental invalidation was built for and what M4 finally
 * has something to feed it. Edits are collected across a frame and collapsed
 * before anything is rescanned: a run of typed bytes is one damaged window, and
 * ten inserted bytes rescanned the file's tail ten times where one pass does.
 *
 * The update runs here rather than in the worker. The worker holds the two
 * *files*; an edited document is a piece table over one, and shipping that
 * across is a bigger change than the work it would save — an overwrite
 * invalidates only the bytes it touched, which measures at hundredths of a
 * millisecond. A length-changing edit does invalidate the tail, and that is
 * why the rescan reads in small chunks with an await between them: the frame
 * is never held for more than a chunk, and a newer edit cancels an older
 * rescan mid-flight.
 */
let pendingEdits: DiffEdit[] = [];
let editTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by every new rescan; an older one sees it and stops. */
let incrementalRun = 0;

/** Small enough that a tail rescan yields to the frame between chunks. */
const INCREMENTAL_CHUNK_SIZE = 256 * 1024;

export function noteEdit(edit: DiffEdit): void {
  pendingEdits.push(edit);
  if (editTimer !== undefined) return;
  editTimer = setTimeout(() => {
    editTimer = undefined;
    const collapsed = collapseEdits(pendingEdits);
    pendingEdits = [];
    if (collapsed.length > 0) void applyEditsToComparison(collapsed);
  }, EDIT_COALESCE_MS);
}

/** A fast typist produces one rescan rather than one per keystroke. */
const EDIT_COALESCE_MS = 120;

async function applyEditsToComparison(edits: readonly DiffEdit[]): Promise<void> {
  const { panes, groupingGap } = workspaceStore.getSnapshot();
  const left = panes.a?.document;
  const right = panes.b?.document;
  const current = diffStore.getSnapshot().index;
  // Nothing to update: with one file there is no comparison, and with no index
  // the full scan is still running and will see the edited content itself.
  if (left === undefined || right === undefined || current === undefined) return;

  const run = ++incrementalRun;
  try {
    let index = current;
    for (const edit of edits) {
      index = await applyEdit(edit, index, left, right, {
        chunkSize: INCREMENTAL_CHUNK_SIZE,
        shouldCancel: () => incrementalRun !== run,
      });
    }
    if (incrementalRun !== run) return;
    publishIndex(index, groupingGap);
  } catch (error) {
    if (error instanceof DiffCancelled) return;
    diffStore.update((state) => ({
      ...state,
      status: "failed",
      problem: error instanceof Error ? error.message : "The comparison could not be updated.",
    }));
  }
}

/** Re-runs the comparison whenever the files or the grouping distance change. */
export function watchWorkspaceForComparison(): () => void {
  refreshComparison();
  return workspaceStore.subscribe(refreshComparison);
}
