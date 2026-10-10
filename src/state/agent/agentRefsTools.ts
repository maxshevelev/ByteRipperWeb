import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import {
  type AgentTool,
  AgentToolError,
  agentTool,
  jsonAnswer,
  READ_ONLY,
} from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import type { AgentDesk } from "@/state/agent/agentDesk";
import type { AgentModuleTools } from "@/state/agent/agentModuleTools";
import { readyFirmware } from "@/state/firmwareReady";
import { askUefiAgent } from "@/state/firmwareStore";
import { REFS } from "@/tools/uefi/agent/uefiAgentRefs";

/**
 * Who in a firmware image refers to an address or a GUID (`Design/AGENT_PROTOCOL.md`, `refs`).
 *
 * The search is in the firmware worker that holds the tree, over the buffers the tree decompressed
 * (`uefiAgentRefs`); this is the tool that names the document and asks it.
 *
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.desk
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.diff
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.init
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.tools
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.refsTool
 * @upstream-differs the document's bytes are read where the tree is, so the tool asks the worker
 * rather than searching a snapshot of the document itself
 */
export class AgentRefsTools {
  private readonly desk: AgentDesk;
  private readonly moduleTools: AgentModuleTools;

  constructor(desk: AgentDesk, moduleTools: AgentModuleTools) {
    this.desk = desk;
    this.moduleTools = moduleTools;
  }

  tools(): AgentTool[] {
    return [
      agentTool({
        name: REFS.name,
        title: REFS.title,
        description: REFS.description,
        inputSchema: AgentSchema.object({
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
          ...REFS.properties,
        }),
        annotations: READ_ONLY,
        run: async (call) => jsonAnswer(await this.refs(call.arguments)),
      }),
    ];
  }

  /** @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.refs */
  async refs(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const host = this.moduleTools.hostFor(place);
    await readyFirmware(host.pane);
    const values = { ...args.values };
    delete values.document;
    const response = await askUefiAgent(host.pane, {
      query: "uefi_refs",
      values,
      answerBound: args.answerBound,
      contentVersion: host.contentVersion,
    });
    if (response.error !== undefined) throw new AgentToolError(response.error);
    const answer = response.answer;
    if (typeof answer !== "object" || answer === null || Array.isArray(answer))
      return answer ?? null;
    return { document: place.id, ...answer };
  }
}
