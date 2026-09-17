/**
 * The third-party databases, fetched live and re-checked rather than trusted.
 *
 * The GUID catalogue, the ME databases and the microcode catalogue all live on
 * GitHub and all change without warning, which is why upstream fetches them
 * rather than shipping them. This is the HTTP half of that: one conditional
 * request for a body, and the answer it gave last time kept beside the body.
 *
 * **The request is conditional at one host and revalidated at the other, and
 * the difference is what GitHub lets a script read.** `api.github.com`, which
 * serves the microcode listing, exposes its `ETag` to a cross-origin reader
 * (`access-control-expose-headers`) and answers a request that carries
 * `If-None-Match` — so there the validator is kept, presented back, and a body
 * that has not changed comes home as a `304` costing no bytes. That is the
 * desktop's own request, header for header. `raw.githubusercontent.com`, which
 * serves the GUID catalogue, `MEA.dat` and `Huffman.dat`, exposes only
 * `cache-control`, `content-length`, `content-type` and `expires`: the `ETag`
 * it sends is invisible to a script, and a script-set `If-None-Match` there is
 * refused before it is made — a CORS preflight answered `403` with no
 * `access-control-allow-headers` — while the same header is free when the
 * *browser* sets it. So those three are asked with `cache: "no-cache"` and the
 * browser revalidates the copy it holds with the validator it stored itself.
 * Measured, not assumed: that request goes out with `cache-control: max-age=0`
 * and `if-none-match: W/"948cc1e4…"` — a validator this code cannot read —
 * and comes back `304` for 79 bytes, where the unconditional fetch beside it
 * moved 37 941.
 *
 * Both modes take the browser's cache out of the way as an *answer*, which is
 * what the desktop asks of `URLSession` by name: `reloadIgnoringLocalCacheData`,
 * "which would answer `200` from disk and swallow the `304` this request is
 * asking for" (`GuidsSource.get`). What it is left to do is carry the
 * validator. The freshness *rules* are not here either way: they are
 * `Freshened` (`freshened.ts`), which decides when to ask and hands over the
 * validator it was given. This file only asks.
 *
 * The Cache API stays, and its job changed: it is no longer a lifetime, it is
 * where the last body, its validator and both of `Freshened`'s dates survive a
 * reload — so a bench with no network still has yesterday's databases, and
 * yesterday's data is never mistaken for today's. The desktop needs no such
 * seat: its offline answer is the baseline compiled into the build.
 *
 * **A fetch anyone is waiting on is visible, with a cancel.** That is the
 * desktop's own lesson: a reported "random pause" before an analysis turned out
 * to be a silent 350 KB download mid-run. So this takes a signal, and the panel
 * that asked shows the wait and offers the cancel.
 *
 * Single-flight: two panels asking for the same catalogue at once make one
 * request. Behind an interface, so a test installs its own and never reaches
 * the network — a test that reaches the network is a test that fails on a train.
 */

/**
 * Why a body did not arrive, in a form a panel can act on rather than print.
 *
 * The three are not the same problem and do not have the same answer. Being
 * rate-limited is temporary and is waited out; being offline means yesterday's
 * copy is the best there is; a 404 means the URL has moved and no amount of
 * waiting helps. A panel that showed one message for all three would be telling
 * a bench to keep pressing a button that cannot work.
 *
 * @upstream-differs one vocabulary of three cases for every source, where
 * upstream spells the same three again in each repository's own error type
 * (`GuidsSourceError`, `MicrocodeSourceError`, `MEADataError`) with a wording
 * apiece — the GUID catalogue's is `GuidsSourceError` in
 * `src/state/guidCatalogueSource.ts`, which is the one named apart
 */
export type RemoteFailure =
  /** The request never got an answer: no network, or it was refused outright. */
  | { readonly kind: "offline"; readonly detail: string }
  /**
   * GitHub answered 403 or 429. Anonymous requests to `api.github.com` are
   * limited by address, and a bench behind one office NAT reaches the limit
   * without ever having asked for anything itself.
   */
  | { readonly kind: "rateLimited" }
  | { readonly kind: "badResponse"; readonly status: number };

export class RemoteFetchError extends Error {
  readonly failure: RemoteFailure;

  constructor(failure: RemoteFailure) {
    super(remoteFailureMessage(failure));
    this.name = "RemoteFetchError";
    this.failure = failure;
  }
}

/**
 * Whether an error carries one of these failures, asked by shape and not by
 * `instanceof`.
 *
 * `instanceof` is a question about which *copy* of this module built the error,
 * and the answer is no whenever there are two — a second module graph, a worker
 * with its own bundle. The failure a panel branches on must not depend on that:
 * the first thing it got wrong was calling a rate-limited fetch "offline",
 * which is the one state this is here to tell apart.
 */
export function remoteFailureOf(error: unknown): RemoteFailure | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const failure = (error as { failure?: unknown }).failure;
  if (typeof failure !== "object" || failure === null) return undefined;
  const kind = (failure as { kind?: unknown }).kind;
  return kind === "offline" || kind === "rateLimited" || kind === "badResponse"
    ? (failure as RemoteFailure)
    : undefined;
}

export function remoteFailureMessage(failure: RemoteFailure): string {
  switch (failure.kind) {
    case "offline":
      return `Could not reach the server: ${failure.detail}`;
    case "rateLimited":
      return (
        "GitHub is rate-limiting this address. Try again in a few minutes, or " +
        "choose a file you already have."
      );
    case "badResponse":
      return `The server answered ${failure.status}.`;
  }
}

/**
 * The copy an earlier run left, exactly as it left it — including the validator
 * to present, and how old it is by both of `Freshened`'s dates.
 *
 * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.Status
 */
export interface StoredBody {
  readonly text: string;
  /** What the server called these bytes — an `ETag`, to echo back next time. */
  readonly validator: string | undefined;
  /** When the body last actually changed. */
  readonly changedAt: number;
  /** When it was last confirmed current. */
  readonly checkedAt: number;
}

/**
 * What one conditional request answered.
 *
 * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.Outcome
 */
export type RemoteAnswer =
  /** The server says what we hold is still current — an HTTP `304`. */
  | { readonly kind: "unchanged" }
  | { readonly kind: "fresh"; readonly text: string; readonly validator: string | undefined };

export interface RemoteSource {
  /** The copy an earlier run left in the Cache API, and no request at all. */
  stored(): Promise<StoredBody | undefined>;
  /**
   * One conditional request for the body: `If-None-Match` with the validator,
   * and `304` when it still stands.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.get
   */
  check(
    validator: string | undefined,
    options?: { readonly signal?: AbortSignal }
  ): Promise<RemoteAnswer>;
}

/** Where the validator and the two dates are kept, a Response carrying neither. */
const VALIDATOR = "x-byteripper-validator";
const CHANGED_AT = "x-byteripper-changed-at";
const CHECKED_AT = "x-byteripper-checked-at";

const CACHE_NAME = "byteripper-databases";

export function remoteSource(url: string): RemoteSource {
  return {
    async stored(): Promise<StoredBody | undefined> {
      const response = await readCache(url);
      if (response === undefined) return undefined;
      const changedAt = Number(response.headers.get(CHANGED_AT) ?? Number.NaN);
      const checkedAt = Number(response.headers.get(CHECKED_AT) ?? Number.NaN);
      // A body nothing can date is a body nothing can decide about, so it is
      // not a copy at all: the next ask fetches it again.
      if (!Number.isFinite(changedAt) || !Number.isFinite(checkedAt)) return undefined;
      return {
        text: await response.text(),
        validator: response.headers.get(VALIDATOR) ?? undefined,
        changedAt,
        checkedAt,
      };
    },

    async check(validator, options = {}): Promise<RemoteAnswer> {
      const at = Date.now();
      const response = await request(url, validator, options.signal);
      if (response.status === 304) {
        // The body is what we hold; the check itself is the news, and it is
        // what the next decision about this body is made from.
        await touch(url, at);
        return { kind: "unchanged" };
      }
      const text = await response.text();
      const etag = response.headers.get("ETag") ?? undefined;
      await remember(url, text, etag, at);
      return { kind: "fresh", text, validator: etag };
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

async function readCache(url: string): Promise<Response | undefined> {
  const cache = await openCache();
  return await cache?.match(url);
}

function entry(
  text: string,
  validator: string | undefined,
  changedAt: number,
  checkedAt: number
): Response {
  const headers = new Headers();
  headers.set(CHANGED_AT, String(changedAt));
  headers.set(CHECKED_AT, String(checkedAt));
  // An ETag is quoted ASCII, but a header value is a byte string and a server
  // is free to send something else: a validator that cannot be written is a
  // validator dropped, which costs a body and never a failure.
  if (validator !== undefined) {
    try {
      headers.set(VALIDATOR, validator);
    } catch {
      // Left out, and the next check is an unconditional one.
    }
  }
  return new Response(text, { headers });
}

async function remember(
  url: string,
  text: string,
  validator: string | undefined,
  at: number
): Promise<void> {
  const cache = await openCache();
  await cache?.put(url, entry(text, validator, at, at)).catch(() => undefined);
}

/**
 * The check happened: the body is untouched and its `checkedAt` moves. The
 * `changedAt` deliberately does not — a `304` today does not make last week's
 * database any fresher, and the date shown is the date it changed.
 *
 * @upstream Packages/FreshData/Sources/FreshData/Freshened.swift#Freshened.run
 */
async function touch(url: string, at: number): Promise<void> {
  const response = await readCache(url);
  if (response === undefined) return;
  const validator = response.headers.get(VALIDATOR) ?? undefined;
  const changedAt = Number(response.headers.get(CHANGED_AT) ?? at);
  const text = await response.text();
  const cache = await openCache();
  await cache?.put(url, entry(text, validator, changedAt, at)).catch(() => undefined);
}

async function request(
  url: string,
  validator: string | undefined,
  signal: AbortSignal | undefined
): Promise<Response> {
  const headers = new Headers();
  if (validator !== undefined) headers.set("If-None-Match", validator);
  // GitHub asks for one, and an anonymous request without it is answered less
  // kindly.
  headers.set("User-Agent", "ByteRipper");
  let response: Response;
  try {
    response = await fetch(url, {
      headers,
      // The browser's cache must never be the one that answers a check — a
      // `200` off disk is not a check, which is the desktop's own reason for
      // `reloadIgnoringLocalCacheData`. It may only carry the question. Where
      // this code holds the validator it asks itself, and `no-store` keeps the
      // cache out of the way entirely; where it cannot read the validator the
      // browser is asked to revalidate the copy it holds with the validator it
      // stored (`max-age=0`, `If-None-Match` from its own entry, a `304` back
      // on the wire), which is a conditional request this code has no way to
      // make and the same one upstream has.
      cache: validator === undefined ? "no-cache" : "no-store",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    // A cancel is the caller's own doing and is not a failure to report as one.
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new RemoteFetchError({
      kind: "offline",
      detail: error instanceof Error ? error.message : "the request did not complete",
    });
  }
  if (response.status === 403 || response.status === 429) {
    throw new RemoteFetchError({ kind: "rateLimited" });
  }
  if (!response.ok && response.status !== 304) {
    throw new RemoteFetchError({ kind: "badResponse", status: response.status });
  }
  return response;
}
