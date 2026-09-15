import {
  type FilePickerType,
  fileSystemAccess,
  type SaveFilePickerOptions,
} from "@/platform/files/capabilities";
import { downloadBlob } from "@/platform/files/download";
import type { RangeSaveOutcome } from "@/platform/files/rangeSave";

/**
 * Writing a small text file the user asked for — the pattern library exported.
 *
 * The save picker where the browser has one, so the file can go straight into
 * the folder it is meant for; the download flow where it does not (D7).
 *
 * @web-only upstream never hands its library over as a file: it keeps it in a folder
 */
export async function saveText(
  contents: string,
  suggestedName: string,
  type: FilePickerType
): Promise<RangeSaveOutcome> {
  const blob = new Blob([contents], { type: Object.keys(type.accept)[0] ?? "text/plain" });
  const picker = fileSystemAccess().showSaveFilePicker;
  if (picker === undefined) {
    downloadBlob(blob, suggestedName);
    return "downloaded";
  }

  let handle: FileSystemFileHandle;
  try {
    const options: SaveFilePickerOptions = { suggestedName, types: [type] };
    handle = await picker(options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    throw error;
  }

  const stream = await handle.createWritable();
  try {
    await stream.write(blob);
    await stream.close();
  } catch (error) {
    // Abort discards the swap file, so a failed write leaves the chosen file as
    // it was.
    await stream.abort().catch(() => undefined);
    throw error;
  }
  return "saved";
}
