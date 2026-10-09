import type { HelpTopicId } from "@/core/help/helpIds";
import type { PartCodec } from "@/core/parts/partCodec";
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
   * Shows a range in the dump, and selects it — or, with `select` false, moves the
   * caret to its start and leaves the selection alone: looking is not selecting,
   * and a user may be part-way through something in the dump. Selecting is the
   * default; going to a thing's place is the other.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.reveal
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revealForTool
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.showZoneStartForTool
   * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.reveal
   */
  readonly reveal: (start: number, end: number, select?: boolean) => void;
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
   * Puts a modal over the window for an operation that changes the file, and
   * returns the handle to move it along with: the title says what is being
   * done, `rename` what it is doing now, `finish` closes it.
   *
   * For work that has to run to its end with the window left alone — it reads
   * the file, takes seconds, and writes back into it — so that nothing can be
   * typed into the dump meanwhile and no second change lands under the first.
   * `onCancel` is called when the reader presses Cancel; the tool stops its work
   * and calls `finish`.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.beginBlockingWork
   * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.beginBlockingWork
   */
  readonly beginBlockingWork: (title: string, onCancel: () => void) => ToolWork;
  /**
   * Tells the reader how an operation ended, in a modal over the window — the
   * same place its progress was. A problem is worded as one and wears the red
   * octagon, what was done the green check. What an operation says about itself
   * belongs here, not in a line of the panel: the panel is a strip beside the
   * dump, and a result nobody was waiting at goes unread.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.report
   * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.report
   * @upstream-differs named for what it says: `report` is already the line's, above
   */
  readonly reportResult: (title: string, message: string, isProblem: boolean) => void;
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
   * A part of this pane's file, opened as a panel over it, linked to `source`
   * (`Design/GAPS.md` G48, G49; upstream's `Design/FRAGMENT_PANELS_PLAN.md`).
   *
   * `codec` is the whole of what the part is: what the panel shows is what it
   * decodes from `source`, and what Update in Parent writes back is what it
   * encodes from the panel. A copy, a body decompressed, a block decoded —
   * each is a codec, and the application opens and puts back all of them the
   * same way. Where the part opens is the application's, and there is only one
   * answer to that.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolHost.openPart
   * @upstream ByteRipperApp/Tools/PaneToolHost.swift#PaneToolHost.openPart
   * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartOpening.swift#UEFIPartOpening
   * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/UEFIPartOpening.swift#UEFIPartOpening.openPart
   * @upstream-differs one form for both: the layout a UEFI panel opened on the
   * part reads it as is an optional last argument rather than a second protocol
   */
  readonly openPart: (
    name: string,
    source: readonly [number, number],
    codec: PartCodec,
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
   * The modules resolve it on every access — a getter around `L` — because
   * the page can switch language while the panel is open, and a name computed
   * once would go stale. Upstream wraps the key at definition, a `static let`
   * evaluated once, and that is safe there only because a language change
   * relaunches the app.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.title
   * @upstream-differs a getter that asks the language at access, where upstream is a `static let` evaluated once — the page switches language live
   */
  readonly title: string;
  /** One line about what it is for, for the picker. */
  readonly summary: string;
  /**
   * Which page of the help explains this instrument — what the `?` in the
   * panel's header opens.
   *
   * Named here so the app draws the button and the module only says where it
   * goes. A tool-module that names no page is one whose header carries no `?`,
   * which is how a new instrument exists before anything has been written
   * about it.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.helpTopic
   */
  readonly helpTopic?: HelpTopicId;
  /**
   * The panel's body. Mounted only while the tool is the one on screen.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.makeSession
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.viewController
   */
  readonly View: (props: { readonly context: ToolContext }) => React.ReactNode;
}

/**
 * The handle on a modal `ToolContext.beginBlockingWork` put up.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolWork
 */
export interface ToolWork {
  /**
   * What the operation is doing now, under the title.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolWork.rename
   */
  rename(phase: string): void;
  /**
   * The operation is over, however it ended: the modal goes.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolWork.finish
   */
  finish(): void;
}
