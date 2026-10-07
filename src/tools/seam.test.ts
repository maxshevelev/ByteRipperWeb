import { describe, expect, it } from "vitest";
import { applyTransaction } from "@/state/toolEdits";
import { openInPane, workspaceStore } from "@/state/workspaceStore";
import type { ToolModule } from "@/tools/toolModule";

/**
 * That the seam can actually be built on: a tool-module written against these
 * types, and a transaction from one reaching the bytes through the host.
 *
 * What upstream proves by compiling a stub host and session is proved here by
 * this file type-checking; the session itself is a component, which the port
 * has no component test for (G24).
 *
 * @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/SeamTests.swift#SeamTests
 */
describe("the tool seam", () => {
  /** A tool-module that marks nothing and draws nothing. */
  const StubModule: ToolModule = {
    id: "dev.maxik.tool.stub",
    title: "Stub",
    summary: "A stand-in.",
    View: () => null,
  };

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/SeamTests.swift#SeamTests.testAModuleIsDescribedBeforeAnythingIsOpened
  // @upstream-differs no preferred panel width: the panel's width is the session's, kept by the tool controller
  it("describes a module before anything is opened", () => {
    expect(StubModule.title).toBe("Stub");
    expect(StubModule.id).toBe("dev.maxik.tool.stub");
  });

  // @upstream Packages/ToolModuleKit/Tests/ToolModuleKitTests/SeamTests.swift#SeamTests.testATransactionFromASessionReachesTheBytes
  it("takes a session's transaction to the bytes", async () => {
    openInPane("a", {
      name: "bios.rom",
      size: 0x100,
      lastModified: 0,
      source: new Blob([new Uint8Array(0x100).fill(0xff)]),
    });
    const problem = await applyTransaction("a", {
      name: "Set Type",
      writes: [{ offset: 0x0e, bytes: new Uint8Array([0x01]) }],
    });
    expect(problem).toBeUndefined();

    const document = workspaceStore.getSnapshot().panes.a?.document;
    if (document === undefined) throw new Error("the pane did not open");
    expect([...(await document.read(0x0d, 2))]).toEqual([0xff, 0x01]);
  });
});
