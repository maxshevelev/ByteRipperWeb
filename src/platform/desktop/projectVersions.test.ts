import { describe, expect, it } from "vitest";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { decodeUtf8 } from "@/core/text/utf";
import { WORKSPACE_VERSION } from "@/core/workspace/workspace";

/**
 * The shell's main process reads a project's windows before any page does, and refuses one a
 * newer build wrote; it can only tell by a copy of the version a window's workspace is written in.
 * The copy is kept level with the page's here.
 *
 * @web-only upstream's project and its windows are one file of one version
 */
describe("the shell's project versions", () => {
  it("know the workspace version this build writes", () => {
    const source = decodeUtf8(fixtureBytes("desktop/projects.cjs"));
    const copy = /^const WORKSPACE_VERSION = (\d+);$/m.exec(source)?.[1];
    expect(Number(copy)).toBe(WORKSPACE_VERSION);
  });
});
