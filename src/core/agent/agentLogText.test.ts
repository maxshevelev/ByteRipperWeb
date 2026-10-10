import { describe, expect, it } from "vitest";
import { detailFields, isProblem, logText } from "@/core/agent/agentLogText";
import type { AgentCallRecord } from "@/core/agent/agentServer";

/** Ported from `AgentUITests`: what the window's log says of a call. */

const record = (overrides: Partial<AgentCallRecord> = {}): AgentCallRecord => ({
  id: 1,
  started: new Date(2026, 9, 9, 15, 4, 5),
  client: "claude-code",
  tool: "read",
  arguments: { offset: "0x10", length: 16 },
  durationMilliseconds: 12.4,
  finished: new Date(2026, 9, 9, 15, 4, 5),
  answerBytes: 1536,
  outcome: { kind: "answered" },
  ...overrides,
});

describe("the log's words", () => {
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheWindowLogsEachCallWithItsArgumentsAndResult
  it("shows the arguments as the agent wrote them, and nothing for none", () => {
    expect(logText(record(), "arguments")).toBe('{"length":16,"offset":"0x10"}');
    expect(logText(record({ arguments: {} }), "arguments")).toBe("");
    expect(logText(record(), "time")).toBe("15:04:05");
    expect(logText(record(), "tool")).toBe("read");
  });

  it("says how long a call took, in milliseconds and then in seconds", () => {
    expect(logText(record(), "duration")).toBe("12 ms");
    expect(logText(record({ durationMilliseconds: 2400 }), "duration")).toBe("2.4 s");
  });

  it("puts the outcome in the result's words", () => {
    expect(logText(record(), "result")).toBe("Answered");
    expect(
      logText(record({ outcome: { kind: "toolError", message: "No file is open." } }), "result")
    ).toBe("No file is open.");
    expect(logText(record({ outcome: { kind: "overBound" } }), "result")).toBe(
      "Too long, not sent"
    );
    expect(logText(record({ outcome: { kind: "cancelled" } }), "result")).toBe("Cancelled");
  });

  it("lists the details with the client and marks a problem", () => {
    const fields = detailFields(record({ outcome: { kind: "overBound" } }));
    expect(fields.map((field) => field.label)).toEqual([
      "Time",
      "Client",
      "Took",
      "Answer",
      "Result",
    ]);
    expect(fields.at(-1)?.isProblem).toBe(true);
    expect(detailFields(record({ client: undefined })).map((field) => field.label)).toEqual([
      "Time",
      "Took",
      "Answer",
      "Result",
    ]);
  });

  /**
   * The log shows a request while the tool is still working on it: when it came in, a time that
   * counts up, no size yet, and "Running…" — which is no problem.
   */
  // @upstream ByteRipperTests/AgentUITests.swift#AgentUITests.testTheLogShowsARequestWhileItRuns
  it("shows a request while it runs, counting up", () => {
    const started = new Date(2026, 9, 9, 15, 4, 5);
    const running = record({
      started,
      finished: new Date(2026, 9, 9, 15, 4, 5),
      durationMilliseconds: 0,
      answerBytes: 0,
      outcome: { kind: "running" },
    });
    expect(logText(running, "result")).toBe("Running…");
    expect(logText(running, "time")).toBe("15:04:05");
    expect(logText(running, "duration", started)).toBe("0 s");
    expect(logText(running, "duration", new Date(started.getTime() + 7400))).toBe("7 s");
    expect(logText(running, "size")).toBe("");
    expect(isProblem(running)).toBe(false);
    expect(detailFields(running).map((field) => field.label)).toEqual(["Time", "Client", "Result"]);
  });
});
