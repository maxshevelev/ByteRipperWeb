import { describe, expect, it } from "vitest";
import { writeJson } from "@/core/sync/syncedCollection";
import {
  dominates,
  EMPTY_VECTOR,
  incremented,
  isConcurrent,
  mergedVectors,
  readVector,
  writesBy,
} from "@/core/sync/versionVector";

/**
 * What tells a concurrent write from a later one, which timestamps cannot — two
 * machines' clocks disagree by more than a sync takes, and clock skew must not
 * decide whose pattern survives.
 */
describe("the version vector", () => {
  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/VersionVectorTests.swift#VersionVectorTests.testAVersionDominatesOneItHasSeenEverythingOf
  it("dominates a version it has seen everything of", () => {
    const earlier = { desk: 2 };
    const later = { desk: 3, laptop: 1 };

    expect(dominates(later, earlier)).toBe(true);
    expect(dominates(earlier, later)).toBe(false);
    expect(isConcurrent(later, earlier)).toBe(false);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/VersionVectorTests.swift#VersionVectorTests.testNeitherHavingSeenTheOtherIsConcurrent
  it("is concurrent where neither has seen the other", () => {
    const mine = { desk: 3, laptop: 1 };
    const theirs = { desk: 2, laptop: 2 };

    expect(isConcurrent(mine, theirs)).toBe(true);
    expect(isConcurrent(theirs, mine)).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/VersionVectorTests.swift#VersionVectorTests.testEqualVersionsAreNotConcurrent
  it("is not concurrent with an equal version", () => {
    expect(isConcurrent({ desk: 2 }, { desk: 2 })).toBe(false);
    expect(dominates({ desk: 2 }, { desk: 2 })).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/VersionVectorTests.swift#VersionVectorTests.testAnEmptyVersionIsDominatedByEverything
  it("has an empty version dominated by everything", () => {
    expect(dominates({ desk: 1 }, EMPTY_VECTOR)).toBe(true);
    expect(dominates(EMPTY_VECTOR, { desk: 1 })).toBe(false);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/VersionVectorTests.swift#VersionVectorTests.testWritingCountsAndMergingTakesTheHigherCount
  it("counts writes, and merging takes the higher count", () => {
    let mine = incremented({ desk: 2 }, "desk");
    expect(writesBy(mine, "desk")).toBe(3);
    mine = incremented(mine, "new-machine");
    expect(writesBy(mine, "new-machine")).toBe(1);

    const merged = mergedVectors(mine, { desk: 1, laptop: 5 });
    expect(writesBy(merged, "desk")).toBe(3);
    expect(writesBy(merged, "laptop")).toBe(5);
    expect(writesBy(merged, "new-machine")).toBe(1);
    expect(dominates(merged, mine)).toBe(true);
  });

  // @upstream Packages/ByteRipperCore/Tests/ByteRipperCoreTests/VersionVectorTests.swift#VersionVectorTests.testItIsStoredAsADictionary
  it("is stored as the dictionary it is", () => {
    expect(JSON.stringify({ desk: 2 })).toBe('{"desk":2}');
    expect(readVector(JSON.parse(writeJson({ desk: 2 })))).toEqual({ desk: 2 });
    expect(() => readVector({ desk: "two" })).toThrow();
  });

  it("counts nothing for a device it has no counter for, whatever its name", () => {
    expect(writesBy({ desk: 1 }, "toString")).toBe(0);
  });
});
