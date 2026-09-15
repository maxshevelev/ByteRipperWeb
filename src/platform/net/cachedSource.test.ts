import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CACHE_LIFETIME_MS, fixedSource, remoteSource } from "@/platform/net/cachedSource";

/**
 * D10: fetched live, kept for a day, and never silent.
 *
 * These run against a stubbed `fetch` and a stubbed Cache API — a test that
 * reaches the network is a test that fails on a train.
 */

interface StubCache {
  readonly entries: Map<string, { body: string; fetchedAt: number }>;
}

const installCaches = (): StubCache => {
  const entries = new Map<string, { body: string; fetchedAt: number }>();
  const cache = {
    match: async (url: string) => {
      const found = entries.get(url);
      if (found === undefined) return undefined;
      return new Response(found.body, {
        headers: { "x-byteripper-fetched-at": String(found.fetchedAt) },
      });
    },
    put: async (url: string, response: Response) => {
      entries.set(url, {
        body: await response.text(),
        fetchedAt: Number(response.headers.get("x-byteripper-fetched-at") ?? 0),
      });
    },
  };
  vi.stubGlobal("caches", { open: async () => cache });
  return { entries };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a remote database", () => {
  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testTheFirstCallFetches
  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testWithinTheDayTheSourceIsNotAsked
  it("fetches it once and serves the cache after", async () => {
    const store = installCaches();
    const fetcher = vi.fn(async () => new Response("A,one\n"));
    vi.stubGlobal("fetch", fetcher);

    const source = remoteSource("https://example.test/db.csv");
    const first = await source.body();
    const second = await source.body();

    expect(first.text).toBe("A,one\n");
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.entries.size).toBe(1);
  });

  // Two panels asking at once make one request, not two.
  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testASecondCallerDuringTheFetchDoesNotStartASecondOne
  it("is single-flight", async () => {
    installCaches();
    const fetcher = vi.fn(async () => new Response("A,one\n"));
    vi.stubGlobal("fetch", fetcher);

    const source = remoteSource("https://example.test/db.csv");
    await Promise.all([source.body(), source.body()]);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAfterADayFreshReplacesTheValueForTheNextReader
  it("goes back to the network once the body is a day old", async () => {
    installCaches();
    const fetcher = vi.fn(async () => new Response("A,one\n"));
    vi.stubGlobal("fetch", fetcher);

    const source = remoteSource("https://example.test/db.csv");
    await source.body();
    vi.advanceTimersByTime(CACHE_LIFETIME_MS + 1);
    await source.body();

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // A bench with no network still has yesterday's databases, and the date says
  // which they are.
  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAFailedCheckKeepsWhatIsHeld
  it("serves a stale body when the network is not there", async () => {
    installCaches();
    let fail = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (fail) throw new Error("offline");
        return new Response("A,one\n");
      })
    );

    const source = remoteSource("https://example.test/db.csv");
    const fresh = await source.body();
    vi.advanceTimersByTime(CACHE_LIFETIME_MS + 1);
    fail = true;
    const stale = await source.body();

    expect(stale.text).toBe("A,one\n");
    expect(stale.fromCache).toBe(true);
    expect(stale.fetchedAt).toBe(fresh.fetchedAt);
  });

  // @upstream Packages/FreshData/Tests/FreshDataTests/FreshenedTests.swift#FreshenedTests.testAFailedFirstFetchIsNotRemembered
  it("gives up when there is nothing cached and no network", async () => {
    installCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );

    await expect(remoteSource("https://example.test/db.csv").body()).rejects.toThrow("offline");
  });

  it("reports a server that answered with a status", async () => {
    installCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 }))
    );

    await expect(remoteSource("https://example.test/db.csv").body()).rejects.toThrow("404");
  });
});

describe("a source over text in hand", () => {
  it("answers without a network at all", async () => {
    const body = await fixedSource("A,one\n").body();
    expect(body.text).toBe("A,one\n");
    expect(body.fromCache).toBe(true);
  });
});
