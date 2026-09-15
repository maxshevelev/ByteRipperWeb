import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";

/**
 * Where the GUID catalogue comes from.
 *
 * An interface rather than a URL, because a test installs its own — a test that
 * reaches the network is a test that fails on a train. It lives here rather
 * than beside the parser because it names a browser type: `src/firmware` is
 * compiled without the DOM, and the parser only ever consumes a finished
 * catalogue.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSource
 */
export interface CatalogueSource {
  /** The catalogue, and when its bytes were fetched. */
  load(signal?: AbortSignal): Promise<{ catalogue: GuidsCatalogue; fetchedAt: number }>;
}

/**
 * `common/guids.csv` from UEFITool, which is the living version of the
 * hard-coded table this parser carries.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.guidsURL
 */
export const GUIDS_CSV_URL =
  "https://raw.githubusercontent.com/LongSoft/UEFITool/new_engine/common/guids.csv";

/** A catalogue over text already in hand — what a test installs. */
export function fixedCatalogue(text: string): CatalogueSource {
  return { load: async () => ({ catalogue: GuidsCatalogue.parse(text), fetchedAt: Date.now() }) };
}
