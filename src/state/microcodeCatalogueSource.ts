import type { FreshenedStatus } from "@/platform/net/freshened";
import { entriesFromTree, type MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";

/**
 * Where the list of microcode, and the microcode itself, comes from.
 *
 * An interface because the tests must not touch the network: a suite that
 * reaches GitHub is a suite that fails on a train. It lives here rather than
 * beside the parsing because it names browser types — `src/tools/fit` is
 * compiled against the pure half and only ever consumes a finished list.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSource
 */
export interface MicrocodeSource {
  /**
   * Every microcode in the collection, read from the file names.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSource.catalogue
   */
  catalogue(signal?: AbortSignal): Promise<readonly MicrocodeCatalogueEntry[]>;

  /**
   * One file's bytes.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSource.download
   */
  download(entry: MicrocodeCatalogueEntry, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;

  /**
   * Emits when a background check has replaced the listing with a newer one, so
   * a table's "latest" verdicts can be settled again against what actually
   * exists now. A source that never changes its mind never emits.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#MicrocodeSource.catalogueChanges
   * @upstream-differs a listener returning its own removal, rather than an
   * `AsyncStream`
   */
  changes(listener: (entries: readonly MicrocodeCatalogueEntry[]) => void): () => void;

  /**
   * When the listing last changed and when it was last confirmed current, or
   * `undefined` if nothing has been fetched.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.freshness
   * @upstream-differs on the interface, where upstream keeps it on the concrete
   * repository: the web's store holds only the interface, so the date the panel
   * reads has nowhere else to be reached from
   */
  freshness(): FreshenedStatus | undefined;

  /**
   * Makes the next `catalogue` re-check, whatever the clock says. It does not
   * throw the listing away: a check on a bench with no network must not be the
   * gesture that empties the table.
   *
   * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.markStale
   * @upstream-differs on the interface, as `freshness` is
   */
  markStale(): void;
}

/**
 * The tree of the default branch, in one request — where the contents API would
 * need a page per directory.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.treeURL
 */
export const MICROCODE_TREE_URL =
  "https://api.github.com/repos/platomav/CPUMicrocodes/git/trees/master?recursive=1";

/** @upstream Modules/FITTool/Sources/FITToolUI/MicrocodeSource.swift#CPUMicrocodesRepository.downloadBase */
export const MICROCODE_DOWNLOAD_BASE =
  "https://raw.githubusercontent.com/platomav/CPUMicrocodes/master/";

/** The listing read from text already in hand — what a test installs. */
export function fixedMicrocodeSource(
  tree: string,
  files: ReadonlyMap<string, Uint8Array<ArrayBuffer>> = new Map()
): MicrocodeSource {
  const entries = entriesFromTree(tree);
  const at = Date.now();
  return {
    catalogue: async () => entries,
    download: async (entry) => {
      const bytes = files.get(entry.path);
      if (bytes === undefined) throw new Error(`nothing installed at ${entry.path}`);
      return bytes;
    },
    // A listing already in hand never changes its mind, so it announces
    // nothing: upstream's default `catalogueChanges()` is a stream that
    // finishes at once, for the same reason.
    changes: () => () => undefined,
    freshness: () => ({ changedAt: at, checkedAt: at }),
    markStale: () => undefined,
  };
}
