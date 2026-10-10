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
  label,
  multiselectable = false,
  hidden,
  listRef,
  keyTable = false,
  onKeyDown,
}: {
  readonly children: ReactNode;
  /** What the list is, to a screen reader: the page's name. */
  readonly label: string;
  /** More than one row can be chosen at once (the Marks). */
  readonly multiselectable?: boolean;
  readonly hidden?: boolean;
  readonly listRef?: Ref<HTMLDivElement>;
  /**
   * The list has details under it: the large view hands it the arrow keys while it is open
   * (`data-key-table`, `largeDetailStore`).
   */
  readonly keyTable?: boolean;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  return (
    // The grid is the scroller that takes the keyboard, as a tool panel's is (`fit-entries`): a
    // click on a row leaves the focus on it (`AppShell`), and its rows carry `aria-selected`.
    // biome-ignore lint/a11y/useSemanticElements: the grid role sits on the scroller that takes the keyboard; a <table> may not carry it
    <div
      className="agent-log"
      ref={listRef}
      role="grid"
      aria-label={label}
      aria-multiselectable={multiselectable ? true : undefined}
      hidden={hidden}
      tabIndex={0}
      data-key-table={keyTable ? "" : undefined}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
