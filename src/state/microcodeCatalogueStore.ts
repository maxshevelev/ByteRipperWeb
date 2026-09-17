import {
  type RemoteFailure,
  RemoteFetchError,
  remoteFailureMessage,
  remoteFailureOf,
  remoteSource,
} from "@/platform/net/cachedSource";
import { Freshened } from "@/platform/net/freshened";
import {
  MICROCODE_DOWNLOAD_BASE,
  MICROCODE_TREE_URL,
  type MicrocodeSource,
} from "@/state/microcodeCatalogueSource";
import { createStore } from "@/state/store";
import { entriesFromTree, type MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";

/**
 * The microcode catalogue the FIT panel rates its rows against.
 *
 * Fetched once per session and re-checked once a day, and *visibly*: the state
 * below is what the panel shows while it is downloading, and the cancel is
 * real. A silent download mid-analysis is the desktop's own reported bug.
 *
 * Re-checked rather than fetched again: the `ETag` the server sent with the
 * listing is presented back, so a listing that has not changed costs one
 * request and no bytes (`Freshened`, `src/platform/net/freshened.ts`) — and on
 * `api.github.com` a `304` is also not counted against the rate limit, which is
 * the smaller reason upstream asks that way.
 *
 * That last sentence is upstream's (`MicrocodeSource`'s own doc), and the one
 * place in this port that measurement contradicts: three conditional requests
 * in a row each moved `x-ratelimit-remaining` down by one, so a `304` costs the
 * same as a body today. It is worth knowing, because the anonymous limit is 60
 * an hour per address and a re-check of the listing spends it either way — what
 * the conditional request saves is the 53 KB, not the request.
 *
 * Why the failure is a value and not a string: being rate-limited, being
 * offline and being answered 404 are three different problems with three
 * different answers, and a panel that printed one message for all of them would
 * be telling a bench to keep pressing a button that cannot work. Anonymous
 * requests to `api.github.com` are limited *by address*, so a bench behind one
 * office NAT reaches the limit without ever having asked for anything itself —
 * which is why that state has to be named rather than read as "it is broken".
 */

export interface MicrocodeCatalogueState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly entries: readonly MicrocodeCatalogueEntry[];
  /**
   * When the listing last changed, so the panel can say how old it is — the
   * date the bytes changed, not the date of the last check behind them.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.freshness
   */
  readonly fetchedAt: number | undefined;
  /** Why the last attempt did not arrive, in a form the panel can act on. */
  readonly failure: RemoteFailure | undefined;
}

/**
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSource.catalogueChanges
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.catalogueChanges
 * @upstream-differs a store subscription rather than an AsyncStream
 */
export const microcodeCatalogueStore = createStore<MicrocodeCatalogueState>({
  status: "idle",
  entries: [],
  fetchedAt: undefined,
  failure: undefined,
});

/**
 * What the panel prints for the state it is in.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSourceError
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSourceError.errorDescription
 */
export function microcodeCatalogueMessage(state: MicrocodeCatalogueState): string | undefined {
  return state.failure === undefined ? undefined : remoteFailureMessage(state.failure);
}

/**
 * The live source, behind the interface so a test installs its own.
 *
 * The Cache API copy the last session left is taken up before the first ask, so
 * a bench with no network still rates a FIT table against yesterday's listing:
 * the file names it holds do not change once written, which is what upstream's
 * on-disk cache answers the same first open with.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.microcodeSource
 */
function liveMicrocodes(): MicrocodeSource {
  const held = new Freshened<readonly MicrocodeCatalogueEntry[]>();
  const remote = remoteSource(MICROCODE_TREE_URL);

  let seeded: Promise<void> | undefined;
  const seed = (): Promise<void> =>
    (seeded ??= (async () => {
      try {
        const stored = await remote.stored();
        if (stored === undefined) return;
        held.adopt(entriesFromTree(stored.text), stored.validator, {
          changedAt: stored.changedAt,
          checkedAt: stored.checkedAt,
        });
      } catch {
        // A copy that cannot be read is not a reason to refuse this ask: the
        // request below is still to be made, and it replaces the copy.
      }
    })());

  return {
    async catalogue(signal) {
      await seed();
      return held.value(async (validator) => {
        const answer = await remote.check(validator, signal === undefined ? {} : { signal });
        return answer.kind === "unchanged"
          ? { kind: "unchanged" }
          : { kind: "fresh", value: entriesFromTree(answer.text), validator: answer.validator };
      });
    },
    async download(entry, signal) {
      // A microcode file never changes once written, so this asks
      // unconditionally and lets the browser's own HTTP cache help if it can.
      const response = await fetch(MICROCODE_DOWNLOAD_BASE + entry.path, {
        ...(signal === undefined ? {} : { signal }),
      });
      if (response.status === 403 || response.status === 429) {
        throw new RemoteFetchError({ kind: "rateLimited" });
      }
      if (!response.ok) {
        throw new RemoteFetchError({ kind: "badResponse", status: response.status });
      }
      return new Uint8Array(await response.arrayBuffer());
    },
    changes(listener) {
      return held.changes(listener);
    },
    freshness: () => held.status,
    markStale: () => held.markStale(),
  };
}

export const liveMicrocodeSource: MicrocodeSource = liveMicrocodes();

let controller: AbortController | undefined;
const watched = new Set<MicrocodeSource>();

/**
 * Asks for the listing: the first ask waits on the network, and every ask after
 * it is answered from what is held — with the day's check running behind the
 * answer, which is what the wait was for.
 *
 * A failed attempt is startable again: a fetch that never reached github.com
 * remembers nothing (`Freshened`), so the next ask tries again rather than
 * replaying the error. That matters most for the rate limit, which is
 * temporary and is waited out.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSource.catalogue
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.catalogue
 */
export function loadMicrocodeCatalogue(source: MicrocodeSource = liveMicrocodeSource): void {
  const state = microcodeCatalogueStore.getSnapshot();
  // One fetch at a time. A listing already in hand is a different case and not
  // an early return: that ask is what gets a day-old listing re-checked.
  if (state.status === "loading") return;

  // A background check is a reason to settle the table's "latest" verdicts
  // again — against what actually exists now — and it is watched once per
  // source, as upstream watches once per module.
  //
  // @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.watchTheCatalogue
  if (!watched.has(source)) {
    watched.add(source);
    source.changes((entries) =>
      microcodeCatalogueStore.update((current) => ({
        ...current,
        status: "ready",
        entries,
        fetchedAt: source.freshness()?.changedAt,
        failure: undefined,
      }))
    );
  }

  // Nothing in hand, so this ask is a wait: a controller to cancel it with, and
  // the panel told to show it.
  const waiting = state.status !== "ready";
  if (waiting) {
    controller = new AbortController();
    microcodeCatalogueStore.update((current) => ({
      ...current,
      status: "loading",
      failure: undefined,
    }));
  }
  const signal = waiting ? controller?.signal : undefined;

  void source.catalogue(signal).then(
    (entries) =>
      microcodeCatalogueStore.update((current) => ({
        ...current,
        status: "ready",
        entries,
        fetchedAt: source.freshness()?.changedAt,
        failure: undefined,
      })),
    (error: unknown) => {
      // A cancel is the user's own doing: the state goes back to idle rather
      // than reporting a failure they caused on purpose.
      if (error instanceof Error && error.name === "AbortError") {
        microcodeCatalogueStore.update((current) =>
          current.status === "loading" ? { ...current, status: "idle" } : current
        );
        return;
      }
      microcodeCatalogueStore.update((current) => ({
        ...current,
        status: "failed",
        // By shape, not by `instanceof`: that is a question about which copy of
        // the module built the error, and getting it wrong turns "rate-limited"
        // — temporary, and waited out — into "offline", which is not.
        failure: remoteFailureOf(error) ?? {
          kind: "offline",
          detail: error instanceof Error ? error.message : "the listing could not be read",
        },
      }));
    }
  );
}

/** Stops a download somebody is waiting on. */
export function cancelMicrocodeCatalogue(): void {
  controller?.abort();
  controller = undefined;
  microcodeCatalogueStore.update((current) =>
    current.status === "loading" ? { ...current, status: "idle" } : current
  );
}

/**
 * Makes the next ask re-check, whatever the clock says.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.markStale
 */
export function markMicrocodeCatalogueStale(source: MicrocodeSource = liveMicrocodeSource): void {
  source.markStale();
}

/**
 * One microcode's bytes, from the collection the list came from — fetched only
 * once one is picked, so the form costs a single request for the listing and
 * one for the file.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSource.download
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.download
 */
export function downloadMicrocode(
  entry: MicrocodeCatalogueEntry,
  signal?: AbortSignal,
  source: MicrocodeSource = liveMicrocodeSource
): Promise<Uint8Array<ArrayBuffer>> {
  return source.download(entry, signal);
}

/**
 * What a failed download says, in the words the listing's own failures use —
 * a fetch that never reached github.com is being offline, whatever the browser
 * called it.
 */
export function microcodeDownloadMessage(error: unknown): string {
  return remoteFailureMessage(
    remoteFailureOf(error) ?? {
      kind: "offline",
      detail: error instanceof Error ? error.message : "that microcode could not be fetched",
    }
  );
}
