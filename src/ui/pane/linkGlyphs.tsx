/**
 * The two marks a part's header wears beside the name of the file it came out
 * of (`Design/UEFI/UPDATE_IN_PARENT.md` §2.2): a chain while there is a way
 * back, and a crossed octagon once there is not.
 *
 * Upstream names two SF Symbols — `link` and `xmark.octagon` — and SF Symbols
 * do not ship to a browser, so both are drawn here on the same 12×12 box, in
 * `currentColor`, so the state's colour carries them the way it carries the
 * name beside them.
 *
 * @upstream ByteRipperApp/Pane/FilePaneView.swift#FilePaneView.updateLink
 * @upstream-differs drawn shapes, where upstream names the platform's symbols
 */

/** Two links of a chain, at the angle SF Symbols draws `link` at. */
export function LinkShapes() {
  return (
    <>
      <path d="M4.6 7.4 7.4 4.6" />
      <path d="M6.2 3 7.4 1.8a2.3 2.3 0 0 1 3.3 3.3L9.4 6.4" />
      <path d="M5.8 9.6 4.6 10.8a2.3 2.3 0 0 1-3.3-3.3L2.6 6.2" />
    </>
  );
}

/** A cross in an octagon: the mark for a way back that is gone. */
export function BrokenLinkShapes() {
  return (
    <>
      <path d="M4.3 1.2h3.4L10.8 4.3v3.4L7.7 10.8H4.3L1.2 7.7V4.3z" />
      <path d="M4.4 4.4l3.2 3.2M7.6 4.4l-3.2 3.2" />
    </>
  );
}
