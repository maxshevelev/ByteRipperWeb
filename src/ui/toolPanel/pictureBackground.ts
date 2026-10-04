/**
 * The ground a picture preview is drawn on: the panel's own background, a
 * checkerboard, or the panel's contrast — cycled by a click on the picture.
 *
 * Ported from upstream's `PicturePreviewView`. Firmware pictures are logos,
 * and a logo is often white or transparent: on the panel's own background it
 * is not there at all, so a picture with an alpha channel starts on the
 * checkerboard, which is what shows transparency; one without starts on the
 * panel's background, which it covers anyway. The choice is not remembered —
 * the next picture starts from what suits it.
 */

/**
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView.Background
 */
export type PictureBackground = "panel" | "checkerboard" | "contrast";

/**
 * The background a picture starts on: the checkerboard when it has an alpha
 * channel, the panel's own when it does not.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView.init
 */
export const initialPictureBackground = (hasAlpha: boolean): PictureBackground =>
  hasAlpha ? "checkerboard" : "panel";

/**
 * The next background in the circle: the panel's own, the checkerboard, the
 * contrast, the panel's own.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView.cycleBackground
 *
 * @upstream-differs a pure answer the component applies, where upstream's view
 * cycles its own state and repaints
 */
export const nextPictureBackground = (one: PictureBackground): PictureBackground => {
  const order: readonly PictureBackground[] = ["panel", "checkerboard", "contrast"];
  const at = order.indexOf(one);
  return order[(at + 1) % order.length] ?? "panel";
};
