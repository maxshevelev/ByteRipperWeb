/**
 * The pane's document glyph, which is also its state (upstream's
 * `FilePaneView.updateHeader`).
 *
 * Outline for a file as it is on disk, filled once it carries unsaved changes;
 * a plus badge for a document that has never been saved, following the same
 * outline/fill rule. The slot's name — File A, File B — rides on the glyph as
 * its label, so the header has room for the file's own name.
 *
 * Form as well as colour: filled against hollow survives a theme switch and
 * colour blindness, which a tint alone would not.
 */
export function DocumentIcon({
  slot,
  dirty,
  untitled,
}: {
  /** "File A" or "File B". */
  readonly slot: string;
  readonly dirty: boolean;
  /** Never on disk: a new document, a join. */
  readonly untitled: boolean;
}) {
  const state = untitled
    ? dirty
      ? "Modified new file"
      : "New file"
    : dirty
      ? "Modified file"
      : "Unmodified file";
  const label = `${slot} — ${state}`;
  return (
    <svg
      className="pane-document"
      data-dirty={dirty ? "" : undefined}
      data-untitled={untitled ? "" : undefined}
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      <path className="pane-document-page" d="M3.5 1.5h5.8l3.2 3.2v9.8h-9Z" />
      <path className="pane-document-fold" d="M9.3 1.5v3.2h3.2" />
      {untitled ? (
        <g className="pane-document-badge">
          <circle cx="11.6" cy="11.6" r="3.7" />
          <path d="M11.6 9.7v3.8M9.7 11.6h3.8" />
        </g>
      ) : null}
    </svg>
  );
}
