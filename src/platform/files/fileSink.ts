import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";
import { contentStream } from "@/core/storage/contentStream";
import type { OffsetRange } from "@/core/storage/pieceTable";
import { StorageError } from "@/core/storage/storageError";
import {
  detectFileCapabilities,
  type FileCapabilities,
  fileSystemAccess,
  type SaveFilePickerOptions,
} from "@/platform/files/capabilities";
import { type OpenedFile, openedFileFrom } from "@/platform/files/openedFile";

/**
 * Writing a document back out.
 *
 * This is where D7's capability difference actually bites. Chromium can write
 * to the file it opened; Firefox and Safari cannot, and the honest thing to do
 * there is download a copy and say so. Both routes live here, behind one
 * function, and everything above it only asks what happened.
 *
 * Two strategies where the browser allows them, as upstream has:
 *
 * - **Patch in place** when the document holds only overwrites. The changed
 *   ranges are written at their own offsets and every untouched byte is left
 *   exactly as it was — which matters for a firmware dump, where "the bytes I
 *   did not touch are bit-identical" is the whole point of the exercise.
 * - **Rewrite** otherwise, streaming the content.
 *
 * The browser makes the atomicity easier than upstream's POSIX dance:
 * `createWritable()` writes to a swap file and only replaces the original when
 * the stream closes, so a failed save leaves the original untouched without
 * any temp-file juggling of our own.
 */

export type SaveOutcome =
  /** Written back to the file it was opened from. */
  | { readonly kind: "savedInPlace"; readonly file: OpenedFile }
  /** Written to a file the user chose. */
  | { readonly kind: "savedAs"; readonly file: OpenedFile }
  /** Downloaded a copy, because this browser cannot write back. */
  | { readonly kind: "downloaded"; readonly name: string }
  /** The user dismissed the picker. Nothing happened, and that is not an error. */
  | { readonly kind: "cancelled" };

export interface SaveRequest {
  /** The content to write. */
  readonly storage: ByteStorage;
  /** What the file is called, for the download name and the Save As suggestion. */
  readonly name: string;
  /** The handle to write back to, where there is one. */
  readonly handle?: FileSystemFileHandle | undefined;
  /**
   * The ranges that differ from the file on disk. When this is given and the
   * handle is the file they were measured against, only these are written.
   */
  readonly changedRanges?: readonly OffsetRange[] | undefined;
  /**
   * The size the document's offsets were written against. Compared with the
   * file on disk before anything is written — see {@link verifyBaseIsIntact}.
   */
  readonly baseSize?: number | undefined;
  readonly capabilities?: FileCapabilities;
}

/** Saves to the file the document came from, or downloads a copy. */
export async function save(request: SaveRequest): Promise<SaveOutcome> {
  const capabilities = request.capabilities ?? detectFileCapabilities();
  const handle = request.handle;

  if (!capabilities.canSaveInPlace || handle === undefined) {
    return await download(request);
  }

  if (!(await ensureWritePermission(handle))) {
    // Permission declined. Downloading anyway would be putting a file somewhere
    // the user did not ask for; saying so and stopping is the honest answer.
    throw new StorageError(
      "permissionDenied",
      "This browser needs permission to write to that file, and it was not granted."
    );
  }

  await verifyBaseIsIntact(handle, request.baseSize);
  await writeThrough(handle, request);
  return { kind: "savedInPlace", file: openedFileFrom(await handle.getFile(), handle) };
}

/** Saves to a file the user picks, or downloads a copy where there is no picker. */
export async function saveAs(request: SaveRequest): Promise<SaveOutcome> {
  const capabilities = request.capabilities ?? detectFileCapabilities();
  const picker = fileSystemAccess().showSaveFilePicker;

  if (!capabilities.canSaveInPlace || picker === undefined) {
    return await download(request);
  }

  let handle: FileSystemFileHandle;
  try {
    const options: SaveFilePickerOptions = { suggestedName: request.name };
    handle = await picker(options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" };
    throw error;
  }

  // A new file holds none of the old bytes, so there is nothing to patch: the
  // whole content is written whatever the document's changed ranges say.
  await writeThrough(handle, { ...request, changedRanges: undefined, handle });
  return { kind: "savedAs", file: openedFileFrom(await handle.getFile(), handle) };
}

/**
 * Refuses to save when the file has shrunk since it was opened.
 *
 * The overlay reads a missing byte as zero so the offsets after it keep their
 * meaning. That is right for the view and catastrophic for a save: the zeros
 * would go into the user's file and the save would report success. A file that
 * *grew* is harmless — the extra bytes are past everything the table names.
 */
async function verifyBaseIsIntact(
  handle: FileSystemFileHandle,
  baseSize: number | undefined
): Promise<void> {
  if (baseSize === undefined) return;
  const onDisk = await handle.getFile();
  if (onDisk.size < baseSize) {
    throw new StorageError(
      "fileChanged",
      "This file has been shortened since it was opened, so what is on screen no longer " +
        "matches it. Open it again before saving, or the bytes that went missing would be " +
        "written back as zeros."
    );
  }
}

/** Writes the content, patching where that is both possible and correct. */
async function writeThrough(handle: FileSystemFileHandle, request: SaveRequest): Promise<void> {
  const ranges = request.changedRanges;
  const canPatch = ranges !== undefined && ranges.length > 0;

  // `keepExistingData` decides whether the swap file starts as a copy of the
  // original or empty — which is exactly the patch-or-rewrite choice.
  const stream = await handle.createWritable({ keepExistingData: canPatch });
  try {
    if (canPatch) {
      for (const range of ranges) {
        const bytes = await request.storage.read(range.start, range.end - range.start);
        await stream.write({ type: "write", position: range.start, data: bytes });
      }
      // A patch never changes the length, but a file that grew past its base
      // through appends still has to end where the document does.
      await stream.truncate(request.storage.size);
    } else {
      for await (const chunk of contentStream(request.storage)) await stream.write(chunk);
    }
    await stream.close();
  } catch (error) {
    // Abort discards the swap file, so a failed save leaves the original as it
    // was. Without this the browser keeps a half-written swap around.
    await stream.abort().catch(() => undefined);
    throw error;
  }
}

/**
 * The route for browsers that cannot write back: build the content as a blob
 * and hand it to the download flow.
 *
 * The whole content goes through memory here, which the patch path avoids. That
 * is the honest cost of the capability being absent, and the interface says so
 * before the user reaches for the button rather than after.
 */
async function download(request: SaveRequest): Promise<SaveOutcome> {
  const chunks: Bytes[] = [];
  for await (const chunk of contentStream(request.storage)) chunks.push(chunk);

  const url = URL.createObjectURL(new Blob(chunks, { type: "application/octet-stream" }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = request.name;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked on the next turn: revoking synchronously races the download the
    // click just started, and the browser then has nothing to fetch.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  return { kind: "downloaded", name: request.name };
}

/** Asks for write permission if the handle does not already have it. */
async function ensureWritePermission(handle: FileSystemFileHandle): Promise<boolean> {
  const permissions = handle as FileSystemFileHandle & {
    queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
    requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>;
  };
  if (typeof permissions.queryPermission !== "function") return true;

  if ((await permissions.queryPermission({ mode: "readwrite" })) === "granted") return true;
  if (typeof permissions.requestPermission !== "function") return false;
  return (await permissions.requestPermission({ mode: "readwrite" })) === "granted";
}
