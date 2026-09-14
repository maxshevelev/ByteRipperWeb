import { describe, expect, it } from "vitest";
import type { MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";
import {
  actionTitle,
  countText,
  formTitle,
  type MicrocodeFormMode,
  narrowingTitle,
  releaseText,
  searchIsHidden,
  shownEntries,
  sizeText,
} from "@/tools/fit/microcodeFormModel";

/** What the microcode form decides — ported from `FITAddMicrocodeViewController`. */

const entry = (
  cpuid: number,
  revisionText: string,
  options: Partial<MicrocodeCatalogueEntry> = {}
): MicrocodeCatalogueEntry => ({
  vendor: "Intel",
  path: `Intel/cpu${cpuid.toString(16)}_ver${revisionText}.bin`,
  cpuid,
  cpuidText: cpuid.toString(16).toUpperCase(),
  platformID: 0x02,
  revisionText,
  date: "2019-10-03",
  isProduction: true,
  size: 0x19000,
  ...options,
});

const catalogue: MicrocodeCatalogueEntry[] = [
  entry(0x906ea, "CA"),
  entry(0x906eb, "B4"),
  entry(0x906ec, "AE", { isProduction: false }),
  entry(0xa0f11, "86", { vendor: "AMD" }),
];

const add: MicrocodeFormMode = { kind: "add", cpuidsInTheImage: new Set([0x906ea]) };
const replace: MicrocodeFormMode = {
  kind: "replace",
  index: 3,
  targetCpuid: 0x906eb,
  targetCpuidText: "906EB",
};

describe("the microcode form", () => {
  it("names itself after what it is for, and says Intel", () => {
    expect(formTitle(add)).toBe("Add Intel Microcode");
    expect(formTitle(replace)).toBe("Replace Intel Microcode");
  });

  it("narrows to the image's CPUIDs, or in replace mode to the row's own", () => {
    expect(narrowingTitle(add)).toBe("Only CPUIDs in this image");
    expect(narrowingTitle(replace)).toBe("Only CPUID 906EB");
    expect(shownEntries(catalogue, add, "", true).map((one) => one.cpuid)).toEqual([0x906ea]);
    expect(shownEntries(catalogue, replace, "", true).map((one) => one.cpuid)).toEqual([0x906eb]);
  });

  // A FIT names no other kind, so listing AMD would be listing what cannot be added.
  it("lists Intel and nothing else, and searches by CPUID", () => {
    expect(shownEntries(catalogue, add, "", false)).toHaveLength(3);
    expect(shownEntries(catalogue, add, "906EC", false).map((one) => one.revisionText)).toEqual([
      "AE",
    ]);
  });

  it("hides the search once a replace is narrowed, and stops filtering by it", () => {
    expect(searchIsHidden(replace, true)).toBe(true);
    expect(searchIsHidden(replace, false)).toBe(false);
    expect(searchIsHidden(add, true)).toBe(false);
    expect(shownEntries(catalogue, replace, "906EA", true)).toHaveLength(1);
  });

  it("counts what it shows against every Intel microcode", () => {
    expect(countText(3, catalogue)).toBe("3 Intel microcodes");
    expect(countText(1, catalogue)).toBe("1 of 3 Intel microcodes");
    expect(countText(0, [])).toBe("");
  });

  it("says Replace for a CPUID the image already names, and Add otherwise", () => {
    expect(actionTitle(add, entry(0x906ea, "D6"))).toBe("Replace");
    expect(actionTitle(add, entry(0x906eb, "B4"))).toBe("Add");
    expect(actionTitle(add, undefined)).toBe("Add");
  });

  it("says Update for the row's own processor, and Replace for any other", () => {
    expect(actionTitle(replace, entry(0x906eb, "F0"))).toBe("Update");
    expect(actionTitle(replace, entry(0x906ea, "CA"))).toBe("Replace");
  });

  it("tells a pre-release apart, and writes the size in hex", () => {
    expect(releaseText(entry(1, "1"))).toBe("PRD");
    expect(releaseText(entry(1, "1", { isProduction: false }))).toBe("pre-release");
    expect(sizeText(entry(1, "1"))).toBe("0x19000");
  });
});
