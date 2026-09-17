import { FileTable } from "@/firmware/me/data/fileTable";
import { type RemoteFailure, remoteFailureOf, remoteSource } from "@/platform/net/cachedSource";
import { Freshened, type FreshenedStatus } from "@/platform/net/freshened";
import { createStore } from "@/state/store";

/**
 * `FileTable.dat` — the table that names an FTBL-mode MFS volume's low-level
 * files and cuts an EFS volume's data area into files.
 *
 * Fetched the way `MEA.dat` and `Huffman.dat` are (D10: lazy, re-checked daily,
 * visible and cancellable), but later than either: this one is asked for *after*
 * an analysis, by a panel that has just found a volume which cannot name its own
 * files. At ~5 MB it is the largest of the three, and a dump without such a
 * volume never pays for it.
 *
 * Unlike the other two, what is held is both halves of the body: the text, which
 * is what crosses to the worker (the split the table's Integrity flags unlock is
 * byte work, and the bytes are there), and the parsed table, which is what the
 * panel reads (upstream hands its tool a parsed `FileTable` for the same
 * reason). One parse of ~5 MB on this side, one in the worker, and neither
 * side parses what the other already has.
 */

/** The table as it arrives: the text the worker parses, and the value the panel reads. */
export interface FileTableBody {
  readonly text: string;
  readonly table: FileTable;
}

export interface FileTableState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** The body as fetched, or `undefined` before anything arrived. */
  readonly body: FileTableBody | undefined;
  readonly fetchedAt: number | undefined;
  readonly failure: RemoteFailure | undefined;
}

export const fileTableStore = createStore<FileTableState>({
  status: "idle",
  body: undefined,
  fetchedAt: undefined,
  failure: undefined,
});

/**
 * The parsed table, or the empty one — which names nothing and says so. What a
 * caller reads when it wants names and does not care whether there are any.
 */
export function fileTableOf(state: FileTableState): FileTable {
  return state.body?.table ?? FileTable.empty;
}

export const FILE_TABLE_DAT_URL =
  "https://raw.githubusercontent.com/platomav/MEAnalyzer/master/FileTable.dat";

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource */
export interface FileTableSource {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource.fileTable */
  load(signal?: AbortSignal): Promise<FileTableBody>;

  /**
   * Emits when a background check has replaced the table with a newer one, so
   * the rows can be named again.
   *
   * @web-only upstream announces a newer `MEA.dat` and nothing announces a
   * newer `FileTable.dat`: its tools read the table through the repository, and
   * an analysis that has finished is never revisited. The web's panel builds its
   * rows out of a store, so a table that has since changed would leave names
   * standing against records that no longer exist, and the same subscription the
   * database has settles it.
   */
  changes(listener: (body: FileTableBody) => void): () => void;

  /**
   * When the table last changed, or `undefined` if nothing has been fetched.
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
function liveFileTable(): FileTableSource {
  const held = new Freshened<FileTableBody>();
  const remote = remoteSource(FILE_TABLE_DAT_URL);

  let seeded: Promise<void> | undefined;
  const seed = (): Promise<void> => {
    seeded ??= (async () => {
      try {
        const stored = await remote.stored();
        if (stored === undefined) return;
        held.adopt({ text: stored.text, table: FileTable.parse(stored.text) }, stored.validator, {
          changedAt: stored.changedAt,
          checkedAt: stored.checkedAt,
        });
      } catch {
        // A copy that cannot be read — or that is no longer a table — is not a
        // reason to refuse this ask: the request below is still to be made, and
        // it replaces the copy.
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
          : {
              kind: "fresh",
              value: { text: answer.text, table: FileTable.parse(answer.text) },
              validator: answer.validator,
            };
      });
    },
    changes(listener) {
      return held.changes(listener);
    },
    freshness: () => held.status,
    markStale: () => held.markStale(),
  };
}

export const liveFileTableSource: FileTableSource = liveFileTable();

/** A table over text already in hand — what a test installs. */
export const fixedFileTableSource = (text: string): FileTableSource => {
  const at = Date.now();
  const body = { text, table: FileTable.parse(text) };
  return {
    load: async () => body,
    changes: () => () => undefined,
    freshness: () => ({ changedAt: at, checkedAt: at }),
    markStale: () => undefined,
  };
};

let controller: AbortController | undefined;
const watched = new Set<FileTableSource>();

/**
 * Starts a download, unless one is already running or one has landed.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.fileTable
 */
export function loadFileTable(source: FileTableSource = liveFileTableSource): void {
  const state = fileTableStore.getSnapshot();
  if (state.status === "loading") return;

  if (!watched.has(source)) {
    watched.add(source);
    source.changes((body) =>
      fileTableStore.update((current) => ({
        ...current,
        status: "ready",
        body,
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
    fileTableStore.update((current) => ({
      ...current,
      status: "loading",
      failure: undefined,
    }));
  }
  const signal = waiting ? controller?.signal : undefined;

  void source.load(signal).then(
    (body) =>
      fileTableStore.update((current) => ({
        ...current,
        status: "ready",
        body,
        fetchedAt: source.freshness()?.changedAt,
        failure: undefined,
      })),
    (error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        fileTableStore.update((current) =>
          current.status === "loading" ? { ...current, status: "idle" } : current
        );
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
    }
  );
}

/**
 * Makes the next ask re-check, whatever the clock says.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.markStale
 * @upstream-differs one function per file, as `markMEDatabaseStale` is: the
 * same upstream call marks every held file, and here each store marks what it
 * holds
 */
export function markFileTableStale(source: FileTableSource = liveFileTableSource): void {
  source.markStale();
}
