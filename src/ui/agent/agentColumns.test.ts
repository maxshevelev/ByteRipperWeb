import { describe, expect, it } from "vitest";
import { logColumns, toolColumns } from "@/ui/agent/AgentTableHead";

/**
 * Which column of each of the Agent window's tables gives way with the panel: one, the one with the
 * most to say, and the others keep the widths they were given (the person can still drag them).
 */
describe("the column that takes what the window adds", () => {
  const growing = (columns: readonly { readonly id: string; readonly grows?: boolean }[]) =>
    columns.filter((one) => one.grows === true).map((one) => one.id);

  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheLastColumnTakesWhatTheWindowAddsInTools
  it("is the last in the Tools list: Last Call", () => {
    expect(growing(toolColumns())).toEqual(["last"]);
    expect(toolColumns().at(-1)?.title).toBe("Last Call");
  });

  it("is Arguments in the Log", () => {
    expect(growing(logColumns())).toEqual(["arguments"]);
  });
});
