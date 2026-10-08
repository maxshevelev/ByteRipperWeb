import { afterEach, describe, expect, it, vi } from "vitest";
import { OpfsScratchStore } from "@/platform/files/opfsScratchStore";

describe("whether the page has private storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  const withCall = () =>
    vi.stubGlobal("navigator", { storage: { getDirectory: () => Promise.resolve({}) } });

  it("is yes where the browser has the call and the page an origin", () => {
    withCall();
    vi.stubGlobal("origin", "http://admins-imac:5173");
    expect(OpfsScratchStore.isAvailable()).toBe(true);
  });

  // The single-file build opened from disk: the call is there, and refused.
  it("is no for a page with no origin of its own, though the call is there", () => {
    withCall();
    vi.stubGlobal("origin", "null");
    expect(OpfsScratchStore.isAvailable()).toBe(false);
  });

  it("is no without the call", () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("origin", "http://admins-imac:5173");
    expect(OpfsScratchStore.isAvailable()).toBe(false);
  });
});
