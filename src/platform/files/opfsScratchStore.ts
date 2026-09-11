import type { ByteSource, Bytes } from "@/core/storage/byteStorage";
import type { ScratchStore } from "@/core/storage/scratchStore";

/**
 * Somewhere private to put a copy of a document's content.
 *
 * This is the browser's answer to upstream's `TemporaryFileStore`. The
 * origin-private file system is a real filesystem the page owns outright: no
 * picker, no permission prompt, not visible to the user, and — the part that
 * matters here — its files come back as `File` objects, which are exactly the
 * `ByteSource` the storage layer already reads through.
 *
 * Two things need it. `EditOverlayStorage`'s materialisation valve, which folds
 * a piece list that has grown too long into a fresh base; and Duplicate, whose
 * copy has to go on reading the content it was taken from after the original
 * has been edited or saved over.
 *
 * `src/core` may not reach any of this, which is why it names
 * {@link ScratchStore} and this implements it.
 */
export class OpfsScratchStore implements ScratchStore {
  private readonly prefix: string;
  private readonly written: string[] = [];
  private counter = 0;

  /**
   * @param prefix Distinguishes one store's files from another's. Each document
   * gets its own store, so its scratch goes when it does.
   */
  constructor(
    prefix = `scratch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  ) {
    this.prefix = prefix;
  }

  /** Whether this browser has an origin-private file system at all. */
  static isAvailable(): boolean {
    return typeof navigator !== "undefined" && navigator.storage?.getDirectory !== undefined;
  }

  async write(content: AsyncIterable<Bytes>): Promise<ByteSource> {
    const root = await navigator.storage.getDirectory();
    const name = `${this.prefix}-${this.counter++}.bin`;
    const handle = await root.getFileHandle(name, { create: true });

    const stream = await handle.createWritable();
    try {
      for await (const chunk of content) await stream.write(chunk);
      await stream.close();
    } catch (error) {
      await stream.abort().catch(() => undefined);
      await root.removeEntry(name).catch(() => undefined);
      throw error;
    }

    this.written.push(name);
    // A `File` is a `ByteSource`, so the storage above reads it exactly as it
    // reads a file the user opened.
    return await handle.getFile();
  }

  /**
   * Drops everything but the newest write.
   *
   * The overlay reads through its previous base until the moment it swaps, so
   * this is called after the swap and never before.
   */
  async releaseAllButLatest(): Promise<void> {
    const doomed = this.written.splice(0, Math.max(0, this.written.length - 1));
    await this.remove(doomed);
  }

  /** Drops everything. Called when the document that owns this store closes. */
  async releaseAll(): Promise<void> {
    const doomed = this.written.splice(0);
    await this.remove(doomed);
  }

  private async remove(names: readonly string[]): Promise<void> {
    if (names.length === 0) return;
    const root = await navigator.storage.getDirectory().catch(() => undefined);
    if (root === undefined) return;
    // A scratch file that will not delete is wasted quota and nothing worse, so
    // a failure here must not fail the operation that triggered it.
    await Promise.all(names.map((name) => root.removeEntry(name).catch(() => undefined)));
  }
}

/**
 * Deletes scratch files left by a session that ended badly.
 *
 * A crash or a killed tab leaves its files behind; nothing else will ever read
 * them, and without this they accumulate against the origin's quota until the
 * browser starts refusing writes. Run once at startup, and only against files
 * matching the naming scheme above so nothing else in the origin's storage is
 * touched.
 */
export async function sweepOrphanedScratch(): Promise<void> {
  if (!OpfsScratchStore.isAvailable()) return;
  try {
    const root = await navigator.storage.getDirectory();
    const directory = root as FileSystemDirectoryHandle & {
      keys?: () => AsyncIterableIterator<string>;
    };
    if (directory.keys === undefined) return;
    for await (const name of directory.keys()) {
      if (/^scratch-[0-9a-z]+-[0-9a-z]+-\d+\.bin$/.test(name)) {
        await root.removeEntry(name).catch(() => undefined);
      }
    }
  } catch {
    // No origin-private filesystem, or no permission to enumerate it.
  }
}
