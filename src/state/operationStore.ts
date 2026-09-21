import { createStore } from "@/state/store";
import { type PaneId, workspaceStore } from "@/state/workspaceStore";

/**
 * A named, cancellable long operation with progress in [0, 1], shown in a
 * pane's status line as its name, a bar and a (×).
 *
 * The operation does no work of its own: the owner runs the real job — a
 * search, the comparison's scan, a segment write — feeds progress through
 * `report`, and the (×) calls `cancel`, which asks the owner to stop.
 *
 * @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation
 * @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.lock
 * @upstream-differs one thread: report and finish update in place, with nothing to hop to or lock
 */
export class BackgroundOperation {
  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.name */
  private currentName: string;
  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.isIndeterminate */
  readonly isIndeterminate: boolean;
  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.cancelAction */
  private readonly cancelAction: () => void;
  private active = true;
  private currentProgress = 0;
  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.onProgress */
  onProgress: ((fraction: number) => void) | undefined;
  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.onRename */
  onRename: ((name: string) => void) | undefined;
  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.onFinish */
  onFinish: (() => void) | undefined;
  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.lastReportedFraction */
  private lastReportedFraction = 0;
  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.lastName */
  private lastName: string;

  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.init */
  constructor(name: string, onCancel: () => void, indeterminate = false) {
    this.currentName = name;
    this.lastName = name;
    this.isIndeterminate = indeterminate;
    this.cancelAction = onCancel;
  }

  get name(): string {
    return this.currentName;
  }

  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.isActive */
  get isActive(): boolean {
    return this.active;
  }

  /** @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.progress */
  get progress(): number {
    return this.currentProgress;
  }

  /**
   * What the operation is doing now, as a long one moves from one phase to the
   * next. Said only when it changes.
   *
   * @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.rename
   */
  rename(name: string): void {
    if (name === this.lastName) return;
    this.lastName = name;
    if (!this.active) return;
    this.currentName = name;
    this.onRename?.(name);
  }

  /**
   * Progress, clamped to [0, 1] and passed on only when the bar would move by
   * at least a percent — a scan of a large file reports thousands of chunks —
   * except the final 1, which always is: the bar reaches the end before it
   * goes.
   *
   * @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.report
   */
  report(fraction: number): void {
    if (this.isIndeterminate) return;
    const clamped = Math.min(Math.max(fraction, 0), 1);
    if (!(clamped - this.lastReportedFraction >= 0.01 || clamped === 1)) return;
    this.lastReportedFraction = clamped;
    if (!this.active) return;
    this.currentProgress = clamped;
    this.onProgress?.(clamped);
  }

  /**
   * Completes the operation, once: a late report or a second finish does
   * nothing, and whoever shows it takes it down.
   *
   * @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.finish
   */
  finish(): void {
    if (!this.active) return;
    this.active = false;
    this.onFinish?.();
  }

  /**
   * The (×): asks the owner to stop. The owner finishes the operation on its
   * way out, so it goes the way a completed one goes.
   *
   * @upstream ByteRipperApp/Pane/BackgroundOperation.swift#BackgroundOperation.cancel
   */
  cancel(): void {
    this.cancelAction();
  }
}

/** An operation as a pane's status line shows it. */
export interface ShownOperation {
  readonly operation: BackgroundOperation;
  readonly name: string;
  readonly progress: number;
  /** False until the debounce has passed, so a quick job never flashes a bar. */
  readonly revealed: boolean;
}

/**
 * What each pane's status line shows, if anything.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.shownOperation
 */
export const operationStore = createStore<Readonly<Record<PaneId, ShownOperation | undefined>>>({
  a: undefined,
  b: undefined,
});

/**
 * How long an operation runs before its strip appears. A search of a small
 * file finishes in a few milliseconds and must not flash a bar.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.defaultOperationDebounce
 */
export const DEFAULT_OPERATION_DEBOUNCE_MS = 300;

/** @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.operationDebounce */
let operationDebounceMs = DEFAULT_OPERATION_DEBOUNCE_MS;

/** Shortens the debounce, for a test that would otherwise wait it out. */
export function setOperationDebounce(ms: number): void {
  operationDebounceMs = ms;
}

const revealTimers: Partial<Record<PaneId, ReturnType<typeof setTimeout>>> = {};

/**
 * Shows `operation` in `pane`'s status line, replacing whatever was there. The
 * strip waits out the debounce unless `revealImmediately` — an operation
 * already running, moved onto the pane that became active, would blink off and
 * on otherwise.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.beginOperation
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.operationShowWorkItem
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.currentOperation
 */
export function beginOperation(
  pane: PaneId,
  operation: BackgroundOperation,
  revealImmediately = false
): void {
  endOperation(pane);
  const patch = (change: Partial<ShownOperation>) =>
    operationStore.update((state) => {
      const shown = state[pane];
      return shown?.operation === operation ? { ...state, [pane]: { ...shown, ...change } } : state;
    });

  operationStore.update((state) => ({
    ...state,
    [pane]: {
      operation,
      name: operation.name,
      progress: operation.progress,
      revealed: revealImmediately,
    },
  }));
  operation.onProgress = (fraction) => patch({ progress: fraction });
  operation.onRename = (name) => patch({ name });
  operation.onFinish = () => {
    if (operationStore.getSnapshot()[pane]?.operation === operation) endOperation(pane);
  };
  if (!revealImmediately) {
    revealTimers[pane] = setTimeout(() => {
      delete revealTimers[pane];
      if (operation.isActive) patch({ revealed: true });
    }, operationDebounceMs);
  }
}

/**
 * Takes the strip down and forgets the operation, a pending reveal included.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.endOperation
 */
export function endOperation(pane: PaneId): void {
  const timer = revealTimers[pane];
  if (timer !== undefined) clearTimeout(timer);
  delete revealTimers[pane];
  operationStore.update((state) =>
    state[pane] === undefined ? state : { ...state, [pane]: undefined }
  );
}

/** The operation that follows the active pane, if one is running. */
let followingOperation: BackgroundOperation | undefined;

/**
 * Shows an operation that belongs to the workspace rather than to a pane — the
 * comparison's scan — on the pane the user is looking at. Switching panes
 * moves it, already revealed.
 */
export function presentOnActivePane(operation: BackgroundOperation): void {
  endOperation("a");
  endOperation("b");
  followingOperation = operation;
  beginOperation(workspaceStore.getSnapshot().activePane, operation);
}

let lastActivePane = workspaceStore.getSnapshot().activePane;
workspaceStore.subscribe(() => {
  const active = workspaceStore.getSnapshot().activePane;
  if (active === lastActivePane) return;
  lastActivePane = active;
  const operation = followingOperation;
  if (operation === undefined || !operation.isActive) return;
  endOperation("a");
  endOperation("b");
  beginOperation(active, operation, true);
});

/**
 * The one operation a modal is holding the window for, if any.
 *
 * The status line's strip above is for work that runs beside the reader — a
 * search, an index — and is easy to miss. This is for work whose result depends
 * on the document not being used while it runs: an update that reads a
 * document, works for seconds and writes back into it. A modal is what keeps a
 * second change from landing under the first, and what puts the progress where
 * the reader is already looking.
 *
 * @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet
 */
export interface BlockingOperation {
  readonly operation: BackgroundOperation;
  /** @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet.titleLabel */
  readonly title: string;
  /** What it is doing now. @upstream #BlockingOperationSheet.phaseLabel */
  readonly name: string;
  /** @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet.progressBar */
  readonly progress: number;
}

export const blockingOperationStore = createStore<BlockingOperation | undefined>(undefined);

/**
 * Shows `operation` as the window's modal, and takes it down when the operation
 * finishes — which is what its own cancellation does too, so Cancel needs no
 * second path.
 *
 * One at a time, as a sheet is: presenting a second replaces the first.
 *
 * @upstream ByteRipperApp/Window/BlockingOperationSheet.swift#BlockingOperationSheet.present
 */
export function presentBlocking(title: string, operation: BackgroundOperation): void {
  const patch = (change: Partial<BlockingOperation>) =>
    blockingOperationStore.update((shown) =>
      shown?.operation === operation ? { ...shown, ...change } : shown
    );

  blockingOperationStore.update(() => ({
    operation,
    title,
    name: operation.name,
    progress: operation.progress,
  }));
  operation.onProgress = (progress) => patch({ progress });
  operation.onRename = (name) => patch({ name });
  operation.onFinish = () => {
    blockingOperationStore.update((shown) => (shown?.operation === operation ? undefined : shown));
  };
}
