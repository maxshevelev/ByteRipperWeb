import { L } from "@/core/localization/localization";
import {
  detectFileCapabilities,
  type FileCapabilities,
  type FilePickerType,
  fileSystemAccess,
} from "@/platform/files/capabilities";
import { type OpenedFile, openedFileFrom } from "@/platform/files/openedFile";

/**
 * Opening a file, by whichever route this browser offers.
 *
 * Two implementations behind one function, as D7 asks: the File System Access
 * picker where it exists, because the handle it returns is what makes *Save*
 * mean save; and a hidden `<input type="file">` everywhere else, which reads
 * perfectly well and can never write.
 *
 * A user dismissing the picker is not an error. It returns no files, and the
 * caller carries on.
 */

const binaryTypes = (): FilePickerType[] => [
  {
    description: L("Firmware dumps and binary files"),
    accept: {
      "application/octet-stream": [".bin", ".rom", ".fd", ".cap", ".img", ".dat"],
    },
  },
];

export interface OpenFileOptions {
  readonly multiple?: boolean;
  readonly capabilities?: FileCapabilities;
  /** What the picker offers; firmware dumps unless said otherwise. */
  readonly types?: FilePickerType[];
}

export async function openFiles(options: OpenFileOptions = {}): Promise<OpenedFile[]> {
  const capabilities = options.capabilities ?? detectFileCapabilities();
  const types = options.types ?? binaryTypes();
  return capabilities.canSaveInPlace && !pickerRefusesFiles
    ? await openThroughPicker(options.multiple ?? false, types)
    : await openThroughInput(options.multiple ?? false, types);
}

/**
 * Set once a handle the picker returned would not give its file. A window that is
 * not a browser's own — an embedded web view — can offer the picker and still
 * refuse `getFile()` ("The request is not allowed by the user agent or the platform
 * in the current context"); the file input reads there, so it is what is used from
 * then on, and the file that failed is asked for again through it.
 */
let pickerRefusesFiles = false;

async function openThroughPicker(
  multiple: boolean,
  types: FilePickerType[]
): Promise<OpenedFile[]> {
  const picker = fileSystemAccess().showOpenFilePicker;
  if (picker === undefined) return [];

  let handles: FileSystemFileHandle[];
  try {
    handles = await picker({ multiple, types, excludeAcceptAllOption: false });
  } catch (error) {
    // AbortError is the user closing the picker, which is not a failure.
    if (error instanceof DOMException && error.name === "AbortError") return [];
    throw error;
  }

  const opened: OpenedFile[] = [];
  try {
    for (const handle of handles) opened.push(openedFileFrom(await handle.getFile(), handle));
  } catch (error) {
    if (!(error instanceof DOMException)) throw error;
    // Not allowed, or not a context that can read it: the input can, though it
    // can never save in place. It cannot be opened from here, though: the picker
    // has used up the click, and an input clicked without one never answers.
    pickerRefusesFiles = true;
    throw new Error(
      L(
        "This window does not let the file picker read files. Choose Open… again: a plainer picker is used from now on."
      )
    );
  }
  return opened;
}

/**
 * The fallback. A file input has to be in the document to be clickable, and
 * gives no way to know the user cancelled — so the promise settles on the first
 * of `change` (they chose) or `cancel` (where the browser fires it).
 */
function openThroughInput(multiple: boolean, types: FilePickerType[]): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = multiple;
    input.accept = types
      .flatMap((type) =>
        Object.entries(type.accept).flatMap(([mime, extensions]) => [...extensions, mime])
      )
      .join(",");
    input.style.display = "none";

    const finish = (files: OpenedFile[]) => {
      input.remove();
      resolve(files);
    };

    input.addEventListener("change", () => {
      finish(Array.from(input.files ?? []).map((file) => openedFileFrom(file)));
    });
    input.addEventListener("cancel", () => finish([]));

    document.body.append(input);
    input.click();
  });
}
