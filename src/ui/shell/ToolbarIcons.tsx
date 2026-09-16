/**
 * The toolbar's glyphs, drawn here: SF Symbols do not ship to a browser. Each
 * is named for the symbol upstream uses, and drawn in the current colour so a
 * disabled or pressed button colours it.
 *
 * @upstream-differs inline SVG shaped after the named SF Symbols
 */

import { ScopeShapes } from "@/ui/shell/scopeGlyph";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Glyph({ children }: { readonly children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {children}
    </svg>
  );
}

/** `wrench.and.screwdriver`, drawn as the wrench the tool panel's header carries. */
export function ToolsGlyph() {
  return (
    <Glyph>
      <path
        fill="currentColor"
        d="M10.5 1.5a4 4 0 0 0-3.8 5.2L1.9 11.5a1.4 1.4 0 0 0 2 2l4.8-4.8a4 4 0 0 0 5.2-3.8l-2.2 2.2-2.1-.6-.6-2.1z"
      />
    </Glyph>
  );
}

/** `dot.scope`, drawn once for this button and the UEFI panel's reveal. */
export function GoToGlyph() {
  return (
    <Glyph>
      <g {...stroke}>
        <ScopeShapes />
      </g>
    </Glyph>
  );
}

/** `magnifyingglass`. */
export function FindGlyph() {
  return (
    <Glyph>
      <circle cx="7" cy="7" r="4.5" {...stroke} />
      <path d="M10.4 10.4 14 14" {...stroke} />
    </Glyph>
  );
}

/** `square.stack.3d.up`. */
export function SegmentsGlyph() {
  return (
    <Glyph>
      <path d="M8 2 14 5 8 8 2 5z" {...stroke} />
      <path d="M2 8.2 8 11.2l6-3" {...stroke} />
      <path d="M2 11.2 8 14.2l6-3" {...stroke} />
    </Glyph>
  );
}

/** `character.cursor.ibeam`. */
export function InsertModeGlyph() {
  return (
    <Glyph>
      <path d="M2 13 5 4l3 9M3.1 10h3.8" {...stroke} />
      <path d="M12 3v10M10.5 3h3M10.5 13h3" {...stroke} />
    </Glyph>
  );
}

/** `backward`. */
export function BackwardGlyph() {
  return (
    <Glyph>
      <path fill="currentColor" d="M8 4 3 8l5 4zM14 4 9 8l5 4z" />
    </Glyph>
  );
}

/** `forward`. */
export function ForwardGlyph() {
  return (
    <Glyph>
      <path fill="currentColor" d="M8 4l5 4-5 4zM2 4l5 4-5 4z" />
    </Glyph>
  );
}

/** `checkmark.circle.fill`. */
export function IdenticalGlyph() {
  return (
    <Glyph>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path
        d="M4.8 8.2 7 10.4l4.2-4.6"
        fill="none"
        stroke="#fff"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Glyph>
  );
}

/** `square.split.1x2` when stacking is offered, `square.split.2x1` when side by side is. */
export function PaneLayoutGlyph({ stacked }: { readonly stacked: boolean }) {
  return (
    <Glyph>
      <rect x="2" y="2" width="12" height="12" rx="2" {...stroke} />
      <path d={stacked ? "M2 8h12" : "M8 2v12"} {...stroke} />
    </Glyph>
  );
}

/** `sidebar.right`. */
export function MinimapGlyph() {
  return (
    <Glyph>
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" {...stroke} />
      <path d="M10.5 2.5v11" {...stroke} />
    </Glyph>
  );
}
