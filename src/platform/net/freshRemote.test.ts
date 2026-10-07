import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { freshRemote } from "@/platform/net/freshRemote";

const URL = "https://example.test/db.txt";
const CHANGED_AT = "x-byteripper-changed-at";
const CHECKED_AT = "x-byteripper-checked-at";

/** A Cache API holding one copy of the file, kept by the session before this one. */
function installCopy(text: string) {
  const headers = new Headers({
    [CHANGED_AT]: String(Date.now()),
    [CHECKED_AT]: String(Date.now()),
  });
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async () => new Response(text, { headers }),
      put: async () => undefined,
    }),
  });
}

/** What the parse reads off a file: its number, and no file that is not one. */
function number(text: string): number {
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`not a number: ${text}`);
  return value;
}

/**
 * One GitHub file held fresh, and what the parse its source names does with a
 * file that does not read.
 */
describe("a file kept fresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("answers from yesterday's copy without asking the network", async () => {
    installCopy("41");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    expect(await freshRemote(URL, number).value()).toBe(41);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("treats a copy that no longer parses as no copy, and fetches the file", async () => {
    installCopy("garbage");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("42"))
    );

    expect(await freshRemote(URL, number).value()).toBe(42);
  });

  it("makes a fetched file that does not parse the ask's error", async () => {
    installCopy("garbage");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("still garbage"))
    );

    await expect(freshRemote(URL, number).value()).rejects.toThrow("not a number");
  });
});
