import type { SyncFolderFiles } from "@/core/sync/folderSync";

/**
 * The folder a synced library lives in, as a browser reaches it
 * (`Design/FAVORITES_SYNC_WEB.md`).
 *
 * **Chromium keeps a folder.** `showDirectoryPicker` hands over a directory
 * handle, the handle survives in IndexedDB, and the browser asks for permission
 * once per visit — or never again, where the user chose "Allow on every visit".
 * Every write replaces a file whole through `createWritable()`.
 *
 * **Firefox and Safari are handed one to read.** A directory input gives
 * read-only copies of the files in the folder chosen, for the occasion: enough
 * to take what other machines keep, and nothing to write back with.
 *
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder
 * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolderAccess
 * @upstream-differs a directory handle kept in IndexedDB, where upstream keeps a security-scoped bookmark
 */

/** Whether this visit may write the folder. */
export type FolderAccess = "granted" | "prompt" | "denied";

export interface LibraryFolder {
  readonly name: string;
  /** What is kept to find the folder again next visit: the handle itself. */
  readonly stored: unknown;
  readonly files: SyncFolderFiles;
  /**
   * Whether the folder may be written, asking the user only when `request` is
   * true — which only a click may do.
   *
   * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.hasAccess
   */
  permission(request: boolean): Promise<FolderAccess>;
  /**
   * Hears about a change in the folder, where the browser can say one happened.
   * Returns what stops listening.
   *
   * @upstream ByteRipperApp/Search/LibraryFilePresenter.swift#LibraryFilePresenter
   * @upstream-differs a FileSystemObserver on the folder, where the browser has one
   */
  watch(onChange: () => void): () => void;
  /** Whether `other` is this same folder, however it was reached. */
  isSame(other: LibraryFolder): Promise<boolean>;
}

/** Where the library's folder comes from, in this browser — or, in a test, a memory. */
export interface FolderPlatform {
  /** True where a folder can be kept and written: Chromium. */
  readonly canKeepFolder: boolean;
  /**
   * Why a folder cannot be kept here, when the reason is one the user can do
   * something about — rather than the browser simply not having the API.
   */
  readonly whyNoFolder?: string | undefined;
  /** Asks the user for a folder to keep the library in. `undefined` when they cancel. */
  pick(): Promise<LibraryFolder | undefined>;
  /**
   * The folder kept from an earlier visit, or `undefined` when what was kept is
   * not one.
   *
   * @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.restore
   */
  restore(stored: unknown): LibraryFolder | undefined;
  /** Asks the user for a folder to read once. `undefined` when they cancel. */
  pickToRead(): Promise<SyncFolderFiles | undefined>;
}

/** How long a burst of changes in the folder is gathered before it is reported. */
const WATCH_SETTLE_MS = 400;

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  keys?: () => AsyncIterableIterator<string>;
};

type ObserverConstructor = new (
  callback: () => void
) => { observe(handle: FileSystemHandle): Promise<void>; disconnect(): void };

type DirectoryPicker = (options?: {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: string;
}) => Promise<FileSystemDirectoryHandle>;

/** A folder over a directory handle. */
export function libraryFolderFrom(handle: FileSystemDirectoryHandle): LibraryFolder {
  const directory = handle as PermissionHandle;

  const files: SyncFolderFiles = {
    name: handle.name,
    /** @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.libraryFiles */
    async list() {
      const names: string[] = [];
      if (directory.keys === undefined) return names;
      for await (const name of directory.keys()) names.push(name);
      return names;
    },
    async read(name) {
      try {
        const file = await (await handle.getFileHandle(name)).getFile();
        return await file.text();
      } catch (error) {
        if (isMissing(error)) return undefined;
        throw error;
      }
    },
    async write(name, contents) {
      const file = await handle.getFileHandle(name, { create: true });
      const stream = await file.createWritable();
      try {
        await stream.write(contents);
        await stream.close();
      } catch (error) {
        // Abort discards the swap file: the file stays as it was, not half-written.
        await stream.abort().catch(() => undefined);
        throw error;
      }
    },
    async remove(name) {
      try {
        await handle.removeEntry(name);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    },
  };

  return {
    name: handle.name,
    stored: handle,
    files,
    async permission(request) {
      if (typeof directory.queryPermission !== "function") return "granted";
      const now = await directory.queryPermission({ mode: "readwrite" });
      if (now === "granted" || !request || typeof directory.requestPermission !== "function") {
        return now;
      }
      return await directory.requestPermission({ mode: "readwrite" });
    },
    watch(onChange) {
      const Observer = (globalThis as { FileSystemObserver?: ObserverConstructor })
        .FileSystemObserver;
      if (Observer === undefined) return () => undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const observer = new Observer(() => {
        if (timer !== undefined) clearTimeout(timer);
        timer = setTimeout(onChange, WATCH_SETTLE_MS);
      });
      void observer.observe(handle).catch(() => undefined);
      return () => {
        if (timer !== undefined) clearTimeout(timer);
        observer.disconnect();
      };
    },
    async isSame(other) {
      const theirs = other.stored;
      if (typeof FileSystemHandle === "undefined" || !(theirs instanceof FileSystemHandle)) {
        return false;
      }
      return await handle.isSameEntry(theirs);
    },
  };
}

/** The browser's own: a kept folder where there is a picker, a read-once folder everywhere. */
export const browserFolderPlatform: FolderPlatform = {
  get canKeepFolder() {
    return typeof directoryPicker() === "function";
  },

  // Chromium offers the folder picker only on a secure page: https, or
  // localhost. The same browser opened at a network address has none, and that
  // is worth saying — it looks exactly like a browser that cannot keep folders.
  get whyNoFolder() {
    if (typeof directoryPicker() === "function") return undefined;
    if ((globalThis as { isSecureContext?: boolean }).isSecureContext !== false) return undefined;
    return (
      "This page was opened at an address the browser does not treat as secure, so it hides " +
      "the folder picker. Open the app over https, or at http://localhost, to keep the library " +
      "in a folder."
    );
  },

  async pick() {
    const picker = directoryPicker();
    if (picker === undefined) return undefined;
    try {
      // The Documents folder to start in, where a synced folder is likeliest to
      // be near; the browser remembers where this id was last pointed.
      // @upstream ByteRipperApp/Search/SyncFolder.swift#SyncFolder.suggestedFolder
      return libraryFolderFrom(
        await picker({ id: "byteripper-library", mode: "readwrite", startIn: "documents" })
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return undefined;
      throw error;
    }
  },

  restore(stored) {
    if (typeof FileSystemDirectoryHandle === "undefined") return undefined;
    return stored instanceof FileSystemDirectoryHandle ? libraryFolderFrom(stored) : undefined;
  },

  pickToRead() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      // The folder, not a file: what the browser hands over is every file in
      // it, as read-only copies.
      (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
      input.style.display = "none";

      const finish = (files: SyncFolderFiles | undefined) => {
        input.remove();
        resolve(files);
      };
      input.addEventListener("change", () => {
        finish(readOnlyFolder(Array.from(input.files ?? [])));
      });
      input.addEventListener("cancel", () => finish(undefined));
      document.body.append(input);
      input.click();
    });
  },
};

/**
 * The files a directory input handed over, as a folder that can only be read:
 * the ones directly in the folder chosen, not in folders inside it.
 */
export function readOnlyFolder(chosen: readonly File[]): SyncFolderFiles | undefined {
  if (chosen.length === 0) return undefined;
  const byName = new Map<string, File>();
  let folderName = "";
  for (const file of chosen) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
    const parts = path.split("/");
    if (parts.length > 2) continue;
    folderName = parts.length === 2 ? (parts[0] ?? "") : folderName;
    byName.set(parts.at(-1) ?? file.name, file);
  }
  return {
    name: folderName,
    list: async () => [...byName.keys()],
    read: async (name) => {
      const file = byName.get(name);
      return file === undefined ? undefined : await file.text();
    },
  };
}

function directoryPicker(): DirectoryPicker | undefined {
  return (globalThis as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "TypeMismatchError")
  );
}
