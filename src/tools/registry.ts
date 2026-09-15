import { fitTool } from "@/tools/fit/fitTool";
import { meTool } from "@/tools/me/meTool";
import type { ToolModule } from "@/tools/toolModule";
import { uefiStructureTool } from "@/tools/uefi/uefiStructureTool";

/**
 * Every tool-module the app ships, in the order the Tools menu lists them.
 *
 * A list rather than a discovery mechanism: what is installed is known when the
 * app is built, and the answer to "which tools are there" should be readable in
 * one place. Nothing here decides whether a tool applies to the open file — all
 * of them are offered for every file, and "there is no FIT table in this image"
 * is a sentence the tool says in its own panel.
 *
 * @upstream ByteRipperApp/Tools/ToolRegistry.swift#ToolRegistry
 */

/** @upstream ByteRipperApp/Tools/ToolRegistry.swift#ToolRegistry.shipping */
export const TOOLS: readonly ToolModule[] = [meTool, fitTool, uefiStructureTool];

/**
 * The tool-module an identifier names, or nothing for one nothing answers to —
 * which is what a module removed between builds looks like.
 *
 * @upstream ByteRipperApp/Tools/ToolRegistry.swift#ToolRegistry.module
 */
export function toolById(id: string): ToolModule | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
