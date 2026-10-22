import type { HostMessage, SessionLine, ViewMessage } from "@/core/session/sessionProtocol";

// The two globals a line between two ends needs, which the core's ES2023 lib does not declare:
// both exist wherever the tests run.
declare const structuredClone: <T>(value: T, options?: { transfer?: unknown[] }) => T;
declare const setTimeout: (callback: () => void, ms?: number) => unknown;

/**
 * The two ends of a window's line to the host, in one process, behaving as a `MessagePort` does:
 * each message is cloned — so whatever cannot cross a real port fails here too — and delivered
 * later, in a task of its own and in the order it was posted.
 */
export function linePair(): {
  readonly view: SessionLine<ViewMessage, HostMessage>;
  readonly host: SessionLine<HostMessage, ViewMessage>;
} {
  let toView: ((message: HostMessage) => void) | undefined;
  let toHost: ((message: ViewMessage) => void) | undefined;
  let open = true;
  const deliver = <T>(
    message: T,
    transfer: readonly unknown[],
    to: () => ((m: T) => void) | undefined
  ) => {
    if (!open) return;
    const copy = structuredClone(message, { transfer: [...transfer] });
    setTimeout(() => {
      if (open) to()?.(copy);
    });
  };
  return {
    view: {
      post: (message, transfer = []) => deliver(message, transfer, () => toHost),
      listen: (receive) => {
        toView = receive;
      },
      close: () => {
        open = false;
      },
    },
    host: {
      post: (message, transfer = []) => deliver(message, transfer, () => toView),
      listen: (receive) => {
        toHost = receive;
      },
      close: () => {
        open = false;
      },
    },
  };
}

/** Lets every message in flight arrive. */
export const quiet = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));
