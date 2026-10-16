import { describe, expect, it } from "vitest";
import { surveyNames } from "@/core/agent/agentSurvey";

// @web-only the naming alone, which upstream tests through the tool (AgentDumpToolsTests)
describe("a survey's names for its files", () => {
  it("are paths from the folder asked about", () => {
    expect(surveyNames(["/dumps/T14/bios.bin", "/dumps/X1/bios.bin"], "/dumps/")).toEqual({
      root: "/dumps",
      names: ["T14/bios.bin", "X1/bios.bin"],
    });
  });

  it("are paths from the deepest folder a list of paths shares, in the order given", () => {
    expect(surveyNames(["/dumps/X1/bios.bin", "/dumps/T14/bios.bin"])).toEqual({
      root: "/dumps",
      names: ["X1/bios.bin", "T14/bios.bin"],
    });
    expect(surveyNames(["/dumps/one.bin"])).toEqual({ root: "/dumps", names: ["one.bin"] });
    expect(surveyNames(["/a/one.bin", "/b/two.bin"])).toEqual({
      root: "/",
      names: ["a/one.bin", "b/two.bin"],
    });
  });

  it("keep a whole path for a file outside the folder", () => {
    expect(surveyNames(["/elsewhere/one.bin"], "/dumps").names).toEqual(["/elsewhere/one.bin"]);
  });

  it("read either separator, and give the folder back with the one it used", () => {
    expect(surveyNames(["C:\\dumps\\X1\\bios.bin", "C:\\dumps\\T14\\bios.bin"])).toEqual({
      root: "C:\\dumps",
      names: ["X1/bios.bin", "T14/bios.bin"],
    });
  });
});
