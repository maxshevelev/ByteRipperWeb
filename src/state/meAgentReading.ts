import { AgentToolError } from "@/core/agent/agentTool";
import { huffmanDictionariesWanted } from "@/firmware/me/engine/huffmanNeed";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { fileTableStore, loadFileTable } from "@/state/fileTableStore";
import { readyFirmware } from "@/state/firmwareReady";
import { fileNamesPaneMe, readPaneMe } from "@/state/firmwareStore";
import { huffmanDictionaryStore, loadHuffmanDictionaries } from "@/state/huffmanDictionaryStore";
import { loadMEDatabase, meDatabaseStore } from "@/state/meDatabaseStore";
import type { PaneId } from "@/state/paneId";
import type { Store } from "@/state/store";
import { ConfigRecordPaths } from "@/tools/configRecordPaths";
import { EFSFileNames } from "@/tools/efsFileNames";
import type { MeTexts } from "@/tools/meReads";
import { fileTableWanted, MFSFileNames, meFileNamesAsk } from "@/tools/mfsFileNames";

/**
 * The pane's ME analysis as an agent's query needs it: made now with whatever data files can be had
 * — the database, the Huffman dictionaries and the file table, each waited for once and each left
 * out when it cannot be had — and kept by the pane for the panels, as the panels' own readings are.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.analysis
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.present
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentFiles.swift#MEAAgentFiles.names
 * @upstream-differs the data files are the stores' and the analysis is the worker's, so each is waited for here
 */
export interface MeAgentReading {
  readonly analysis: FirmwareAnalysis;
  /** Where in the image the ME region begins. */
  readonly regionOffset: number;
  /** What `FileTable.dat` names, `none` where the dump needs no table or it could not be had. */
  readonly names: MFSFileNames;
  readonly efsNames: EFSFileNames;
  readonly configPaths: ConfigRecordPaths;
}

/** Waits until a data file's store has settled, one way or the other. */
function settled<T extends { readonly status: string }>(
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

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.analysis */
export async function meAgentReading(pane: PaneId): Promise<MeAgentReading> {
  await readyFirmware(pane);
  const database = (await settled(meDatabaseStore, () => loadMEDatabase())).text;
  let texts: MeTexts = { database, huffman: undefined, fileTable: undefined };
  const first = await readPaneMe(pane, texts, false, () => undefined);
  if (first === undefined) throw new AgentToolError("This document has no ME region to read.");
  if (first.response.analysis === undefined) {
    throw new AgentToolError(first.response.problem ?? "The ME region could not be analysed.");
  }
  let reading = first;
  // The dictionaries check the Huffman modules, which is most of an analysis: asked for only by an
  // image that has some, and the reading that follows has them.
  if (huffmanDictionariesWanted(first.response.analysis)) {
    const huffman = (await settled(huffmanDictionaryStore, () => loadHuffmanDictionaries())).text;
    if (huffman !== undefined) {
      texts = { ...texts, huffman };
      reading = (await readPaneMe(pane, texts, false, () => undefined)) ?? reading;
    }
  }
  const analysis = reading.response.analysis ?? first.response.analysis;
  let names: MFSFileNames = MFSFileNames.none;
  let efsNames: EFSFileNames = EFSFileNames.none;
  let configPaths: ConfigRecordPaths = ConfigRecordPaths.none;
  if (fileTableWanted(analysis)) {
    const fileTable = (await settled(fileTableStore, () => loadFileTable())).body?.text;
    const ask = meFileNamesAsk(analysis);
    if (fileTable !== undefined && ask !== undefined) {
      const found = await fileNamesPaneMe(pane, {
        mfs: ask.mfs,
        efs: ask.efs,
        configIDs: ask.configIDs,
        platform: analysis.mfsVolume?.ftblPlatform ?? -1,
        dictionary: analysis.mfsVolume?.ftblDictionary ?? -1,
        databaseText: texts.database,
        huffmanText: texts.huffman,
        fileTableText: fileTable,
      });
      names = found?.mfs ?? MFSFileNames.none;
      efsNames = found?.efs ?? EFSFileNames.none;
      configPaths = found?.config ?? ConfigRecordPaths.none;
    }
  }
  return { analysis, regionOffset: reading.response.regionOffset, names, efsNames, configPaths };
}
