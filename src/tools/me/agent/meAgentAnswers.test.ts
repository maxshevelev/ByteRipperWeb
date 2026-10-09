import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, member } from "@/core/agent/json";
import { withEnglish } from "@/core/localization/localization";
import type { MFSStateBasis } from "@/firmware/me/models/firmwareFacts";
import {
  efsText,
  explanation,
  meSummaryAnswer,
  meTreeAnswer,
  reservedText,
} from "@/tools/me/agent/meAgentAnswers";
import { analysisWith, mfsVolumeFixture } from "@/tools/meaTesting";
import { presentMEA } from "@/tools/meaTree";

/**
 * What an agent is told of the ME region: what the File System State rests on, the summary and the
 * tree.
 *
 * @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentQueriesTests.swift#MEAAgentQueriesTests
 */

describe("the File System State's basis", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentQueriesTests.swift#MEAAgentQueriesTests.testAConfiguredStateWithAnUnreadableEFSSaysWhatIsUnknown
  it("says what is unknown when the EFS could not be read", () => {
    const basis: MFSStateBasis = {
      reservedFiles: { kind: "notRead" },
      efs: { kind: "unreadable", offset: 0x267000 },
      configuration: ["FITC"],
      decidedBy: "configuration",
    };
    const text = withEnglish(() => explanation("configured", basis));
    expect(text.startsWith("Configured, from the configuration found (FITC), not from files")).toBe(
      true
    );
    expect(text).toContain("The EFS partition at 0x267000 could not be read");
    expect(text).toContain("is unknown");
    expect(efsText(basis.efs)).toBe(
      "unreadable: the partition table lists an EFS partition at 0x267000, but no EFS volume could be read there"
    );
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentQueriesTests.swift#MEAAgentQueriesTests.testAnInitializedStateFromTheEFSNeedsNoCaveat
  it("needs no caveat for an initialized state the EFS decided", () => {
    const basis: MFSStateBasis = {
      reservedFiles: { kind: "notRead" },
      efs: { kind: "holdsFiles" },
      configuration: ["FITC"],
      decidedBy: "efs",
    };
    expect(withEnglish(() => explanation("initialized", basis))).toBe(
      "Initialized, because the EFS volume holds file content: the engine has run and written its files."
    );
    expect(reservedText({ kind: "initializing", indices: [2, 8] })).toBe(
      "present: file 2, file 8, which mean Initialized"
    );
  });
});

describe("me_summary", () => {
  it("gives the summary's rows, with a verdict's tone and the state's basis", () => {
    const answer = withEnglish(() =>
      meSummaryAnswer(
        analysisWith({
          mfsState: "configured",
          mfsStateBasis: {
            reservedFiles: { kind: "notRead" },
            efs: { kind: "noPartition" },
            configuration: ["FITC"],
            decidedBy: "configuration",
          },
        })
      )
    );
    const blocks = member(answer, "blocks") as Json[];
    const rows = blocks.flatMap((block) => member(block, "rows") as Json[]);
    expect(rows.find((row) => member(row, "label") === "Family")).toBeDefined();
    const state = rows.find((row) => member(row, "label") === "File System State");
    expect(member(state, "value")).toBe("Configured");
    expect(member(member(state, "basis"), "decided_by")).toBe("configuration");
    expect(member(member(state, "basis"), "complete")).toBe(true);
  });
});

describe("me_tree", () => {
  const roots = presentMEA(analysisWith({ mfsVolume: mfsVolumeFixture(), regions: [] }), undefined);

  it("gives the top groups, and a node's fields with its children", () => {
    const top = withEnglish(() => meTreeAnswer(roots, new AgentArguments({}), 1));
    expect(member(top, "total")).toBe(roots.length);
    const first = (member(top, "children") as Json[])[0];
    expect(member(first, "id")).toBe("0");
    const node = withEnglish(() => meTreeAnswer(roots, new AgentArguments({ node: "0" }), 1));
    expect((member(member(node, "node"), "fields") as Json[]).length).toBeGreaterThan(0);
  });

  it("refuses an id that is no node, and one that is no id", () => {
    expect(() => meTreeAnswer(roots, new AgentArguments({ node: "99.1" }), 1)).toThrow(
      "No ME node 99.1. Ids come from `me_tree` on the same document."
    );
    expect(() => meTreeAnswer(roots, new AgentArguments({ node: "x" }), 1)).toThrow(
      "`x` is not an ME node id."
    );
  });

  it("pages its children and refuses a page of another question", () => {
    const first = withEnglish(() => meTreeAnswer(roots, new AgentArguments({ limit: 1 }), 1));
    const next = member(first, "next") as string;
    expect(next).toBeTypeOf("string");
    const second = withEnglish(() =>
      meTreeAnswer(roots, new AgentArguments({ limit: 1, after: next }), 1)
    );
    expect((member(second, "children") as Json[]).length).toBe(1);
    expect(() => meTreeAnswer(roots, new AgentArguments({ limit: 1, after: next }), 2)).toThrow();
  });
});
