import { describe, expect, it } from "vitest";
import { isLibraryFile, libraryFileName, stampOf } from "@/core/sync/syncFolderNaming";

describe("a machine's library file", () => {
  it("is named by the stem and the machine's stamp", () => {
    expect(libraryFileName("A93F1C0D22B7")).toBe("ByteRipper Patterns (A93F1C0D22B7).json");
  });

  it("takes its stamp from the head of the digest, in upper-case hex", () => {
    const digest = Uint8Array.of(0x0a, 0x93, 0xff, 0x1c, 0x00, 0x22, 0xb7, 0x55);
    expect(stampOf(digest)).toBe("0A93FF1C0022");
  });
});

describe("telling library files from everything else", () => {
  it("takes a machine's own file", () => {
    expect(isLibraryFile("ByteRipper Patterns (A93F1C0D22B7).json")).toBe(true);
  });

  it("leaves alone what a sync client or a person put beside them", () => {
    expect(isLibraryFile("ByteRipper Patterns (A93F1C0D22B7) 2.json")).toBe(false);
    expect(isLibraryFile("ByteRipper Patterns (conflicted copy 2026-09-05).json")).toBe(false);
    expect(isLibraryFile("ByteRipper Patterns (a93f1c0d22b7).json")).toBe(false);
    expect(isLibraryFile("ByteRipper Patterns (A93F1C0D22).json")).toBe(false);
    expect(isLibraryFile("ByteRipper Patterns.json")).toBe(false);
    expect(isLibraryFile("My patterns (A93F1C0D22B7).json")).toBe(false);
    expect(isLibraryFile("DumpCompare Patterns (A93F1C0D22B7).json")).toBe(false);
  });
});
