/**
 * A command a tool-module offers in the dump's own context menu, under its own name: right-click
 * a byte, **UEFI Structure ▸ Show in Tree**.
 *
 * The other direction from the panel's own buttons. A button in the panel acts on where the caret
 * is, and a reader has to know that the caret is what it means; a command in the dump's menu acts
 * on the byte that was clicked, which is what the reader was already pointing at.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDumpAction.swift#ToolDumpAction
 */
export interface ToolDumpAction {
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDumpAction.swift#ToolDumpAction.title */
  readonly title: string;
  /**
   * A command that cannot run here is offered greyed rather than left out.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDumpAction.swift#ToolDumpAction.isEnabled
   */
  readonly isEnabled: boolean;
  /** @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDumpAction.swift#ToolDumpAction.perform */
  readonly perform: () => void;
}

/**
 * What a session offers for the byte at `offset`; asked each time the menu opens. An empty list
 * adds nothing to the menu.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolSession.swift#ToolSession.dumpActions
 */
export type DumpActionsProvider = (offset: number) => readonly ToolDumpAction[];
