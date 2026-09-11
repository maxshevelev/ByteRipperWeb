import { describe, expect, it } from "vitest";
import { detectFileCapabilities, saveExplanation, saveVerb } from "@/platform/files/capabilities";

/**
 * D7's whole point is that the capability difference lives in one place and is
 * announced rather than discovered. These are the three browsers the project
 * supports, stood up as objects: feature detection means a fake window is a
 * complete test of it.
 */

const chromium = {
  showOpenFilePicker: () => Promise.resolve([]),
  showSaveFilePicker: () => Promise.resolve({}),
  showDirectoryPicker: () => Promise.resolve({}),
};

const firefoxOrSafari = {};

describe("what the browser can do with files", () => {
  it("sees Chromium's picker and the writable handle it returns", () => {
    const capabilities = detectFileCapabilities(chromium);
    expect(capabilities.canSaveInPlace).toBe(true);
    expect(capabilities.canPickDirectory).toBe(true);
  });

  it("sees that Firefox and Safari cannot write back", () => {
    const capabilities = detectFileCapabilities(firefoxOrSafari);
    expect(capabilities.canSaveInPlace).toBe(false);
    expect(capabilities.canWriteDroppedFiles).toBe(false);
    expect(capabilities.canPickDirectory).toBe(false);
  });

  it("does not claim saving from a half-implemented picker", () => {
    // Opening a file is not the same capability as writing one back, and a
    // browser that grew only the first must not get a button saying Save.
    const capabilities = detectFileCapabilities({ showOpenFilePicker: () => Promise.resolve([]) });
    expect(capabilities.canSaveInPlace).toBe(false);
  });
});

describe("what the app calls it", () => {
  it("says Save only where saving is what happens", () => {
    expect(saveVerb(detectFileCapabilities(chromium))).toBe("Save");
    expect(saveVerb(detectFileCapabilities(firefoxOrSafari))).toBe("Download");
  });

  it("explains the difference rather than leaving it to be discovered", () => {
    expect(saveExplanation(detectFileCapabilities(firefoxOrSafari))).toMatch(/downloads a copy/);
    expect(saveExplanation(detectFileCapabilities(chromium))).toMatch(/written back/);
  });
});
