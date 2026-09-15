import { describe, expect, it } from "vitest";
import { SearchCancelled } from "@/core/search/searchEngine";
import {
  type Attempt,
  attemptEncoding,
  attemptsFor,
  firstMatchAmong,
  looksLikeHexBytes,
} from "@/core/search/smartSearch";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { asArray } from "@/core/testing/support";

/** Ported from `SmartSearchTests.swift`. */

const storage = (bytes: number[]) => new MemoryBackedStorage(new Uint8Array(bytes));
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const utf16le = (text: string) => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++)
    out.push(text.charCodeAt(i) & 0xff, text.charCodeAt(i) >> 8);
  return out;
};

const shape = (attempts: Attempt[]) =>
  attempts.map(
    (attempt) => `${attempt.encodings.join("+")}:${asArray(attempt.pattern.bytes).join(",")}`
  );

describe("whether text was meant as hex", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testHexLooksLikeHex
  it("accepts what a dump prints", () => {
    expect(looksLikeHexBytes("DEADBEEF")).toBe(true);
    expect(looksLikeHexBytes("DE AD BE EF")).toBe(true);
    expect(looksLikeHexBytes("de ad")).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testAnythingElseIsText
  it("refuses what only happens to parse", () => {
    // A reader who means those four bytes writes them the way a dump prints
    // them; `DEAD BEEF` is a phrase.
    expect(looksLikeHexBytes("DEAD BEEF")).toBe(false);
    expect(looksLikeHexBytes("DEA")).toBe(false); // odd number of digits
    expect(looksLikeHexBytes("hello")).toBe(false);
    expect(looksLikeHexBytes("")).toBe(false);
    expect(looksLikeHexBytes("   ")).toBe(false);
  });
});

describe("what to try, and in what order", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testHexIsTriedFirstForAHexPattern
  it("tries hex first when the text reads as hex", () => {
    const attempts = attemptsFor("DEAD", true);
    expect(attempts[0]?.encodings).toEqual(["hex"]);
    expect(asArray(attempts[0]?.pattern.bytes ?? new Uint8Array())).toEqual([0xde, 0xad]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testEncodingsThatAskTheSameQuestionAreOneAttempt
  it("merges the encodings that ask the same question", () => {
    // `abc` as ASCII and as UTF-8 is the same three bytes compared the same
    // way; scanning the dump twice would be twice the wait for one answer.
    expect(shape(attemptsFor("abc", true))).toEqual([
      "ascii+utf8:97,98,99",
      "utf16LE:97,0,98,0,99,0",
      "utf16BE:0,97,0,98,0,99",
    ]);
  });

  it("adopts the narrower claim when a merged attempt wins", () => {
    const merged = attemptsFor("abc", true)[0];
    expect(merged && attemptEncoding(merged)).toBe("ascii");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testAnEncodingThatCannotCarryTheTextIsLeftOut
  it("leaves out an encoding that cannot hold the text", () => {
    // ASCII cannot carry é, so there is nothing to look for in it.
    const attempts = attemptsFor("café", true);
    expect(attempts.every((attempt) => !attempt.encodings.includes("ascii"))).toBe(true);
    expect(attempts[0]?.encodings).toEqual(["utf8"]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testAPreferredEncodingGoesFirst
  it("puts a preferred encoding in front and does not repeat it", () => {
    const attempts = attemptsFor("abc", true, "utf16BE");
    expect(attempts[0]?.encodings).toEqual(["utf16BE"]);
    expect(attempts.filter((a) => a.encodings.includes("utf16BE"))).toHaveLength(1);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testTheCaseFlagRidesWithEachAttempt
  it("treats case sensitivity as part of the question", () => {
    expect(attemptsFor("abc", true)[0]?.folding).toEqual({ kind: "exact" });
    expect(attemptsFor("abc", false)[0]?.folding).toEqual({ kind: "asciiBytes" });
  });

  it("yields nothing for text no encoding can carry", () => {
    expect(attemptsFor("", true)).toEqual([]);
  });
});

describe("the pass", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testThePassAdoptsTheFirstEncodingThatFindsAnything
  it("takes the first encoding that finds anything", async () => {
    // The string is stored UTF-16LE, so ASCII and UTF-8 find nothing and the
    // pass moves on rather than stopping at the first miss.
    const bytes = [0, 0, ...utf16le("Setup"), 0, 0];
    const outcome = await firstMatchAmong(attemptsFor("Setup", true), storage(bytes), { from: 0 });

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(attemptEncoding(outcome.attempt)).toBe("utf16LE");
    expect(outcome.range).toEqual({ start: 2, end: 12 });
    expect(outcome.wrapped).toBe(false);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testAnAttemptWrapsBeforeTheNextEncodingIsTried
  it("wraps rather than reporting nothing ahead of the caret", async () => {
    // "this encoding finds nothing" has to mean nothing anywhere in the file,
    // or the pass would move to the next encoding while the answer was behind
    // the caret all along.
    const bytes = [...ascii("target"), ...new Array(20).fill(0)];
    const outcome = await firstMatchAmong(attemptsFor("target", true), storage(bytes), {
      from: 10,
    });

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.range).toEqual({ start: 0, end: 6 });
    expect(outcome.wrapped).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testAPassThatFindsNothingSaysSo
  it("reports nothing when no encoding finds it anywhere", async () => {
    const outcome = await firstMatchAmong(
      attemptsFor("missing", true),
      storage(new Array(64).fill(0)),
      { from: 0 }
    );
    expect(outcome.kind).toBe("nothing");
  });

  it("finds hex bytes before trying to read them as text", async () => {
    const bytes = [0, 0, 0xde, 0xad, 0, 0, ...ascii("DEAD")];
    const outcome = await firstMatchAmong(attemptsFor("DEAD", true), storage(bytes), { from: 0 });

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(attemptEncoding(outcome.attempt)).toBe("hex");
    expect(outcome.range).toEqual({ start: 2, end: 4 });
  });

  it("goes backwards when asked", async () => {
    // Backward means the last match whose *end* is at or before the anchor, so
    // an anchor at 6 still finds the match occupying 4..6.
    const bytes = [...ascii("aa"), 0, 0, ...ascii("aa")];
    const at = async (from: number) => {
      const outcome = await firstMatchAmong(attemptsFor("aa", true), storage(bytes), {
        from,
        direction: "backward",
      });
      return outcome.kind === "found" ? `${outcome.range.start}-${outcome.range.end}` : "nothing";
    };
    expect(await at(6)).toBe("4-6");
    expect(await at(5)).toBe("0-2");
    // Before the first match, the pass wraps to the last one.
    expect(await at(1)).toBe("4-6");
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testProgressCoversTheWholePass
  it("reports progress across the whole pass", async () => {
    const seen: number[] = [];
    await firstMatchAmong(attemptsFor("missing", true), storage(new Array(64).fill(0)), {
      from: 0,
      onProgress: (value) => seen.push(value),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    // Every attempt's share is covered, so the last one ends at the end.
    expect(seen[seen.length - 1]).toBe(1);
  });
});

describe("what is tried, beyond upstream's first cases", () => {
  const encodings = (attempts: Attempt[]) => attempts.map(attemptEncoding);

  // Text is tried ASCII first, then the UTF-16 pair — and never as hex, because
  // it does not look like hex.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testATextPatternIsNeverTriedAsHex
  it("never tries a text pattern as hex", () => {
    const attempts = attemptsFor("boot", false);
    expect(attempts.every((attempt) => !attempt.encodings.includes("hex"))).toBe(true);
    // UTF-8 asks the same question as ASCII here, so it is not asked twice.
    expect(encodings(attempts)).toEqual(["ascii", "utf16LE", "utf16BE"]);
    expect(asArray(attempts[0]?.pattern.bytes ?? new Uint8Array())).toEqual(ascii("boot"));
    expect(asArray(attempts[1]?.pattern.bytes ?? new Uint8Array())).toEqual([
      0x62, 0, 0x6f, 0, 0x6f, 0, 0x74, 0,
    ]);
    expect(asArray(attempts[2]?.pattern.bytes ?? new Uint8Array())).toEqual([
      0, 0x62, 0, 0x6f, 0, 0x6f, 0, 0x74,
    ]);
  });

  // Nothing to look for is not a list of nothing to look for: an empty field
  // yields no attempts at all. Spaces are not nothing, though — three of them are
  // three bytes a dump may well hold.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testAnEmptyFieldYieldsNoAttempts
  it("yields no attempts for an empty field, and some for spaces", () => {
    expect(attemptsFor("", false)).toEqual([]);
    expect(asArray(attemptsFor("   ", false)[0]?.pattern.bytes ?? new Uint8Array())).toEqual([
      0x20, 0x20, 0x20,
    ]);
  });

  // Preferring hex for a pattern that does not read as hex still tries the bytes
  // first — the user asked for them — and preferring one that cannot read the
  // text at all changes nothing.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testAPreferredEncodingIsTriedEvenAgainstTheHexRule
  it("tries a preferred encoding even against the hex rule", () => {
    const hexFirst = attemptsFor("beef", false, "hex");
    expect(hexFirst[0] === undefined ? undefined : attemptEncoding(hexFirst[0])).toBe("hex");
    expect(asArray(hexFirst[0]?.pattern.bytes ?? new Uint8Array())).toEqual([0xbe, 0xef]);

    // ASCII cannot carry it, so there is nothing to try first.
    expect(encodings(attemptsFor("ключ", false, "ascii"))).toEqual(["utf8", "utf16LE", "utf16BE"]);
    // And `boot` is no more hex for having been asked for as hex.
    expect(encodings(attemptsFor("boot", false, "hex"))).toEqual(["ascii", "utf16LE", "utf16BE"]);
  });

  // Cancelling stops the pass where it is: several scans of a file is a wait
  // worth being able to stop.
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SmartSearchTests.swift#SmartSearchTests.testCancellingStopsThePass
  it("stops the pass when cancelled", async () => {
    let scans = 0;
    await expect(
      firstMatchAmong(attemptsFor("boot", false), storage(new Array(4096).fill(0xff)), {
        from: 0,
        chunkSize: 512,
        shouldCancel: () => {
          scans += 1;
          return scans > 2;
        },
      })
    ).rejects.toBeInstanceOf(SearchCancelled);
  });
});
