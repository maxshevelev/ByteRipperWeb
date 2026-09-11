import { describe, expect, it } from "vitest";
import { MatchSetBuilder } from "@/core/search/matchSet";
import {
  findOne,
  foldedPattern,
  indexOfBytes,
  SearchCancelled,
  scanAll,
} from "@/core/search/searchEngine";
import {
  type CaseFolding,
  foldingFor,
  parsePattern,
  patternHexText,
  type SearchEncoding,
} from "@/core/search/searchPattern";
import { MemoryBackedStorage } from "@/core/storage/memoryBackedStorage";
import { asArray, SeededRandom } from "@/core/testing/support";

/** Ported from `SearchEngineTests.swift`. */

const storage = (bytes: number[] | Uint8Array) =>
  new MemoryBackedStorage(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const utf16le = (text: string) => {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    out.push(text.charCodeAt(i) & 0xff, text.charCodeAt(i) >> 8);
  }
  return out;
};

/** A search with folding applied to both sides, as the engine's callers do. */
async function find(
  pattern: number[],
  bytes: number[],
  options: {
    from?: number;
    direction?: "forward" | "backward";
    folding?: CaseFolding;
    chunkSize?: number;
  } = {}
) {
  const folding = options.folding ?? { kind: "exact" };
  const found = await findOne(foldedPattern(new Uint8Array(pattern), folding), storage(bytes), {
    folding,
    ...(options.from === undefined ? {} : { from: options.from }),
    ...(options.direction === undefined ? {} : { direction: options.direction }),
    ...(options.chunkSize === undefined ? {} : { chunkSize: options.chunkSize }),
  });
  return found === undefined ? undefined : `${found.start}-${found.end}`;
}

describe("parsing a pattern", () => {
  const parsed = (text: string, encoding: SearchEncoding) => {
    const result = parsePattern(text, encoding);
    return result.ok ? asArray(result.pattern.bytes) : result.reason;
  };

  it("accepts every hex spelling", () => {
    for (const text of ["DEADBEEF", "de ad be ef", "DE AD BE EF", "0xDE 0xAD 0xBE 0xEF"]) {
      expect(parsed(text, "hex"), text).toEqual([0xde, 0xad, 0xbe, 0xef]);
    }
  });

  it("refuses malformed hex rather than guessing", () => {
    expect(parsed("DEAD BEE", "hex")).toBe("invalidHexPattern");
    expect(parsed("ZZ", "hex")).toBe("invalidHexPattern");
    expect(parsed("", "hex")).toBe("emptyPattern");
  });

  it("encodes text in each encoding", () => {
    expect(parsed("Hi", "ascii")).toEqual([0x48, 0x69]);
    expect(parsed("Café", "utf8")).toEqual([0x43, 0x61, 0x66, 0xc3, 0xa9]);
    expect(parsed("Hi", "utf16LE")).toEqual([0x48, 0x00, 0x69, 0x00]);
    expect(parsed("Hi", "utf16BE")).toEqual([0x00, 0x48, 0x00, 0x69]);
  });

  it("refuses a character ASCII cannot hold", () => {
    // ASCII is the narrower claim, so this is a refusal rather than a silent
    // coercion into something the file does not contain.
    expect(parsed("Café", "ascii")).toBe("undecodableText");
  });

  it("shows the bytes back the way a dump prints them", () => {
    const result = parsePattern("deadbeef", "hex");
    expect(result.ok && patternHexText(result.pattern)).toBe("DE AD BE EF");
  });
});

describe("finding one match", () => {
  const haystack = [0xde, 0xad, 0xbe, 0x00, 0xde, 0xad, 0xbe, 0xde, 0xad];

  it("finds it at the start, the middle and the end", async () => {
    expect(await find([0xde, 0xad], haystack)).toBe("0-2");
    expect(await find([0xde, 0xad], haystack, { from: 1 })).toBe("4-6");
    expect(await find([0xde, 0xad], haystack, { from: 5 })).toBe("7-9");
    expect(await find([0xde, 0xad], haystack, { from: 8 })).toBeUndefined();
  });

  it("handles the edges", async () => {
    expect(await find([0x01], [])).toBeUndefined();
    expect(await find([], [1, 2, 3])).toBeUndefined();
    expect(await find([1, 2, 3, 4], [1, 2, 3])).toBeUndefined(); // longer than the file
    expect(await find([3], [1, 2, 3])).toBe("2-3"); // the very last byte
  });

  it("goes backwards, from the end", async () => {
    expect(await find([0xde, 0xad], haystack, { from: 9, direction: "backward" })).toBe("7-9");
    expect(await find([0xde, 0xad], haystack, { from: 7, direction: "backward" })).toBe("4-6");
    expect(await find([0xde, 0xad], haystack, { from: 4, direction: "backward" })).toBe("0-2");
    expect(await find([0xde, 0xad], haystack, { from: 1, direction: "backward" })).toBeUndefined();
  });

  it("finds a match across a chunk boundary", async () => {
    const bytes = new Array(8).fill(0);
    bytes[3] = 0xaa;
    bytes[4] = 0xbb;
    expect(await find([0xaa, 0xbb], bytes, { chunkSize: 3 })).toBe("3-5");
    expect(await find([0xaa, 0xbb], bytes, { from: 8, direction: "backward", chunkSize: 3 })).toBe(
      "3-5"
    );
  });

  it("throws when cancelled", async () => {
    let checks = 0;
    await expect(
      findOne(new Uint8Array([0xff]), storage(new Uint8Array(64)), {
        folding: { kind: "exact" },
        chunkSize: 4,
        shouldCancel: () => ++checks > 1,
      })
    ).rejects.toBeInstanceOf(SearchCancelled);
  });
});

describe("case folding", () => {
  const ci = (encoding: SearchEncoding, caseSensitive = false) =>
    foldingFor(encoding, caseSensitive);

  it("folds ASCII letters", async () => {
    const bytes = ascii("Hi there");
    expect(await find(ascii("HI"), bytes, { folding: ci("ascii") })).toBe("0-2");
    expect(await find(ascii("hi"), bytes, { folding: ci("ascii") })).toBe("0-2");
    expect(await find(ascii("THE"), bytes, { folding: ci("ascii") })).toBe("3-6");
    // Case-sensitive is exact.
    expect(await find(ascii("HI"), bytes, { folding: ci("ascii", true) })).toBeUndefined();
    expect(await find(ascii("Hi"), bytes, { folding: ci("ascii", true) })).toBe("0-2");
  });

  it("folds only the ASCII part of UTF-8", async () => {
    // "Café" is C a f é. The ASCII C folds to c, but É (C3 89) never folds to
    // é (C3 A9) — a byte-wise fold has no business with a two-byte character.
    const bytes = [0x43, 0x61, 0x66, 0xc3, 0xa9];
    expect(await find([0x63, 0x61, 0x66, 0xc3, 0xa9], bytes, { folding: ci("utf8") })).toBe("0-5");
    expect(
      await find([0x43, 0x41, 0x46, 0xc3, 0x89], bytes, { folding: ci("utf8") })
    ).toBeUndefined();
  });

  it("folds UTF-16 by code unit, not by byte", async () => {
    const bytes = utf16le("Hi there");
    expect(await find(utf16le("HI"), bytes, { folding: ci("utf16LE") })).toBe("0-4");
    expect(await find(utf16le("HI"), bytes, { folding: ci("utf16LE", true) })).toBeUndefined();
  });

  it("does not fold the high byte of a non-ASCII code unit", async () => {
    // The reason UTF-16 needs its own rule: a byte-wise fold would read the
    // high byte of U+6100 (`00 61` LE) as the letter `a` and match U+4100,
    // which is a different character entirely.
    const file = [0x00, 0x61]; // U+6100, little-endian
    const pattern = [0x00, 0x41]; // U+4100
    expect(await find(pattern, file, { folding: ci("utf16LE") })).toBeUndefined();
    // While the real letters still fold.
    expect(await find([0x41, 0x00], [0x61, 0x00], { folding: ci("utf16LE") })).toBe("0-2");
  });

  it("folds going backwards", async () => {
    const bytes = ascii("ab AB ab");
    expect(
      await find(ascii("AB"), bytes, { from: 8, direction: "backward", folding: ci("ascii") })
    ).toBe("6-8");
    expect(
      await find(ascii("ab"), bytes, {
        from: 5,
        direction: "backward",
        folding: ci("ascii", true),
      })
    ).toBe("0-2");
    // Case-insensitive backward from inside must skip the exact one and land
    // on the uppercase one before it.
    expect(
      await find(ascii("ab"), bytes, { from: 6, direction: "backward", folding: ci("ascii") })
    ).toBe("3-5");
  });

  it("folds across a chunk boundary", async () => {
    const bytes = new Array(8).fill(0);
    bytes.splice(2, 3, ...ascii("AbC"));
    expect(await find(ascii("abc"), bytes, { folding: ci("ascii"), chunkSize: 3 })).toBe("2-5");
    expect(
      await find(ascii("abc"), bytes, {
        from: 8,
        direction: "backward",
        folding: ci("ascii"),
        chunkSize: 3,
      })
    ).toBe("2-5");
  });

  it("keeps raw bytes distinct when the search is exact", async () => {
    // Case sensitivity lives in the byte domain: an exact search treats 0x41
    // and 0x61 as the different bytes they are.
    expect(await find([0x41, 0x62, 0x63], [0x41, 0x62, 0x63])).toBe("0-3");
    expect(await find([0x61, 0x62, 0x63], [0x41, 0x62, 0x63])).toBeUndefined();
  });
});

describe("scanning for every match", () => {
  const all = async (
    pattern: number[],
    bytes: number[],
    options: { chunkSize?: number; folding?: CaseFolding } = {}
  ) => {
    const folding = options.folding ?? { kind: "exact" };
    const starts: number[] = [];
    await scanAll(foldedPattern(new Uint8Array(pattern), folding), storage(bytes), {
      folding,
      chunkSize: options.chunkSize ?? 7,
      onMatches: (found) => starts.push(...found),
    });
    return starts;
  };

  it("finds every occurrence", async () => {
    expect(await all([0xde, 0xad], [0xde, 0xad, 0xbe, 0x00, 0xde, 0xad, 0xbe, 0xde, 0xad])).toEqual(
      [0, 4, 7]
    );
  });

  it("does not overlap them", async () => {
    // `aaa` in `aaaaa` is two matches, not three.
    expect(await all(ascii("aaa"), ascii("aaaaa"))).toEqual([0]);
    expect(await all(ascii("aa"), ascii("aaaa"))).toEqual([0, 2]);
  });

  it("counts a match on a chunk boundary exactly once", async () => {
    const bytes = new Array(20).fill(0);
    bytes[6] = 0xaa;
    bytes[7] = 0xbb;
    for (const chunkSize of [1, 2, 3, 7, 8, 19, 20, 64]) {
      expect(await all([0xaa, 0xbb], bytes, { chunkSize }), `chunk ${chunkSize}`).toEqual([6]);
    }
  });

  it("finds them across several boundaries", async () => {
    const bytes: number[] = [];
    for (let i = 0; i < 10; i++) bytes.push(0xaa, 0xbb, 0x00, 0x00);
    expect(await all([0xaa, 0xbb], bytes, { chunkSize: 3 })).toEqual([
      0, 4, 8, 12, 16, 20, 24, 28, 32, 36,
    ]);
  });

  it("folds while scanning", async () => {
    expect(
      await all(ascii("ab"), ascii("ab AB Ab aB"), { folding: foldingFor("ascii", false) })
    ).toEqual([0, 3, 6, 9]);
  });

  it("reports progress reaching one", async () => {
    let last = -1;
    await scanAll(new Uint8Array([0xff]), storage(new Uint8Array(64).fill(0xff)), {
      folding: { kind: "exact" },
      chunkSize: 7,
      onMatches: () => {},
      onProgress: (value) => (last = Math.max(last, value)),
    });
    expect(last).toBe(1);
  });

  it("says how far it has scanned, so a partial index knows what it covers", async () => {
    const windows: number[] = [];
    await scanAll(new Uint8Array([0xaa]), storage(new Uint8Array(20)), {
      folding: { kind: "exact" },
      chunkSize: 7,
      onMatches: () => {},
      onWindow: (upTo) => windows.push(upTo),
    });
    expect(windows).toEqual([7, 14, 20]);
  });

  it("stops early when told to, without claiming to have finished", async () => {
    let batches = 0;
    let progress = 0;
    await scanAll(new Uint8Array([0xff]), storage(new Uint8Array(64).fill(0xff)), {
      folding: { kind: "exact" },
      chunkSize: 8,
      onMatches: () => batches++,
      onProgress: (value) => (progress = value),
      shouldStop: () => batches >= 2,
    });
    expect(progress).toBeLessThan(1);
  });

  it("fills a match set", async () => {
    const result = parsePattern("AA", "hex");
    if (!result.ok) throw new Error("the pattern should parse");

    const bytes = new Uint8Array(500);
    for (let i = 0; i < 500; i += 25) bytes[i] = 0xaa;
    const builder = new MatchSetBuilder(result.pattern, { kind: "exact" }, bytes.length);
    await scanAll(result.pattern.bytes, storage(bytes), {
      folding: { kind: "exact" },
      chunkSize: 64,
      onMatches: (starts) => builder.add(starts),
    });

    const set = builder.finish();
    expect(set.total).toBe(20);
    expect(set.startAt(0)).toBe(0);
    expect(set.startAt(19)).toBe(475);
  });

  it("agrees with a naive scan over random data", async () => {
    for (let round = 0; round < 25; round++) {
      const random = new SeededRandom(0x5ea4c40 + round);
      const bytes = Array.from(random.bytes(random.int(1, 400)), (b) => b % 4);
      const pattern = Array.from(random.bytes(random.int(1, 4)), (b) => b % 4);

      // The obvious answer, non-overlapping, as the oracle.
      const expected: number[] = [];
      for (let at = 0; at + pattern.length <= bytes.length; ) {
        let i = 0;
        while (i < pattern.length && bytes[at + i] === pattern[i]) i++;
        if (i === pattern.length) {
          expected.push(at);
          at += pattern.length;
        } else at++;
      }

      expect(await all(pattern, bytes, { chunkSize: random.int(1, 40) }), `round ${round}`).toEqual(
        expected
      );
    }
  });
});

describe("the byte search itself", () => {
  it("finds a needle at every alignment", () => {
    const haystack = new Uint8Array(64).map((_, i) => i % 7);
    for (const needle of [[0], [1, 2], [3, 4, 5], [0, 1, 2, 3, 4, 5, 6]]) {
      const expected = (() => {
        for (let at = 0; at + needle.length <= haystack.length; at++) {
          let i = 0;
          while (i < needle.length && haystack[at + i] === needle[i]) i++;
          if (i === needle.length) return at;
        }
        return -1;
      })();
      expect(indexOfBytes(haystack, new Uint8Array(needle)), needle.join(",")).toBe(expected);
    }
  });

  it("answers the edges", () => {
    const haystack = new Uint8Array([1, 2, 3]);
    expect(indexOfBytes(haystack, new Uint8Array(0))).toBe(-1);
    expect(indexOfBytes(haystack, new Uint8Array([1, 2, 3, 4]))).toBe(-1);
    expect(indexOfBytes(haystack, new Uint8Array([3]))).toBe(2);
    expect(indexOfBytes(haystack, new Uint8Array([1]), 1)).toBe(-1);
  });
});
