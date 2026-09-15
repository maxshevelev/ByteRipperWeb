import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { remoteSource } from "@/platform/net/cachedSource";
import { type CatalogueSource, GUIDS_CSV_URL } from "@/state/guidCatalogueSource";
import { createStore } from "@/state/store";

/**
 * The GUID catalogue the tree names its nodes by.
 *
 * Fetched once per session and cached for a day (D10), and *visibly*: the state
 * below is what a panel shows while it is downloading, and the cancel is real.
 * A silent 350 KB download mid-analysis is the desktop's own reported bug.
 *
 * Until it lands the tree names a GUID node by its GUID, which is the honest
 * answer and not a placeholder — the hard-coded table already covers the GUIDs
 * worth knowing without a network.
 */

/**
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.freshness
 * @upstream-differs the fetch date and status in a store, not a Freshened value
 */
export interface CatalogueState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly catalogue: GuidsCatalogue;
  /** When the bytes were fetched, so the interface can say how old they are. */
  readonly fetchedAt: number | undefined;
  readonly problem: string | undefined;
}

/**
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSource.guidsChanges
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.guidsChanges
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.guidsSource
 * @upstream-differs a store subscription rather than an AsyncStream
 */
export const catalogueStore = createStore<CatalogueState>({
  status: "idle",
  catalogue: GuidsCatalogue.empty,
  fetchedAt: undefined,
  problem: undefined,
});

/**
 * The live source, behind the interface so a test can install its own.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository
 */
export const liveCatalogueSource: CatalogueSource = {
  async load(signal) {
    const body = await remoteSource(GUIDS_CSV_URL).body(signal === undefined ? {} : { signal });
    return { catalogue: GuidsCatalogue.parse(body.text), fetchedAt: body.fetchedAt };
  },
};

let controller: AbortController | undefined;

/**
 * Starts a download, unless one is already running or one has landed.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSource.guids
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.guids
 */
export function loadGuidCatalogue(source: CatalogueSource = liveCatalogueSource): void {
  const state = catalogueStore.getSnapshot();
  if (state.status === "loading" || state.status === "ready") return;
  controller = new AbortController();
  catalogueStore.update((current) => ({ ...current, status: "loading", problem: undefined }));

  void source
    .load(controller.signal)
    .then(({ catalogue, fetchedAt }) =>
      catalogueStore.update((current) => ({
        ...current,
        status: "ready",
        catalogue,
        fetchedAt,
        problem: undefined,
      }))
    )
    .catch((error: unknown) =>
      catalogueStore.update((current) => ({
        ...current,
        status: "failed",
        problem:
          error instanceof Error && error.name === "AbortError"
            ? undefined
            : "The GUID catalogue could not be downloaded. Nodes keep their GUIDs.",
      }))
    );
}

/** Stops a download somebody is waiting on. */
export function cancelGuidCatalogue(): void {
  controller?.abort();
  controller = undefined;
  catalogueStore.update((current) =>
    current.status === "loading" ? { ...current, status: "idle" } : current
  );
}
