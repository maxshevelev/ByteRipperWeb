import { toolController } from "@/state/toolController";
import type { PaneId } from "@/state/workspaceStore";
import { toolById } from "@/tools/registry";
import type { DumpActionsProvider, ToolDumpAction } from "@/tools/toolDumpAction";

/**
 * What the running tool-module offers in the dump's context menu, kept by the pane its session
 * reads: the session registers a provider while it runs and takes it back when it ends.
 *
 * @upstream-differs a registry the tool's view writes to, where upstream's controller asks its session object
 */
const providers = new Map<PaneId, DumpActionsProvider>();

/** The tool for `pane` (or nothing) says what it offers there. */
export function setDumpActions(pane: PaneId, provider: DumpActionsProvider | undefined): void {
  if (provider === undefined) providers.delete(pane);
  else providers.set(pane, provider);
}

/**
 * What the running tool-module offers for the byte at `offset` of `pane`, under its own name.
 * Nothing when there is no tool-module, when the session reads another pane, or when the list is
 * empty.
 *
 * Only for the bound pane, by the same rule a zone follows: the session reads one file, and a
 * byte of another is not one it knows.
 *
 * @upstream ByteRipperApp/Tools/ToolController.swift#ToolController.dumpActions
 */
export function dumpActionsAt(
  pane: PaneId,
  offset: number
): { readonly title: string; readonly actions: readonly ToolDumpAction[] } | undefined {
  const provider = providers.get(pane);
  if (provider === undefined) return undefined;
  const session = Object.values(toolController.getSnapshot().sessions).find(
    (one) => one.boundPane === pane && one.activeIdentifier !== undefined
  );
  const module =
    session?.activeIdentifier === undefined ? undefined : toolById(session.activeIdentifier);
  if (module === undefined) return undefined;
  const actions = provider(offset);
  return actions.length === 0 ? undefined : { title: module.title, actions };
}
