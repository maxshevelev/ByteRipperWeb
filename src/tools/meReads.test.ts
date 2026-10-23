import { describe, expect, it } from "vitest";
import type { CodePartition } from "@/firmware/me/models/firmwareAnalysis";
import { analysisWith, efsVolumeFixture } from "@/tools/meaTesting";
import {
  type MeAsks,
  type MeData,
  type MeReading,
  type MeTexts,
  pendingOf,
  readMe,
  textsFor,
} from "@/tools/meReads";
import type { MeAnalyzeResponse } from "@/workers/protocol";

/** Ported from upstream's `MEReadsTests` — which database a reading is pending on. */

const huffmanPartition = (): CodePartition => ({
  name: "FTPR",
  offset: 0x1000,
  headerVersion: 2,
  headerLength: 0x14,
  numModules: 1,
  checksumValid: true,
  modules: [{ name: "pm", offset: 0x100, size: 0x100, isHuffman: true }],
  extensions: [],
});

const noneFailed = { fileTable: false, huffman: false };

describe("what a reading is pending on", () => {
  // @upstream Packages/MEReads/Tests/MEReadsTests/MEReadsTests.swift#MEReadsTests.testAFirstReadingIsPendingOnlyOnWhatItWanted
  it("is only what the analysis wanted and the reading did without", () => {
    const analysis = analysisWith({ codePartition: huffmanPartition() });
    const without = { usedFileTable: false, usedHuffman: false };
    expect(pendingOf(analysis, without, noneFailed)).toEqual({ fileTable: false, huffman: true });
    expect(pendingOf(analysis, { usedFileTable: false, usedHuffman: true }, noneFailed)).toEqual({
      fileTable: false,
      huffman: false,
    });
  });

  it("does not wait for a database that could not be downloaded", () => {
    const analysis = analysisWith({ efsVolume: efsVolumeFixture() });
    const without = { usedFileTable: false, usedHuffman: false };
    expect(pendingOf(analysis, without, noneFailed).fileTable).toBe(true);
    expect(pendingOf(analysis, without, { fileTable: true, huffman: false }).fileTable).toBe(false);
  });

  it("is nothing for no analysis", () => {
    expect(pendingOf(undefined, { usedFileTable: false, usedHuffman: false }, noneFailed)).toEqual({
      fileTable: false,
      huffman: false,
    });
  });
});

/** An ask that records what it was asked and answers with what the case hands it. */
function asks(answer: (texts: MeTexts) => MeAnalyzeResponse, held?: MeAnalyzeResponse) {
  const asked: MeTexts[] = [];
  const result: MeAsks = {
    ask: (texts) => {
      asked.push(texts);
      return Promise.resolve(answer(texts));
    },
    held: () => held,
  };
  return { asked, result };
}

const response = (analysis = analysisWith(), problem?: string): MeAnalyzeResponse => ({
  kind: "meAnalyze",
  id: 1 as MeAnalyzeResponse["id"],
  regionOffset: 0,
  analysis: problem === undefined ? analysis : undefined,
  problem,
});

const texts: MeTexts = { database: "db", huffman: "huffman", fileTable: undefined };

/** The files as `texts` has them, every one already landed; what was waited for is recorded. */
function dataOf(files: MeTexts, held: MeTexts = files) {
  const waited: string[] = [];
  const data: MeData = {
    prefetch: () => waited.push("prefetch"),
    held: () => held,
    database: async () => {
      waited.push("database");
      return files.database;
    },
    huffman: async () => {
      waited.push("huffman");
      return files.huffman;
    },
    fileTable: async () => {
      waited.push("fileTable");
      return files.fileTable;
    },
    failed: () => ({ fileTable: false, huffman: false }),
  };
  return { data, waited };
}

describe("reading the region", () => {
  // @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.read
  it("shows a first reading made without the dictionaries, then reads with them", async () => {
    const wanting = response(analysisWith({ codePartition: huffmanPartition() }));
    const { asked, result } = asks(() => wanting);
    const shown: MeReading[] = [];
    const last = await readMe(result, dataOf(texts).data, true, (first) => shown.push(first));
    expect(asked.map((one) => one.huffman)).toEqual([undefined, "huffman"]);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ usedHuffman: false });
    expect(last).toMatchObject({ usedHuffman: true });
  });

  it("is done with the first reading when nothing wants the dictionaries", async () => {
    const { asked, result } = asks(() => response());
    const shown: MeReading[] = [];
    const last = await readMe(result, dataOf(texts).data, true, (first) => shown.push(first));
    expect(asked).toHaveLength(1);
    expect(shown).toEqual([]);
    expect(last?.response.analysis).toBeDefined();
  });

  it("does not read again what failed the first time", async () => {
    const { asked, result } = asks(() => response(undefined, "The ME region could not be read."));
    const last = await readMe(result, dataOf(texts).data, true, () => {});
    expect(asked).toHaveLength(1);
    expect(last?.response.problem).toBe("The ME region could not be read.");
  });

  it("reads straight away with what it has when something is already on screen", async () => {
    const { asked, result } = asks(() =>
      response(analysisWith({ codePartition: huffmanPartition() }))
    );
    const shown: MeReading[] = [];
    await readMe(result, dataOf(texts).data, false, (first) => shown.push(first));
    expect(asked).toEqual([texts]);
    expect(shown).toEqual([]);
  });

  it("answers what the pane holds without reading anything", async () => {
    const held = response();
    const { asked, result } = asks(() => response(), held);
    const last = await readMe(result, dataOf(texts).data, true, () => {});
    expect(asked).toEqual([]);
    expect(last?.response).toBe(held);
  });

  it("has nothing to say when the pane has no image", async () => {
    const result: MeAsks = { ask: () => Promise.resolve(undefined), held: () => undefined };
    expect(await readMe(result, dataOf(texts).data, true, () => {})).toBeUndefined();
  });
});

describe("waiting for the data files", () => {
  // @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.firstReading
  it("makes the first reading once the database is in", async () => {
    const { asked, result } = asks(() => response());
    const { data, waited } = dataOf(texts, {
      database: undefined,
      huffman: undefined,
      fileTable: undefined,
    });
    await readMe(result, data, true, () => {});
    expect(waited).toEqual(["prefetch", "database"]);
    expect(asked).toEqual([{ database: "db", huffman: undefined, fileTable: undefined }]);
  });

  it("waits, for the reading in full, only for what the first one wanted", async () => {
    const wanting = response(analysisWith({ codePartition: huffmanPartition() }));
    const { asked, result } = asks(() => wanting);
    const { data, waited } = dataOf(
      { ...texts, fileTable: "table" },
      { database: "db", huffman: undefined, fileTable: undefined }
    );
    await readMe(result, data, true, () => {});
    expect(waited).toEqual(["prefetch", "database", "huffman"]);
    expect(asked.at(-1)).toEqual({ database: "db", huffman: "huffman", fileTable: undefined });
  });
});

describe("what tells two readings apart", () => {
  it("is the database, and a dictionary or the table only where the analysis reads with it", () => {
    const all = { database: "db", huffman: "huffman", fileTable: "table" };
    expect(textsFor(analysisWith(), all)).toEqual({
      database: "db",
      huffman: undefined,
      fileTable: undefined,
    });
    expect(textsFor(analysisWith({ codePartition: huffmanPartition() }), all).huffman).toBe(
      "huffman"
    );
    expect(textsFor(analysisWith({ efsVolume: efsVolumeFixture() }), all).fileTable).toBe("table");
  });
});
