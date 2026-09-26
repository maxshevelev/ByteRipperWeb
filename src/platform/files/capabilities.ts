import { L } from "@/core/localization/localization";

/**
 * What this browser can do with files, detected once.
 *
 * Decision D7: the difference between *Save* and *Download a copy* is a fact
 * about the browser that the user has to see, and everything else in the app
 * stays ignorant of it. This module is where the detection happens, and the
 * only place `showOpenFilePicker` is named.
 */

/** The File System Access surface this app uses, typed where lib.dom stops. */
interface FileSystemAccessWindow {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>;
  showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

/** One entry of a picker's type menu: a description and the types it admits. */
export interface FilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

export interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerType[];
}

export interface SaveFilePickerOptions extends OpenFilePickerOptions {
  suggestedName?: string;
}

export interface FileCapabilities {
  /**
   * True when a file opened through the picker can be written back to itself —
   * Chromium only. Everywhere else the app is fully usable and saves a copy
   * through the download flow, and the button says *Download* rather than
   * *Save*.
   */
  readonly canSaveInPlace: boolean;
  /** True when a drop can yield a writable handle rather than a plain `File`. */
  readonly canWriteDroppedFiles: boolean;
  /** True when Save All as Separate Files can write into a chosen directory. */
  readonly canPickDirectory: boolean;
}

/**
 * What this browser offers. Feature detection, never user-agent sniffing: the
 * question is whether the function is there, and that is exactly what is asked.
 */
export function detectFileCapabilities(scope: unknown = globalThis): FileCapabilities {
  const host = scope as FileSystemAccessWindow;
  const canSaveInPlace =
    typeof host.showOpenFilePicker === "function" && typeof host.showSaveFilePicker === "function";
  return {
    canSaveInPlace,
    // A drop yields a handle through the same API, and only where it exists.
    canWriteDroppedFiles: canSaveInPlace && typeof DataTransferItem !== "undefined",
    canPickDirectory: typeof host.showDirectoryPicker === "function",
  };
}

/**
 * How the app names the act of writing a file.
 *
 * Two things have to be true before the button may say *Save*: the browser can
 * write back at all, and *this file* arrived with a handle to write back to. A
 * file that came from an `<input>`, or from a drop the browser gave no handle
 * for, will be downloaded however capable the browser is — and a button
 * promising otherwise is exactly the discovery D7 exists to prevent.
 *
 * The UI asks this rather than deciding for itself, so the wording can never
 * drift from what will happen.
 */
export function saveVerb(capabilities: FileCapabilities, hasHandle = true): "Save" | "Download" {
  return capabilities.canSaveInPlace && hasHandle ? "Save" : "Download";
}

/** One sentence a person can read about why the button says what it says. */
export function saveExplanation(capabilities: FileCapabilities, hasHandle = true): string {
  if (capabilities.canSaveInPlace && hasHandle) {
    return "Edits are written back to the file you opened.";
  }
  if (capabilities.canSaveInPlace) {
    return (
      "This file was opened without a handle the browser will write through, so saving " +
      "downloads a copy. Opening it again through Open… gives one."
    );
  }
  return (
    "This browser cannot write to a file it opened, so saving downloads a copy instead. " +
    "Chromium-based browsers can save in place."
  );
}

/**
 * What saving does in this browser, as one sentence for the landing screen.
 *
 * Asked of the browser rather than of a file: the landing screen has no file
 * open, so the question there is what this browser does with one — and
 * {@link saveVerb} would answer *Download* even in Chromium, where the only
 * thing missing is a file to write back through.
 *
 * @web-only the landing screen's line. Upstream shows the save kind beside the
 * pane's status, where the web keeps it in the toolbar's own button wording;
 * this sentence is what the landing screen says in words, having no file open
 * to hang a save verb on
 */
export function saveNotice(capabilities: FileCapabilities): string {
  return capabilities.canSaveInPlace ? L("Saves in place.") : L("Saves by downloading a copy.");
}

export const fileSystemAccess = (scope: unknown = globalThis): FileSystemAccessWindow =>
  scope as FileSystemAccessWindow;
