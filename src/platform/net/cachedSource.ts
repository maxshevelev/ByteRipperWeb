/**
 * The third-party databases, fetched live and kept for a day (D10).
 *
 * The GUID catalogue, the ME databases and the microcode catalogue all live on
 * GitHub and all change without warning, which is why upstream fetches them
 * rather than shipping them. This adds the case the desktop lacks: the body is
 * kept in the Cache API for twenty-four hours, so a bench with no network still
 * has yesterday's databases — and every body carries the date it was fetched,
 * so yesterday's data is never mistaken for today's.
 *
 * **A fetch anyone is waiting on is visible, with a cancel.** That is the
 * desktop's own lesson: a reported "random pause" before an analysis turned out
 * to be a silent 350 KB download mid-run. So this reports its state and takes a
 * signal, and the panel that asked shows both.
 *
 * Single-flight: two panels asking for the same catalogue at once make one
 * request. Behind an interface, so a test installs its own and never reaches
 * the network — a test that reaches the network is a test that fails on a train.
 */

export interface FetchedBody {
  readonly text: string;
  /** When these bytes were fetched, so the interface can say how old they are. */
  readonly fetchedAt: number;
  /** True when the network was not reached and this came out of the cache. */
  readonly fromCache: boolean;
}

export interface RemoteSource {
  /** The body, from the cache while it is fresh and from the network otherwise. */
  body(options?: { readonly signal?: AbortSignal }): Promise<FetchedBody>;
}

/** How long a body is served without going back to the network. */
export const CACHE_LIFETIME_MS = 24 * 60 * 60 * 1000;

const CACHE_NAME = "byteripper-databases";
/** Where the fetch date is kept, since a Response carries no date of our own. */
const FETCHED_AT = "x-byteripper-fetched-at";

export function remoteSource(url: string, lifetime = CACHE_LIFETIME_MS): RemoteSource {
  let inFlight: Promise<FetchedBody> | undefined;

  return {
    async body(options = {}): Promise<FetchedBody> {
      const cached = await readCache(url, lifetime);
      if (cached !== undefined) return cached;
      // Single-flight: the second asker waits on the first request rather than
      // making a second one.
      inFlight ??= fetchAndCache(url, options.signal).finally(() => {
        inFlight = undefined;
      });
      try {
        return await inFlight;
      } catch (error) {
        // A network that is not there is not a failure while a stale copy
        // exists: yesterday's catalogue is better than none, and the date says
        // which it is.
        const stale = await readCache(url, Number.POSITIVE_INFINITY);
        if (stale !== undefined) return stale;
        throw error;
      }
    },
  };
}

async function openCache(): Promise<Cache | undefined> {
  if (typeof caches === "undefined") return undefined;
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Private mode, or storage refused. A browser without a cache is a browser
    // that fetches every time, which still works.
    return undefined;
  }
}

async function readCache(url: string, lifetime: number): Promise<FetchedBody | undefined> {
  const cache = await openCache();
  const response = await cache?.match(url);
  if (response === undefined) return undefined;
  const fetchedAt = Number(response.headers.get(FETCHED_AT) ?? 0);
  if (!Number.isFinite(fetchedAt) || Date.now() - fetchedAt > lifetime) return undefined;
  return { text: await response.text(), fetchedAt, fromCache: true };
}

async function fetchAndCache(url: string, signal?: AbortSignal): Promise<FetchedBody> {
  const request: RequestInit = signal === undefined ? {} : { signal };
  const response = await fetch(url, request);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  const text = await response.text();
  const fetchedAt = Date.now();

  const cache = await openCache();
  // Stored with the date beside it: a Response's own `date` header is the
  // server's, and what matters here is when *this* browser got it.
  await cache
    ?.put(url, new Response(text, { headers: { [FETCHED_AT]: String(fetchedAt) } }))
    .catch(() => undefined);

  return { text, fetchedAt, fromCache: false };
}

/** A source over text already in hand — what a test installs. */
export function fixedSource(text: string, fetchedAt = Date.now()): RemoteSource {
  return { body: async () => ({ text, fetchedAt, fromCache: true }) };
}
