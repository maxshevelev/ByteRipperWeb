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

const BINARY_TYPES: FilePickerType[] = [
  {
    description: "Firmware dumps and binary files",
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
  const types = options.types ?? BINARY_TYPES;
  return capabilities.canSaveInPlace
    ? await openThroughPicker(options.multiple ?? false, types)
    : await openThroughInput(options.multiple ?? false, types);
}

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
  for (const handle of handles) opened.push(openedFileFrom(await handle.getFile(), handle));
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
