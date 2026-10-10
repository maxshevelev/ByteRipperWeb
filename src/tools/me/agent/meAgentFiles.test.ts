import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import { type Json, jsonText, member } from "@/core/agent/json";
import { EXTENTS_SHORTENED, filesAnswer } from "@/tools/me/agent/meAgentFiles";
import type { MEFileRow, MEFileSide } from "@/tools/meFileComparison";

/**
 * How `me_files_compare` words a comparison.
 *
 * @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentFilesTests.swift#MEAAgentFilesTests
 */

const side = (extents: { start: number; end: number }[], size = 0x40): MEFileSide => ({
  storedSize: size,
  contentSize: size,
  extents,
  contentDigest: undefined,
  integrity: undefined,
  complete: true,
});

const row = (
  key: number,
  status: MEFileRow["status"],
  options: { name?: string; moved?: boolean; rewritten?: boolean; differing?: number } = {}
): MEFileRow => ({
  volume: "mfs",
  key,
  name: options.name,
  status,
  a: status === "onlyInB" ? undefined : side([{ start: 0x100, end: 0x140 }]),
  b: status === "onlyInA" ? undefined : side([{ start: 0x200, end: 0x240 }]),
  moved: options.moved ?? false,
  differingBytes: options.differing,
  integrityDiffers: options.rewritten,
  encrypted: undefined,
});

const page = (after?: string) =>
  new AgentPage(new AgentArguments(after === undefined ? {} : { after }), "f");

const BOUND = 24 << 10;

describe("me_files_compare's answer", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentFilesTests.swift#MEAAgentFilesTests.testAFileTooLargeForOneAnswerKeepsItsFirstStretches
  it("keeps the first stretches of a file too large for one answer, and says so", () => {
    const many = Array.from({ length: 2000 }, (_, index) => ({
      start: 0x1000 + index * 0x42,
      end: 0x1040 + index * 0x42,
    }));
    const big: MEFileRow = { ...row(4, "different"), a: side(many, many.length * 0x40) };
    const answer = filesAnswer(
      { rows: [big], gaps: [] },
      undefined,
      undefined,
      true,
      40,
      page(),
      BOUND
    );
    const item = (member(answer, "different") as Json[])[0];
    expect(member(item, "truncated")).toBe("item");
    expect((member(member(item, "extents"), "document") as Json[]).length).toBe(EXTENTS_SHORTENED);
    expect(member(member(item, "extents"), "document_total")).toBe(2000);
    expect(jsonText(answer).length).toBeLessThanOrEqual(BOUND);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentFilesTests.swift#MEAAgentFilesTests.testTheAnswerCountsMovedAndRewrittenFilesAmongTheSame
  it("counts the moved and the rewritten among the same", () => {
    const comparison = {
      rows: [
        row(1, "same", { moved: true }),
        row(2, "same", { rewritten: true }),
        row(3, "same"),
        row(4, "different", { name: "/home/mca/eom", rewritten: true, differing: 3 }),
        row(5, "onlyInA"),
        row(6, "onlyInB"),
      ],
      gaps: [{ volume: "efs" as const, inA: false, reason: "unreadable" as const }],
    };
    const answer = filesAnswer(comparison, undefined, undefined, false, 40, page(), BOUND);
    expect(member(answer, "counts")).toEqual({
      same: 3,
      moved: 1,
      rewritten: 1,
      different: 1,
      only_in_document: 1,
      only_in_against: 1,
    });
    expect(member(answer, "different")).toEqual([
      {
        volume: "mfs",
        index: 4,
        name: "/home/mca/eom",
        size: { document: "0x40", against: "0x40" },
        differing_bytes: 3,
        integrity_differs: true,
      },
    ]);
    expect(member(answer, "not_compared")).toEqual([
      {
        volume: "efs",
        in: "against",
        reason:
          "The EFS partition holds no volume that could be read; its System page may be erased.",
      },
    ]);
  });

  // @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentFilesTests.swift#MEAAgentFilesTests.testTheListsAreNarrowedAndCut
  it("narrows by name and volume, and cuts into pages without skipping one", () => {
    const comparison = {
      rows: [
        row(1, "different", { name: "/home/a" }),
        row(2, "different", { name: "/home/b" }),
        row(3, "different", { name: "/fpf/c" }),
      ],
      gaps: [],
    };
    const narrowed = filesAnswer(comparison, undefined, "HOME", false, 40, page(), BOUND);
    expect(member(member(narrowed, "counts"), "different")).toBe(2);
    const cut = filesAnswer(comparison, undefined, undefined, false, 1, page(), BOUND);
    expect((member(cut, "different") as Json[]).length).toBe(1);
    expect(member(member(cut, "counts"), "different")).toBe(3);
    const second = filesAnswer(
      comparison,
      undefined,
      undefined,
      false,
      1,
      page(member(cut, "next") as string),
      BOUND
    );
    expect(member((member(second, "different") as Json[])[0], "index")).toBe(2);
    const efsOnly = filesAnswer(comparison, "efs", undefined, false, 40, page(), BOUND);
    expect(member(member(efsOnly, "counts"), "different")).toBe(0);
  });
});

describe("me_files_compare's extents", () => {
  // @upstream Modules/MEATool/Tests/MEAToolTests/MEAAgentFilesTests.swift#MEAAgentFilesTests.testExtentsAreGivenOnlyWhenAskedFor
  it("gives a file's extents only when asked for", () => {
    const comparison = { rows: [row(4, "different")], gaps: [] };
    const plain = filesAnswer(comparison, undefined, undefined, false, 40, page(), BOUND);
    expect(member((member(plain, "different") as Json[])[0], "extents")).toBeUndefined();
    const placed = filesAnswer(comparison, undefined, undefined, true, 40, page(), BOUND);
    expect(member((member(placed, "different") as Json[])[0], "extents")).toEqual({
      document: [{ start: "0x100", end: "0x140" }],
      against: [{ start: "0x200", end: "0x240" }],
    });
  });
});
