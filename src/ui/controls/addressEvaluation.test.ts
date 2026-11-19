import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ADDRESS_HISTORY_LIMIT,
  adoptAddressHistory,
  recentAddressEntries,
  recordAddress,
  setAddressHistoryStorage,
} from "@/state/addressHistoryStore";
import {
  addressBreakdown,
  addressHistoryRows,
  addressProblemMessage,
  addressResultText,
  addressValue,
  evaluateAddress,
  recordAddressInHistory,
} from "@/ui/controls/addressEvaluation";

/**
 * The one field an address or a length is typed in (issue #9): what it shows
 * beside the text, what it reads back, and the list of what was typed before.
 * Ported from `AddressFieldTests.swift`, and the history half of
 * `GoToBookmarksTests.swift`.
 */

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

beforeEach(() => setAddressHistoryStorage(memoryStorage()));
afterEach(() => setAddressHistoryStorage(undefined));

// @upstream ByteRipperTests/AddressFieldTests.swift#AddressFieldTests.testTheResultBesideTheText
describe("the result beside the text", () => {
  // Drawn for a sum, and for a lone number typed without its `0x` — `40` and
  // `0x40` being the mistake the field makes visible. A number already written
  // as the app writes one needs nothing beside it.
  const cases: [typed: string, result: string][] = [
    ["0x1FE000 + 40", "= 0x1FE028"],
    ["0x2C0000 - 1024", "= 0x2BFC00"],
    ["4096", "= 0x1000"],
    ["beef", "= 0xBEEF"],
    ["0x1000", ""],
    ["0X0007af00", ""],
    ["  0x10  ", ""],
    // Nothing to show for text that names no number.
    ["0x", ""],
    ["0x10 +", ""],
    ["0x10 - 0x20", ""],
    ["zz", ""],
  ];
  for (const [typed, result] of cases) {
    it(`"${typed}"`, () => expect(addressResultText(typed)).toBe(result));
  }
});

// @upstream ByteRipperTests/AddressFieldTests.swift#AddressFieldTests.testTheValueIsWhatTheTextComesTo
it("acts on what the text comes to", () => {
  expect(addressValue("0x1FE000 + 4096")).toBe(0x1ff000);
  expect(addressValue("0x10 +")).toBeUndefined();
  expect(evaluateAddress("0x10 +")).toEqual({ ok: false, reason: "incomplete" });
});

it("calls a result past what this application addresses invalid, as a lone number that large is", () => {
  expect(evaluateAddress("0x1FFFFFFFFFFFFF + 1")).toEqual({ ok: false, reason: "invalidInput" });
  expect(addressValue("0x1FFFFFFFFFFFFF + 1 - 1")).toBe(Number.MAX_SAFE_INTEGER);
});

// @upstream ByteRipperTests/AddressFieldTests.swift#AddressFieldTests.testTheBreakdownIsForASum
it("reads back only a sum: a lone number has its result beside it already", () => {
  expect(addressBreakdown("0x1FE000 + 40")).toBe("0x1FE000 + 0x28 = 0x1FE028 (2089000)");
  expect(addressBreakdown("4096")).toBeUndefined();
  expect(addressBreakdown("0x10 +")).toBeUndefined();
});

// @upstream ByteRipperTests/AddressFieldTests.swift#AddressFieldTests.testWhatGoesIntoTheHistory
it("keeps a sum as typed, and a lone number only where it was an address gone to", () => {
  recordAddressInHistory("4096");
  expect(recentAddressEntries()).toEqual([]);

  recordAddressInHistory("4096", true);
  expect(recentAddressEntries()).toEqual(["0x00001000"]);

  recordAddressInHistory("  0x1FE000 + 40 ");
  recordAddressInHistory("  0x1FE000 + 40 ");
  // As typed, once, most recent first.
  expect(recentAddressEntries()).toEqual(["0x1FE000 + 40", "0x00001000"]);

  recordAddressInHistory("0x10 +", true);
  expect(recentAddressEntries()).toHaveLength(2);
});

// @upstream ByteRipperTests/AddressFieldTests.swift#AddressFieldTests.testOneSumIsOneEntryHoweverItWasTyped
it("keeps one sum typed several ways as one entry, the latest typing standing", () => {
  recordAddress(0x7af00);
  for (const text of ["0x1FE000+40", "0x1FE000 + 40", "0x1fe000 + 0x28"]) {
    recordAddressInHistory(text);
  }
  recordAddressInHistory("0x7af00", true);
  expect(recentAddressEntries()).toEqual(["0x0007AF00", "0x1fe000 + 0x28"]);
});

// @upstream ByteRipperTests/AddressFieldTests.swift#AddressFieldTests.testTheListShowsSumsWithTheirResults
it("lists a sum with what it comes to, and gives the field the sum alone", () => {
  recordAddress(0x7af00);
  recordAddressInHistory("0x1FE000 + 40");
  expect(addressHistoryRows(recentAddressEntries())).toEqual([
    { entry: "0x1FE000 + 40", result: "0x1FE028" },
    { entry: "0x0007AF00", result: undefined },
  ]);
  expect(addressValue("0x1FE000 + 40")).toBe(0x1fe028);
});

// @upstream ByteRipperTests/AddressFieldTests.swift#AddressFieldTests.testTheProblemIsNamedOnlyForASum
it("names what is wrong only for a sum", () => {
  expect(addressProblemMessage("0x10")).toBeUndefined();
  expect(addressProblemMessage("zz")).toBeUndefined();
  // Too large, but no sum.
  expect(addressProblemMessage("0x1FFFFFFFFFFFFFFFF")).toBeUndefined();
  expect(addressProblemMessage("0xFFFFFFFFFFFFFFFF + 1")).toBe(
    "The result does not fit in 64 bits."
  );
  expect(addressProblemMessage("0x10 - 0x20")).toBe("The result is negative.");
  expect(addressProblemMessage("0x10 +")).toBe("The sum is not finished.");
});

// @upstream ByteRipperTests/AddressFieldTests.swift#AddressFieldTests.testAnEmptyListSaysSo
it("has no rows when nothing was entered yet", () => {
  expect(addressHistoryRows(recentAddressEntries())).toEqual([]);
});

// @upstream ByteRipperTests/GoToBookmarksTests.swift#GoToBookmarksTests.testTheHistoryKeepsTheLastTenMostRecentFirst
it("caps the list at its limit, newest first", () => {
  for (let offset = 0; offset < ADDRESS_HISTORY_LIMIT + 5; offset++) recordAddress(offset * 0x10);
  const recent = recentAddressEntries();
  expect(recent).toHaveLength(ADDRESS_HISTORY_LIMIT);
  expect(recent[0]).toBe(
    `0x${((ADDRESS_HISTORY_LIMIT + 4) * 0x10).toString(16).toUpperCase().padStart(8, "0")}`
  );
});

// @upstream ByteRipperTests/GoToBookmarksTests.swift#GoToBookmarksTests.testRecordingAnAddressAgainMovesItToTheFront
it("moves an address recorded again to the front, once", () => {
  recordAddress(0x10);
  recordAddress(0x20);
  recordAddress(0x10);
  expect(recentAddressEntries()).toEqual(["0x00000010", "0x00000020"]);
});

it("adopts the addresses a tab kept with its bookmarks, only into an empty list", () => {
  adoptAddressHistory([0x1000, 0x7af00]);
  expect(recentAddressEntries()).toEqual(["0x00001000", "0x0007AF00"]);
  adoptAddressHistory([0x20]);
  expect(recentAddressEntries()).toEqual(["0x00001000", "0x0007AF00"]);
});

it("reads a storage that refuses as an empty list", () => {
  setAddressHistoryStorage({
    getItem: () => {
      throw new Error("refused");
    },
    setItem: () => {
      throw new Error("refused");
    },
  });
  recordAddress(0x10);
  expect(recentAddressEntries()).toEqual([]);
});
