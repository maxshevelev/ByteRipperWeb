import { afterEach, describe, expect, it, vi } from "vitest";
import { updatesOffered } from "@/state/updateStore";

describe("where a newer release is offered", () => {
  afterEach(() => vi.unstubAllGlobals());

  // The site serves the newest release: its next load is the update.
  it("is nowhere on a hosted page", () => {
    vi.stubGlobal("location", { protocol: "https:" });
    expect(updatesOffered()).toBe(false);
    vi.stubGlobal("location", { protocol: "http:" });
    expect(updatesOffered()).toBe(false);
  });

  it("is on a page kept on disk, which is replaced by downloading the next", () => {
    vi.stubGlobal("location", { protocol: "file:" });
    expect(updatesOffered()).toBe(true);
  });

  it("is in the desktop build, which installs it", () => {
    vi.stubGlobal("location", { protocol: "app:" });
    vi.stubGlobal("byteripperDesktop", {});
    expect(updatesOffered()).toBe(true);
  });
});
