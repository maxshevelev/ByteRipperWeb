import {
  type RemoteFailure,
  remoteFailureMessage,
  remoteFailureOf,
  remoteSource,
} from "@/platform/net/cachedSource";
import { Freshened, type FreshenedStatus } from "@/platform/net/freshened";
import { createStore } from "@/state/store";

/**
 * `Huffman.dat` — the dictionaries the ME analysis decompresses Huffman modules
 * with.
 *
 * Fetched the way `MEA.dat` is (D10: lazy, re-checked daily, visible and
 * cancellable), but only for an image that has a Huffman module to read: the
 * families whose modules are LZMA or uncompressed never ask, as upstream never
 * fetches it for them. An analysis without it skips the checks that need it
 * rather than failing them.
 */

export interface HuffmanDictionaryState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** The file's text, which the worker parses. */
  readonly text: string | undefined;
  readonly fetchedAt: number | undefined;
  readonly failure: RemoteFailure | undefined;
}

export const huffmanDictionaryStore = createStore<HuffmanDictionaryState>({
  status: "idle",
  text: undefined,
  fetchedAt: undefined,
  failure: undefined,
});

export const HUFFMAN_DAT_URL =
  "https://raw.githubusercontent.com/platomav/MEAnalyzer/master/Huffman.dat";

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource */
export interface HuffmanDictionarySource {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource.huffmanDictionaries */
  load(signal?: AbortSignal): Promise<string>;

  /**
   * Emits when a background check has replaced the dictionaries with newer
   * ones, so a reading made with the old ones can be made again.
   *
   * @web-only upstream announces a newer `MEA.dat` and nothing announces a
   * newer `Huffman.dat`: its decoder is handed the dictionaries inside the
   * analysis, and an analysis that has finished is never revisited. The web's
   * panel reads them out of a store, so a dictionary that has since changed
   * would leave an identity — and a decompression — standing against a file
   * that no longer exists, and the same subscription the database has settles
   * it.
   */
  changes(listener: (text: string) => void): () => void;

  /**
   * When the dictionaries last changed, or `undefined` if nothing has been
   * fetched.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.freshness
   * @upstream-differs the status is reached through the source, the store
   * holding only the interface
   */
  freshness(): FreshenedStatus | undefined;

  /**
   * Makes the next ask re-check, whatever the clock says.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.markStale
   * @upstream-differs on the interface, as `freshness` is
   */
  markStale(): void;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository */
function liveDictionaries(): HuffmanDictionarySource {
  const held = new Freshened<string>();
  const remote = remoteSource(HUFFMAN_DAT_URL);

  let seeded: Promise<void> | undefined;
  const seed = (): Promise<void> => {
    seeded ??= (async () => {
      try {
        const stored = await remote.stored();
        if (stored === undefined) return;
        held.adopt(stored.text, stored.validator, {
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
          : { kind: "fresh", value: answer.text, validator: answer.validator };
      });
    },
    changes(listener) {
      return held.changes(listener);
    },
    freshness: () => held.status,
    markStale: () => held.markStale(),
  };
}

export const liveHuffmanDictionarySource: HuffmanDictionarySource = liveDictionaries();

/** Dictionaries over text already in hand — what a test installs. */
export const fixedHuffmanDictionarySource = (text: string): HuffmanDictionarySource => {
  const at = Date.now();
  return {
    load: async () => text,
    changes: () => () => undefined,
    freshness: () => ({ changedAt: at, checkedAt: at }),
    markStale: () => undefined,
  };
};

export function huffmanDictionaryMessage(state: HuffmanDictionaryState): string | undefined {
  return state.failure === undefined ? undefined : remoteFailureMessage(state.failure);
}

let controller: AbortController | undefined;
const watched = new Set<HuffmanDictionarySource>();

/**
 * Starts a download, unless one is already running or one has landed.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.huffmanDictionaries
 */
export function loadHuffmanDictionaries(
  source: HuffmanDictionarySource = liveHuffmanDictionarySource
): void {
  const state = huffmanDictionaryStore.getSnapshot();
  if (state.status === "loading") return;

  if (!watched.has(source)) {
    watched.add(source);
    source.changes((text) =>
      huffmanDictionaryStore.update((current) => ({
        ...current,
        status: "ready",
        text,
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
    huffmanDictionaryStore.update((current) => ({
      ...current,
      status: "loading",
      failure: undefined,
    }));
  }
  const signal = waiting ? controller?.signal : undefined;

  void source.load(signal).then(
    (text) =>
      huffmanDictionaryStore.update((current) => ({
        ...current,
        status: "ready",
        text,
        fetchedAt: source.freshness()?.changedAt,
        failure: undefined,
      })),
    (error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        huffmanDictionaryStore.update((current) =>
          current.status === "loading" ? { ...current, status: "idle" } : current
        );
        return;
      }
      huffmanDictionaryStore.update((current) => ({
        ...current,
        status: "failed",
        failure: remoteFailureOf(error) ?? {
          kind: "offline",
          detail: error instanceof Error ? error.message : "the dictionaries could not be read",
        },
      }));
    }
  );
}

export function cancelHuffmanDictionaries(): void {
  controller?.abort();
  controller = undefined;
  huffmanDictionaryStore.update((current) =>
    current.status === "loading" ? { ...current, status: "idle" } : current
  );
}

/**
 * Makes the next ask re-check, whatever the clock says.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.markStale
 * @upstream-differs one function per file, as `markMEDatabaseStale` is: the
 * same upstream call marks both, and here each store marks what it holds
 */
export function markHuffmanDictionariesStale(
  source: HuffmanDictionarySource = liveHuffmanDictionarySource
): void {
  source.markStale();
}
