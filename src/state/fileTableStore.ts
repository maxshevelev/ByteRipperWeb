import { FileTable } from "@/firmware/me/data/fileTable";
import {
  type RemoteFailure,
  remoteFailureMessage,
  remoteFailureOf,
  remoteSource,
} from "@/platform/net/cachedSource";
import { createStore } from "@/state/store";

/**
 * `FileTable.dat` — what names an FTBL-mode MFS volume's low-level files.
 *
 * Fetched the way `MEA.dat` and `Huffman.dat` are (D10: lazy, cached for a day,
 * visible and cancellable), but only when a volume actually asks for a name,
 * which is an FTBL-mode MFS and nothing else. The file is the largest of the
 * three (~5 MB), so a dump that has no such volume never pays for it.
 *
 * The table is parsed where it lands rather than in a worker: the names are put
 * on the rows in the panel, so a parsed table is what the panel needs, and it
 * is parsed once per fetch.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.fileTable
 */

export interface FileTableState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /**
   * The file's text, which the worker parses for itself: the split that needs
   * the table happens where the volume's bytes are, and a parsed table cannot
   * cross to a worker.
   */
  readonly text: string | undefined;
  /** The same file, parsed once here, because the names are put on in the panel. */
  readonly table: FileTable | undefined;
  readonly fetchedAt: number | undefined;
  readonly failure: RemoteFailure | undefined;
}

export const fileTableStore = createStore<FileTableState>({
  status: "idle",
  text: undefined,
  table: undefined,
  fetchedAt: undefined,
  failure: undefined,
});

/** `FileTable.dat` from ME Analyzer, which is the living version of this table. */
export const FILE_TABLE_DAT_URL =
  "https://raw.githubusercontent.com/platomav/MEAnalyzer/master/FileTable.dat";

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource.fileTable */
export interface FileTableSource {
  load(signal?: AbortSignal): Promise<{ readonly text: string; readonly fetchedAt: number }>;
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository */
export const liveFileTableSource: FileTableSource = {
  async load(signal) {
    const body = await remoteSource(FILE_TABLE_DAT_URL).body(
      signal === undefined ? {} : { signal }
    );
    return { text: body.text, fetchedAt: body.fetchedAt };
  },
};

/** A table over text already in hand — what a test installs. */
export const fixedFileTableSource = (text: string): FileTableSource => ({
  load: async () => ({ text, fetchedAt: Date.now() }),
});

export function fileTableMessage(state: FileTableState): string | undefined {
  return state.failure === undefined ? undefined : remoteFailureMessage(state.failure);
}

let controller: AbortController | undefined;

/**
 * Starts a download, unless one is running or one has landed.
 *
 * Silent on failure, as upstream is: offline, rate-limited, or a table that
 * does not describe this volume all leave the rows reading `File 63`, which is
 * what the flash says about them. A panel that complained here would be
 * reporting on an errand of its own, and the file inventory is complete without
 * it.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.loadFileNames
 */
export function loadFileTable(source: FileTableSource = liveFileTableSource): void {
  const state = fileTableStore.getSnapshot();
  if (state.status === "loading" || state.status === "ready") return;
  controller = new AbortController();
  fileTableStore.update((current) => ({ ...current, status: "loading", failure: undefined }));

  void source
    .load(controller.signal)
    .then(({ text, fetchedAt }) => {
      const table = FileTable.parse(text);
      fileTableStore.update((current) => ({
        ...current,
        status: "ready",
        text,
        table,
        fetchedAt,
        failure: undefined,
      }));
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        fileTableStore.update((current) => ({ ...current, status: "idle" }));
        return;
      }
      fileTableStore.update((current) => ({
        ...current,
        status: "failed",
        failure: remoteFailureOf(error) ?? {
          kind: "offline",
          detail: error instanceof Error ? error.message : "the file table could not be read",
        },
      }));
    })
    .finally(() => {
      controller = undefined;
    });
}

export function cancelFileTable(): void {
  controller?.abort();
  controller = undefined;
}
