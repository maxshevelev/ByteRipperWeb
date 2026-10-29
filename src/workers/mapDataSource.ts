/// <reference lib="webworker" />

import { installMapSource, type MapFamily } from "@/firmware/mapData/mapResources";

/**
 * The app's own copy of the compiled map files, read synchronously, as
 * upstream reads them out of its bundle: every reader of a descriptor or an ME
 * image is synchronous, and a worker may wait on a request where a page may
 * not. The files ship with the build, so this is a read of the app's own
 * assets and never a network dependency.
 *
 * @web-only upstream's `Bundle.module.url(forResource:)`
 */

// Each spelled out, so the bundler sees every asset it has to ship.
const URLS: Readonly<Record<MapFamily, URL>> = {
  strap: new URL("../firmware/mapData/data/StrapMaps.bin", import.meta.url),
  register: new URL("../firmware/mapData/data/RegisterMaps.bin", import.meta.url),
  configuration: new URL("../firmware/mapData/data/ConfigMaps.bin", import.meta.url),
  uep: new URL("../firmware/mapData/data/UEPMaps.bin", import.meta.url),
  gpio: new URL("../firmware/mapData/data/GPIOMaps.bin", import.meta.url),
  layout: new URL("../firmware/mapData/data/LayoutMaps.bin", import.meta.url),
};

/** Puts the app's own copy in place as where this worker's map files come from. */
export function installBundledMaps(): void {
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
