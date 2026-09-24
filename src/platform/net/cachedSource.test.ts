import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { remoteFailureOf, remoteSource } from "@/platform/net/cachedSource";

/**
 * The HTTP half of a third-party database, and nothing else.
 *
 * The freshness *rules* are `Freshened`, which has its own file and its own
 * tests; what is here is one conditional request for a body, the validator the
 * server gave with it kept beside it, and the three ways an answer can fail
 * named rather than worded. These run against a stubbed `fetch` and a stubbed
 * Cache API — a test that reaches the network is a test that fails on a train.
 *
 * The Cache API is the web's own seat for that copy (upstream writes an
 * on-disk file and falls back to the baseline its build ships), so the header
 * names below are a format this file is the specification for.
 */

const VALIDATOR = "x-byteripper-validator";
const CHANGED_AT = "x-byteripper-changed-at";
const CHECKED_AT = "x-byteripper-checked-at";

const URL = "https://example.test/db.csv";

interface Stored {
  readonly body: string;
  readonly validator: string | undefined;
  readonly changedAt: number;
  readonly checkedAt: number;
}

const installCaches = () => {
  const entries = new Map<string, Stored>();
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async (url: string): Promise<Response | undefined> => {
        const found = entries.get(url);
        if (found === undefined) return undefined;
        const headers = new Headers();
        headers.set(CHANGED_AT, String(found.changedAt));
        headers.set(CHECKED_AT, String(found.checkedAt));
        if (found.validator !== undefined) headers.set(VALIDATOR, found.validator);
        return new Response(found.body, { headers });
      },
      put: async (url: string, response: Response): Promise<void> => {
        entries.set(url, {
          body: await response.text(),
          validator: response.headers.get(VALIDATOR) ?? undefined,
          changedAt: Number(response.headers.get(CHANGED_AT)),
          checkedAt: Number(response.headers.get(CHECKED_AT)),
        });
      },
    }),
  });
  return { entries };
};

/** The request the source made, as the assertion sees it. */
const sent = (fetcher: ReturnType<typeof vi.fn>, call = 0): Headers => {
  const init = fetcher.mock.calls[call]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
};

/** How the request told the browser to treat its own cache. */
const cacheModeOf = (fetcher: ReturnType<typeof vi.fn>, call = 0): RequestInit["cache"] =>
  (fetcher.mock.calls[call]?.[1] as RequestInit | undefined)?.cache;

const answered = (body: string, etag?: string): Response =>
  new Response(body, { headers: etag === undefined ? {} : { ETag: etag } });

/** One ask, answered, with the fetcher it asked through. */
const asked = async (validator: string | undefined): Promise<ReturnType<typeof vi.fn>> => {
  installCaches();
  const fetcher = vi.fn(async () => answered("A,one\n", '"v1"'));
  vi.stubGlobal("fetch", fetcher);
  await remoteSource(URL).check(validator);
  return fetcher;
};

const AT = new Date("2026-01-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AT);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a conditional request for a body", () => {
  // @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.request
  it("asks unconditionally when nothing is held, and keeps the validator", async () => {
    const store = installCaches();
    const fetcher = vi.fn(async () => answered("A,one\n", '"v1"'));
    vi.stubGlobal("fetch", fetcher);

    const answer = await remoteSource(URL).check(undefined);

    expect(answer).toEqual({ kind: "fresh", text: "A,one\n", validator: '"v1"' });
    // Nothing to present, so the request asks for the whole body.
    expect(sent(fetcher).get("If-None-Match")).toBeNull();
    // And it carries no header of its own at all: anything outside the CORS
    // safelist sends a preflight ahead of the request, and
    // `raw.githubusercontent.com` answers every preflight 403. A `User-Agent`
    // set here — the one the desktop sends — failed every database fetch in
    // Safari, which honours it, while Chromium stripped it and hid the fault.
    expect(sent(fetcher).get("User-Agent")).toBeNull();
    expect([...sent(fetcher).keys()]).toEqual([]);
    // Nothing was asked about a body this script could name, so the browser is
    // asked to revalidate — see the case below.
    expect(cacheModeOf(fetcher)).toBe("no-cache");

    const stored = await remoteSource(URL).stored();
    expect(stored).toEqual({
      text: "A,one\n",
      validator: '"v1"',
      changedAt: AT.getTime(),
      checkedAt: AT.getTime(),
    });
    expect(store.entries.size).toBe(1);
  });

  // @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.send
  it("presents the validator, and a 304 keeps the body and its changed date", async () => {
    installCaches();
    let status = 200;
    const fetcher = vi.fn(async () =>
      status === 304 ? new Response(null, { status: 304 }) : answered("A,one\n", '"v1"')
    );
    vi.stubGlobal("fetch", fetcher);
    await remoteSource(URL).check(undefined);

    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    status = 304;
    const answer = await remoteSource(URL).check('"v1"');

    expect(answer).toEqual({ kind: "unchanged" });
    expect(sent(fetcher, 1).get("If-None-Match")).toBe('"v1"');
    // The question is being asked here, so the browser must not answer it from
    // disk: a check served out of its own cache is not a check.
    expect(cacheModeOf(fetcher, 1)).toBe("no-store");
    // The check happened, so `checkedAt` moves; the body did not change, so
    // `changedAt` does not — a 304 today does not make last week's database any
    // fresher, and the date the panel shows is the date it changed.
    expect(await remoteSource(URL).stored()).toEqual({
      text: "A,one\n",
      validator: '"v1"',
      changedAt: AT.getTime(),
      checkedAt: new Date("2026-01-02T00:00:00Z").getTime(),
    });
  });

  it("asks about the body itself where a validator is in hand, and asks the browser to revalidate where one is not", async () => {
    // Measured in a browser, and the reason this is two rules rather than one:
    // `raw.githubusercontent.com` — the GUID catalogue, `MEA.dat`, `Huffman.dat`
    // — exposes only `cache-control`, `content-length`, `content-type` and
    // `expires` to a cross-origin script, so its `ETag` cannot be read and none
    // is ever kept; a script-set `If-None-Match` there is refused before it is
    // made (the CORS preflight is answered `403` with no
    // `access-control-allow-headers`). `api.github.com`, which serves the
    // microcode listing, exposes its `ETag` and allows the request. So where
    // this file can ask it does, with the cache out of the way entirely; where
    // it cannot, it asks the browser to revalidate — and the browser sets the
    // very header a script may not, out of the copy it stored:
    //
    //   wire request:  cache-control=max-age=0 if-none-match=W/"948cc1e4…"
    //   wire response: statusCode=304            (79 bytes moved)
    //   for comparison, the unconditional fetch beside it moved 37 941
    //
    // That is why neither mode is `default`: a `200` off disk is not a check,
    // and a copy still inside `max-age` must not answer one either — a *Refresh
    // now* has to reach the server.
    //
    // @web-only the transport's own business: a native app reads the validator
    // and presents it itself, which is the `no-store` half above
    expect(cacheModeOf(await asked('"v1"'))).toBe("no-store");
    expect(cacheModeOf(await asked(undefined))).toBe("no-cache");
  });

  it("replaces the body when the server has a newer one", async () => {
    installCaches();
    let body = answered("A,one\n", '"v1"');
    const fetcher = vi.fn(async () => body);
    vi.stubGlobal("fetch", fetcher);
    await remoteSource(URL).check(undefined);

    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    body = answered("A,two\nB,three\n", '"v2"');
    const answer = await remoteSource(URL).check('"v1"');

    expect(answer).toEqual({ kind: "fresh", text: "A,two\nB,three\n", validator: '"v2"' });
    expect(await remoteSource(URL).stored()).toEqual({
      text: "A,two\nB,three\n",
      validator: '"v2"',
      changedAt: new Date("2026-01-02T00:00:00Z").getTime(),
      checkedAt: new Date("2026-01-02T00:00:00Z").getTime(),
    });
  });

  it("treats a copy nothing can date as no copy at all", async () => {
    // A body with no dates beside it is a body nothing can decide about, so the
    // next ask fetches it again rather than guessing.
    const store = installCaches();
    store.entries.set(URL, {
      body: "A,one\n",
      validator: '"v1"',
      changedAt: Number.NaN,
      checkedAt: Number.NaN,
    });

    expect(await remoteSource(URL).stored()).toBeUndefined();
  });

  it("works where the browser has no Cache API", async () => {
    // Private mode, or storage refused. A browser without a cache is a browser
    // that fetches every time, which still works.
    vi.stubGlobal("caches", undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answered("A,one\n"))
    );

    expect(await remoteSource(URL).stored()).toBeUndefined();
    expect(await remoteSource(URL).check(undefined)).toEqual({
      kind: "fresh",
      text: "A,one\n",
      validator: undefined,
    });
  });
});

describe("a request that did not answer with a body", () => {
  it("names a rate limit, whether it came as 403 or 429", async () => {
    for (const status of [403, 429]) {
      installCaches();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("", { status }))
      );

      const error = await remoteSource(URL)
        .check(undefined)
        .then(
          () => undefined,
          (thrown: unknown) => thrown
        );

      expect(remoteFailureOf(error)).toEqual({ kind: "rateLimited" });
    }
  });

  it("names a server that answered with a status", async () => {
    installCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 }))
    );

    const error = await remoteSource(URL)
      .check(undefined)
      .then(
        () => undefined,
        (thrown: unknown) => thrown
      );

    expect(remoteFailureOf(error)).toEqual({ kind: "badResponse", status: 404 });
  });

  it("names being offline, in whatever words the browser used", async () => {
    installCaches();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      })
    );

    const error = await remoteSource(URL)
      .check(undefined)
      .then(
        () => undefined,
        (thrown: unknown) => thrown
      );

    expect(remoteFailureOf(error)).toEqual({ kind: "offline", detail: "network unreachable" });
  });

  it("passes a cancel through untouched", async () => {
    // A cancel is the caller's own doing, so it is not one of the three
    // failures and nothing names it: the ask is simply over.
    installCaches();
    const abort = new Error("aborted");
    abort.name = "AbortError";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw abort;
      })
    );

    const controller = new AbortController();
    const error = await remoteSource(URL)
      .check(undefined, { signal: controller.signal })
      .then(
        () => undefined,
        (thrown: unknown) => thrown
      );

    expect(error).toBe(abort);
    expect(remoteFailureOf(error)).toBeUndefined();
  });
});
