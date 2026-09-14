/**
 * Formatted text and pictures on the clipboard.
 *
 * Formatted text goes as `text/html` beside `text/plain`, so a copy pastes into
 * a note or a report as the table it is on screen and into a plain field as
 * readable lines. It is written through the copy event first: that route is
 * synchronous, keeps the click's gesture, and works on a bench reaching the app
 * over plain HTTP, where the asynchronous clipboard does not exist at all.
 *
 * A picture has no such route — only the asynchronous clipboard carries
 * `image/png`, and only in a secure context — so it says whether it worked and
 * the caller decides what to do instead.
 */

interface ClipboardSurface {
  write?: (items: ClipboardItem[]) => Promise<void>;
  writeText?: (text: string) => Promise<void>;
}

const clipboard = (): ClipboardSurface | undefined =>
  typeof navigator === "undefined"
    ? undefined
    : (navigator as { clipboard?: ClipboardSurface }).clipboard;

/** Puts formatted text on the clipboard, with its plain spelling under it. */
export async function writeRichText(html: string, plain: string): Promise<boolean> {
  if (copyThroughEvent(html, plain)) return true;
  const surface = clipboard();
  if (surface === undefined) return false;
  try {
    if (typeof ClipboardItem !== "undefined" && surface.write !== undefined) {
      await surface.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
  } catch {
    // Refused as rich text; the plain spelling below may still be accepted.
  }
  try {
    if (surface.writeText === undefined) return false;
    await surface.writeText(plain);
    return true;
  } catch {
    return false;
  }
}

/** Puts a picture on the clipboard. False where the browser will not take one. */
export async function writeImage(image: Blob): Promise<boolean> {
  const surface = clipboard();
  if (surface?.write === undefined || typeof ClipboardItem === "undefined") return false;
  try {
    await surface.write([new ClipboardItem({ [image.type]: image })]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The copy command, with this page answering its own copy event. The command
 * is the old one, and still the one every browser honours without a permission.
 */
function copyThroughEvent(html: string, plain: string): boolean {
  if (typeof document === "undefined") return false;
  let written = false;
  const onCopy = (event: ClipboardEvent) => {
    if (event.clipboardData === null) return;
    event.clipboardData.setData("text/html", html);
    event.clipboardData.setData("text/plain", plain);
    event.preventDefault();
    event.stopImmediatePropagation();
    written = true;
  };
  // Capturing on the window, so nothing listening for copies further in — the
  // dump's own copy — answers this one instead.
  window.addEventListener("copy", onCopy, true);
  try {
    document.execCommand("copy");
  } catch {
    // A browser that has dropped the command; the asynchronous route follows.
  } finally {
    window.removeEventListener("copy", onCopy, true);
  }
  return written;
}
