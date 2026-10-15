import { L } from "@/core/localization/localization";
import { type PaneId, paneIn, type WorkspaceState } from "@/state/workspaceStore";

/**
 * The codec `pane`'s bytes went through on their way out of the file, for its
 * pill: its own codec's, or — for a part taken out of a part that was
 * decompressed or decoded, whose own codec only copies — the nearest such
 * part's. A node opened out of a decompressed body holds decompressed bytes as
 * much as the body does. Nothing for the file's own bytes.
 *
 * @upstream ByteRipperApp/Fragments/FragmentPanels.swift#FragmentPanels.transform
 */
export function partTransform(
  state: WorkspaceState,
  pane: PaneId
): { readonly text: string; readonly explanation: string | undefined } | undefined {
  const origin = paneIn(state, pane)?.origin;
  if (origin === undefined) return undefined;
  const own = origin.codec.transform;
  if (own !== undefined) return { text: own, explanation: origin.codec.badge?.explanation };
  let holder: PaneId | undefined = origin.parent;
  while (holder !== undefined) {
    const part = paneIn(state, holder);
    const outer = part?.origin;
    if (part === undefined || outer === undefined) return undefined;
    const inherited = outer.codec.transform;
    if (inherited !== undefined) {
      return {
        text: inherited,
        explanation: L(
          "Part of “%1$@”, whose bytes were converted with %2$@ when taken out of the file.",
          part.name,
          inherited
        ),
      };
    }
    holder = outer.parent;
  }
  return undefined;
}
