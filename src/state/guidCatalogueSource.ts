import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { remoteFailureOf } from "@/platform/net/cachedSource";
import type { FreshenedStatus } from "@/platform/net/freshened";

/**
 * Where the GUID catalogue comes from.
 *
 * An interface rather than a URL, because a test installs its own — a test that
 * reaches the network is a test that fails on a train. It lives here rather
 * than beside the parser because it names a browser type: `src/firmware` is
 * compiled without the DOM, and the parser only ever consumes a finished
 * catalogue.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSource
 */
export interface CatalogueSource {
  /** The fresh catalogue, parsed from `common/guids.csv`. */
  load(signal?: AbortSignal): Promise<GuidsCatalogue>;

  /**
   * Emits when a background check has replaced the catalogue with a newer one,
   * so the tree can be drawn again with the names that just arrived. A source
   * that never changes its mind never emits.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSource.guidsChanges
   * @upstream-differs a listener returning its own removal, rather than an
   * `AsyncStream`
   */
  changes(listener: (catalogue: GuidsCatalogue) => void): () => void;

  /**
   * When the catalogue last changed and when it was last confirmed current, or
   * `undefined` if nothing has been fetched.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.freshness
   * @upstream-differs on the interface, where upstream keeps it on the concrete
   * repository: the web's store holds only the interface, so the freshness a
   * panel reads has nowhere else to be reached from
   */
  freshness(): FreshenedStatus | undefined;

  /**
   * Makes the next `load` re-check, whatever the clock says — the Refresh
   * command. It does not throw the catalogue away: a Refresh on a bench with no
   * network must not be the gesture that empties the tree.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.markStale
   * @upstream-differs on the interface, as `freshness` is
   */
  markStale(): void;
}

/**
 * What went wrong on the way to the catalogue, in words a bench can act on.
 *
 * Being rate-limited, being offline and being answered 404 are three different
 * problems with three different answers, and the tree says which one it is
 * rather than printing one message for all three.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSourceError
 */
export type GuidsSourceError =
  | { readonly kind: "offline"; readonly underlying: string }
  | { readonly kind: "badResponse"; readonly status: number }
  | { readonly kind: "rateLimited" };

/**
 * Whether an error carries one of these failures, asked by shape and not by
 * `instanceof` — the reason `remoteFailureOf` gives: the answer to `instanceof`
 * is no whenever there are two copies of the module, and the failure a panel
 * branches on must not depend on which one built it.
 *
 * The three kinds are also the ones `RemoteFailure` names, which is what the
 * fetch itself throws: the catalogue's own error is that vocabulary in its own
 * words, and this is where one becomes the other.
 *
 * @upstream-differs upstream's repository maps its statuses itself, so there is
 * one error type from the socket up; the web's fetch is shared by four sources,
 * so it throws `RemoteFetchError` and the catalogue translates it here
 */
export function guidsSourceErrorOf(error: unknown): GuidsSourceError | undefined {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      readonly kind?: unknown;
      readonly underlying?: unknown;
      readonly status?: unknown;
    };
    switch (candidate.kind) {
      case "rateLimited":
        return { kind: "rateLimited" };
      case "badResponse":
        if (typeof candidate.status === "number") {
          return { kind: "badResponse", status: candidate.status };
        }
        break;
      case "offline":
        if (typeof candidate.underlying === "string") {
          return { kind: "offline", underlying: candidate.underlying };
        }
        break;
      default:
        break;
    }
  }

  const failure = remoteFailureOf(error);
  if (failure === undefined) return undefined;
  switch (failure.kind) {
    case "offline":
      return { kind: "offline", underlying: failure.detail };
    case "rateLimited":
      return { kind: "rateLimited" };
    case "badResponse":
      return { kind: "badResponse", status: failure.status };
  }
}

/**
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#GuidsSourceError.errorDescription
 */
export function guidsSourceMessage(error: GuidsSourceError): string {
  switch (error.kind) {
    case "offline":
      return `Could not reach github.com: ${error.underlying}`;
    case "badResponse":
      return `github.com answered ${error.status}.`;
    case "rateLimited":
      return (
        "GitHub is rate-limiting this address. The names shown are the ones " +
        "shipped in the build, and they will refresh on the next open."
      );
  }
}

/**
 * `common/guids.csv` from UEFITool, which is the living version of the
 * hard-coded table this parser carries.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/GuidsSource.swift#LongSoftGuidsRepository.guidsURL
 */
export const GUIDS_CSV_URL =
  "https://raw.githubusercontent.com/LongSoft/UEFITool/new_engine/common/guids.csv";

/**
 * A catalogue over text already in hand — what a test installs.
 *
 * It never changes its mind, so it announces nothing: upstream's default
 * `guidsChanges()` is a stream that finishes at once, for the same reason.
 */
export function fixedCatalogue(text: string): CatalogueSource {
  const catalogue = GuidsCatalogue.parse(text);
  const at = Date.now();
  return {
    load: async () => catalogue,
    changes: () => () => undefined,
    freshness: () => ({ changedAt: at, checkedAt: at }),
    markStale: () => undefined,
  };
}
