import { formatHex, parseHex } from "@/core/text/hexText";

/**
 * Bytes on the clipboard.
 *
 * Hex text is the format that always works and always travels — into a forum
 * post, a bug report, a terminal, and back here. But it is lossy in one
 * direction that matters: a megabyte of bytes is three megabytes of text, and
 * pasting it back costs a parse.
 *
 * Chromium lets a page put an arbitrary type on the clipboard as long as the
 * name is prefixed `web `, so where that exists the bytes go across *as bytes*
 * alongside the text. A paste prefers them and falls back to parsing the text,
 * so a copy from this application pastes losslessly into it and legibly into
 * everything else.
 */

/**
 * The custom type. The `web ` prefix is required: it is what marks the entry as
 * written by a web page rather than by a native application, and a browser
 * refuses any other unrecognised name.
 */
const RAW_TYPE = "web application/octet-stream";

interface ClipboardItemConstructor {
  supports?: (type: string) => boolean;
}

function supportsRawBytes(): boolean {
  if (typeof ClipboardItem === "undefined") return false;
  const itemType = ClipboardItem as unknown as ClipboardItemConstructor;
  // `supports` is itself recent; without it, assume the type would be refused
  // rather than throwing inside a copy the user is waiting on.
  return typeof itemType.supports === "function" && itemType.supports(RAW_TYPE);
}

/**
 * Puts bytes on the clipboard as raw bytes and as hex text.
 *
 * Returns false when the asynchronous route is unavailable or refused, so the
 * caller can fall back to the text it can write synchronously.
 */
export async function writeBytes(bytes: Uint8Array): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.clipboard?.write === undefined) return false;

  const items: Record<string, Blob> = {
    "text/plain": new Blob([formatHex(bytes)], { type: "text/plain" }),
  };
  if (supportsRawBytes()) {
    items[RAW_TYPE] = new Blob([bytes.slice()], { type: "application/octet-stream" });
  }

  try {
    await navigator.clipboard.write([new ClipboardItem(items)]);
    return true;
  } catch {
    // A denied permission, a lost user gesture, or a browser that refused the
    // custom type after saying it supported it. The text route still works.
    return false;
  }
}

/**
 * Reads bytes from the clipboard, preferring the raw type.
 *
 * `undefined` when there is nothing that unambiguously reads as bytes — which
 * is not a failure, only a paste of something that was not bytes.
 */
export async function readBytes(): Promise<Uint8Array | undefined> {
  if (typeof navigator === "undefined" || navigator.clipboard?.read === undefined) return undefined;

  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes(RAW_TYPE)) {
        return new Uint8Array(await (await item.getType(RAW_TYPE)).arrayBuffer());
      }
    }
  } catch {
    // Reading the clipboard needs a permission the user may not have given.
    return undefined;
  }
  return undefined;
}

/** What a paste event carries, when it carries bytes. */
export function bytesFromClipboardData(data: DataTransfer): Uint8Array | undefined {
  return parseHex(data.getData("text/plain"));
}
