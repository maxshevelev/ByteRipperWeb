import { describe, expect, it } from "vitest";
import { sanitizedPaneName } from "@/state/paneName";

/** The rule for what an unsaved document may be called — upstream's `RenamePaneTests`. */

describe("a pane's name", () => {
  // @upstream ByteRipperTests/RenamePaneTests.swift#RenamePaneTests.testANameIsTrimmed
  it("is trimmed", () => {
    expect(sanitizedPaneName("  bios.bin \n")).toBe("bios.bin");
  });

  // Dropped rather than refused: the header shows what was left.
  // @upstream ByteRipperTests/RenamePaneTests.swift#RenamePaneTests.testTheSeparatorsAreDropped
  it("loses the characters a file name cannot carry", () => {
    expect(sanitizedPaneName("bios/1.bin")).toBe("bios1.bin");
    expect(sanitizedPaneName("bios:1.bin")).toBe("bios1.bin");
  });

  // @upstream ByteRipperTests/RenamePaneTests.swift#RenamePaneTests.testANameOfNothingIsRefused
  it("is nothing when nothing is asked for", () => {
    expect(sanitizedPaneName("")).toBeUndefined();
    expect(sanitizedPaneName("   ")).toBeUndefined();
    expect(sanitizedPaneName("//")).toBeUndefined();
  });
});
