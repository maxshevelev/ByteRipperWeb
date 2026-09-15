import { describe, expect, it } from "vitest";
import { ignoredFilesMessage } from "@/ui/shell/ignoredFiles";

describe("the files a gesture could not take", () => {
  it("are counted, in the singular and the plural", () => {
    expect(ignoredFilesMessage(1, "open")).toBe(
      "Additional files ignored: 1 file was not opened because only two files can be compared at once."
    );
    expect(ignoredFilesMessage(3, "join")).toBe(
      "Additional files ignored: 3 files were not joined because only one file can be joined at a time."
    );
  });
});
