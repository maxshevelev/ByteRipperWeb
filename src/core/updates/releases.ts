import { type AppVersion, compareAppVersions, parseAppVersion } from "@/core/updates/appVersion";

/**
 * A release published on github.com.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#Release
 * @upstream-differs carries the release's files too, which the desktop shell installs from
 */
export interface Release {
  /**
   * The version its tag names, "0.8.5-2".
   *
   * @upstream ByteRipperApp/Updates/GitHubReleases.swift#Release.version
   */
  readonly version: AppVersion;
  /**
   * The release's own page — where a download and the notes are. What the
   * landing screen opens when its line is clicked.
   *
   * @upstream ByteRipperApp/Updates/GitHubReleases.swift#Release.page
   */
  readonly page: string;
  /** The files attached to it, by name. */
  readonly assets: readonly { readonly name: string; readonly url: string }[];
  /**
   * The release's own text, as written on github.com: what the landing screen
   * prints under the version. Absent when the release has none, or when the
   * answer comes from the shell's redirect, which carries only the tag.
   *
   * @web-only the page reads the body out of the API's answer; upstream links
   * to the release's page rather than printing its text
   */
  readonly body?: string | undefined;
}

/**
 * Where "is there a newer version of this app?" is asked.
 *
 * An interface for the reason the live data sources are: a test that reaches
 * github.com is a test that fails on a train, and a bench with no internet is
 * not a defect in what is being tested.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#ReleaseSource
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#ReleaseSource.latestRelease
 */
export interface ReleaseSource {
  /**
   * The newest published release, or `undefined` when the repository has
   * published none. Rejects when the question could not be asked at all.
   * `refresh` asks again even if an answer is held — for a person who pressed
   * a button, rather than for a screen that was drawn.
   */
  latestRelease(options?: { readonly refresh?: boolean }): Promise<Release | undefined>;
}

/**
 * A source with nothing to announce: what a repository with no releases
 * answers, and what an app under test asks instead of github.com.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#NoReleases
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#NoReleases.latestRelease
 */
export const NO_RELEASES: ReleaseSource = { latestRelease: async () => undefined };

/**
 * Whether the release is newer than the version running.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#Release.isNewer
 */
export const isNewerRelease = (release: Release, running: AppVersion): boolean =>
  compareAppVersions(release.version, running) > 0;

/**
 * The newest published release, if it is newer than the version running — the
 * whole question in one place, so that no caller has to remember both halves of
 * it and get the second one wrong.
 *
 * Everything that can go wrong answers `undefined`: no network, a rate limit, a
 * repository with no releases, a build with no version to compare against. The
 * landing screen is there to open a file, not to report on github.com.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#ReleaseSource.newerRelease
 */
export async function newerRelease(
  source: ReleaseSource,
  running: AppVersion | undefined
): Promise<Release | undefined> {
  if (running === undefined) return undefined;
  try {
    const release = await source.latestRelease();
    return release !== undefined && isNewerRelease(release, running) ? release : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The release github.com describes, read out of its answer.
 *
 * Separate from the request so that the reading of it — the part that can be
 * wrong in ways a network cannot cause — is tested against a fixture.
 *
 * @upstream ByteRipperApp/Updates/GitHubReleases.swift#GitHubReleases.release
 */
export function releaseFromJson(data: unknown, repository: string): Release | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const payload = data as {
    tag_name?: unknown;
    html_url?: unknown;
    assets?: unknown;
    body?: unknown;
  };
  if (typeof payload.tag_name !== "string") return undefined;
  const version = parseAppVersion(payload.tag_name);
  if (version === undefined) return undefined;
  // A tag whose page cannot be opened is a line that promises a click, so the
  // releases page stands in: the release is listed on it.
  const page =
    typeof payload.html_url === "string" && /^https:\/\/[^/\s]+\//.test(payload.html_url)
      ? payload.html_url
      : `${repository}/releases`;
  const assets = Array.isArray(payload.assets)
    ? payload.assets.flatMap((one: unknown) => {
        const asset = one as { name?: unknown; browser_download_url?: unknown };
        return typeof asset.name === "string" && typeof asset.browser_download_url === "string"
          ? [{ name: asset.name, url: asset.browser_download_url }]
          : [];
      })
    : [];
  const body = typeof payload.body === "string" ? payload.body : undefined;
  return { version, page, assets, body };
}
