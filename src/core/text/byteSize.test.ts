import { describe, expect, it } from "vitest";
import { friendlySize } from "@/core/text/byteSize";

/** Ported from `FilePaneView.friendlySize`. */
describe("a byte count as a person reads it", () => {
  it("says bytes exactly, up to the first unit", () => {
    expect(friendlySize(0)).toBe("0 B");
    expect(friendlySize(8)).toBe("8 B");
    expect(friendlySize(1023)).toBe("1023 B");
  });

  // Binary units under decimal names, so a dump whose size is a power of two
  // reads as "8 MB" rather than "8.39 MB".
  it("counts a kilobyte as 1024 bytes", () => {
    expect(friendlySize(1024)).toBe("1 KB");
    expect(friendlySize(8 * 1024 * 1024)).toBe("8 MB");
    expect(friendlySize(1024 ** 4)).toBe("1 TB");
  });

  it("rounds to a whole unit", () => {
    expect(friendlySize(255 * 1024 + 512)).toBe("256 KB");
    expect(friendlySize(1536)).toBe("2 KB");
  });

  // The loop leaves the value under 1024, so the only way rounding reaches 1024
  // is the last half-unit — which rolls up rather than printing "1024 KB".
  it("rolls the last half-unit up instead of printing 1024 of the smaller one", () => {
    expect(friendlySize(1024 * 1024 - 1)).toBe("1 MB");
  });

  // Nothing above a terabyte to roll into.
  it("stays in terabytes past the last unit", () => {
    expect(friendlySize(5 * 1024 ** 4)).toBe("5 TB");
  });
});
