import { describe, expect, it } from "vitest";
import {
  detectFileCapabilities,
  saveExplanation,
  saveNotice,
  saveVerb,
} from "@/platform/files/capabilities";

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

  it("says Download for a file with no handle, however capable the browser", () => {
    // A file from an <input>, or a drop the browser gave no handle for, is
    // downloaded whatever Chromium can do in general — and a button promising
    // otherwise is exactly the discovery D7 exists to prevent.
    expect(saveVerb(detectFileCapabilities(chromium), false)).toBe("Download");
    expect(saveExplanation(detectFileCapabilities(chromium), false)).toMatch(/downloads a copy/);
  });

  it("explains the difference rather than leaving it to be discovered", () => {
    expect(saveExplanation(detectFileCapabilities(firefoxOrSafari))).toMatch(/downloads a copy/);
    expect(saveExplanation(detectFileCapabilities(chromium))).toMatch(/written back/);
  });

  it("states what saving does on the landing screen from the browser alone", () => {
    // No file is open there, so the browser is the whole question: a Chromium
    // landing screen says *in place* even though `saveVerb` would say Download,
    // which is about a file that does not exist yet.
    expect(saveNotice(detectFileCapabilities(chromium))).toBe("Saves in place.");
    expect(saveNotice(detectFileCapabilities(firefoxOrSafari))).toBe(
      "Saves by downloading a copy."
    );
  });
});
