import { describe, expect, it } from "vitest";
import { sourceOver } from "@/firmware/byteSource";
import { parseUefiImage } from "@/firmware/uefi/uefiImage";

/**
 * The progress a caller asks the scan to report while it parses: fractions of
 * the image the scan has crossed, going forward. A tool turns them into a moving
 * bar, so this is where "the bar must actually move" is guaranteed.
 *
 * @upstream Packages/UEFIImage/Tests/UEFIImageTests/ParseProgressTests.swift#ParseProgressTests
 */
describe("the parse's progress", () => {
  // A raw image has no descriptor, so the whole thing is walked byte by byte —
  // the one slow path in a UEFI parse, and the only one that needs progress.
  // 2 MiB spans several of the scan's 1 MiB windows.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ParseProgressTests.swift#ParseProgressTests.testScanReportsMonotonicProgressAcrossTheImage
  // @upstream-differs a plain array collects the fractions: the parse runs on one thread here, where upstream's `Reported` is a locked list
  it("reports monotonic progress across the image", () => {
    const seen: number[] = [];
    const parsed = parseUefiImage(sourceOver(new Uint8Array(2 << 20).fill(0xff)), {
      onProgress: (fraction) => seen.push(fraction),
    });

    // The scan should report more than once across several windows.
    expect(seen.length).toBeGreaterThanOrEqual(3);
    // Fractions live in (0, 1].
    expect(seen.every((fraction) => fraction > 0 && fraction <= 1)).toBe(true);
    // Progress must never walk backwards.
    let previous = 0;
    for (const fraction of seen) {
      expect(fraction).toBeGreaterThanOrEqual(previous);
      previous = fraction;
    }
    // A scan that reads to the end of the image reports having done so.
    expect(seen.at(-1)).toBe(1);
    expect(parsed.roots.map((node) => node.kind)).toEqual(["padding"]);
  });

  // Reporting is opt-in: no callback, no overhead, and — importantly — the parse
  // still behaves identically. Guarded because a regression that made progress
  // reporting interfere with parsing would be easy to miss while every progress
  // test still passes.
  // @upstream Packages/UEFIImage/Tests/UEFIImageTests/ParseProgressTests.swift#ParseProgressTests.testParseWithoutProgressStillParses
  it("still parses without progress", () => {
    const parsed = parseUefiImage(sourceOver(new Uint8Array(0x200).fill(0xff)));
    expect(parsed.roots.map((node) => node.kind)).toEqual(["padding"]);
    expect(parsed.diagnostics).toEqual([]);
  });
});
