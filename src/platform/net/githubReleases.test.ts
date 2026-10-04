import { describe, expect, it } from "vitest";
import { parseAppVersion } from "@/core/updates/appVersion";
import { NO_RELEASES, releaseFromJson, releaseToAnnounce } from "@/core/updates/releases";
import { GitHubReleases, REPOSITORY, ReleaseCheckError } from "@/platform/net/githubReleases";
import { checkFailure } from "@/state/updateStore";

const running = (text: string) => parseAppVersion(text);

const payload = {
  tag_name: "v0.8.5-2",
  html_url: "https://github.com/maxshevelev/ByteRipperWeb/releases/tag/v0.8.5-2",
  assets: [
    {
      name: "ByteRipper-0.8.5-2-setup.exe",
      browser_download_url: "https://github.com/x/y/releases/download/v0.8.5-2/setup.exe",
    },
    { name: "broken" },
  ],
};

describe("reading a release", () => {
  it("takes the version, the page and the named files", () => {
    const release = releaseFromJson(payload, REPOSITORY);
    expect(release?.version.text).toBe("0.8.5-2");
    expect(release?.page).toBe(payload.html_url);
    expect(release?.assets).toEqual([
      { name: "ByteRipper-0.8.5-2-setup.exe", url: payload.assets[0]?.browser_download_url },
    ]);
  });

  it("falls back to the releases page for a page that cannot be opened", () => {
    const release = releaseFromJson({ ...payload, html_url: "not a url" }, REPOSITORY);
    expect(release?.page).toBe(`${REPOSITORY}/releases`);
  });

  it("says nothing for a tag with no number, or for something else entirely", () => {
    expect(releaseFromJson({ tag_name: "nightly" }, REPOSITORY)).toBeUndefined();
    expect(releaseFromJson(null, REPOSITORY)).toBeUndefined();
    expect(releaseFromJson([], REPOSITORY)).toBeUndefined();
  });
});

describe("the question 'what is announced'", () => {
  const source = (tag: string) => ({
    latestRelease: async () => releaseFromJson({ ...payload, tag_name: tag }, REPOSITORY),
  });

  it("answers the release when it is newer than what runs, in the newer case", async () => {
    const answer = await releaseToAnnounce(source("v0.8.5-2"), running("0.8.5-1"));
    expect(answer?.release.version.text).toBe("0.8.5-2");
    expect(answer?.isRunningBuild).toBe(false);
    expect(await releaseToAnnounce(source("v0.8.6-1"), running("0.8.5-9"))).toBeDefined();
  });

  it("answers the build running when the release is it, in the running case", async () => {
    const answer = await releaseToAnnounce(source("v0.8.5-2"), running("0.8.5-2"));
    expect(answer?.release.version.text).toBe("0.8.5-2");
    expect(answer?.isRunningBuild).toBe(true);
    // A labelled build of it is the build, for the comparison's purposes.
    expect(
      (await releaseToAnnounce(source("v0.8.5-2"), running("0.8.5-2-dev")))?.isRunningBuild
    ).toBe(true);
  });

  it("answers nothing for an older published release", async () => {
    // A bench on a build made after the release was published is not told to
    // go back to the older one: no published release is either the build or
    // news about it.
    expect(await releaseToAnnounce(source("v0.8.5-2"), running("0.8.5-3"))).toBeUndefined();
  });

  it("answers nothing when anything goes wrong, or there is nothing to compare", async () => {
    const failing = {
      latestRelease: async () => {
        throw new Error("offline");
      },
    };
    expect(await releaseToAnnounce(failing, running("0.8.5"))).toBeUndefined();
    expect(await releaseToAnnounce(NO_RELEASES, running("0.8.5"))).toBeUndefined();
    expect(await releaseToAnnounce(source("v0.9.0"), undefined)).toBeUndefined();
  });
});

describe("the github source", () => {
  const answering = (status: number, body: unknown = payload) => {
    const calls: string[] = [];
    const request = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
    return { calls, request };
  };

  it("asks once and holds the answer for a day", async () => {
    const { calls, request } = answering(200);
    let now = 0;
    const source = new GitHubReleases(request, () => now);
    await source.latestRelease();
    await source.latestRelease();
    expect(calls).toHaveLength(1);
    now = 25 * 60 * 60 * 1000;
    await source.latestRelease();
    expect(calls).toHaveLength(2);
  });

  it("asks again when a person asked", async () => {
    const { calls, request } = answering(200);
    const source = new GitHubReleases(request, () => 0);
    await source.latestRelease();
    await source.latestRelease({ refresh: true });
    expect(calls).toHaveLength(2);
  });

  it("takes two callers at once for one request", async () => {
    const { calls, request } = answering(200);
    const source = new GitHubReleases(request, () => 0);
    await Promise.all([source.latestRelease(), source.latestRelease()]);
    expect(calls).toHaveLength(1);
  });

  it("reads a repository with no releases as no release", async () => {
    const source = new GitHubReleases(answering(404, {}).request, () => 0);
    expect(await source.latestRelease()).toBeUndefined();
  });

  it("does not remember a failure", async () => {
    let status = 500;
    const calls: number[] = [];
    const request = (async () => {
      calls.push(status);
      return new Response(JSON.stringify(payload), { status });
    }) as typeof fetch;
    const source = new GitHubReleases(request, () => 0);
    await expect(source.latestRelease()).rejects.toThrow("500");
    status = 200;
    expect((await source.latestRelease())?.version.text).toBe("0.8.5-2");
    expect(calls).toEqual([500, 200]);
  });
});

describe("why a check fails", () => {
  const failing = (status: number, headers: Record<string, string> = {}) => {
    const request = (async () => new Response("{}", { status, headers })) as typeof fetch;
    return new GitHubReleases(request, () => 0);
  };

  it("names a spent allowance, and when it is renewed", async () => {
    const error = await failing(403, {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "1800",
    })
      .latestRelease()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReleaseCheckError);
    expect(error).toMatchObject({ kind: "rateLimit", status: 403, retryAt: 1_800_000 });
  });

  it("reads a 429 as a limit too", async () => {
    await expect(failing(429).latestRelease()).rejects.toMatchObject({ kind: "rateLimit" });
  });

  it("does not take every 403 for a limit", async () => {
    await expect(
      failing(403, { "x-ratelimit-remaining": "12" }).latestRelease()
    ).rejects.toMatchObject({ kind: "status", status: 403 });
  });

  it("names GitHub's own errors by their status", async () => {
    await expect(failing(503).latestRelease()).rejects.toMatchObject({
      kind: "status",
      status: 503,
    });
  });

  it("calls a request that never got an answer a network failure", async () => {
    const source = new GitHubReleases(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(source.latestRelease()).rejects.toMatchObject({ kind: "network" });
  });
});

describe("the words for it", () => {
  it("says how long to wait, rounded up", () => {
    const error = new ReleaseCheckError("rateLimit", 403, 10 * 60_000 + 1);
    expect(checkFailure(error, 0)).toContain("11 minutes");
  });

  it("says an hour when GitHub did not say", () => {
    expect(checkFailure(new ReleaseCheckError("rateLimit", 403), 0)).toContain("about an hour");
  });

  it("names the status", () => {
    expect(checkFailure(new ReleaseCheckError("status", 502), 0)).toContain("502");
  });

  it("blames the network only for the network", () => {
    expect(checkFailure(new ReleaseCheckError("network"), 0)).toContain("could not be reached");
    expect(checkFailure(new Error("anything"), 0)).toContain("could not be reached");
  });
});
