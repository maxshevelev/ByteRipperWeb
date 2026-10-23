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

/**
 * The data files as a reading reaches them: each waited for when it is needed — which is what
 * asks for it — and what has landed so far.
 *
 * @web-only upstream's reading takes a data source that downloads every file side by side; here
 * the files are the stores', asked for lazily (GAPS §2.2)
 */
export interface MeData {
  /** The files every reading needs start downloading: the database. */
  readonly prefetch: () => void;
  /** What has landed so far. */
  readonly held: () => MeTexts;
  /** Each file once it has landed or failed: undefined for one that cannot be had. */
  readonly database: () => Promise<string | undefined>;
  readonly huffman: () => Promise<string | undefined>;
  readonly fileTable: () => Promise<string | undefined>;
  /** Which files could not be downloaded, so a reading does not stand waiting for them. */
  readonly failed: () => { readonly fileTable: boolean; readonly huffman: boolean };
}

/**
 * The texts an analysis is told apart by: the database always, and a dictionary or the file
 * table only when the analysis has something to read with it. A reading made without
 * `Huffman.dat` of an image with no Huffman module is the reading with it too, so a file that
 * lands later, or one the asker happens to hold, does not make it a different question.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.huffmanDictionariesWanted
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.fileTableWanted
 */
export function textsFor(analysis: FirmwareAnalysis | undefined, texts: MeTexts): MeTexts {
  return {
    database: texts.database,
    huffman:
      analysis !== undefined && huffmanDictionariesWanted(analysis) ? texts.huffman : undefined,
    fileTable: analysis !== undefined && fileTableWanted(analysis) ? texts.fileTable : undefined,
  };
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
 * The database starts downloading (`MeData.prefetch`). With `quick` — nothing is on
 * screen yet — a first reading follows as soon as the database is in, with the file table if it
 * is already held and without the dictionaries: when it went without nothing it wanted, it is
 * the reading; otherwise it goes to `shown`, and one reading follows with what it wanted, waited
 * for. Without `quick` the panel has an analysis up, which stays until the one asked for lands.
 * What the pane already holds is answered without reading anything.
 *
 * At most two readings, then, where reading again as each file landed made four — each a full
 * pass over the region, the dictionaries' most of all.
 *
 * Resolves with the reading to keep: the last one, or nothing when the pane has no image to read.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.read
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.firstReading
 */
export async function readMe(
  asks: MeAsks,
  data: MeData,
  quick: boolean,
  shown: (first: MeReading) => void
): Promise<MeReading | undefined> {
  data.prefetch();
  const wholeHeld = asks.held(data.held());
  if (wholeHeld !== undefined) return reading(wholeHeld, data.held());
  const database = await data.database();
  if (!quick) {
    // What a reading on screen already asked for is in hand; what it did not, it did not want.
    const held = data.held();
    const texts = { database, huffman: held.huffman, fileTable: held.fileTable };
    const answer = await asks.ask(texts);
    return answer === undefined ? undefined : reading(answer, texts);
  }
  const first: MeTexts = { database, huffman: undefined, fileTable: data.held().fileTable };
  const answer = await asks.ask(first);
  if (answer === undefined) return undefined;
  // The bytes or `MEA.dat` failed it, and the reading with the rest needs both: it would fail the
  // same way, after a second wait. And an image that has nothing more to read with is read in full.
  if (answer.analysis === undefined) return reading(answer, first);
  const missing = pendingOf(answer.analysis, reading(answer, first), data.failed());
  if (!missing.huffman && !missing.fileTable) return reading(answer, first);
  shown(reading(answer, first));
  const full: MeTexts = {
    database,
    huffman: missing.huffman ? await data.huffman() : undefined,
    fileTable: missing.fileTable ? await data.fileTable() : first.fileTable,
  };
  const whole = await asks.ask(full);
  return whole === undefined ? undefined : reading(whole, full);
}
