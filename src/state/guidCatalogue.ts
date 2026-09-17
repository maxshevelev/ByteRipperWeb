import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { remoteSource } from "@/platform/net/cachedSource";
import { Freshened, type FreshenedStatus } from "@/platform/net/freshened";
import {
  type CatalogueSource,
  GUIDS_CSV_URL,
  type GuidsSourceError,
  guidsSourceErrorOf,
  guidsSourceMessage,
} from "@/state/guidCatalogueSource";
import { createStore } from "@/state/store";

/**
 * The GUID catalogue the tree names its nodes by.
 *
 * Fetched once per session and cached for a day (D10), and *visibly*: the state
 * below is what a panel shows while it is downloading, and the cancel is real.
 * A silent 350 KB download mid-analysis is the desktop's own reported bug.
 *
 * Re-checked once a day rather than fetched again: this host's `ETag` cannot be
 * read by a script, so the *browser* is asked to revalidate the copy it holds
 * with the validator it stored, and a catalogue that has not changed costs one
 * request and no bytes (`Freshened`, `src/platform/net/freshened.ts`, and the
 * measurement in `cachedSource.ts`). A
 * catalogue that has changed arrives behind the answer the tree is already
 * drawn with, and the tree is drawn again — a better name is worth showing the
 * moment it exists.
 *
 * Until it lands the tree names a GUID node by its GUID, which is the honest
 * answer and not a placeholder — the hard-coded table already covers the GUIDs
 * worth knowing without a network.
 */

/**
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.freshness
 */
export interface CatalogueState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly catalogue: GuidsCatalogue;
  /**
   * When the catalogue last changed, and when it was last confirmed current.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.freshness
   */
  readonly freshness: FreshenedStatus | undefined;
  /** Why the last attempt did not arrive, in a form the panel can act on. */
  readonly failure: GuidsSourceError | undefined;
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
  freshness: undefined,
  failure: undefined,
});

/**
 * `github.com/LongSoft/UEFITool`, branch `new_engine`, `common/guids.csv`.
 *
 * One request for the whole catalogue, and — because 680 KB of CSV is also a
 * parse — the parsed catalogue is held for the life of the session and
 * re-checked once a day (`Freshened`). Without that, every file a tree was
 * opened on paid for the same download again.
 *
 * The Cache API copy the last session left is taken up before the first ask, so
 * a bench with no network still opens on yesterday's catalogue, and its two
 * dates say how old it is.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository
 */
function liveCatalogue(): CatalogueSource {
  const held = new Freshened<GuidsCatalogue>();
  const remote = remoteSource(GUIDS_CSV_URL);

  let seeded: Promise<void> | undefined;
  const seed = (): Promise<void> => {
    seeded ??= (async () => {
      try {
        const stored = await remote.stored();
        if (stored === undefined) return;
        held.adopt(GuidsCatalogue.parse(stored.text), stored.validator, {
          changedAt: stored.changedAt,
          checkedAt: stored.checkedAt,
        });
      } catch {
        // A copy that cannot be read is not a reason to refuse this ask: the
        // request below is still to be made, and it replaces the copy.
      }
    })();
    return seeded;
  };

  return {
    async load(signal) {
      await seed();
      return held.value(async (validator) => {
        const answer = await remote.check(validator, signal === undefined ? {} : { signal });
        return answer.kind === "unchanged"
          ? { kind: "unchanged" }
          : {
              kind: "fresh",
              value: GuidsCatalogue.parse(answer.text),
              validator: answer.validator,
            };
      });
    },
    changes(listener) {
      return held.changes(listener);
    },
    freshness: () => held.status,
    markStale: () => held.markStale(),
  };
}

/** The live source, behind the interface so a test can install its own. */
export const liveCatalogueSource: CatalogueSource = liveCatalogue();

/**
 * What a failed fetch of the catalogue would say, if anything said it.
 *
 * Nothing in the tree does, and that is upstream's own decision rather than an
 * oversight: the hard-coded table the build ships is still there, so the tree's
 * names are not wrong, only older. "A download failure is not a problem worth
 * saying in red — the names are still there, just older" (`refreshGuids`), and
 * the catch under it says nothing at all. This is the error's own wording, kept
 * where the type is, for whatever says it next.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSourceError.errorDescription
 */
export function catalogueMessage(state: CatalogueState): string | undefined {
  return state.failure === undefined ? undefined : guidsSourceMessage(state.failure);
}

let controller: AbortController | undefined;
const watched = new Set<CatalogueSource>();

/**
 * Asks for the catalogue: the first ask waits on the network, and every ask
 * after it is answered from what is held — with the day's check running behind
 * the answer, which is what the wait was for.
 *
 * A failed attempt is startable again: a fetch that never reached github.com
 * remembers nothing (`Freshened`), so the next ask tries again rather than
 * replaying the error.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSource.guids
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.guids
 */
export function loadGuidCatalogue(source: CatalogueSource = liveCatalogueSource): void {
  const state = catalogueStore.getSnapshot();
  // One fetch at a time. A catalogue already in hand is a different case and
  // not an early return: that ask is what gets a day-old catalogue re-checked.
  if (state.status === "loading") return;

  // A background check is a reason to draw the tree again — the names that just
  // arrived — and it is watched once per source, as upstream watches once per
  // module.
  //
  // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.watchTheGuids
  if (!watched.has(source)) {
    watched.add(source);
    source.changes((catalogue) =>
      catalogueStore.update((current) => ({
        ...current,
        status: "ready",
        catalogue,
        freshness: source.freshness(),
        failure: undefined,
      }))
    );
  }

  // Nothing in hand, so this ask is a wait: a controller to cancel it with, and
  // the panel told to show it.
  const waiting = state.status !== "ready";
  if (waiting) {
    controller = new AbortController();
    catalogueStore.update((current) => ({ ...current, status: "loading", failure: undefined }));
  }
  const signal = waiting ? controller?.signal : undefined;

  void source.load(signal).then(
    (catalogue) =>
      catalogueStore.update((current) => ({
        ...current,
        status: "ready",
        catalogue,
        freshness: source.freshness(),
        failure: undefined,
      })),
    (error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        catalogueStore.update((current) =>
          current.status === "loading" ? { ...current, status: "idle" } : current
        );
        return;
      }
      catalogueStore.update((current) => ({
        ...current,
        status: "failed",
        failure: guidsSourceErrorOf(error) ?? {
          kind: "offline",
          underlying: error instanceof Error ? error.message : "the catalogue could not be read",
        },
      }));
    }
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

/**
 * Makes the next ask re-check, whatever the clock says.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.markStale
 */
export function markGuidCatalogueStale(source: CatalogueSource = liveCatalogueSource): void {
  source.markStale();
}
