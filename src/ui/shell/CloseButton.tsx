/**
 * A cross that closes something: a pane, the find bar.
 *
 * Upstream's `xmark` — a glyph rather than the word, drawn as lines rather than
 * a "✕" character, so it sits on the chrome's own grid and does not change size
 * with whatever font the platform substitutes for the character.
 */
export function CloseButton({
  label,
  onClick,
}: {
  /** What the button closes, for the tooltip and a screen reader. */
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="close-button"
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <svg viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 2l6 6M8 2l-6 6" />
      </svg>
    </button>
  );
}
