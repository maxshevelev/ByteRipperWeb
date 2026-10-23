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
    }
  | { readonly kind: "whose"; readonly ask: string; readonly session: SessionId }
  | { readonly kind: "held"; readonly ask: string; readonly id: string }
  | { readonly kind: "linked"; readonly ask: string; readonly session: SessionId }
  | { readonly kind: "linkedCount"; readonly ask: string; readonly count: number }
  | {
      readonly kind: "openLink";
      readonly ask: string;
      readonly workspace: string;
      readonly pane: string;
      readonly request: LinkRequest;
    }
  | { readonly kind: "linkOpened"; readonly ask: string; readonly answer: LinkAnswer | undefined };

/**
 * A part's link as the workspace wrote it, asked at restore of the window its parent is in: the
 * stretch of the parent, how it was read, and what the part is called.
 */
export interface LinkRequest {
  readonly source: readonly [number, number];
  /** The codec's workspace state, as the record holds it. */
  readonly codec: string;
  readonly name: string;
}

/** The parent's answer: its session, its name, and the part's bytes decoded out of it. */
export interface LinkAnswer {
  readonly session: SessionId;
  readonly parentName: string;
  readonly bytes: Uint8Array;
}

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
  /**
   * The part a window restoring asks of this one: out of the pane this window wrote down as
   * `pane`, once it is back. The restorer's (`workspaceRestorer`).
   */
  openLink?: ((pane: string, request: LinkRequest) => Promise<LinkAnswer | undefined>) | undefined;
  /** How many panes of this window link to the session another window is closing. */
  linkedTo?: ((session: SessionId) => number) | undefined;
} = {};

/**
 * What a pane of another window is written down as in this one's record: that window's workspace
 * and the id it writes the pane under — upstream's ids are one workspace's, and here each window
 * writes its own record.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#PaneState.id
 * @upstream-differs qualified by the window's workspace, which upstream's one record needs not
 */
export const paneElsewhere = (workspace: string, pane: string): string => `${workspace}#${pane}`;

/** The window and the pane a written parent names; no window for a pane of the same record. */
export function paneNamed(id: string): { readonly workspace?: string; readonly pane: string } {
  const at = id.indexOf("#");
  return at < 0 ? { pane: id } : { workspace: id.slice(0, at), pane: id.slice(at + 1) };
}

/** What this window is in the shell's workspace; the recorder's, given once it starts. */
let thisWorkspace: (() => string) | undefined;

/** Says which workspace this window writes, so another can name its panes. */
export function nameThisWorkspace(name: () => string): void {
  thisWorkspace = name;
}

const token = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

let channel: ParentChannel | undefined;
/** The restoring windows' asks this one has taken up. */
const answering = new Set<string>();

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
    if (message.kind === "whose") {
      const pane = paneShowing(message.session);
      const workspace = thisWorkspace?.();
      if (pane === undefined || workspace === undefined) return;
      joined.postMessage({ kind: "held", ask: message.ask, id: paneElsewhere(workspace, pane) });
      return;
    }
    if (message.kind === "linked") {
      const count = parentLinkHost.linkedTo?.(message.session) ?? 0;
      if (count > 0) joined.postMessage({ kind: "linkedCount", ask: message.ask, count });
      return;
    }
    if (message.kind === "openLink") {
      const open = parentLinkHost.openLink;
      if (open === undefined || message.workspace !== thisWorkspace?.()) return;
      // The ask is sent again until it is heard: one heard already is being answered.
      if (answering.has(message.ask)) return;
      answering.add(message.ask);
      joined.postMessage({ kind: "holding", ask: message.ask });
      void open(message.pane, message.request).then(
        (answer) => joined.postMessage({ kind: "linkOpened", ask: message.ask, answer }),
        () => joined.postMessage({ kind: "linkOpened", ask: message.ask, answer: undefined })
      );
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

/** How long a question every window may answer is listened for. */
const ANSWERS_MS = 400;

/**
 * What another window writes the pane that shows `session` down as — `<workspace>#<pane>` — or
 * nothing where no window that writes its workspace shows it.
 */
export function whoseIs(session: SessionId): Promise<string | undefined> {
  const line = channel;
  if (line === undefined) return Promise.resolve(undefined);
  const ask = token();
  return new Promise((resolve) => {
    const done = (id: string | undefined) => {
      clearTimeout(timer);
      line.removeEventListener("message", on);
      resolve(id);
    };
    const on = (event: { data: unknown }) => {
      const message = event.data as Message;
      if (message.kind === "held" && message.ask === ask) done(message.id);
    };
    const timer = setTimeout(() => done(undefined), ANSWERS_MS);
    line.addEventListener("message", on);
    line.postMessage({ kind: "whose", ask, session });
  });
}

/** How many panes of the other windows link to `session`. */
export function linkedElsewhere(session: SessionId): Promise<number> {
  const line = channel;
  if (line === undefined) return Promise.resolve(0);
  const ask = token();
  return new Promise((resolve) => {
    let count = 0;
    const on = (event: { data: unknown }) => {
      const message = event.data as Message;
      if (message.kind === "linkedCount" && message.ask === ask) count += message.count;
    };
    line.addEventListener("message", on);
    line.postMessage({ kind: "linked", ask, session });
    setTimeout(() => {
      line.removeEventListener("message", on);
      resolve(count);
    }, ANSWERS_MS);
  });
}

/** How long a restoring window asks for the window its parent is in to come up. */
const OPEN_LINK_FIND_MS = 10_000;
/** How long that window then has to open the parent and decode the part. */
const OPEN_LINK_ANSWER_MS = 120_000;

/**
 * The part `request` names, out of the pane `pane` of the window that writes `workspace` — asked
 * as both restore, so asked again until that window is up to hear it. Nothing where it does not
 * come up, or its pane did not come back as the document the part was taken out of.
 */
export function openLinkElsewhere(
  workspace: string,
  pane: string,
  request: LinkRequest
): Promise<LinkAnswer | undefined> {
  const line = channel;
  if (line === undefined) return Promise.resolve(undefined);
  const ask = token();
  return new Promise((resolve) => {
    const post = () => line.postMessage({ kind: "openLink", ask, workspace, pane, request });
    let again: ReturnType<typeof setInterval> | undefined = setInterval(post, 500);
    let timer = setTimeout(() => done(undefined), OPEN_LINK_FIND_MS);
    const done = (answer: LinkAnswer | undefined) => {
      clearInterval(again);
      clearTimeout(timer);
      line.removeEventListener("message", on);
      resolve(answer);
    };
    const on = (event: { data: unknown }) => {
      const message = event.data as Message;
      if (!("ask" in message) || message.ask !== ask) return;
      if (message.kind === "holding" && again !== undefined) {
        clearInterval(again);
        again = undefined;
        clearTimeout(timer);
        timer = setTimeout(() => done(undefined), OPEN_LINK_ANSWER_MS);
      } else if (message.kind === "linkOpened") {
        done(message.answer);
      }
    };
    line.addEventListener("message", on);
    post();
  });
}
