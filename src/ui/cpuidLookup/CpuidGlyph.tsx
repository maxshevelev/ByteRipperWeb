/**
 * The lookup's glyph — a processor, its pins on every side — which its pill and its header wear.
 *
 * @web-only upstream's lookup is a window and never reaches a dock
 */
export function CpuidGlyph({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="8" height="8" rx="1" />
      <rect x="6.5" y="6.5" width="3" height="3" rx="0.4" />
      <path d="M6 1.8V4M8 1.8V4M10 1.8V4M6 12v2.2M8 12v2.2M10 12v2.2M1.8 6H4M1.8 8H4M1.8 10H4M12 6h2.2M12 8h2.2M12 10h2.2" />
    </svg>
  );
}
