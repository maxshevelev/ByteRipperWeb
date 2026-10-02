import { huffmanDictionariesWanted } from "@/firmware/me/engine/huffmanNeed";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { type MEAPending, NOTHING_PENDING } from "@/tools/mePending";
import { fileTableWanted } from "@/tools/mfsFileNames";
import type { MeAnalyzeResponse } from "@/workers/protocol";

/**
 * The reading both ME panels make of the ME region, in one place: the ME Analyzer
 * and the UEFI Structure's ME sub-tree.
 *
 * A reading with `Huffman.dat` decompresses every Huffman module to check it, which
 * is most of an analysis, so a panel that waited for it showed nothing for seconds on
 * every dump but the first of a run — the dictionaries were in hand by then, and the
 * first reading took them. The first reading is therefore made without them, shown at
 * once with what depends on them saying so (`MEAPending`), and the reading that
 * follows has them.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.read
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.firstReading
 * @upstream-differs the data files are the texts the store holds, so what a reading is
 * "pending on" is a question of which texts it was asked with, not of what the engine
 * asked for and did without
 */

/** The data files a reading may be made with — each undefined until it has landed. */
export interface MeTexts {
  readonly database: string | undefined;
  readonly huffman: string | undefined;
  readonly fileTable: string | undefined;
}

/** An analysis, and which databases it was read with. */
export interface MeReading {
  readonly response: MeAnalyzeResponse;
  readonly usedFileTable: boolean;
  readonly usedHuffman: boolean;
}

/** What a reading needs of the pane: the pane's own answers, kept by what they were read against. */
export interface MeAsks {
  /** The analysis of these texts, read or already held. */
  readonly ask: (texts: MeTexts) => Promise<MeAnalyzeResponse | undefined>;
  /** The analysis of these texts when the pane already holds it, and nothing otherwise. */
  readonly held: (texts: MeTexts) => MeAnalyzeResponse | undefined;
}

const reading = (response: MeAnalyzeResponse, texts: MeTexts): MeReading => ({
  response,
  usedFileTable: texts.fileTable !== undefined,
  usedHuffman: texts.huffman !== undefined,
});

/**
 * What a reading has not been read with yet, and the values that depend on it.
 *
 * `failed` is a database that could not be downloaded: it is not waited for, and the
 * values shown stand.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEAFirstReading.pending
 */
export function pendingOf(
  analysis: FirmwareAnalysis | undefined,
  read: Pick<MeReading, "usedFileTable" | "usedHuffman">,
  failed: { readonly fileTable: boolean; readonly huffman: boolean }
): MEAPending {
  if (analysis === undefined) return NOTHING_PENDING;
  return {
    fileTable: fileTableWanted(analysis) && !read.usedFileTable && !failed.fileTable,
    huffman: huffmanDictionariesWanted(analysis) && !read.usedHuffman && !failed.huffman,
  };
}

/**
 * Reads the region.
 *
 * With `quick` — nothing is on screen yet — a reading that is not already held is
 * made first without `Huffman.dat` and handed to `shown` when an analysis wants it, and
 * the one with it follows. Without `quick` the panel has an analysis up, which stays
 * until the one asked for lands. What the pane already holds is answered without
 * reading anything.
 *
 * Resolves with the reading to keep: the last one, or nothing when the pane has no
 * image to read.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.read
 */
export async function readMe(
  asks: MeAsks,
  texts: MeTexts,
  quick: boolean,
  shown: (first: MeReading) => void
): Promise<MeReading | undefined> {
  const wholeHeld = asks.held(texts);
  if (wholeHeld !== undefined) return reading(wholeHeld, texts);
  if (quick && texts.huffman !== undefined) {
    const first = { ...texts, huffman: undefined };
    const answer = await asks.ask(first);
    if (answer === undefined) return undefined;
    // The bytes or `MEA.dat` failed it, and the reading with the dictionaries needs both:
    // it would fail the same way, after a second wait. And an image that has nothing to
    // check with them is read in full already.
    if (answer.analysis === undefined || !huffmanDictionariesWanted(answer.analysis)) {
      return reading(answer, first);
    }
    shown(reading(answer, first));
  }
  const answer = await asks.ask(texts);
  return answer === undefined ? undefined : reading(answer, texts);
}
