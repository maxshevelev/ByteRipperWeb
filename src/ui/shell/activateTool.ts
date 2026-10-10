import { activate, sessionOn, toolController } from "@/state/toolController";
import { focusToolChoice } from "@/state/toolNavigation";
import { frontSurface, type PaneId } from "@/state/workspaceStore";

/**
 * Picks a tool panel — from the Tools list, the toolbar or its key — and moves the keyboard with
 * the choice: to the panel's table when one opens, so the arrow keys walk its rows at once, and
 * back to the dump the panel read when None closes it.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.activateTool
 * @upstream-differs the panel mounts after the choice is made, so its table is asked for the
 * keyboard on the frames that follow, until it is there
 */
export function activateTool(identifier: string | undefined): void {
  const surface = frontSurface();
  const reading = sessionOn(toolController.getSnapshot(), surface).boundPane;
  activate(identifier, surface);
  const bound = sessionOn(toolController.getSnapshot(), surface).boundPane;
  if (bound !== undefined) {
    giveToPanel(bound, 0);
  } else if (reading !== undefined) {
    giveToDump(reading, 0);
  }
}

/** How many frames to wait for a panel to mount, or a dump to come back. */
const FRAMES = 20;

function giveToPanel(pane: PaneId, tried: number): void {
  if (focusToolChoice(pane) || tried >= FRAMES) return;
  requestAnimationFrame(() => giveToPanel(pane, tried + 1));
}

function giveToDump(pane: PaneId, tried: number): void {
  const dump = document.querySelector(`.hex-pane[data-pane="${pane}"] .hex-scroller`);
  if (dump instanceof HTMLElement) {
    dump.focus();
    return;
  }
  if (tried < FRAMES) requestAnimationFrame(() => giveToDump(pane, tried + 1));
}
