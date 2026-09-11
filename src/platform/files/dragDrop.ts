import { detectFileCapabilities } from "@/platform/files/capabilities";
import { type OpenedFile, openedFileFrom } from "@/platform/files/openedFile";

/**
 * Files dropped onto the window.
 *
 * In Chromium a drop can yield a writable handle through
 * `getAsFileSystemHandle()`, so a dragged-in dump can be saved back to itself —
 * the same capability the picker gives, by the same route. Elsewhere a drop
 * gives a plain `File`, readable and never writable, which is the same
 * limitation the picker has there.
 */

/**
 * The files from a drop, with handles where the browser supplied them.
 *
 * Everything this reads out of the `DataTransfer` is read **synchronously**.
 * A `DataTransfer` is emptied the moment the drop event returns, so a plain
 * `await` before touching `items` or `files` leaves nothing to touch — the
 * promises are started first and awaited afterwards.
 */
export async function filesFromDrop(transfer: DataTransfer): Promise<OpenedFile[]> {
  const { canWriteDroppedFiles } = detectFileCapabilities();

  // The plain files, captured now, as the fallback for every route below.
  const plain = Array.from(transfer.files).map((file) => openedFileFrom(file));

  if (!canWriteDroppedFiles) return plain;

  const pending: Promise<OpenedFile | undefined>[] = [];
  for (const item of Array.from(transfer.items)) {
    if (item.kind !== "file") continue;
    pending.push(handleFromItem(item));
  }

  const withHandles = (await Promise.all(pending)).filter(
    (file): file is OpenedFile => file !== undefined
  );
  // A drop that yielded no handles is not a failed drop — some drag sources
  // cannot supply one, and the plain files are still perfectly readable.
  return withHandles.length > 0 ? withHandles : plain;
}

async function handleFromItem(item: DataTransferItem): Promise<OpenedFile | undefined> {
  const getHandle = (
    item as DataTransferItem & {
      getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
    }
  ).getAsFileSystemHandle;

  if (typeof getHandle === "function") {
    try {
      const handle = await getHandle.call(item);
      if (handle !== null && handle.kind === "file") {
        const fileHandle = handle as FileSystemFileHandle;
        return openedFileFrom(await fileHandle.getFile(), fileHandle);
      }
      // A directory was dropped: nothing here to open.
      if (handle !== null) return undefined;
    } catch {
      // Some drag sources have no handle to give and say so by throwing. That
      // costs the save-in-place path for this file and nothing else, so fall
      // through to the plain file rather than failing the drop.
    }
  }

  const file = item.getAsFile();
  return file === null ? undefined : openedFileFrom(file);
}

/** True when a drag carries something this app could open. */
export function dragCarriesFiles(transfer: DataTransfer | null): boolean {
  if (transfer === null) return false;
  return Array.from(transfer.types).includes("Files");
}
