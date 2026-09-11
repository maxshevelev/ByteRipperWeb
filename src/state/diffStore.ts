import { DiffBlockIndex } from "@/core/diff/diffBlock";
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
  ].join("|");
  if (inputs === currentInputs && diffStore.getSnapshot().status !== "idle") return;
  currentInputs = inputs;

  cancelRunning();
  const id = nextJobId++;
  currentJobId = id;
  diffStore.update((state) => ({ ...state, status: "scanning", progress: 0, problem: undefined }));

  const leftBlob = blobOf(left.file.source);
  const rightBlob = blobOf(right.file.source);
  if (leftBlob === undefined || rightBlob === undefined) {
    diffStore.update((state) => ({
      ...state,
      status: "failed",
      problem: "These files cannot be compared in a worker.",
    }));
    return;
  }

  send({ kind: "diff", id, left: leftBlob, right: rightBlob, gap: groupingGap });
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

/** Re-runs the comparison whenever the files or the grouping distance change. */
export function watchWorkspaceForComparison(): () => void {
  refreshComparison();
  return workspaceStore.subscribe(refreshComparison);
}
