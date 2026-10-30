import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, member } from "@/core/agent/json";
import { withEnglish } from "@/core/localization/localization";
import type { MFSStateBasis } from "@/firmware/me/models/firmwareFacts";
import {
  efsText,
  explanation,
  manufacturingBasisJson,
  meSummaryAnswer,
  meTreeAnswer,
  reservedText,
} from "@/tools/me/agent/meAgentAnswers";
import { analysisWith, manifestFixture, mfsVolumeFixture, versionWith } from "@/tools/meaTesting";
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
    // The explanation is what the row reads: the state, then the evidence in brackets. The
    // address of the EFS partition it could not read is in the structured fields beside it, where
    // the panel has room for it.
    const text = withEnglish(() => explanation("configured", basis));
    expect(text).toBe("Configured (configuration: FITC; EFS: unreadable)");
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
      "Initialized (EFS: holds files)"
    );
    expect(reservedText({ kind: "initializing", indices: [2, 8] })).toBe(
      "present: file 2, file 8, which mean Initialized"
    );
  });
});

describe("the Manufacturing verdict's basis", () => {
  // What an agent is told the Manufacturing verdict rests on: an agent that reads "Will close on
  // first boot" and acts on it must be able to see which record the flag came from, what End of
  // Manufacturing will commit, and what the descriptor said beside it.
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentQueriesTests.swift#MEAAgentQueriesTests.testTheManufacturingVerdictCarriesItsEvidence
  it("carries its evidence", () => {
    const json = manufacturingBasisJson("willClose", {
      flag: true,
      flexible: 0,
      page: "imageConfiguration",
      descriptorOpen: false,
      liveFilesResolved: true,
    });
    expect(member(json, "flag")).toBe(true);
    expect(member(json, "flexible_eom_settings")).toBe(0);
    expect(member(json, "flag_page")).toBe("imageConfiguration");
    expect(member(json, "descriptor")).toBe("locked");
    expect(member(json, "live_files")).toBe("read");
    // What the row itself reads, brackets and all.
    expect(member(json, "explanation")).toBe(
      "Will close on the EOM flag (EOM: on, descriptor: locked)"
    );

    // A region read without a descriptor, and with a file system the database could not name:
    // both are said rather than left out.
    const sparse = manufacturingBasisJson("willClose", {
      flag: true,
      flexible: 1,
      page: "liveMFS",
      descriptorOpen: undefined,
      liveFilesResolved: false,
    });
    expect(member(sparse, "descriptor")).toBe("not read");
    expect(member(sparse, "live_files")).toBe("not read");
    expect(member(sparse, "flag_page")).toBe("liveMFS");
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
    // The row as it reads, the evidence in brackets.
    expect(member(state, "value")).toBe("Configured (configuration: FITC)");
    expect(member(state, "tone")).toBe("good");
    expect(member(member(state, "basis"), "decided_by")).toBe("configuration");
    expect(member(member(state, "basis"), "complete")).toBe(true);
  });

  // The Manufacturing verdict's evidence rides on the row the Summary names "EOM on First
  // Boot", and the Boot Guard row carries the profile and its index beside its words.
  // @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.summary
  // @upstream-differs upstream attaches the basis to a row labelled "Manufacturing", which no row
  // has carried since c6e5f94f; the web matches "EOM on First Boot"
  it("attaches the Manufacturing basis to the EOM on First Boot row, and the profile to Boot Guard", () => {
    const answer = withEnglish(() =>
      meSummaryAnswer(
        analysisWith({
          manifest: manifestFixture(),
          version: versionWith(16, 1, 25, 1991),
          manufacturingState: "willNotClose",
          manufacturingBasis: {
            flag: false,
            flexible: 0,
            page: "imageConfiguration",
            descriptorOpen: true,
            liveFilesResolved: true,
          },
          bootGuardProfile: "5",
        })
      )
    );
    const rows = (member(answer, "blocks") as Json[]).flatMap(
      (block) => member(block, "rows") as Json[]
    );
    const eom = rows.find((row) => member(row, "label") === "EOM on First Boot");
    expect(member(eom, "value")).toBe("Will not close (EOM: off, descriptor: open)");
    expect(member(eom, "tone")).toBe("good");
    const basis = member(eom, "basis");
    expect(member(basis, "flag")).toBe(false);
    expect(member(basis, "descriptor")).toBe("open");
    expect(member(basis, "explanation")).toBe("Will not close (EOM: off, descriptor: open)");
    expect(rows.find((row) => member(row, "label") === "Manufacturing")).toBeUndefined();

    const bootGuard = rows.find((row) => member(row, "label") === "Boot Guard");
    expect(member(bootGuard, "value")).toBe("5 - FVME");
    expect(member(bootGuard, "profile")).toBe("5");
    expect(member(bootGuard, "profile_index")).toBe(3);
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
