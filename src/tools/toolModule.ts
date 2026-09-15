import type { NoticeGlyph } from "@/state/noticeStore";
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

/**
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost
 * @upstream-differs the context a tool is handed is its pane, reveal, report and notices; the rest it reads from the stores it subscribes to
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.pane
 */
export interface ToolContext {
  /** The pane this instance of the tool is about. */
  readonly pane: PaneId;
  /**
   * Shows a range in the dump, and selects it.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.reveal
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revealForTool
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showZoneStartForTool
   * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.reveal
   */
  readonly reveal: (start: number, end: number) => void;
  /** Something the user needs told, in the shell's own status line. */
  readonly report: (problem: string | undefined) => void;
  /**
   * Shows a short-lived plate over the window — the one a search result is
   * reported in — about something the panel *did* rather than something it
   * found in the bytes: a copy that went to the clipboard.
   *
   * The panel names the glyph and writes the lines, because the panel is what
   * knows what happened; where the plate appears, how long it holds and that a
   * new one replaces the last are the window's, asked for here rather than
   * re-decided by every tool. A panel drawing its own plate would be a second
   * convention, and the user would see two.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.showNotice
   */
  readonly showNotice: (glyph: NoticeGlyph, lines: readonly string[]) => void;
}

/**
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession
 * @upstream-differs a module object whose View component is the session
 */
export interface ToolModule {
  /**
   * Stable, and what a saved layout would name.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.identifier
   */
  readonly id: string;
  /**
   * What the panel's tab says.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.title
   */
  readonly title: string;
  /** One line about what it is for, for the picker. */
  readonly summary: string;
  /**
   * The panel's body. Mounted only while the tool is the one on screen.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.makeSession
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.viewController
   */
  readonly View: (props: { readonly context: ToolContext }) => React.ReactNode;
}
