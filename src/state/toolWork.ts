import { BackgroundOperation, presentBlocking } from "@/state/operationStore";
import { reportAlert } from "@/state/workspaceStore";
import type { ToolWork } from "@/tools/toolModule";

/**
 * The handle a tool moves a blocking modal with: the modal is driven by a
 * `BackgroundOperation`, and closes when it finishes.
 *
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolWork
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolWork.operation
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolWork.rename
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolWork.finish
 */
export class PaneToolWork implements ToolWork {
  readonly operation: BackgroundOperation;

  /** @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolWork.init */
  constructor(operation: BackgroundOperation) {
    this.operation = operation;
  }

  rename(phase: string): void {
    this.operation.rename(phase);
  }

  finish(): void {
    this.operation.finish();
  }
}

/**
 * Puts the modal over the window and answers its handle. Cancel is the tool's
 * to act on; it ends the modal by finishing.
 *
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.beginBlockingWork
 * @upstream-differs one window: there is no owner to bring to the front first,
 * and no panel without a window to be answered with a handle that does nothing
 */
export function beginBlockingWork(title: string, onCancel: () => void): ToolWork {
  const operation = new BackgroundOperation(title, onCancel, true);
  presentBlocking(title, operation);
  return new PaneToolWork(operation);
}

/**
 * How an operation ended, said in a modal of its own: the green check for what
 * was done, the red octagon for what was refused or failed.
 *
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.report
 */
export function reportToolResult(title: string, message: string, isProblem: boolean): void {
  reportAlert(title, message, isProblem ? "problem" : "success");
}
