import { describe, expect, it } from "vitest";
import { MatchBitmap, MatchSet, MatchSetBuilder } from "@/core/search/matchSet";
import { DEFAULT_MAX_RESULTS } from "@/core/search/searchEngine";
import { EXACT, type SearchPattern } from "@/core/search/searchPattern";

/**
 * Ported from `MatchSetTests.swift`.
 *
 * One scan per activated pattern is the single source for the dump's greys, the
 * find indicator, Find Next, the count and the results panel. This is that set:
 * where the matches are, held sparsely or as a bitmap depending on their
 * density, and exact in either — the count never truncates, because a count in
 * the thousands is the diagnosis that the pattern is too generic.
 */

const pattern: SearchPattern = { bytes: new Uint8Array([0xde, 0xad, 0xbe, 0xef]), encoding: "hex" };
const single = (byte: number): SearchPattern => ({
  bytes: new Uint8Array([byte]),
  encoding: "hex",
});

const built = (extent: number, starts: number[], maxIndexBytes?: number) => {
  const builder = new MatchSetBuilder(pattern, EXACT, extent, maxIndexBytes);
  builder.add(starts);
  return builder.finish();
};

/** Held sparsely whatever the density, for comparing the two answer for answer. */
const sparse = (extent: number, starts: number[], p = pattern) =>
  new MatchSet(
    p,
    EXACT,
    extent,
    starts.length,
    {
      kind: "sparse",
      starts: Float64Array.from(starts),
    },
    extent
  );

const bitmapped = (extent: number, starts: number[], p = pattern) => {
  const map = new MatchBitmap(extent);
  for (const start of starts) map.set(start);
  map.sealRanks();
  return new MatchSet(p, EXACT, extent, starts.length, { kind: "bitmap", bitmap: map }, extent);
};

const ranges = (matches: { start: number; end: number }[]) =>
  matches.map((match) => `${match.start}-${match.end}`);

describe("what the dump asks for", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testMatchesOverlappingARangeIncludeOneStraddlingItsStart
  it("includes a match that starts before the range and reaches in", () => {
    // The case a row boundary creates on every screen.
    expect(ranges(built(0x1000, [0x00, 0x0e, 0x40]).matchesIntersecting(0x10, 0x20))).toEqual([
      "14-18",
    ]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testMatchesOverlappingARangeStopAtItsEnd
  it("stops at the range's end", () => {
    const all = built(0x1000, [0x00, 0x10, 0x20, 0x30]);
    expect(ranges(all.matchesIntersecting(0x10, 0x30))).toEqual(["16-20", "32-36"]);
    expect(all.matchesIntersecting(0, 0x1000)).toHaveLength(4);
    expect(all.matchesIntersecting(0x100, 0x200)).toEqual([]);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testASingleBytePatternDoesNotReachBackwards
  it("does not reach backwards for a single-byte pattern", () => {
    const builder = new MatchSetBuilder(single(0xff), EXACT, 0x100);
    builder.add([0x0f, 0x10]);
    expect(ranges(builder.finish().matchesIntersecting(0x10, 0x20))).toEqual(["16-17"]);
  });
});

describe("what navigation asks for", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testTheOrdinalsAroundACaret
  it("names the ordinals around a caret", () => {
    const all = built(0x1000, [0x10, 0x20, 0x30]);
    expect(all.indexStartingAt(0x20)).toBe(1); // standing on a match names it
    expect(all.indexStartingAt(0x21)).toBeUndefined(); // between matches, nothing
    expect(all.indexAtOrAfter(0x20)).toBe(1); // Find Next from a start finds it
    expect(all.indexAtOrAfter(0x21)).toBe(2); // and moves on from inside one
    expect(all.indexAtOrAfter(0x31)).toBeUndefined();
    expect(all.indexBefore(0x30)).toBe(1);
    expect(all.indexBefore(0x31)).toBe(2); // from inside a match, back means that one
    expect(all.indexBefore(0x10)).toBeUndefined();
    expect(all.rangeAt(2)).toEqual({ start: 0x30, end: 0x34 });
    expect(all.rangeAt(3)).toBeUndefined();
  });
});

describe("the two representations", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testBitmapAndSparseAgreeOnEveryQuery
  it("answer every query identically", () => {
    // The bitmap exists to make an uncapped highlight affordable, not to change
    // any answer. Checked over a dense, irregular set including runs of
    // adjacent matches — what a short pattern in padding produces.
    const extent = 4096;
    const starts: number[] = [];
    let offset = 3;
    let step = 1;
    while (offset < extent - 8) {
      starts.push(offset);
      offset += step;
      step = (step % 7) + 1;
    }

    const a = sparse(extent, starts);
    const b = bitmapped(extent, starts);
    expect(a.total).toBe(b.total);

    for (let at = 0; at < extent; at += 13) {
      expect(a.indexStartingAt(at), `ordinal at ${at}`).toBe(b.indexStartingAt(at));
      expect(a.indexAtOrAfter(at), `next at ${at}`).toBe(b.indexAtOrAfter(at));
      expect(a.indexBefore(at), `previous at ${at}`).toBe(b.indexBefore(at));
      expect(ranges(a.matchesIntersecting(at, at + 16)), `row at ${at}`).toEqual(
        ranges(b.matchesIntersecting(at, at + 16))
      );
    }
    for (const index of [0, 1, 2, starts.length >> 1, starts.length - 2, starts.length - 1]) {
      expect(a.startAt(index), `start of match ${index}`).toBe(b.startAt(index));
    }
    expect(b.startAt(starts.length)).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testSelectFindsMatchesFarIntoTheBitmap
  it("select finds matches far into the bitmap", () => {
    // The rank table narrows select to a block; a set whose matches all sit in
    // the last block is what exposes an off-by-one there.
    const dense = bitmapped(40_000, [39_000, 39_500, 39_900]);
    expect([0, 1, 2].map((i) => dense.startAt(i))).toEqual([39_000, 39_500, 39_900]);
    expect(dense.indexStartingAt(39_500)).toBe(1);
    expect(dense.indexBefore(40_000)).toBe(2);
  });
});

describe("choosing the representation", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testDensityPicksTheRepresentation
  it("switches where a list costs what the bitmap costs", () => {
    expect(built(6400, [0x10, 0x20, 0x30]).storage.kind).toBe("sparse");

    const dense = built(
      6400,
      Array.from({ length: 200 }, (_, i) => i * 8)
    );
    expect(dense.storage.kind).toBe("bitmap");
    expect(dense.total).toBe(200);
    expect(dense.isHighlightable).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testBatchedDeliveryMatchesOneBigBatch
  it("gives the same outcome however the matches are batched", () => {
    // The scan hands over a window's matches at once, and the conversion can
    // fall in the middle of a batch.
    const starts = Array.from({ length: 300 }, (_, i) => i * 4);
    const batched = new MatchSetBuilder(pattern, EXACT, 6400);
    for (let at = 0; at < starts.length; at += 37) batched.add(starts.slice(at, at + 37));

    const whole = built(6400, starts);
    const piecewise = batched.finish();
    expect(piecewise.total).toBe(whole.total);
    expect(ranges(piecewise.matchesIntersecting(0, 6400))).toEqual(
      ranges(whole.matchesIntersecting(0, 6400))
    );
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testPastTheCeilingTheCountSurvivesAlone
  it("keeps the count when even a bitmap will not fit", () => {
    const counted = built(
      1 << 20,
      Array.from({ length: 20_000 }, (_, i) => i * 8),
      1024
    );
    expect(counted.storage.kind).toBe("counted");
    expect(counted.total).toBe(20_000); // the count is never truncated
    expect(counted.isHighlightable).toBe(false); // a partial highlight would be a lie
    expect(counted.matchesIntersecting(0, 0x1000)).toEqual([]);
    expect(counted.indexAtOrAfter(0)).toBeUndefined();
    expect(counted.startAt(0)).toBeUndefined();
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testListabilityFollowsTheCountAlone
  it("decides listability on the count alone, never the representation", () => {
    expect(built(0x1000, []).isListable).toBe(false);
    expect(sparse(1 << 24, [0x10]).isListable).toBe(true);
    expect(
      bitmapped(
        1 << 20,
        Array.from({ length: DEFAULT_MAX_RESULTS }, (_, i) => i * 8)
      ).isListable
    ).toBe(true);
    expect(
      bitmapped(
        1 << 20,
        Array.from({ length: DEFAULT_MAX_RESULTS + 1 }, (_, i) => i * 8)
      ).isListable
    ).toBe(false);
  });
});

describe("following an overwrite", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testSplicingAnOverwrittenRange
  it("splices the edited range, in both representations", () => {
    for (const subject of [
      sparse(0x1000, [0x10, 0x40, 0x80]),
      bitmapped(0x1000, [0x10, 0x40, 0x80]),
    ]) {
      const kind = subject.storage.kind;
      const updated = subject.splice([0x44], 0x3d, 0x50);
      expect(updated, `${kind} can be updated in place`).toBeDefined();
      expect(ranges(updated?.matchesIntersecting(0, 0x1000) ?? []), kind).toEqual([
        "16-20",
        "68-72",
        "128-132",
      ]);
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testSplicingCanRemoveAndAddMatches
  it("can remove matches as well as add them", () => {
    for (const subject of [
      sparse(0x1000, [0x10, 0x40, 0x80]),
      bitmapped(0x1000, [0x10, 0x40, 0x80]),
    ]) {
      const updated = subject.splice([], 0x3d, 0x50);
      expect(updated?.total).toBe(2);
      expect(ranges(updated?.matchesIntersecting(0, 0x1000) ?? [])).toEqual(["16-20", "128-132"]);
    }
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testACountedSetRefusesToBeSpliced
  it("refuses when the set kept only a count", () => {
    const counted = new MatchSet(pattern, EXACT, 1 << 20, 500_000, { kind: "counted" }, 1 << 20);
    expect(counted.splice([1], 0, 16)).toBeUndefined();
  });
});

describe("naming a match", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testTheIndexAtAnOffsetPointsAtTheMatchThere
  it("makes the index and the offset agree", () => {
    // A dense bitmap is where a rank/select mismatch shows, and upstream's
    // showed as a mark one row above the match it named.
    const dense = MatchSet.of(
      single(0xff),
      EXACT,
      4096,
      Array.from({ length: 4096 }, (_, i) => i)
    );
    for (const offset of [0, 1, 63, 64, 65, 1000, 4095]) {
      const index = dense.indexAtOrAfter(offset);
      expect(index === undefined ? undefined : dense.startAt(index), `at ${offset}`).toBe(offset);
    }

    const gappy = MatchSet.of(single(0xff), EXACT, 4096, [0, 100, 4000]);
    const startOf = (offset: number) => {
      const index = gappy.indexAtOrAfter(offset);
      return index === undefined ? undefined : gappy.startAt(index);
    };
    expect(startOf(1)).toBe(100);
    expect(startOf(100)).toBe(100);
    expect(startOf(101)).toBe(4000);
    expect(gappy.indexAtOrAfter(4001)).toBeUndefined();
  });
});

describe("stepping", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testAStepSaysWhenItWrapped
  it("says when it came round the end", () => {
    const set = MatchSet.of(single(0xaa), EXACT, 64, [8, 16, 32]);

    const first = set.step("forward", 0);
    expect(first?.index).toBe(0);
    expect(first?.range).toEqual({ start: 8, end: 9 });
    expect(first?.wrapped).toBe(false);

    expect(set.step("forward", 9)?.index).toBe(1);
    expect(set.step("forward", 33)?.index).toBe(0); // past the last is the first
    expect(set.step("forward", 33)?.wrapped).toBe(true);

    expect(set.step("backward", 32)?.index).toBe(1);
    expect(set.step("backward", 8)?.index).toBe(2); // before the first is the last
    expect(set.step("backward", 8)?.wrapped).toBe(true);
    expect(set.step("backward", 32)?.wrapped).toBe(false);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testALoneMatchWrapsOntoItself
  // @upstream ByteRipperTests/FindFlowTests.swift#FindFlowTests.testASingleMatchWrapsOntoItself
  it("wraps a lone match onto itself", () => {
    // A press that does nothing at all reads as a broken key, so it re-lands
    // and says why.
    const set = MatchSet.of(single(0xaa), EXACT, 64, [16]);
    expect(set.step("forward", 20)).toEqual({
      index: 0,
      range: { start: 16, end: 17 },
      wrapped: true,
    });
    expect(set.step("backward", 16)?.wrapped).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/MatchSetTests.swift#MatchSetTests.testThereIsNoStepWhereThereIsNothingToStepTo
  it("has nowhere to step when there is nothing to step to", () => {
    expect(MatchSet.of(single(0xaa), EXACT, 64, []).step("forward", 0)).toBeUndefined();
    const counted = new MatchSet(
      single(0xaa),
      EXACT,
      1 << 20,
      500_000,
      { kind: "counted" },
      1 << 20
    );
    expect(counted.step("forward", 0)).toBeUndefined();
  });
});

describe("a partial index", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/SearchEngineTests.swift#SearchEngineTests.testAPartialSetKnowsItIsPartial
  it("knows it is partial", () => {
    const builder = new MatchSetBuilder(pattern, EXACT, 1000);
    builder.add([10, 20]);
    const partial = builder.snapshot(400);

    expect(partial.isComplete).toBe(false);
    expect(partial.indexedUpTo).toBe(400);
    expect(partial.total).toBe(2); // what is known so far, not the whole answer

    builder.add([500]);
    const whole = builder.finish();
    expect(whole.isComplete).toBe(true);
    expect(whole.total).toBe(3);
  });
});

describe("the start of the next match", () => {
  it("is the same held sparsely or as a bitmap", () => {
    const starts = Array.from({ length: 600 }, (_, i) => i * 7);
    const dense = built(4200, starts);
    const thin = sparse(4200, starts);
    expect(dense.storage.kind).toBe("bitmap");
    for (const offset of [0, 1, 7, 8, 4192, 4193]) {
      expect(dense.startAtOrAfter(offset)).toBe(thin.startAtOrAfter(offset));
    }
    expect(dense.startAtOrAfter(8)).toBe(14);
    expect(dense.startAtOrAfter(4194)).toBeUndefined();
  });

  it("is nowhere in a set that only counts", () => {
    expect(
      built(
        1 << 20,
        Array.from({ length: 50_000 }, (_, i) => i * 4),
        1
      ).startAtOrAfter(0)
    ).toBeUndefined();
  });
});
