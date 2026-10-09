import { AgentToolError } from "@/core/agent/agentTool";
import { ensurePaneFirmware, firmwareFor, firmwareStore } from "@/state/firmwareStore";
import type { PaneId } from "@/state/paneId";

/**
 * Waits until the pane's image has been read — the parse a tool starts from — and gives it back as
 * the pane, or refuses in words an agent can act on when it could not be read.
 *
 * What a tool-module's agent query needs before it asks anything of the tree: with its panel open
 * or not, the pane's one shared parse is what answers.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITAgentQueries.swift#FITAgentQueries.readyTree
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.readyTree
 * @upstream-differs the parse is in a worker, so this waits for the store to say it is ready
 */
export async function readyFirmware(pane: PaneId): Promise<void> {
  await ensurePaneFirmware(pane);
  await new Promise<void>((resolve) => {
    const settled = () => {
      const status = firmwareFor(pane)?.status;
      return status === "ready" || status === "failed";
    };
    if (settled()) {
      resolve();
      return;
    }
    const stop = firmwareStore.subscribe(() => {
      if (!settled()) return;
      stop();
      resolve();
    });
  });
  const held = firmwareFor(pane);
  if (held?.status !== "ready") {
    throw new AgentToolError(
      held?.problem === undefined
        ? "This document's firmware structure could not be read."
        : `This document's firmware structure could not be read: ${held.problem}`
    );
  }
}
