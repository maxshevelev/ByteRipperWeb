import { describe, expect, it } from "vitest";
import {
  changeMicrocode,
  type MicrocodeChangeResult,
  microcodeChangeWords,
  microcodeDoneTitle,
} from "@/tools/fit/fitChange";
import type { ToolWork } from "@/tools/toolModule";

/**
 * Ported from `FITToolFlowTests`: a change to the microcodes is a modal over
 * the window while it is worked out, and a modal for how it ended — the panel's
 * own line says nothing of it. The web's level is the flow itself, fed a host
 * that records what it was asked to put up.
 */

/** A host that keeps the modals it was asked for, and what they were told. */
function recordingHost() {
  const log: string[] = [];
  const phases: string[] = [];
  const results: { title: string; message: string; isProblem: boolean }[] = [];
  let cancel: (() => void) | undefined;
  const host = {
    beginBlockingWork(title: string, onCancel: () => void): ToolWork {
      log.push(`begin ${title}`);
      cancel = onCancel;
      return {
        rename: (phase) => phases.push(phase),
        finish: () => log.push("finish"),
      };
    },
    reportResult(title: string, message: string, isProblem: boolean) {
      log.push(`report ${title}`);
      results.push({ title, message, isProblem });
    },
  };
  return { host, log, phases, results, pressCancel: () => cancel?.() };
}

const refused = (problem: string): MicrocodeChangeResult => ({
  problem,
  summary: undefined,
  kind: undefined,
});

describe("a change to the microcodes", () => {
  it("is refused in a modal worded as a problem, after the progress modal is gone", async () => {
    // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testARefusalIsASheetAndAudible
    // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testRemovingARowThatIsNotMicrocodeIsRefused
    const { host, log, results } = recordingHost();

    await changeMicrocode(host, { kind: "addOrReplace" }, async () =>
      refused("That file does not start with an Intel microcode header.")
    );

    expect(log).toEqual([
      "begin Adding a microcode",
      "finish",
      "report Could not add the microcode",
    ]);
    expect(results).toEqual([
      {
        title: "Could not add the microcode",
        message: "That file does not start with an Intel microcode header.",
        isProblem: true,
      },
    ]);
  });

  it("says what was done, and that undo takes it back, once the progress modal is gone", async () => {
    // @upstream ByteRipperTests/FITToolFlowTests.swift#FITToolFlowTests.testASuccessIsASheetAndTheProgressSheetIsGone
    const { host, log, phases, results } = recordingHost();

    await changeMicrocode(host, { kind: "addOrReplace" }, async () => ({
      problem: undefined,
      summary: "The microcode went in at 0x2100.",
      kind: "added",
    }));

    expect(phases).toEqual(["Working out where it goes…"]);
    expect(log).toEqual(["begin Adding a microcode", "finish", "report Microcode added"]);
    expect(results[0]?.isProblem).toBe(false);
    expect(results[0]?.message.startsWith("The microcode went in at 0x2100.")).toBe(true);
    expect(results[0]?.message.endsWith("Undo takes it back.")).toBe(true);
  });

  it("is titled by what it came to: put in, put in the place of another, taken out", () => {
    expect(microcodeDoneTitle("added")).toBe("Microcode added");
    expect(microcodeDoneTitle("replaced")).toBe("Microcode replaced");
    expect(microcodeDoneTitle("removed")).toBe("Microcode removed");
    expect(microcodeChangeWords({ kind: "replaceAt" })).toEqual({
      sheetTitle: "Replacing a microcode",
      couldNot: "Could not replace the microcode",
    });
    expect(microcodeChangeWords({ kind: "remove" })).toEqual({
      sheetTitle: "Removing a microcode",
      couldNot: "Could not remove the microcode",
    });
  });

  it("drops the plan when Cancel is pressed, and says nothing of it", async () => {
    const { host, log, results, pressCancel } = recordingHost();
    let landed = false;

    await changeMicrocode(host, { kind: "remove" }, async (cancelled) => {
      pressCancel();
      // The plan is complete — but nothing is written for a change that was
      // abandoned, which is what `cancelled` is asked for.
      landed = !cancelled();
      return { problem: undefined, summary: "The microcode is out of the table.", kind: "removed" };
    });

    expect(landed).toBe(false);
    expect(results).toEqual([]);
    expect(log[0]).toBe("begin Removing a microcode");
    expect(log).not.toContain("report Microcode removed");
  });

  it("says nothing for a change that was superseded", async () => {
    const { host, results } = recordingHost();

    await changeMicrocode(host, { kind: "remove" }, async () => ({
      problem: undefined,
      summary: undefined,
      kind: undefined,
    }));

    expect(results).toEqual([]);
  });
});
