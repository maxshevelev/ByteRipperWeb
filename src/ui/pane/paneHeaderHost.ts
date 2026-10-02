import { createContext } from "react";

/**
 * Where a pane's title bar goes when the surface it is in lays one header across the
 * whole of itself. A fragment panel is one: the part's name, the link back to the file
 * it came out of, the ⌄ and the ✕ run above the tool, the dump and the map, because a
 * part is the only file the panel holds and there is no second name for the tool's
 * header or the map's to say.
 *
 * Nothing provides it for a pane of the workspace, which keeps its bar above its own
 * dump. `element` is nothing until the panel has mounted the strip.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.hoistHeader
 */
export interface PaneHeaderHost {
  readonly element: HTMLElement | null;
}

export const PaneHeaderHostContext = createContext<PaneHeaderHost | undefined>(undefined);
