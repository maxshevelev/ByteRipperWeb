import { afterEach, describe, expect, it } from "vitest";
import { fixtureBytes } from "@/core/testing/fixtureFile";
import { installMapSource, MAP_FILE_NAMES } from "@/firmware/mapData/mapResources";
import { configurationMapForME } from "@/firmware/me/configuration/meConfigurationMap";
import { loadBundledMapsInPage } from "@/platform/mapData/bundledMaps";

/** The committed map file a bundled URL names, read from disk as the test setup reads it. */
const fromDisk = async (url: string): Promise<Uint8Array | undefined> => {
  const name = Object.values(MAP_FILE_NAMES).find((one) => url.endsWith(`/${one}`));
  return name === undefined ? undefined : fixtureBytes(`src/firmware/mapData/data/${name}`);
};

/**
 * The page reads the maps too: the ME panel builds its Configuration tab, and its FPF and strap
 * groups, from the analysis the worker sent, through the same maps. A page that never installed
 * them showed "No configuration read" on every image, however much the worker had read.
 *
 * @web-only upstream reads its maps out of one bundle, in one process
 */
describe("the page's maps", () => {
  // The test setup installs the files from disk for every suite; this one takes them away first.
  afterEach(() => {
    installMapSource((family) =>
      fixtureBytes(`src/firmware/mapData/data/${MAP_FILE_NAMES[family]}`)
    );
  });

  it("are there once the page has loaded them", async () => {
    installMapSource(() => undefined);
    expect(configurationMapForME(16, "mobile"), "the premise: nothing installed").toBeUndefined();

    await loadBundledMapsInPage(fromDisk);
    expect(configurationMapForME(16, "mobile")).toBeDefined();
  });

  it("leave out a file that cannot be had, and nothing else", async () => {
    installMapSource(() => undefined);
    await loadBundledMapsInPage(async (url) =>
      url.endsWith("/ConfigMaps.bin") ? undefined : fromDisk(url)
    );
    expect(configurationMapForME(16, "mobile")).toBeUndefined();
  });
});
