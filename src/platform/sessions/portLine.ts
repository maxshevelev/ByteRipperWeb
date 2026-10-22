import type { SessionLine } from "@/core/session/sessionProtocol";

/**
 * One end of a window's line to the session host, over a `MessagePort` (`Design/FILE_SESSIONS.md`):
 * a channel's port while the host runs in the page, a `SharedWorker`'s once it runs there.
 *
 * @web-only see `SessionLine`
 */
export function portLine<Out, In>(port: MessagePort): SessionLine<Out, In> {
  // Node's port keeps the process alive while it listens; a page's has no such notion.
  (port as { unref?: () => void }).unref?.();
  return {
    post: (message, transfer = []) => port.postMessage(message, [...transfer] as Transferable[]),
    listen: (receive) => {
      port.onmessage = (event: MessageEvent<In>) => receive(event.data);
    },
    close: () => port.close(),
  };
}
