import { LocalizedText } from "@/core/localization/localization";
import type { SessionId } from "@/core/session/sessionProtocol";
import type { RebuildCaution, RebuildTarget } from "@/firmware/uefi/uefiRebuild";
import { askFirmwareRebuild } from "@/state/firmwareStore";
import { isSlot, type PaneId } from "@/state/paneId";
import { editingHooks, paneShowing } from "@/state/workspaceStore";
import type { FirmwareRebuildResponse } from "@/workers/protocol";

/**
 * A part's way home when its parent is shown in another window (`Design/DESKTOP_WINDOWS.md`,
 * "Parts linked across windows"): what the link needs done where the parent is.
 *
 * The parent's bytes are the session host's, which every window reaches, so the link reads them
 * and writes them itself (`DocumentOrigin`). Two things are the holding window's: the UEFI
 * planner, which runs in the parent pane's own firmware worker, and showing the source, which is
 * that window's panes to bring forward. Both are asked over a `BroadcastChannel`, of whichever
 * window shows the parent's session.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revealOrigin
 * @upstream-differs a window asked over a channel, where upstream's link holds the parent pane
 * itself and finds the window that has it
 */

type Message =
  | {
      readonly kind: "rebuild";
      readonly ask: string;
      readonly session: SessionId;
      readonly bytes: Uint8Array;
      readonly target: RebuildTarget;
      readonly accepting: readonly RebuildCaution[];
    }
  | { readonly kind: "holding"; readonly ask: string }
  | {
      readonly kind: "progress";
      readonly ask: string;
      readonly phase: string;
      readonly fraction: number;
    }
  | {
      readonly kind: "rebuilt";
      readonly ask: string;
      readonly answer: FirmwareRebuildResponse | undefined;
    }
  | {
      readonly kind: "reveal";
      readonly session: SessionId;
      readonly range: readonly [number, number];
    }
  | {
      readonly kind: "edited";
      readonly session: SessionId;
      readonly spans: readonly (readonly [number, number])[];
    };

/** The part of a `BroadcastChannel` this uses. */
export interface ParentChannel {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

/** How long a window holding the parent has to say it does before the ask is given up. */
const HOLDER_TIMEOUT_MS = 2_000;

/**
 * What this window does for a link from another: shows `range` of `pane`, the window brought to
 * the front. The shell's, which holds the panels.
 */
export const parentLinkHost: {
  reveal?: ((pane: PaneId, range: readonly [number, number]) => void) | undefined;
} = {};

const token = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let channel: ParentChannel | undefined;

/**
 * Joins the other windows' links. Answers the means to leave. `opened` stands in for a channel in
 * a test.
 */
export function startParentLinks(
  opened: ParentChannel | undefined = typeof BroadcastChannel === "undefined"
    ? undefined
    : new BroadcastChannel("byteripper-parents")
): () => void {
  if (opened === undefined) return () => {};
  const joined = opened;
  channel = joined;
  const listener = (event: { data: unknown }) => {
    const message = event.data as Message;
    if (message.kind === "reveal") {
      const pane = paneShowing(message.session);
      if (pane !== undefined) parentLinkHost.reveal?.(pane, message.range);
      return;
    }
    if (message.kind === "edited") {
      // Told as a typed byte is: the comparison, the search and the map hold claims about them.
      const pane = paneShowing(message.session);
      if (pane === undefined || !isSlot(pane)) return;
      for (const [start, end] of message.spans) {
        editingHooks.onEdit?.(pane, { kind: "overwrite", start, end });
      }
      return;
    }
    if (message.kind !== "rebuild") return;
    const pane = paneShowing(message.session);
    if (pane === undefined) return;
    joined.postMessage({ kind: "holding", ask: message.ask });
    void askFirmwareRebuild(
      pane,
      message.bytes,
      message.target,
      (phase, fraction) =>
        joined.postMessage({ kind: "progress", ask: message.ask, phase: phase.text, fraction }),
      message.accepting
    ).then(
      (answer) => joined.postMessage({ kind: "rebuilt", ask: message.ask, answer }),
      () => joined.postMessage({ kind: "rebuilt", ask: message.ask, answer: undefined })
    );
  };
  joined.addEventListener("message", listener);
  return () => {
    joined.removeEventListener("message", listener);
    joined.close();
    if (channel === joined) channel = undefined;
  };
}

/**
 * The UEFI planner's answer for putting `bytes` back at `target` of `session`, worked out in the
 * window that shows it; nothing where no window does.
 */
export function rebuildElsewhere(
  session: SessionId,
  bytes: Uint8Array,
  target: RebuildTarget,
  onProgress: ((phase: LocalizedText, fraction: number) => void) | undefined,
  accepting: readonly RebuildCaution[]
): Promise<FirmwareRebuildResponse | undefined> {
  const line = channel;
  if (line === undefined) return Promise.resolve(undefined);
  const ask = token();
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => done(undefined),
      HOLDER_TIMEOUT_MS
    );
    const done = (answer: FirmwareRebuildResponse | undefined) => {
      clearTimeout(timer);
      line.removeEventListener("message", on);
      resolve(answer);
    };
    const on = (event: { data: unknown }) => {
      const message = event.data as Message;
      if (!("ask" in message) || message.ask !== ask) return;
      if (message.kind === "holding") {
        // Found: the planner takes as long as it takes.
        clearTimeout(timer);
        timer = undefined;
      } else if (message.kind === "progress") {
        onProgress?.(LocalizedText.verbatim(message.phase), message.fraction);
      } else if (message.kind === "rebuilt") {
        done(message.answer);
      }
    };
    line.addEventListener("message", on);
    line.postMessage({ kind: "rebuild", ask, session, bytes, target, accepting });
  });
}

/** Asks the window that shows `session` to bring it forward with `range` selected. */
export function revealElsewhere(session: SessionId, range: readonly [number, number]): void {
  channel?.postMessage({ kind: "reveal", session, range });
}

/** Tells the window that shows `session` which of its bytes a link here has written. */
export function tellEdited(
  session: SessionId,
  spans: readonly (readonly [number, number])[]
): void {
  channel?.postMessage({ kind: "edited", session, spans });
}
