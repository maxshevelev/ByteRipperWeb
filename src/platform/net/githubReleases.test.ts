import { describe, expect, it } from "vitest";
import { parseAppVersion } from "@/core/updates/appVersion";
import { NO_RELEASES, newerRelease, releaseFromJson } from "@/core/updates/releases";
import { GitHubReleases, REPOSITORY } from "@/platform/net/githubReleases";

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

describe("the question 'is there a newer version'", () => {
  const source = (tag: string) => ({
    latestRelease: async () => releaseFromJson({ ...payload, tag_name: tag }, REPOSITORY),
  });

  it("answers the release when it is newer than what runs", async () => {
    expect((await newerRelease(source("v0.8.5-2"), running("0.8.5-1")))?.version.text).toBe(
      "0.8.5-2"
    );
    expect(await newerRelease(source("v0.8.6-1"), running("0.8.5-9"))).toBeDefined();
  });

  it("answers nothing for the same version, an older one, or a labelled build of it", async () => {
    expect(await newerRelease(source("v0.8.5-2"), running("0.8.5-2"))).toBeUndefined();
    expect(await newerRelease(source("v0.8.5-2"), running("0.8.5-3"))).toBeUndefined();
    expect(await newerRelease(source("v0.8.5-2"), running("0.8.5-2-dev"))).toBeUndefined();
  });

  it("answers nothing when anything goes wrong, or there is nothing to compare", async () => {
    const failing = {
      latestRelease: async () => {
        throw new Error("offline");
      },
    };
    expect(await newerRelease(failing, running("0.8.5"))).toBeUndefined();
    expect(await newerRelease(NO_RELEASES, running("0.8.5"))).toBeUndefined();
    expect(await newerRelease(source("v0.9.0"), undefined)).toBeUndefined();
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
