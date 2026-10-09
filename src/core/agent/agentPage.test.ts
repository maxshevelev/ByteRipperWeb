import { describe, expect, it } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import { AgentToolError } from "@/core/agent/agentTool";
import { type Json, jsonBytes } from "@/core/agent/json";

/** Ported from `AgentPageTests.swift`: a list answer cut to fit the answer bound, and the cursor that goes on. */

const items = (count: number, size = 100): Json[] =>
  Array.from({ length: count }, (_, n) => ({ n, pad: "x".repeat(size) }));

const page = (after?: string, fingerprint = "f") =>
  new AgentPage(new AgentArguments(after === undefined ? {} : { after }), fingerprint);

const refusal = (body: () => void): string | undefined => {
  try {
    body();
  } catch (error) {
    return error instanceof AgentToolError ? error.message : String(error);
  }
  return undefined;
};

type Answer = { [key: string]: Json };

describe("a page of a list", () => {
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentPageTests.swift#AgentPageTests.testAPageThatFitsIsUnchanged
  it("leaves a page that fits unchanged", () => {
    const answer = page().answer({ total: 3 }, "items", items(3), 3, 24 << 10) as Answer;
    expect((answer.items as Json[]).length).toBe(3);
    expect(answer.next).toBeNull();
    expect(answer.truncated).toBeUndefined();
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentPageTests.swift#AgentPageTests.testAPageCutByLimitHasANextAndNoMark
  it("gives a page cut by the limit a next and no mark", () => {
    const answer = page().answer({}, "items", items(10).slice(0, 4), 10, 24 << 10) as Answer;
    expect((answer.items as Json[]).length).toBe(4);
    expect(answer.next).toBe("4:f");
    expect(answer.truncated).toBeUndefined();
  });

  // Twice the bound's worth: the page stays within it, says why it is short, and the pages one
  // after another are every item once.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentPageTests.swift#AgentPageTests.testPagesCutBySizeStayInTheBoundAndAddUpToTheWhole
  it("stays in the bound when cut by size, and the pages add up to the whole", () => {
    const all = items(100, 400);
    const bound = 20_000;
    const seen: Json[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const paging = page(after);
      const candidates = all.slice(paging.first, paging.first + 1000);
      const answer = paging.answer(
        { totals: { items: 100 } },
        "items",
        candidates,
        all.length,
        bound
      ) as Answer;
      expect(jsonBytes(answer).length).toBeLessThanOrEqual(bound);
      const got = answer.items as Json[];
      expect(got.length).toBeGreaterThan(0);
      seen.push(...got);
      after = typeof answer.next === "string" ? answer.next : undefined;
      if (after !== undefined) expect(answer.truncated).toBe("size");
      pages += 1;
    } while (after !== undefined);
    expect(seen).toEqual(all);
    expect(pages).toBeGreaterThan(2);
  });

  // Several lists in turn: each keeps its key, and the cursor counts across.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentPageTests.swift#AgentPageTests.testListsInTurnArePagedAsOne
  it("pages lists in turn as one", () => {
    const sequence = [
      { key: "a", item: 1 },
      { key: "a", item: 2 },
      { key: "b", item: 3 },
      { key: "c", item: 4 },
    ];
    const first = page().answerLists({}, ["a", "b", "c"], sequence.slice(0, 3), 4, 1000) as Answer;
    expect(first.a).toEqual([1, 2]);
    expect(first.b).toEqual([3]);
    expect(first.c).toEqual([]);
    expect(first.next).toBe("3:f");
    const second = page("3:f").answerLists(
      {},
      ["a", "b", "c"],
      sequence.slice(3),
      4,
      1000
    ) as Answer;
    expect(second.a).toEqual([]);
    expect(second.c).toEqual([4]);
    expect(second.next).toBeNull();
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentPageTests.swift#AgentPageTests.testAnItemTooLargeAloneIsShortenedOrNamed
  it("shortens or names an item too large alone", () => {
    const huge: Json = { pad: "x".repeat(5000) };
    const shortened = page().answer({}, "items", [huge, 1], 2, 1000, () => ({
      pad: "xxx",
      truncated: "item",
    })) as Answer;
    expect(shortened.items).toEqual([{ pad: "xxx", truncated: "item" }, 1]);
    expect(shortened.next).toBeNull();
    expect(shortened.truncated).toBeUndefined();

    expect(refusal(() => page("7:f").answer({}, "items", [huge], 9, 1000))).toBe(
      "Item 7 alone is over the 1000-byte bound for one answer, even shortened; " +
        "narrow the question so it is not among the answers."
    );
  });

  // Items each too large alone are each shortened, as many to a page as fit shortened; one that
  // fits a page of its own is not shortened.
  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentPageTests.swift#AgentPageTests.testEveryItemTooLargeAloneIsShortenedWhereverItFalls
  it("shortens every item too large alone, wherever it falls", () => {
    const huge: Json = { pad: "x".repeat(5000) };
    const small: Json = { pad: "y".repeat(600) };
    const answer = page().answer({}, "items", [huge, huge, small, small, huge], 5, 1000, (item) =>
      item === huge ? { pad: "xxx", truncated: "item" } : undefined
    ) as Answer;
    expect(answer.items).toEqual([
      { pad: "xxx", truncated: "item" },
      { pad: "xxx", truncated: "item" },
      small,
    ]);
    expect(answer.next).toBe("3:f");
    expect(answer.truncated).toBe("size");
  });

  // @upstream Packages/AgentKit/Tests/AgentKitTests/AgentPageTests.swift#AgentPageTests.testACursorFromAnotherQuestionIsRefused
  it("refuses a cursor from another question", () => {
    expect(refusal(() => page("3:old", "new"))).toBe(
      "A document changed since that page, or the question did; ask again without `after`."
    );
    expect(refusal(() => page("three"))).toBe("`after` is not a `next` this tool gave.");
    expect(page("3:f").first).toBe(3);
  });
});
