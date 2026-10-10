import { AgentToolError } from "@/core/agent/agentTool";
import { readyFirmware } from "@/state/firmwareReady";
import { expandFirmwareNodeAndWait, firmwareFor, firmwareNodeAt } from "@/state/firmwareStore";
import type { PaneId } from "@/state/paneId";
import { nodeOpen } from "@/tools/uefi/uefiPresenter";
import type { WireNode } from "@/workers/protocol";

/**
 * A UEFI node of a pane's tree, found by the id an agent gives, with the branches on the way read
 * where the tree is and the panel's copy following.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentNodeData.swift#UEFIAgentNodeData.bytes
 * @upstream-differs only the node and where it lies in the file: the bytes are read by whoever
 * needs them
 */
export async function firmwareNodeOf(
  pane: PaneId,
  nodeText: string
): Promise<{ readonly node: WireNode; readonly roots: readonly WireNode[] }> {
  await readyFirmware(pane);
  const path = nodePath(nodeText);
  for (let length = 1; length < path.length; length++) {
    await expandFirmwareNodeAndWait(pane, path.slice(0, length));
  }
  const roots = firmwareFor(pane)?.roots ?? [];
  const node = firmwareNodeAt(roots, path);
  if (node === undefined) {
    throw new AgentToolError(
      `No node ${nodeText} in this image. Ids come from \`uefi_tree\`, \`uefi_find\` or \`uefi_at\` on the same document: ` +
        "a part opened with `open_part` has its own tree and its own ids, and a call that leaves out `document` goes to the focused one — " +
        "the part, after `open_part` — so give the `document` the id was listed on."
    );
  }
  return { node, roots };
}

/**
 * The bytes of `pane`'s file a node stands for: its own range, or — for a node inside a
 * compressed section — the section's.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIPresenter.swift#UEFIPresenter.fileSource
 */
export async function fileSourceOfNode(
  pane: PaneId,
  nodeText: string
): Promise<readonly [number, number]> {
  const { node, roots } = await firmwareNodeOf(pane, nodeText);
  const open = nodeOpen(node, false, roots);
  if (open === undefined) {
    throw new AgentToolError(
      `Node ${nodeText} has no bytes of the file to lead back to: there is nothing there, ` +
        "or its compressed section cannot be traced back to the file."
    );
  }
  return open.source;
}

/** A node id as indices; the top is no node. */
export function nodePath(text: string): number[] {
  if (!/^[0-9]+(\.[0-9]+)*$/.test(text)) {
    throw new AgentToolError(
      `\`${text}\` is not a node id. Ids look like "0.2.5" and come from \`uefi_tree\`, \`uefi_find\` or \`uefi_at\`.`
    );
  }
  return text.split(".").map(Number);
}
