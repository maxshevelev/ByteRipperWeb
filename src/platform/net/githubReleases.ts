import { type Release, type ReleaseSource, releaseFromJson } from "@/core/updates/releases";

/**
 * Where this edition's releases are.
 *
 * The web edition's own repository, not upstream's: the release a build is
 * compared with is the next build of *this* app, which is what the page or the
 * Windows build would be replaced by.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.repository
 * @upstream-differs this repository's releases, not the macOS app's
 */
export const REPOSITORY = "https://github.com/maxshevelev/ByteRipperWeb";

/** @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.latestReleaseURL */
export const LATEST_RELEASE_URL =
  "https://api.github.com/repos/maxshevelev/ByteRipperWeb/releases/latest";

/** One request a day, however often the landing screen is drawn. */
const HOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Why the question could not be answered — which is what decides what the
 * reader is told. "Could not be reached" for a rate limit sends them to look at
 * a network that is fine.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#ReleaseCheckError
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#ReleaseCheckError.errorDescription
 * @upstream-differs three kinds instead of one status: a person is waiting for this answer, and each kind has a different thing to do
 */
export class ReleaseCheckError extends Error {
  readonly kind: "network" | "rateLimit" | "status";
  /** The HTTP status, for `status` and `rateLimit`. */
  readonly status: number | undefined;
  /** When the limit lifts, as a time in milliseconds, when GitHub said. */
  readonly retryAt: number | undefined;

  constructor(kind: ReleaseCheckError["kind"], status?: number, retryAt?: number) {
    super(
      kind === "network"
        ? "github.com could not be reached."
        : kind === "rateLimit"
          ? "github.com is limiting requests from this network."
          : `github.com answered ${status}.`
    );
    this.name = "ReleaseCheckError";
    this.kind = kind;
    this.status = status;
    this.retryAt = retryAt;
  }
}

/**
 * A source that asks once and holds the answer for a day, however often it is
 * asked: the landing screen is drawn again every time the last file is closed,
 * and a page that asked on each of those would be spending its rate limit
 * telling a window what it already knew. A failure is not held: a remembered
 * failure outlives the network that caused it.
 *
 * What is asked is a function, so the same holding serves the page's own fetch
 * and the desktop shell's, which asks without the page's limits.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.init
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.latestRelease
 * @upstream-differs a small in-memory hold, not `Freshened`: there is no body worth keeping across a reload
 */
export class HeldReleases implements ReleaseSource {
  private held: { readonly at: number; readonly release: Release | undefined } | undefined;
  private inFlight: Promise<Release | undefined> | undefined;

  private readonly ask: () => Promise<Release | undefined>;
  private readonly now: () => number;

  constructor(ask: () => Promise<Release | undefined>, now: () => number = Date.now) {
    this.ask = ask;
    this.now = now;
  }

  latestRelease(options?: { readonly refresh?: boolean }): Promise<Release | undefined> {
    const held = this.held;
    if (options?.refresh !== true && held !== undefined && this.now() - held.at < HOLD_MS) {
      return Promise.resolve(held.release);
    }
    // Two callers at once are one request.
    this.inFlight ??= this.ask()
      .then((release) => {
        this.held = { at: this.now(), release };
        return release;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
}

/**
 * The newest release, asked of `/releases/latest`: the one answer that always
 * has the same shape and leaves out drafts and prereleases on its own.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.shared
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.get
 */
export class GitHubReleases extends HeldReleases {
  constructor(request: typeof fetch = (input, init) => fetch(input, init), now?: () => number) {
    super(() => getLatest(request), now);
  }
}

async function getLatest(request: typeof fetch): Promise<Release | undefined> {
  let response: Response;
  try {
    response = await request(LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
      // The page decides when to ask; the browser's own cache is not to answer.
      cache: "no-store",
    });
  } catch {
    throw new ReleaseCheckError("network");
  }
  // A repository that has published nothing answers 404, and that is no
  // release rather than a failure: the truth about the repository.
  if (response.status === 404) return undefined;
  if (!response.ok) {
    // GitHub answers a spent allowance with 403 (or 429) and says when it is
    // renewed.
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (response.status === 429 || (response.status === 403 && remaining === "0")) {
      const reset = Number(response.headers.get("x-ratelimit-reset"));
      throw new ReleaseCheckError(
        "rateLimit",
        response.status,
        Number.isFinite(reset) && reset > 0 ? reset * 1000 : undefined
      );
    }
    throw new ReleaseCheckError("status", response.status);
  }
  try {
    return releaseFromJson(await response.json(), REPOSITORY);
  } catch {
    throw new ReleaseCheckError("status", response.status);
  }
}
