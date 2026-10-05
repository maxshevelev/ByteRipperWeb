import { afterEach, describe, expect, it } from "vitest";
import { blockingOperationStore } from "@/state/operationStore";
import { beginBlockingWork, PaneToolWork, reportToolResult } from "@/state/toolWork";
import { dismissAlert, workspaceStore } from "@/state/workspaceStore";

/**
 * The seam a tool is given for a change that holds the window still: a modal
 * with its title and phases, and a modal for how it ended. Upstream's
 * `SeamTests` give the seam a stub; here the real host is exercised.
 */
describe("a tool's blocking work", () => {
  afterEach(() => {
    blockingOperationStore.update(() => undefined);
    dismissAlert();
  });

  it("puts a modal up with its title, moves it through its phases and takes it down", () => {
    const work = beginBlockingWork("Adding a microcode", () => {});
    expect(work).toBeInstanceOf(PaneToolWork);
    expect(blockingOperationStore.getSnapshot()?.title).toBe("Adding a microcode");

    work.rename("Working out where it goes…");
    expect(blockingOperationStore.getSnapshot()?.name).toBe("Working out where it goes…");

    work.finish();
    expect(blockingOperationStore.getSnapshot()).toBeUndefined();
  });

  it("hands Cancel to the tool, which ends the modal by finishing", () => {
    let cancelled = 0;
    const work = beginBlockingWork("Removing a microcode", () => {
      cancelled += 1;
      work.finish();
    });

    blockingOperationStore.getSnapshot()?.operation.cancel();

    expect(cancelled).toBe(1);
    expect(blockingOperationStore.getSnapshot()).toBeUndefined();
  });

  it("tells a result in a modal, worded as a problem or as what was done", () => {
    reportToolResult("Could not add the microcode", "Nothing was written.", true);
    expect(workspaceStore.getSnapshot().alert).toEqual({
      title: "Could not add the microcode",
      message: "Nothing was written.",
      outcome: "problem",
    });

    reportToolResult("Microcode added", "The microcode went in at 0x2100.", false);
    expect(workspaceStore.getSnapshot().alert?.outcome).toBe("success");
  });
});
