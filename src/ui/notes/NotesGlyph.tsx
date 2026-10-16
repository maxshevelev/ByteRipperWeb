/**
 * Upstream's `heart.text.square`: the one picture of the Annotations panel, worn
 * by its pill, its header and its empty view alike.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesSymbol
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesSymbol.name
 * @upstream-differs drawn as lines on the chrome's grid, a browser having no SF Symbols
 */
export function NotesGlyph({
  className,
  size = 14,
}: {
  readonly className?: string | undefined;
  readonly size?: number;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3" />
      <path
        d="M5.4 7.7C3.9 6.8 3.6 5.8 4 5.2c.4-.6 1.1-.5 1.4.1.3-.6 1-.7 1.4-.1.4.6.1 1.6-1.4 2.5Z"
        fill="currentColor"
        strokeWidth="0.8"
      />
      <path d="M8.7 5.6h3M4.3 10.1h7.4M4.3 12h4.9" />
    </svg>
  );
}
