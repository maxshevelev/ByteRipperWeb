import { describe, expect, it } from "vitest";
import { compareAppVersions, parseAppVersion } from "@/core/updates/appVersion";

const version = (text: string) => {
  const parsed = parseAppVersion(text);
  if (parsed === undefined) throw new Error(`${text} is not a version`);
  return parsed;
};
const compare = (left: string, right: string) =>
  Math.sign(compareAppVersions(version(left), version(right)));

describe("reading a version", () => {
  it("takes a leading v off and keeps the spelling", () => {
    expect(parseAppVersion("v0.8.5-2")?.text).toBe("0.8.5-2");
    expect(parseAppVersion(" V1.2 ")?.text).toBe("1.2");
  });

  it("reads the build number as a part of its own", () => {
    expect(version("0.8.5-2").parts).toEqual([0, 8, 5, 2]);
    expect(version("0.8.5").parts).toEqual([0, 8, 5]);
  });

  it("does not read a label as a part", () => {
    expect(version("0.8.5-dev").parts).toEqual([0, 8, 5]);
    expect(version("0.8.5-1-dev").parts).toEqual([0, 8, 5, 1]);
    expect(version("0.9.0-beta").parts).toEqual([0, 9, 0]);
  });

  it("says nothing when there is no number", () => {
    expect(parseAppVersion("latest")).toBeUndefined();
    expect(parseAppVersion("")).toBeUndefined();
  });
});

describe("comparing versions", () => {
  it("compares parts as numbers, not as text", () => {
    expect(compare("0.8.10", "0.8.9")).toBe(1);
    expect(compare("0.8.5-10", "0.8.5-9")).toBe(1);
  });

  it("reads a missing part as zero", () => {
    expect(compare("0.9", "0.9.0")).toBe(0);
    expect(compare("0.8.5", "0.8.5-0")).toBe(0);
  });

  it("puts this edition's builds after the upstream release they are level with", () => {
    expect(compare("0.8.5", "0.8.5-1")).toBe(-1);
    expect(compare("0.8.5-1", "0.8.5-2")).toBe(-1);
    expect(compare("0.8.5-7", "0.8.6")).toBe(-1);
    expect(compare("0.8.6", "0.8.5-7")).toBe(1);
  });

  it("does not order a label", () => {
    expect(compare("0.8.5-dev", "0.8.5")).toBe(0);
    expect(compare("0.8.5-1-dev", "0.8.5-1")).toBe(0);
  });
});
