import { useEffect, useState } from "react";
import { fileTableStore, loadFileTable } from "@/state/fileTableStore";
import { huffmanDictionaryStore, loadHuffmanDictionaries } from "@/state/huffmanDictionaryStore";
import { loadMEDatabase, meDatabaseStore } from "@/state/meDatabaseStore";
import type { Store } from "@/state/store";
import type { MeData, MeTexts } from "@/tools/meReads";

/**
 * The three data files an ME reading may be made with — `MEA.dat`, `Huffman.dat` and
 * `FileTable.dat` — as the reading needs them: all of them asked for at once, side by side, when
 * a region is first read, and each waited for when the reading comes to need it.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEADownloads.swift#MEADownloads.prefetch
 * @upstream-differs the files are the stores', each fetched and freshened by its own rule
 */

/** Waits until a data file's store has settled, one way or the other. */
export function settled<T extends { readonly status: string }>(
  store: Store<T>,
  start: () => void
): Promise<T> {
  start();
  return new Promise((resolve) => {
    const done = () => {
      const state = store.getSnapshot();
      return state.status === "ready" || state.status === "failed";
    };
    if (done()) {
      resolve(store.getSnapshot());
      return;
    }
    const stop = store.subscribe(() => {
      if (!done()) return;
      stop();
      resolve(store.getSnapshot());
    });
  });
}

/** What the three files hold now: each undefined until it has landed. */
const heldTexts = (): MeTexts => ({
  database: meDatabaseStore.getSnapshot().text,
  huffman: huffmanDictionaryStore.getSnapshot().text,
  fileTable: fileTableStore.getSnapshot().body?.text,
});

/** The data files as the panels read them: fetched over the network, freshened as they go. */
export const liveMeData: MeData = {
  prefetch: () => {
    loadMEDatabase();
    loadHuffmanDictionaries();
    loadFileTable();
  },
  held: heldTexts,
  database: async () => (await settled(meDatabaseStore, loadMEDatabase)).text,
  huffman: async () => (await settled(huffmanDictionaryStore, loadHuffmanDictionaries)).text,
  fileTable: async () => (await settled(fileTableStore, loadFileTable)).body?.text,
  failed: () => ({
    huffman: huffmanDictionaryStore.getSnapshot().status === "failed",
    fileTable: fileTableStore.getSnapshot().status === "failed",
  }),
};

/** Exactly these texts and nothing else: a caller that has waited for the files itself. */
export const fixedMeData = (texts: MeTexts): MeData => ({
  prefetch: () => {},
  held: () => texts,
  database: async () => texts.database,
  huffman: async () => texts.huffman,
  fileTable: async () => texts.fileTable,
  failed: () => ({ huffman: false, fileTable: false }),
});

/**
 * How many times a data file that was already in hand has been replaced by another — a newer
 * download, or one that failed and has now come — which is when a reading made with the old one
 * is read again. A file's first landing is not counted: the reading that wanted it waited for it.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.runMEAnalysis
 * @upstream-differs a count a panel's reading depends on, where upstream re-reads ignoring the cache
 */
export function useMeDataReplaced(): number {
  const [replaced, setReplaced] = useState(0);
  useEffect(() => {
    const watch = <T extends { readonly status: string }>(
      store: Store<T>,
      text: (state: T) => string | undefined
    ) => {
      let last = store.getSnapshot();
      return store.subscribe(() => {
        const now = store.getSnapshot();
        const was = text(last);
        const is = text(now);
        const before = last;
        last = now;
        if (is === undefined || is === was) return;
        if (was !== undefined || before.status === "failed") setReplaced((count) => count + 1);
      });
    };
    const stops = [
      watch(meDatabaseStore, (state) => state.text),
      watch(huffmanDictionaryStore, (state) => state.text),
      watch(fileTableStore, (state) => state.body?.text),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, []);
  return replaced;
}
