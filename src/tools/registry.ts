import type { ToolModule } from "@/tools/toolModule";
import { uefiStructureTool } from "@/tools/uefi/uefiStructureTool";

/**
 * The tools this build has.
 *
 * A list rather than a lookup the tools register themselves into: a registry
 * that tools write into makes the set depend on which modules happened to be
 * imported, and the answer to "which tools are there" should be readable in one
 * place.
 */
export const TOOLS: readonly ToolModule[] = [uefiStructureTool];

export function toolById(id: string): ToolModule | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
