import { MAP_DATA_VERSIONS } from "@/firmware/mapData/mapDataVersions";
import { MapDataError, MapFile } from "@/firmware/mapData/mapFile";

/**
 * Where a family's compiled map file comes from, and the one place it is read.
 *
 * Upstream reads each family out of its bundle once, synchronously, the first
 * time a reader asks (`static let loaded`). The web keeps that shape — every
 * reader of a descriptor or an ME image is synchronous — behind a source
 * installed where the maps are read (`src/platform/mapData/bundledMaps.ts`,
 * which reads the app's own copy in `data/`: a worker for its parsers, the page
 * for the presenters that name what they found) and a test installs too,
 * reading the same files from disk. The binaries are brought across by
 * `Skills/port-from-byteripper/scripts/sync_maps.py`.
 */

/** The six families, named as `MAP_DATA_VERSIONS` names them. */
export type MapFamily = keyof typeof MAP_DATA_VERSIONS;

/** A family's bytes, or `undefined` where the source has none. */
export type MapBytesSource = (family: MapFamily) => Uint8Array | undefined;

/** The file each family ships as, by upstream's name. */
export const MAP_FILE_NAMES: Readonly<Record<MapFamily, string>> = {
  strap: "StrapMaps.bin",
  register: "RegisterMaps.bin",
  configuration: "ConfigMaps.bin",
  uep: "UEPMaps.bin",
  gpio: "GPIOMaps.bin",
  layout: "LayoutMaps.bin",
};

/** Until the app's own copy is installed (`src/platform/mapData/bundledMaps.ts`), there is none. */
const none: MapBytesSource = () => undefined;

let source: MapBytesSource = none;
const loaded = new Map<MapFamily, MapFile | MapDataError>();
const decoded = new Map<MapFamily, unknown>();

/**
 * Puts `next` in place as where the families' bytes come from, and forgets
 * every file read so far: the worker at its start, a test before its suite.
 */
export function installMapSource(next: MapBytesSource): void {
  source = next;
  loaded.clear();
  decoded.clear();
}

/**
 * A family's map file, validated against the version the code was marked
 * with. Read once; a failure is kept as the answer too, as upstream keeps its
 * `Result`, so a missing or stale file is not asked for on every lookup.
 *
 * @throws MapDataError when the file is missing, stale or corrupt.
 */
export function mapFileOf(family: MapFamily): MapFile {
  let answer = loaded.get(family);
  if (answer === undefined) {
    answer = read(family);
    loaded.set(family, answer);
  }
  if (answer instanceof MapDataError) throw answer;
  return answer;
}

function read(family: MapFamily): MapFile | MapDataError {
  const bytes = source(family);
  if (bytes === undefined) {
    return new MapDataError({ kind: "resourceMissing", name: MAP_FILE_NAMES[family] });
  }
  const mark = MAP_DATA_VERSIONS[family];
  try {
    return new MapFile(bytes, mark.version, mark.formatVersion);
  } catch (error) {
    if (error instanceof MapDataError) return error;
    return new MapDataError({ kind: "corrupt", reason: String(error) });
  }
}

/**
 * A family's records as its reader decodes them, or why there are none. The
 * decode runs once per file, and a failure is kept as the answer too: upstream's
 * readers hold one `Result` each (`static let loaded`).
 */
export function decodedMapsOf<T>(
  family: MapFamily,
  decode: (file: MapFile) => T
): T | MapDataError {
  if (decoded.has(family)) return decoded.get(family) as T | MapDataError;
  let result: T | MapDataError;
  try {
    result = decode(mapFileOf(family));
  } catch (error) {
    result =
      error instanceof MapDataError
        ? error
        : new MapDataError({ kind: "corrupt", reason: String(error) });
  }
  decoded.set(family, result);
  return result;
}
