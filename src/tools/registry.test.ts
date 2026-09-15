import { describe, expect, it } from "vitest";
import { TOOLS, toolById } from "@/tools/registry";

/** The registry, ported from upstream's `ToolsMenuTests`. */

describe("the tool registry", () => {
  // @upstream ByteRipperTests/ToolsMenuTests.swift#ToolsMenuTests.testTheMenuListsEveryModuleTheRegistryHoldsInItsOrder
  it("lists the shipping modules in upstream's order", () => {
    expect(TOOLS.map((tool) => [tool.id, tool.title])).toEqual([
      ["dev.maxik.tool.me-analyzer", "ME Analyzer"],
      ["dev.maxik.tool.fit", "FIT Table"],
      ["dev.maxik.tool.uefi-structure", "UEFI Structure"],
    ]);
  });

  // @upstream ByteRipperTests/ToolsMenuTests.swift#ToolsMenuTests.testTheRegistryFindsAModuleByItsIdentifier
  it("finds a module by its identifier, and nothing for one it does not hold", () => {
    expect(toolById("dev.maxik.tool.fit")?.title).toBe("FIT Table");
    expect(toolById("dev.maxik.tool.removed")).toBeUndefined();
  });
});
