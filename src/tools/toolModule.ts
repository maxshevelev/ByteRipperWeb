import type { UEFIRootLayout } from "@/firmware/uefi/rootLayout";
import type { NoticeGlyph } from "@/state/noticeStore";
import type { ToolSessionState } from "@/state/parkedToolState";
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
   * What this session was handed as it started: what the last session of this
   * tool, on this file, decided was worth keeping — or nothing, which is what a
   * tool that keeps nothing is handed, and what a file that has just been
   * opened has.
   *
   * Opaque, and read once: the panel seeds the state it is about to draw with,
   * and what it leaves behind when it closes is what the next session gets.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.restore
   */
  readonly restored: ToolSessionState | undefined;
  /**
   * Shows a range in the dump, and selects it.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.reveal
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revealForTool
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showZoneStartForTool
   * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.reveal
   */
  readonly reveal: (start: number, end: number) => void;
  /**
   * Something the panel just did, said in the bound pane's own line for a
   * moment: an edit that landed, a write that was refused.
   *
   * The line already carries the window's own short-lived sentences — an
   * insert's new total, a find that moved the caret — and a panel's sentence is
   * the same kind of thing: true for a moment, needing no answer, and gone
   * again without the user dismissing anything.
   *
   * @web-only the seam has no such member: its only "what happened" is
   * `showNotice`, and an upstream tool that cannot act asks beforehand
   * (`isReadOnly`, `read`) rather than reporting a refusal after the fact. A
   * browser cannot always ask first — a page's clipboard write can be denied by
   * the browser, and a worker's plan can refuse a write — so a panel needs
   * somewhere to say so.
   */
  readonly report: (text: string) => void;
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
  /**
   * Bytes the panel has made sense of, opened as a part of their own — a panel
   * over the file they came out of, with a pill in the dock
   * (`Design/GAPS.md` G48, G49).
   *
   * The tool decides what the bytes are and what they are called; where they
   * open is the application's, and there is only one answer to that.
   *
   * `source` is where those bytes are in the pane's own file: the link back,
   * which is what Update in Parent puts them through. A part opened without one
   * has no way home and says so.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.openPart
   * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.openPart
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openPartForTool
   */
  readonly openPart: (
    bytes: Uint8Array,
    name: string,
    source?: readonly [number, number],
    /**
     * What a panel opened on the part should read its bytes as, where the tool
     * knows: a decompressed body is a run of sections, not an image to scan.
     *
     * @upstream Packages/UEFIImage/Sources/UEFIImage/RootLayout.swift#UEFIRootLayout
     */
    layout?: UEFIRootLayout
  ) => void;
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
