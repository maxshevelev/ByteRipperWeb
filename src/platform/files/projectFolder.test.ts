import { describe, expect, it } from "vitest";
import {
  decodeEdits,
  encodeEdits,
  isProjectFolderName,
  projectName,
} from "@/platform/files/projectFolder";

describe("a project's folder", () => {
  it("keeps a file's changes as runs and the bytes editing added", () => {
    const edits = {
      baseSize: 0x1000,
      runs: [
        { kind: "base" as const, start: 0, end: 0x10 },
        { kind: "added" as const, start: 0, end: 2 },
        { kind: "base" as const, start: 0x12, end: 0x1000 },
      ],
      added: new Uint8Array([0x77, 0x99]),
    };
    expect(decodeEdits(encodeEdits(edits))).toEqual(edits);
  });

  it("reads nothing back from bytes that are not such a record", () => {
    expect(decodeEdits(new Uint8Array([1, 2]))).toBeUndefined();
    expect(decodeEdits(new Uint8Array([0xff, 0, 0, 0, 0x7b]))).toBeUndefined();
  });

  it("is named by its folder without the extension", () => {
    expect(projectName("Job 1234.brw")).toBe("Job 1234");
    expect(projectName("Bench")).toBe("Bench");
    expect(isProjectFolderName("A.BRW")).toBe(true);
    expect(isProjectFolderName("dumps")).toBe(false);
  });
});
