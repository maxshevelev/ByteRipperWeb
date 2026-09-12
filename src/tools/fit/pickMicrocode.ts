/**
 * The microcode file the user picks, read into memory.
 *
 * A plain file input rather than the File System Access API: this file is only
 * ever read, never written back, so the picker that works in every browser is
 * the right one — and the bytes never leave the machine either way.
 *
 * A microcode image is a few hundred kilobytes at most, so it is read whole
 * rather than streamed: the editor has to check its header and its checksum
 * before anything is written, which means holding all of it anyway.
 */
export function pickMicrocode(): Promise<Uint8Array | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    // `.bin` is what the collection writes; anything else is allowed through
    // because a bench renames files, and the header is the real check.
    input.accept = ".bin,application/octet-stream";
    input.style.display = "none";

    // A picker the user closes fires no `change` event in most browsers, so the
    // element would stay in the document for the life of the page. `cancel`
    // covers the browsers that have it, and the rest are tidied when the next
    // pick replaces this one.
    const finish = (bytes: Uint8Array | undefined) => {
      input.remove();
      resolve(bytes);
    };
    input.addEventListener("cancel", () => finish(undefined));
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) {
        finish(undefined);
        return;
      }
      void file
        .arrayBuffer()
        .then((buffer) => finish(new Uint8Array(buffer)))
        .catch(() => finish(undefined));
    });

    document.body.append(input);
    input.click();
  });
}
