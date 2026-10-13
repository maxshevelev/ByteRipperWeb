import type { PaneId } from "@/state/workspaceStore";
import type { WireContentMatch } from "@/workers/protocol";

/**
 * What the UEFI Structure panel on a pane offers outside itself: going to a place as a click on a
 * Contents search result goes, and opening the bytes a place behind a codec is in as a click on
 * one opens them — what an annotation's double-click does.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.goTo
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.openContentMatch
 * @upstream-differs the panel is a React component on the pane, so it registers here while it is
 * up, where upstream's caller holds the session
 */
export interface UefiPanelLink {
  /** The node in the tree, opened the way there, and the bytes in the dump. */
  readonly goTo: (match: WireContentMatch) => Promise<void>;
  /** The decompressed or decoded bytes the place is in, as a part with the place selected. */
  readonly open: (match: WireContentMatch) => Promise<void>;
}

const links = new Map<PaneId, UefiPanelLink>();

/** The panel on `pane` is up; the returned function says it went. */
export function registerUefiPanelLink(pane: PaneId, link: UefiPanelLink): () => void {
  links.set(pane, link);
  return () => {
    if (links.get(pane) === link) links.delete(pane);
  };
}

/** The panel's link on `pane`, waited for a moment while a panel just switched on comes up. */
export async function uefiPanelLink(
  pane: PaneId,
  waitMs = 3000
): Promise<UefiPanelLink | undefined> {
  const started = Date.now();
  for (;;) {
    const link = links.get(pane);
    if (link !== undefined || Date.now() - started > waitMs) return link;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
