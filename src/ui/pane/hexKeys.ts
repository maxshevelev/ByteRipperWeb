import { BYTES_PER_ROW } from "@/render/hexGrid/hexLayout";

/**
 * What a keystroke means in the hex grid.
 *
 * Pure: it takes the few fields of a keyboard event that matter and returns a
 * command, so every rule below is testable without a DOM. The pane does the
 * listening and the acting; this decides.
 *
 * **Modifier normalisation lives here and nowhere else** — Cmd on Apple
 * platforms, Ctrl everywhere else. Scattering that decision is how an app ends
 * up with three shortcuts that disagree about which key is the important one.
 *
 * **Home, End, Page Up and Page Down diverge from upstream, deliberately.** The
 * macOS app scrolls the viewport with them and leaves the caret where it is,
 * because that is what every Mac application does. On Windows and Linux the
 * same keys move the caret, because that is what every application there does.
 * A web app runs on all three, and following the browser's own platform is the
 * only answer that is not wrong for two thirds of its users. The Mac's
 * Cmd+arrow jumps are kept as they are, and their Ctrl equivalents work
 * elsewhere.
 */

/** The part of a keyboard event these rules read. */
export interface HexKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

export type KeyboardPlatform = "apple" | "other";

export type HexCommand =
  /** Move the caret by a signed number of bytes. */
  | { readonly kind: "moveBy"; readonly delta: number; readonly extend: boolean }
  /** Move the caret to an absolute offset. */
  | { readonly kind: "moveTo"; readonly target: CaretTarget; readonly extend: boolean }
  /** Scroll without moving the caret — the Mac's Home/End/Page behaviour. */
  | { readonly kind: "scrollByPage"; readonly down: boolean }
  | { readonly kind: "scrollTo"; readonly edge: "top" | "bottom" }
  | { readonly kind: "selectAll" }
  | { readonly kind: "goToPosition" };

/**
 * Targets the pane resolves, because they depend on the file size and the
 * viewport height — which this module deliberately does not know.
 */
export type CaretTarget = "rowStart" | "rowEnd" | "fileStart" | "fileEnd" | "pageUp" | "pageDown";

/** Whether this is an Apple keyboard layout, where the primary modifier is Cmd. */
export function detectKeyboardPlatform(platformName = navigatorPlatform()): KeyboardPlatform {
  return /mac|iphone|ipad|ipod/i.test(platformName) ? "apple" : "other";
}

function navigatorPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return data?.platform ?? navigator.platform ?? navigator.userAgent;
}

/** True when the event carries the platform's primary modifier. */
export function hasPrimaryModifier(event: HexKeyEvent, platform: KeyboardPlatform): boolean {
  return platform === "apple" ? event.metaKey : event.ctrlKey;
}

/**
 * The command a keystroke means, or `undefined` to let it through to the
 * browser — which is the right answer for everything this grid does not claim.
 */
export function resolveHexKey(
  event: HexKeyEvent,
  platform: KeyboardPlatform
): HexCommand | undefined {
  const extend = event.shiftKey;
  const primary = hasPrimaryModifier(event, platform);

  // The command palette and the menu own every other modified key, and Alt is
  // reserved for difference navigation from M3.
  if (event.altKey) return undefined;

  if (primary) {
    switch (event.key) {
      case "a":
      case "A":
        return { kind: "selectAll" };
      case "l":
      case "L":
        return { kind: "goToPosition" };
      // The Mac's caret jumps. They work elsewhere too under Ctrl, where they
      // cost nothing: Ctrl+arrow is not spoken for in a browser.
      case "ArrowLeft":
        return { kind: "moveTo", target: "rowStart", extend };
      case "ArrowRight":
        return { kind: "moveTo", target: "rowEnd", extend };
      case "ArrowUp":
      case "Home":
        return { kind: "moveTo", target: "fileStart", extend };
      case "ArrowDown":
      case "End":
        return { kind: "moveTo", target: "fileEnd", extend };
      default:
        return undefined;
    }
  }

  switch (event.key) {
    case "ArrowLeft":
      return { kind: "moveBy", delta: -1, extend };
    case "ArrowRight":
      return { kind: "moveBy", delta: 1, extend };
    case "ArrowUp":
      return { kind: "moveBy", delta: -BYTES_PER_ROW, extend };
    case "ArrowDown":
      return { kind: "moveBy", delta: BYTES_PER_ROW, extend };

    // The platform split. A Mac scrolls; everywhere else the caret moves.
    case "Home":
      return platform === "apple"
        ? { kind: "scrollTo", edge: "top" }
        : { kind: "moveTo", target: "rowStart", extend };
    case "End":
      return platform === "apple"
        ? { kind: "scrollTo", edge: "bottom" }
        : { kind: "moveTo", target: "rowEnd", extend };
    case "PageUp":
      return platform === "apple"
        ? { kind: "scrollByPage", down: false }
        : { kind: "moveTo", target: "pageUp", extend };
    case "PageDown":
      return platform === "apple"
        ? { kind: "scrollByPage", down: true }
        : { kind: "moveTo", target: "pageDown", extend };

    default:
      return undefined;
  }
}

/**
 * Where a target lands, given what only the pane knows.
 *
 * A bare caret at the end of a row sits *on* the row's last byte; a selection's
 * half-open end sits one past it. Both reveal the same byte, which is the point
 * — upstream makes the same distinction, and for the same reason.
 */
export function resolveTarget(
  target: CaretTarget,
  caret: number,
  fileSize: number,
  rowsPerPage: number,
  extend: boolean
): number {
  const rowStart = caret - (caret % BYTES_PER_ROW);
  switch (target) {
    case "rowStart":
      return rowStart;
    case "rowEnd": {
      const rowEnd = Math.min(rowStart + BYTES_PER_ROW, fileSize);
      if (extend) return rowEnd;
      return rowEnd === 0 ? 0 : rowEnd - 1;
    }
    case "fileStart":
      return 0;
    case "fileEnd":
      return fileSize;
    case "pageUp":
      return Math.max(0, caret - rowsPerPage * BYTES_PER_ROW);
    case "pageDown":
      return Math.min(fileSize, caret + rowsPerPage * BYTES_PER_ROW);
  }
}
