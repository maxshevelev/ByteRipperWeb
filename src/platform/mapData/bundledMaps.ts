import { installMapSource, type MapFamily } from "@/firmware/mapData/mapResources";

/**
 * The app's own copy of the compiled map files, as upstream reads them out of its
 * bundle. The files ship with the build, so reading them is a read of the app's own
 * assets and never a network dependency.
 *
 * Two places read them, and both have to be given them: the workers, whose parsers
 * read a descriptor or an ME image, and the page, whose presenters name what those
 * parsers found — the Configuration tab, the FPF settings and the strap groups are
 * built on the page from the analysis the worker sent, through the same maps.
 *
 * @web-only upstream's `Bundle.module.url(forResource:)`
 */

// Each spelled out, so the bundler sees every asset it has to ship.
const URLS: Readonly<Record<MapFamily, URL>> = {
  strap: new URL("../../firmware/mapData/data/StrapMaps.bin", import.meta.url),
  register: new URL("../../firmware/mapData/data/RegisterMaps.bin", import.meta.url),
  configuration: new URL("../../firmware/mapData/data/ConfigMaps.bin", import.meta.url),
  uep: new URL("../../firmware/mapData/data/UEPMaps.bin", import.meta.url),
  gpio: new URL("../../firmware/mapData/data/GPIOMaps.bin", import.meta.url),
  layout: new URL("../../firmware/mapData/data/LayoutMaps.bin", import.meta.url),
};

const FAMILIES = Object.keys(URLS) as MapFamily[];

/**
 * Puts the app's own copy in place for a worker, read synchronously: every reader
 * of a descriptor or an ME image is synchronous, and a worker may wait on a request
 * where a page may not.
 */
export function installBundledMapsInWorker(): void {
  installMapSource((family) => {
    try {
      const request = new XMLHttpRequest();
      request.open("GET", URLS[family].href, false);
      request.responseType = "arraybuffer";
      request.send();
      // A `data:` URL — the single-file build inlines every asset — answers with status 0.
      const ok = request.status === 200 || (request.status === 0 && request.response !== null);
      return ok ? new Uint8Array(request.response as ArrayBuffer) : undefined;
    } catch {
      return undefined;
    }
  });
}

/** One family's bytes, or `undefined` where they cannot be had. */
export type MapBytesFetch = (url: string) => Promise<Uint8Array | undefined>;

const fetchBytes: MapBytesFetch = async (url) => {
  try {
    const response = await fetch(url);
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Puts the app's own copy in place for the page. A page may not make the worker's
 * synchronous request — `arraybuffer` is refused on the main thread — so the six
 * files are fetched first and handed over from memory; the page waits for them
 * before it draws, as it waits for its settings. A file that cannot be had is left
 * out, and its readers answer as upstream's do for a missing resource.
 */
export async function loadBundledMapsInPage(read: MapBytesFetch = fetchBytes): Promise<void> {
  const bytes = await Promise.all(FAMILIES.map((family) => read(URLS[family].href)));
  const held = new Map(FAMILIES.map((family, index) => [family, bytes[index]] as const));
  installMapSource((family) => held.get(family));
}
