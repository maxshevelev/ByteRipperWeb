import { L } from "@/core/localization/localization";
import {
  type RemoteFailure,
  remoteFailureMessage,
  remoteFailureOf,
} from "@/platform/net/cachedSource";
import type { FreshenedStatus } from "@/platform/net/freshened";
import { freshRemote } from "@/platform/net/freshRemote";
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
export function liveDictionaries(
  url = HUFFMAN_DAT_URL
): HuffmanDictionarySource & { settle(): Promise<void> } {
  const remote = freshRemote(url, (text) => text);
  return {
    load: (signal) => remote.value(signal),
    changes: remote.changes,
    freshness: remote.freshness,
    markStale: remote.markStale,
    settle: remote.settle,
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
          detail: error instanceof Error ? error.message : L("the dictionaries could not be read"),
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
