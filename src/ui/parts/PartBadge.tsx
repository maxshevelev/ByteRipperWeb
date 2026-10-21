/**
 * A word in a capsule: what a part's codec says its bytes are (`PartCodec.badge`) — in a fragment
 * panel's header, on its pill in the dock, on an annotation's card and in the UEFI panel's search
 * results. One component, because one badge drawn by two pieces of code is two badges that drift
 * apart.
 *
 * A conversion the bytes went through — `LZMA`, `XOR 77` — carries ⇄ before the word;
 * `Read-only`, `Structure` and `Plain` do not. The word is in the text's colour; a pill that is up
 * inks it with its own (`.fragment-pill[data-up] .part-badge`).
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/PartBadgeView.swift#PartBadgeView
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/PartBadgeView.swift#PartBadgeView.text
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/PartBadgeView.swift#PartBadgeView.isTransform
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/PartBadgeView.swift#PartBadgeView.init
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/PartBadgeView.swift#PartBadgeView.placeSymbol
 * @upstream-differs a styled span the theme's tokens colour, where upstream draws its capsule so the
 * fill follows the appearance
 */
export function PartBadge({
  text,
  isTransform = false,
  title,
  className,
}: {
  readonly text: string;
  readonly isTransform?: boolean | undefined;
  /** What the pointer is told: the codec's sentence. */
  readonly title?: string | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={className === undefined ? "part-badge" : `part-badge ${className}`}
      title={title}
    >
      {isTransform ? <TransformGlyph /> : null}
      {text}
    </span>
  );
}

/** Upstream's `arrow.left.arrow.right`: the bytes went through a conversion. */
function TransformGlyph() {
  return (
    <svg
      className="part-badge-glyph"
      viewBox="0 0 12 12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 4h9M8 1.5 10.5 4 8 6.5" />
      <path d="M10.5 8h-9M4 5.5 1.5 8 4 10.5" />
    </svg>
  );
}
