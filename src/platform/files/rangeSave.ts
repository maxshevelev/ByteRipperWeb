import type { ByteStorage, Bytes } from "@/core/storage/byteStorage";
import { rangeStream } from "@/core/storage/contentStream";
import { fileSystemAccess, type SaveFilePickerOptions } from "@/platform/files/capabilities";
import { downloadBlob } from "@/platform/files/download";

/**
 * Writing one range out to a file of its own.
 *
 * Save Selection as… and Save Segment… are the same act with different ways of
 * saying which bytes (§10.2, §21.5), so they are one function. The picker where
 * the browser has one, the download flow where it does not (D7).
 */

export type RangeSaveOutcome = "saved" | "downloaded" | "cancelled";

/**
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveRange
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.savePaneSelectionAs
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.exportName
 */
export async function saveRange(
  storage: ByteStorage,
  start: number,
  end: number,
  suggestedName: string
): Promise<RangeSaveOutcome> {
  const picker = fileSystemAccess().showSaveFilePicker;
  if (picker === undefined) {
    const chunks: Bytes[] = [];
    for await (const chunk of rangeStream(storage, start, end)) chunks.push(chunk);
    downloadBlob(new Blob(chunks, { type: "application/octet-stream" }), suggestedName);
    return "downloaded";
  }

  let handle: FileSystemFileHandle;
  try {
    const options: SaveFilePickerOptions = { suggestedName };
    handle = await picker(options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    throw error;
  }

  const stream = await handle.createWritable();
  try {
    for await (const chunk of rangeStream(storage, start, end)) await stream.write(chunk);
    await stream.close();
  } catch (error) {
    // Abort discards the swap file, so a failed write leaves the chosen file as
    // it was rather than half-filled.
    await stream.abort().catch(() => undefined);
    throw error;
  }
  return "saved";
}
