import {
  type RemoteFailure,
  RemoteFetchError,
  remoteFailureMessage,
  remoteFailureOf,
  remoteSource,
} from "@/platform/net/cachedSource";
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
 * Fetched once per session and cached for a day (D10), and *visibly*: the state
 * below is what the panel shows while it is downloading, and the cancel is
 * real. A silent download mid-analysis is the desktop's own reported bug.
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
  /** When the bytes were fetched, so the panel can say how old they are. */
  readonly fetchedAt: number | undefined;
  /** Why the last attempt did not arrive, in a form the panel can act on. */
  readonly failure: RemoteFailure | undefined;
}

export const microcodeCatalogueStore = createStore<MicrocodeCatalogueState>({
  status: "idle",
  entries: [],
  fetchedAt: undefined,
  failure: undefined,
});

/** What the panel prints for the state it is in. */
export function microcodeCatalogueMessage(state: MicrocodeCatalogueState): string | undefined {
  return state.failure === undefined ? undefined : remoteFailureMessage(state.failure);
}

/** The live source, behind the interface so a test installs its own. */
export const liveMicrocodeSource: MicrocodeSource = {
  async catalogue(signal) {
    const body = await remoteSource(MICROCODE_TREE_URL).body(
      signal === undefined ? {} : { signal }
    );
    return { entries: entriesFromTree(body.text), fetchedAt: body.fetchedAt };
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
};

let controller: AbortController | undefined;

/**
 * Starts a download, unless one is running or one has landed.
 *
 * A failed attempt is startable again: being rate-limited is temporary, and a
 * button the user is told to press in a few minutes has to work when they do.
 */
export function loadMicrocodeCatalogue(source: MicrocodeSource = liveMicrocodeSource): void {
  const state = microcodeCatalogueStore.getSnapshot();
  if (state.status === "loading" || state.status === "ready") return;
  controller = new AbortController();
  microcodeCatalogueStore.update((current) => ({
    ...current,
    status: "loading",
    failure: undefined,
  }));

  void source
    .catalogue(controller.signal)
    .then(({ entries, fetchedAt }) =>
      microcodeCatalogueStore.update((current) => ({
        ...current,
        status: "ready",
        entries,
        fetchedAt,
        failure: undefined,
      }))
    )
    .catch((error: unknown) => {
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
    });
}

/** Stops a download somebody is waiting on. */
export function cancelMicrocodeCatalogue(): void {
  controller?.abort();
  controller = undefined;
  microcodeCatalogueStore.update((current) =>
    current.status === "loading" ? { ...current, status: "idle" } : current
  );
}

/** Forgets what was fetched, so the next ask goes back to the network. */
export function forgetMicrocodeCatalogue(): void {
  controller?.abort();
  controller = undefined;
  microcodeCatalogueStore.update(() => ({
    status: "idle",
    entries: [],
    fetchedAt: undefined,
    failure: undefined,
  }));
}
