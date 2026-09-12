import type { PaneId } from "@/state/workspaceStore";

/**
 * What a tool module is.
 *
 * A tool reads one pane's bytes and says something about them: the UEFI
 * structure, the FIT table, what the ME region holds. The contract is short on
 * purpose, and every clause in it is a rule the application depends on.
 *
 * - **A tool is bound to one pane**, and says which in its header. With two
 *   files open, a panel that did not say which one it was about would be a
 *   panel nobody could trust.
 * - **A tool writes only through the document**, so every edit it makes is one
 *   the user can undo with the same key they undo their own typing with.
 * - **A tool asks the pane to reveal a range** rather than scrolling it: where
 *   the dump goes is the shell's business, and a tool that moved it directly
 *   would fight the other things that move it.
 * - **A tool depends on `src/firmware` and on shared code, never on the shell
 *   and never on another tool.** Code two tools both need moves to shared code.
 */

export interface ToolContext {
  /** The pane this instance of the tool is about. */
  readonly pane: PaneId;
  /** Shows a range in the dump, and selects it. */
  readonly reveal: (start: number, end: number) => void;
  /** Something the user needs told, in the shell's own status line. */
  readonly report: (problem: string | undefined) => void;
}

export interface ToolModule {
  /** Stable, and what a saved layout would name. */
  readonly id: string;
  /** What the panel's tab says. */
  readonly title: string;
  /** One line about what it is for, for the picker. */
  readonly summary: string;
  /** The panel's body. Mounted only while the tool is the one on screen. */
  readonly View: (props: { readonly context: ToolContext }) => React.ReactNode;
}
