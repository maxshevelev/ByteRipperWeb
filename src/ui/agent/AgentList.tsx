import type { KeyboardEvent, ReactNode, Ref } from "react";

/**
 * The scrolling list of one page of the Agent window. It takes the keyboard: when the window comes
 * up and when a page is chosen, the keyboard is put on the list in view, and Up and Down walk its
 * rows.
 *
 * @upstream ByteRipperApp/Agent/AgentWindowController.swift#AgentWindowController.focusList
 * @web-only an AppKit table is a first responder with arrow-key movement of its own
 */
export function AgentList({
  children,
  hidden,
  listRef,
  onKeyDown,
}: {
  readonly children: ReactNode;
  readonly hidden?: boolean;
  readonly listRef?: Ref<HTMLDivElement>;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a list that walks its rows by the arrow keys, as an AppKit table does
    <div
      className="agent-log"
      ref={listRef}
      hidden={hidden}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the keyboard surface of the page's list
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
