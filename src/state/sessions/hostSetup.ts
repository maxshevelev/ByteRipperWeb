import { SessionHost } from "@/core/session/sessionHost";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { ChunkCache } from "@/core/storage/chunkCache";
import { FileBackedStorage } from "@/core/storage/fileBackedStorage";
import type { KeptFolder } from "@/core/workspace/keptFolder";
import { storageOf } from "@/platform/sessions/documentSource";
import { installSessionOperations } from "@/platform/sessions/sessionOperations";
import { installKeeperOperations, type KeptFolderRef } from "@/state/sessions/keeperOperations";

/**
 * The session host as both of its homes make it (`Design/FILE_SESSIONS.md`): the `SharedWorker`
 * every window of the app connects to, and the page itself where there is no such worker — the
 * single-file build, a test.
 *
 * @web-only upstream's documents live in its one process
 */
export function makeSessionHost(options: {
  /** The folder a keeper writes into, or nothing where content cannot be kept. */
  readonly folderOf: (ref: KeptFolderRef) => KeptFolder | undefined;
  /** Every workspace's kept folder: the switch turned off. */
  readonly removeAllKept: () => Promise<void>;
  /** A join's bytes by a reference the platform gave that is not a `Blob`. */
  readonly otherExternal?: ((reference: unknown) => ByteStorage | undefined) | undefined;
}): SessionHost {
  const host = new SessionHost({
    storage: storageOf,
    external: async (reference) => {
      if (typeof Blob !== "undefined" && reference instanceof Blob) {
        return new FileBackedStorage(reference, new ChunkCache());
      }
      const storage = options.otherExternal?.(reference);
      if (storage === undefined) throw new Error("The bytes to join are gone.");
      return storage;
    },
  });
  installSessionOperations(host);
  installKeeperOperations(host, options.folderOf);
  host.defineHostOperation("keeper.removeFolder", async (args) => {
    const folder = options.folderOf((args as { folder: KeptFolderRef }).folder) as
      | (KeptFolder & { remove?: () => Promise<void> })
      | undefined;
    await folder?.remove?.();
  });
  host.defineHostOperation("keeper.removeAll", () => options.removeAllKept());
  // A window let a session go: it ends once no window shows it.
  host.defineHostOperation("session.closeUnshown", (args) => {
    const { session } = args as { session: string };
    if (!host.shownSessions().has(session)) host.close(session);
  });
  return host;
}
