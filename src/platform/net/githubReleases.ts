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
 * The newest release, asked of `/releases/latest`: the one answer that always
 * has the same shape and leaves out drafts and prereleases on its own.
 *
 * Held for a day, because the landing screen is drawn again every time the last
 * file is closed and a page that asked github.com on each of those would be
 * spending its rate limit telling a window what it already knew. A failure is
 * not held: a remembered failure outlives the network that caused it.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.shared
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.init
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.latestRelease
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.get
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#ReleaseCheckError
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#ReleaseCheckError.errorDescription
 * @upstream-differs a small in-memory hold, not `Freshened`: there is no body worth keeping across a reload
 */
export class GitHubReleases implements ReleaseSource {
  private held: { readonly at: number; readonly release: Release | undefined } | undefined;
  private inFlight: Promise<Release | undefined> | undefined;

  private readonly request: typeof fetch;
  private readonly now: () => number;

  constructor(
    request: typeof fetch = (input, init) => fetch(input, init),
    now: () => number = Date.now
  ) {
    this.request = request;
    this.now = now;
  }

  latestRelease(options?: { readonly refresh?: boolean }): Promise<Release | undefined> {
    const held = this.held;
    if (options?.refresh !== true && held !== undefined && this.now() - held.at < HOLD_MS) {
      return Promise.resolve(held.release);
    }
    // Two callers at once are one request.
    this.inFlight ??= this.get().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async get(): Promise<Release | undefined> {
    const response = await this.request(LATEST_RELEASE_URL, {
      headers: { Accept: "application/vnd.github+json" },
      // The page decides when to ask; the browser's own cache is not to answer.
      cache: "no-store",
    });
    // A repository that has published nothing answers 404, and that is no
    // release rather than a failure: the truth about the repository.
    if (response.status === 404) return this.hold(undefined);
    if (!response.ok) throw new Error(`github.com answered ${response.status}.`);
    return this.hold(releaseFromJson(await response.json(), REPOSITORY));
  }

  private hold(release: Release | undefined): Release | undefined {
    this.held = { at: this.now(), release };
    return release;
  }
}
