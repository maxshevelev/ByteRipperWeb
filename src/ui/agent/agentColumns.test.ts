import { describe, expect, it } from "vitest";
import { findingColumns, logColumns, markColumns, toolColumns } from "@/ui/agent/AgentTableHead";

/**
 * Which column of each of the Agent window's tables gives way with the panel: one, the one with the
 * most to say, and the others keep the widths they were given (the person can still drag them).
 */
describe("the column that takes what the window adds", () => {
  const growing = (columns: readonly { readonly id: string; readonly grows?: boolean }[]) =>
    columns.filter((one) => one.grows === true).map((one) => one.id);

  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheLastColumnTakesWhatTheWindowAddsInMarksAndTools
  it("is the last in the Marks and Tools lists: Note and Last Call", () => {
    expect(growing(markColumns())).toEqual(["note"]);
    expect(markColumns().at(-1)?.id).toBe("note");
    expect(growing(toolColumns())).toEqual(["last"]);
    expect(toolColumns().at(-1)?.title).toBe("Last Call");
  });

  it("is Arguments in the Log, and the finding's text in the Findings", () => {
    expect(growing(logColumns())).toEqual(["arguments"]);
    expect(growing(findingColumns())).toEqual(["text"]);
  });
});
