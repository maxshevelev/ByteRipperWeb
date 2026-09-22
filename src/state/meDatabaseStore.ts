import {
  type RemoteFailure,
  remoteFailureMessage,
  remoteFailureOf,
  remoteSource,
} from "@/platform/net/cachedSource";
import { Freshened, type FreshenedStatus } from "@/platform/net/freshened";
import { createStore } from "@/state/store";

/**
 * `MEA.dat` — the firmware database the ME analysis identifies against.
 *
 * Fetched once per session and re-checked once a day (D10), and *visibly*. This
 * is the database the desktop's own reported bug was about: a silent 350 KB
 * download in the middle of an analysis, which a bench experienced as a random
 * pause. So the state below is what the panel shows while it downloads, the
 * cancel is real, and the fetched date is on screen — yesterday's database is
 * worth having and worth being told about.
 *
 * The day's re-check costs one request and no bytes when the database has not
 * changed: this host's `ETag` cannot be read by a script, so the *browser*
 * revalidates the copy it holds with the validator it stored and the `304`
 * comes back on the wire (`Freshened`, `src/platform/net/freshened.ts`, and the
 * measurement in `cachedSource.ts`). A database that *has* changed
 * arrives behind the answer the panel is already reading, and the panel is told
 * through `changes` so it can identify again against what has just arrived.
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
   * When the bytes last changed, so the interface can say how old they are.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.freshness
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

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource
 */
export interface MEDatabaseSource {
  /**
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource.database
   */
  load(signal?: AbortSignal): Promise<string>;

  /**
   * Emits when a background check has replaced `MEA.dat` with a newer one.
   *
   * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataSource.databaseChanges
   * @upstream-differs a listener returning its own removal, rather than an
   * `AsyncStream`
   */
  changes(listener: (text: string) => void): () => void;

  /**
   * When the database last changed, or `undefined` if nothing has been fetched.
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

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.dataSource
 */
function liveDatabase(): MEDatabaseSource {
  const held = new Freshened<string>();
  const remote = remoteSource(MEA_DAT_URL);

  let seeded: Promise<void> | undefined;
  const seed = (): Promise<void> => {
    seeded ??= (async () => {
      try {
        const stored = await remote.stored();
        if (stored === undefined) return;
        held.adopt(stored.text, stored.validator, {
          changedAt: stored.changedAt,
          checkedAt: stored.checkedAt,
        });
      } catch {
        // A copy that cannot be read is not a reason to refuse this ask: the
        // request below is still to be made, and it replaces the copy.
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
          : { kind: "fresh", value: answer.text, validator: answer.validator };
      });
    },
    changes(listener) {
      return held.changes(listener);
    },
    freshness: () => held.status,
    markStale: () => held.markStale(),
  };
}

export const liveMEDatabaseSource: MEDatabaseSource = liveDatabase();

/** A database over text already in hand — what a test installs. */
export const fixedMEDatabaseSource = (text: string): MEDatabaseSource => {
  const at = Date.now();
  return {
    load: async () => text,
    changes: () => () => undefined,
    freshness: () => ({ changedAt: at, checkedAt: at }),
    markStale: () => undefined,
  };
};

/**
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataError
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEADataSource.swift#MEADataError.errorDescription
 */
export function meDatabaseMessage(state: MEDatabaseState): string | undefined {
  return state.failure === undefined ? undefined : remoteFailureMessage(state.failure);
}

let controller: AbortController | undefined;
const watched = new Set<MEDatabaseSource>();

/**
 * Starts a download, unless one is already running or one has landed.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.database
 */
export function loadMEDatabase(source: MEDatabaseSource = liveMEDatabaseSource): void {
  const state = meDatabaseStore.getSnapshot();
  if (state.status === "loading") return;

  if (!watched.has(source)) {
    watched.add(source);
    // A newer database is a reason to read again: the identification, the SKU
    // and the known-bad hashes all come out of that file, and an answer from
    // last week's copy is exactly what the day's check was for.
    //
    // @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession.watchTheDatabase
    source.changes((text) =>
      meDatabaseStore.update((current) => ({
        ...current,
        status: "ready",
        text,
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
    meDatabaseStore.update((current) => ({ ...current, status: "loading", failure: undefined }));
  }
  const signal = waiting ? controller?.signal : undefined;

  void source.load(signal).then(
    (text) => {
      meDatabaseStore.update((current) => ({
        ...current,
        status: "ready",
        text,
        fetchedAt: source.freshness()?.changedAt,
        failure: undefined,
      }));
    },
    (error: unknown) => {
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
    }
  );
}

export function cancelMEDatabase(): void {
  controller?.abort();
  controller = undefined;
  meDatabaseStore.update((current) =>
    current.status === "loading" ? { ...current, status: "idle" } : current
  );
}

/**
 * Makes the next ask re-check, whatever the clock says.
 *
 * @upstream Packages/MEFirmware/Sources/MEFirmware/Data/MEAGitHubDataRepository.swift#MEAGitHubDataRepository.markStale
 * @upstream-differs one function per file, where upstream's one repository
 * marks both of its files at once: the web has a store for each, and each marks
 * what it holds
 */
export function markMEDatabaseStale(source: MEDatabaseSource = liveMEDatabaseSource): void {
  source.markStale();
}
