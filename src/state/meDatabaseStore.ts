import {
  type RemoteFailure,
  remoteFailureMessage,
  remoteFailureOf,
  remoteSource,
} from "@/platform/net/cachedSource";
import { createStore } from "@/state/store";

/**
 * `MEA.dat` — the firmware database the ME analysis identifies against.
 *
 * Fetched once per session and cached for a day (D10), and *visibly*. This is
 * the database the desktop's own reported bug was about: a silent 350 KB
 * download in the middle of an analysis, which a bench experienced as a random
 * pause. So the state below is what the panel shows while it downloads, the
 * cancel is real, and the fetched date is on screen — yesterday's database is
 * worth having and worth being told about.
 *
 * An analysis runs without it. What it loses is the *identity* — the family, the
 * variant, the database row — and it keeps everything structural, which is why
 * the panel shows the structure immediately and the identity when it lands.
 */

export interface MEDatabaseState {
  readonly status: "idle" | "loading" | "ready" | "failed";
  /** The file's text, which the worker parses; the main thread never does. */
  readonly text: string | undefined;
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.freshness
   * @upstream-differs the date the body was fetched, which the panel shows, rather than a Freshened status
   */
  readonly fetchedAt: number | undefined;
  readonly failure: RemoteFailure | undefined;
}

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource.databaseChanges
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.databaseChanges
 * @upstream-differs a store subscription rather than an AsyncStream
 */
export const meDatabaseStore = createStore<MEDatabaseState>({
  status: "idle",
  text: undefined,
  fetchedAt: undefined,
  failure: undefined,
});

/** `MEA.dat` from ME Analyzer, which is the living version of this database. */
export const MEA_DAT_URL = "https://raw.githubusercontent.com/platomav/MEAnalyzer/master/MEA.dat";

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource */
export interface MEDatabaseSource {
  /** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource.database */
  load(signal?: AbortSignal): Promise<{ readonly text: string; readonly fetchedAt: number }>;
}

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.dataSource
 */
export const liveMEDatabaseSource: MEDatabaseSource = {
  async load(signal) {
    const body = await remoteSource(MEA_DAT_URL).body(signal === undefined ? {} : { signal });
    return { text: body.text, fetchedAt: body.fetchedAt };
  },
};

/** A database over text already in hand — what a test installs. */
export const fixedMEDatabaseSource = (text: string): MEDatabaseSource => ({
  load: async () => ({ text, fetchedAt: Date.now() }),
});

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataError
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataError.errorDescription
 */
export function meDatabaseMessage(state: MEDatabaseState): string | undefined {
  return state.failure === undefined ? undefined : remoteFailureMessage(state.failure);
}

let controller: AbortController | undefined;

/**
 * Starts a download, unless one is running or one has landed.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.database
 */
export function loadMEDatabase(source: MEDatabaseSource = liveMEDatabaseSource): void {
  const state = meDatabaseStore.getSnapshot();
  if (state.status === "loading" || state.status === "ready") return;
  controller = new AbortController();
  meDatabaseStore.update((current) => ({ ...current, status: "loading", failure: undefined }));

  void source
    .load(controller.signal)
    .then(({ text, fetchedAt }) =>
      meDatabaseStore.update((current) => ({
        ...current,
        status: "ready",
        text,
        fetchedAt,
        failure: undefined,
      }))
    )
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        meDatabaseStore.update((current) =>
          current.status === "loading" ? { ...current, status: "idle" } : current
        );
        return;
      }
      meDatabaseStore.update((current) => ({
        ...current,
        status: "failed",
        // By shape, not by `instanceof` — see the microcode catalogue, where
        // that distinction turned a rate limit into "offline".
        failure: remoteFailureOf(error) ?? {
          kind: "offline",
          detail: error instanceof Error ? error.message : "the database could not be read",
        },
      }));
    });
}

export function cancelMEDatabase(): void {
  controller?.abort();
  controller = undefined;
  meDatabaseStore.update((current) =>
    current.status === "loading" ? { ...current, status: "idle" } : current
  );
}

/** @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.markStale */
export function forgetMEDatabase(): void {
  controller?.abort();
  controller = undefined;
  meDatabaseStore.update(() => ({
    status: "idle",
    text: undefined,
    fetchedAt: undefined,
    failure: undefined,
  }));
}
