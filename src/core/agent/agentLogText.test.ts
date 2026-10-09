import { describe, expect, it } from "vitest";
import { detailFields, logText } from "@/core/agent/agentLogText";
import type { AgentCallRecord } from "@/core/agent/agentServer";

/** Ported from `AgentUITests`: what the window's log says of a call. */

const record = (overrides: Partial<AgentCallRecord> = {}): AgentCallRecord => ({
  id: 1,
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
});
