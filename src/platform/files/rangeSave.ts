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
/**
 * Asked about the file the picker chose, before anything is written (§21.7). A
 * guard that returns false sends the picker back up to choose again — the one
 * answer that helps is another file. Absent where there is nothing to guard
 * against (a save with no segment sources behind it).
 */
export type SaveTargetGuard = (handle: FileSystemFileHandle) => Promise<boolean>;

export async function saveRange(
  storage: ByteStorage,
  start: number,
  end: number,
  suggestedName: string,
  validateTarget?: SaveTargetGuard
): Promise<RangeSaveOutcome> {
  return saveRanges(storage, [{ start, end }], suggestedName, validateTarget);
}

/**
 * `saveRange` for the stretches of a scattered zone: their bytes one after
 * another, in the order given — for a file, its content.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.saveRanges
 */
export async function saveRanges(
  storage: ByteStorage,
  ranges: readonly { readonly start: number; readonly end: number }[],
  suggestedName: string,
  validateTarget?: SaveTargetGuard
): Promise<RangeSaveOutcome> {
  async function* bytes(): AsyncGenerator<Bytes> {
    for (const range of ranges) yield* rangeStream(storage, range.start, range.end);
  }
  const picker = fileSystemAccess().showSaveFilePicker;
  if (picker === undefined) {
    const chunks: Bytes[] = [];
    for await (const chunk of bytes()) chunks.push(chunk);
    downloadBlob(new Blob(chunks, { type: "application/octet-stream" }), suggestedName);
    return "downloaded";
  }

  for (;;) {
    let handle: FileSystemFileHandle;
    try {
      const options: SaveFilePickerOptions = { suggestedName };
      handle = await picker(options);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
    // A name that would replace a segment's source sends the panel back up, the
    // way Save As does (§21.7): the useful answer is another name, and asking
    // for it is the whole of the remedy.
    if (validateTarget !== undefined && !(await validateTarget(handle))) continue;

    const stream = await handle.createWritable();
    try {
      for await (const chunk of bytes()) await stream.write(chunk);
      await stream.close();
    } catch (error) {
      // Abort discards the swap file, so a failed write leaves the chosen file as
      // it was rather than half-filled.
      await stream.abort().catch(() => undefined);
      throw error;
    }
    return "saved";
  }
}
