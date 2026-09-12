import { entriesFromTree, type MicrocodeCatalogueEntry } from "@/tools/fit/microcodeCatalogue";

/**
 * Where the list of microcode, and the microcode itself, comes from.
 *
 * An interface because the tests must not touch the network: a suite that
 * reaches GitHub is a suite that fails on a train. It lives here rather than
 * beside the parsing because it names browser types — `src/tools/fit` is
 * compiled against the pure half and only ever consumes a finished list.
 */
export interface MicrocodeSource {
  /** Every microcode in the collection, read from the file names. */
  catalogue(signal?: AbortSignal): Promise<{
    readonly entries: readonly MicrocodeCatalogueEntry[];
    readonly fetchedAt: number;
  }>;
  /** One file's bytes. */
  download(entry: MicrocodeCatalogueEntry, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
}

/**
 * The tree of the default branch, in one request — where the contents API would
 * need a page per directory.
 */
export const MICROCODE_TREE_URL =
  "https://api.github.com/repos/platomav/CPUMicrocodes/git/trees/master?recursive=1";

export const MICROCODE_DOWNLOAD_BASE =
  "https://raw.githubusercontent.com/platomav/CPUMicrocodes/master/";

/** The listing read from text already in hand — what a test installs. */
export function fixedMicrocodeSource(
  tree: string,
  files: ReadonlyMap<string, Uint8Array<ArrayBuffer>> = new Map()
): MicrocodeSource {
  return {
    catalogue: async () => ({ entries: entriesFromTree(tree), fetchedAt: Date.now() }),
    download: async (entry) => {
      const bytes = files.get(entry.path);
      if (bytes === undefined) throw new Error(`nothing installed at ${entry.path}`);
      return bytes;
    },
  };
}
