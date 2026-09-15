import { describe, expect, it } from "vitest";
import { searchPatternEntry } from "@/core/search/searchPatternEntry";
import {
  commitCase,
  commitEncoding,
  commitName,
  commitPattern,
  differs,
  hasDraft,
  importReport,
  moveRow,
  patternComplaint,
  removeRow,
  storedRows,
  withDraft,
} from "@/ui/settings/favoritesTable";

const row = (name: string, pattern: string) =>
  searchPatternEntry({ name, pattern, encoding: "hex" });
const names = (rows: readonly { name: string }[]) => rows.map((each) => each.name);

describe("the line an import leaves under the table", () => {
  it("says what the import did, leaving out what it did not do", () => {
    expect(
      importReport({ kind: "imported", added: 2, changed: 0, removed: 1 }, "Mac.json")
    ).toEqual({ report: 'Imported "Mac.json": 2 added, 1 removed.' });
  });

  it("says when the file brought nothing new", () => {
    expect(
      importReport({ kind: "imported", added: 0, changed: 0, removed: 0 }, "Mac.json")
    ).toEqual({ report: '"Mac.json" holds nothing this browser does not already have.' });
  });

  it("calls a file that is not a library a problem", () => {
    expect(importReport({ kind: "unreadable" }, "notes.txt")).toEqual({
      problem: '"notes.txt" is not a ByteRipper pattern library.',
    });
  });

  it("says nothing while the resolver is asking", () => {
    expect(importReport({ kind: "asking", questions: 2 }, "Mac.json")).toEqual({});
  });
});

describe("the Favorites table", () => {
  it("keeps a pattern that is a search", () => {
    const { rows, message } = commitPattern([row("a", "11")], 0, " DE AD ");
    expect(rows[0]?.pattern).toBe("DE AD");
    expect(message).toBeUndefined();
  });

  it("refuses a pattern that is not, and says why", () => {
    const before = [row("a", "11")];
    const { rows, message } = commitPattern(before, 0, "DE A");
    expect(rows).toBe(before);
    expect(message).toBe('"DE A" is not hex — use pairs like DE AD BE EF.');
  });

  it("refuses an encoding the pattern cannot be read in", () => {
    const ascii = [searchPatternEntry({ name: "a", pattern: "é", encoding: "utf8" })];
    const { rows, message } = commitEncoding(ascii, 0, "ascii");
    expect(rows).toBe(ascii);
    expect(message).toBe(patternComplaint("é", "ascii"));
    expect(commitEncoding([row("a", "41")], 0, "ascii").rows[0]?.encoding).toBe("ascii");
  });

  it("trims a name and records a case rule", () => {
    expect(commitName([row("a", "11")], 0, "  ME FPT ").rows[0]?.name).toBe("ME FPT");
    expect(commitCase([row("a", "11")], 0, true).rows[0]?.caseSensitive).toBe(true);
  });

  it("holds one draft at a time, and stores none", () => {
    const first = withDraft([row("a", "11")]);
    expect(first.draft).toBe(1);
    expect(hasDraft(first.rows)).toBe(true);
    expect(withDraft(first.rows)).toEqual(first);
    expect(names(storedRows(first.rows))).toEqual(["a"]);
  });

  it("moves a row into the gap it was dropped in", () => {
    const rows = [row("a", "11"), row("b", "22"), row("c", "33")];
    expect(names(moveRow(rows, 0, 3))).toEqual(["b", "c", "a"]);
    expect(names(moveRow(rows, 2, 0))).toEqual(["c", "a", "b"]);
    expect(names(moveRow(rows, 1, 1))).toEqual(["a", "b", "c"]);
  });

  it("removes a row", () => {
    expect(names(removeRow([row("a", "11"), row("b", "22")], 0))).toEqual(["b"]);
  });

  it("does not count a list that says the same thing as a change", () => {
    const rows = [row("a", "11")];
    expect(
      differs(
        rows,
        rows.map((each) => ({ ...each, modifiedAt: 1 }))
      )
    ).toBe(false);
    expect(differs(rows, [{ ...rows[0], name: "b" } as (typeof rows)[number]])).toBe(true);
  });
});
