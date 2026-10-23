/// <reference lib="webworker" />

import { installCatalogue, L } from "@/core/localization/localization";
import { ImageReader } from "@/firmware/imageReader";
import { FileTable } from "@/firmware/me/data/fileTable";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import {
  type HuffmanDictionaries,
  parseHuffmanDictionaries,
} from "@/firmware/me/decompress/huffman";
import { analyzeMeRegion, checksums } from "@/firmware/me/engine/analyzer";
import { meRegion } from "@/firmware/me/layout/flashDescriptor";
import { ConfigRecordPaths } from "@/tools/configRecordPaths";
import { EFSFileNames } from "@/tools/efsFileNames";
import { MFSFileNames } from "@/tools/mfsFileNames";
import { BlobByteSource } from "@/workers/blobByteSource";
import type { MeWorkerRequest, MeWorkerResponse } from "@/workers/protocol";

/**
 * A pane's ME region read, digested and its files named — beside the worker that holds the UEFI
 * tree rather than in it, as upstream reads it off the main actor while the tree opens its
 * branches (`MEReads.analyze`, `Task.detached`).
 *
 * An analysis is a full pass over the region, a few hundred milliseconds with the Huffman
 * modules decompressed, and a worker answers one message at a time: in the tree's worker every
 * branch the reader opened meanwhile waited for it. Nothing here needs the tree — the region is
 * the descriptor's, read off the image's bytes — so this worker is handed the image and nothing
 * else, and builds no tree.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.analyze
 * @upstream-differs a worker of its own where upstream runs a detached task beside the tree
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: MeWorkerResponse) => scope.postMessage(message);

/** The image the pane shows, as its tree's worker reads it; nothing before the first ask. */
let reader: ImageReader | undefined;

/**
 * The bytes the ME analysis works over, and where they begin in the image.
 *
 * One region's bytes in memory, where the UEFI parser streams a whole image: the
 * analysis walks its structures in every direction and a region is megabytes,
 * not gigabytes. Which region is the descriptor's business, and a bare region is
 * its own. The checksums read the same bytes, so the digests describe the buffer
 * the analysis was made from.
 *
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.regionBytes
 * @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.regionBase
 */
function meRegionBytes():
  | { readonly bytes: Uint8Array; readonly regionOffset: number }
  | undefined {
  if (reader === undefined) return undefined;
  const whole = reader.bytes(reader.all);
  if (whole === undefined) return undefined;
  const found = meRegion(whole);
  return found === undefined
    ? { bytes: whole, regionOffset: 0 }
    : { bytes: whole.subarray(found.base, found.base + found.size), regionOffset: found.base };
}

/**
 * `Huffman.dat` as dictionaries. One that does not parse is no dictionaries: the
 * checks that need them are skipped, and the analysis is not failed for it.
 */
function parsedDictionaries(text: string): HuffmanDictionaries | undefined {
  try {
    return parseHuffmanDictionaries(text);
  } catch {
    return undefined;
  }
}

/**
 * The table, or nothing — a body that is not one is not a reason to fail an
 * analysis.
 *
 * Kept against the text it was parsed from, because the file is ~5 MB and an
 * image is analysed again on every edit: parsing it once per download rather
 * than once per analysis is the difference between a pause nobody notices and
 * one everybody does. The panel's side holds its own parse for the same reason
 * (`fileTableStore`), and a worker cannot be handed that one.
 */
let fileTableText: string | undefined;
let fileTableParsed: FileTable | undefined;
function parsedFileTable(text: string): FileTable | undefined {
  if (text === fileTableText) return fileTableParsed;
  fileTableText = text;
  try {
    fileTableParsed = FileTable.parse(text);
  } catch {
    fileTableParsed = undefined;
  }
  return fileTableParsed;
}

/** `MEA.dat` parsed, kept against its text as the table is: a reading and the one after it share it. */
let databaseText: string | undefined;
let databaseParsed: MEADatabase | undefined;
function parsedDatabase(text: string): MEADatabase {
  if (text !== databaseText || databaseParsed === undefined) {
    databaseText = text;
    databaseParsed = MEADatabase.parse(text);
  }
  return databaseParsed;
}

scope.onmessage = (event: MessageEvent<MeWorkerRequest>) => {
  const request = event.data;
  switch (request.kind) {
    // The words the problems are said in.
    case "speakLanguage":
      installCatalogue(request.catalogue);
      return;

    case "meOpen":
      reader = new ImageReader(new BlobByteSource(request.content));
      return;

    case "meChecksums": {
      const region = meRegionBytes();
      const readable = region !== undefined && region.bytes.length > 0;
      post({
        kind: "meChecksums",
        id: request.id,
        ...(readable
          ? checksums(region.bytes)
          : { sha256: undefined, sha384: undefined, crc32: undefined }),
      });
      return;
    }

    case "meAnalyze": {
      if (reader === undefined) {
        post({
          kind: "meAnalyze",
          id: request.id,
          regionOffset: 0,
          analysis: undefined,
          problem: L("No image is open."),
        });
        return;
      }
      const region = meRegionBytes();
      const regionOffset = region?.regionOffset ?? 0;
      const bytes = region?.bytes;
      if (bytes === undefined) {
        post({
          kind: "meAnalyze",
          id: request.id,
          regionOffset: 0,
          analysis: undefined,
          problem: L("That image could not be read."),
        });
        return;
      }
      const dictionaries =
        request.huffmanText === undefined ? undefined : parsedDictionaries(request.huffmanText);
      const table =
        request.fileTableText === undefined ? undefined : parsedFileTable(request.fileTableText);
      const database =
        request.databaseText === undefined ? undefined : parsedDatabase(request.databaseText);
      const analysis = analyzeMeRegion({
        bytes,
        baseOffset: regionOffset,
        ...(database === undefined ? {} : { database }),
        ...(dictionaries === undefined ? {} : { huffmanDictionaries: dictionaries }),
        ...(table === undefined ? {} : { fileTable: table }),
      });
      post({ kind: "meAnalyze", id: request.id, regionOffset, analysis, problem: undefined });
      return;
    }

    // The names an analysis cannot give itself, looked up in `FileTable.dat`
    // off the main thread, as upstream does (`MEReads.fileNames`): the table
    // is parsed here, where it is already parsed for the analysis, and the
    // panel never holds it.
    //
    // @upstream Packages/MEReads/Sources/MEReads/MEReads.swift#MEReads.fileNames
    case "meFileNames": {
      const table =
        request.fileTableText === undefined ? undefined : parsedFileTable(request.fileTableText);
      if (table === undefined || table.isEmpty) {
        post({
          kind: "meFileNames",
          id: request.id,
          mfs: undefined,
          efs: undefined,
          config: undefined,
        });
        return;
      }
      const mfs =
        request.mfs === undefined ? undefined : MFSFileNames.forVolume(table, request.mfs);
      const efs =
        request.efs === undefined
          ? undefined
          : EFSFileNames.forVolume({
              table,
              volume: request.efs,
              platform: request.platform,
              dictionary: request.dictionary,
            });
      const config =
        request.configIDs.length === 0
          ? undefined
          : ConfigRecordPaths.forFileIDs({
              table,
              fileIDs: request.configIDs,
              platform: request.platform,
              dictionary: request.dictionary,
            });
      post({ kind: "meFileNames", id: request.id, mfs, efs, config });
      return;
    }
  }
};
