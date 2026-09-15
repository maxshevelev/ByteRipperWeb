import {
  type RemoteFailure,
  remoteFailureMessage,
  remoteFailureOf,
  remoteSource,
} from "@/platform/net/cachedSource";
import { createStore } from "@/state/store";

/**
 * `Huffman.dat` — the dictionaries the ME analysis decompresses Huffman modules
 * with.
 *
 * Fetched the way `MEA.dat` is (D10: lazy, cached for a day, visible and
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
  load(signal?: AbortSignal): Promise<{ readonly text: string; readonly fetchedAt: number }>;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository */
export const liveHuffmanDictionarySource: HuffmanDictionarySource = {
  async load(signal) {
    const body = await remoteSource(HUFFMAN_DAT_URL).body(signal === undefined ? {} : { signal });
    return { text: body.text, fetchedAt: body.fetchedAt };
  },
};

/** Dictionaries over text already in hand — what a test installs. */
export const fixedHuffmanDictionarySource = (text: string): HuffmanDictionarySource => ({
  load: async () => ({ text, fetchedAt: Date.now() }),
});

export function huffmanDictionaryMessage(state: HuffmanDictionaryState): string | undefined {
  return state.failure === undefined ? undefined : remoteFailureMessage(state.failure);
}

let controller: AbortController | undefined;

/**
 * Starts a download, unless one is running or one has landed.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.huffmanDictionaries
 */
export function loadHuffmanDictionaries(
  source: HuffmanDictionarySource = liveHuffmanDictionarySource
): void {
  const state = huffmanDictionaryStore.getSnapshot();
  if (state.status === "loading" || state.status === "ready") return;
  controller = new AbortController();
  huffmanDictionaryStore.update((current) => ({
    ...current,
    status: "loading",
    failure: undefined,
  }));

  void source
    .load(controller.signal)
    .then(({ text, fetchedAt }) =>
      huffmanDictionaryStore.update((current) => ({
        ...current,
        status: "ready",
        text,
        fetchedAt,
        failure: undefined,
      }))
    )
    .catch((error: unknown) => {
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
    });
}

export function cancelHuffmanDictionaries(): void {
  controller?.abort();
  controller = undefined;
  huffmanDictionaryStore.update((current) =>
    current.status === "loading" ? { ...current, status: "idle" } : current
  );
}
