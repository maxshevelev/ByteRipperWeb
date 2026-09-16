import { describe, expect, it } from "vitest";
import { ignoredFilesAlert } from "@/ui/shell/ignoredFiles";

describe("the files a gesture could not take", () => {
  // @upstream ByteRipperTests/DropBandsTests.swift#DropBandsTests.testExtraFilesDroppedOnAJoinBandAreIgnored
  it("are counted, in the singular and the plural", () => {
    expect(ignoredFilesAlert(1, "open")).toEqual({
      title: "Additional files ignored",
      message: "1 file was not opened because only two files can be compared at once.",
    });
    expect(ignoredFilesAlert(3, "join")).toEqual({
      title: "Additional files ignored",
      message: "3 files were not joined because only one file can be joined at a time.",
    });
  });

  it("gives the gesture's own reason, under the one title", () => {
    // A join takes one file where an open takes two, so the sentence differs
    // and nothing else does.
    expect(ignoredFilesAlert(2, "open").message).toContain("only two files can be compared");
    expect(ignoredFilesAlert(2, "join").message).toContain("only one file can be joined");
  });
});
