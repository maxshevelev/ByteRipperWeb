import { baseName } from "@/core/agent/agentSurvey";
import { AgentToolError } from "@/core/agent/agentTool";
import type { SessionView } from "@/core/session/sessionView";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { operate } from "@/platform/sessions/sessionOperations";
import { AgentBackgroundDocuments } from "@/state/agent/agentBackgroundDocuments";
import { onSessionClosed } from "@/state/sessions/pageSessions";
import {
  type PaneId,
  type PartId,
  paneInFront,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * The open documents as the agent service sees them: which there are, what each is called to an
 * agent, and which one the reader is in (`Design/PORT_AGENT.md`).
 *
 * Asked, never stored: every answer is read from the workspace at the moment of the question, so
 * a file closed a second ago cannot be described as open. The one thing kept is the short id each
 * document is given the first time an agent sees it — held weakly against the document, so it
 * goes when the document does, and a file opened into the same pane later is a new document with
 * a new id. The name is the session's, held by the host, so it is the same in every window.
 *
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk
 */
export class AgentDesk {
  /** The names this window gave, by session, until the host's word on them arrives. */
  private readonly ids = new Map<string, string>();
  private nextId = 1;
  /**
   * The files an agent opened by path, with no window. Their ids are the entry's, not the
   * document's: a file read again after a change on disk is a new document under the same id.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.background
   */
  readonly background: AgentBackgroundDocuments;
  /**
   * The background files let go to stay inside the bounds: the agent still holds their ids, and
   * naming one reads the file again. By id, the path each let-go one was.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.released
   */
  private readonly released = new Map<string, string>();
  /**
   * A let-go id the file answers under another id now: the agent opened the same path again
   * meanwhile, or the file is open in the window.
   *
   * @web-only upstream's lookup reads the file again inside itself and hands back that place; the
   * page's read is a wait, done before the tool runs (`revive`), so the place it found is noted here
   */
  private readonly standIns = new Map<string, string>();
  private readonly bridge: () => AgentBridge | undefined;

  constructor(bridge: () => AgentBridge | undefined = () => undefined) {
    this.bridge = bridge;
    this.background = new AgentBackgroundDocuments(bridge, () => this.mint());
    onSessionClosed((session) => this.ids.delete(session));
    this.background.onRelease = (entry) => {
      this.released.set(entry.id, entry.path);
    };
  }

  /**
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.mint
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.nextID
   * @upstream-differs in the desktop shell the number comes from the main process, one counter for
   * every window, so an id names the document in the app and so the window holding it (D7d)
   */
  private mint(): string {
    const shared = this.bridge()?.mint?.();
    if (shared !== undefined && shared > 0) return `d${shared}`;
    const id = `d${this.nextId}`;
    this.nextId += 1;
    return id;
  }

  /**
   * The document's id, minted the first time it is asked for: `d1`, `d2`… Short, because a model
   * writes it back on every call.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.id
   */
  id(document: SessionView): string {
    // The session's own name first: a document carried to another window is the same session,
    // and goes on under the name it had (`Design/FILE_SESSIONS.md`, S9).
    const named = document.agentId ?? this.ids.get(document.id);
    if (named !== undefined) return named;
    const id = this.mint();
    this.ids.set(document.id, id);
    void operate(document, "agentName", id)
      .then((agreed) => {
        if (agreed !== id) this.ids.set(document.id, agreed);
      })
      .catch(() => undefined);
    return id;
  }

  /**
   * Every open document: the workspace's two panes, then the parts in the dock.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.places
   */
  places(): AgentPlace[] {
    const state = workspaceStore.getSnapshot();
    const result: AgentPlace[] = [];
    for (const [pane, slot] of [
      ["a", "A"],
      ["b", "B"],
    ] as const) {
      const held = state.panes[pane];
      if (held !== undefined) result.push(this.place(pane, held.document, held.name, slot));
    }
    for (const panel of state.dock.panels) {
      const pane: PartId = `part:${panel}`;
      const held = state.parts[pane];
      if (held !== undefined) result.push(this.place(pane, held.document, held.name, "part"));
    }
    for (const entry of this.background.entries) {
      const held = state.parts[entry.pane];
      if (held === undefined) continue;
      const place = new AgentPlace(entry.id, "background", entry.pane, held.document, held.name);
      place.path = entry.path;
      result.push(place);
    }
    return labelled(result);
  }

  private place(pane: PaneId, document: SessionView, name: string, slot: AgentSlot): AgentPlace {
    return new AgentPlace(this.id(document), slot, pane, document, name);
  }

  /**
   * The document the reader is in: the pane in front — a part's panel when one is up, as every
   * command aimed at "the active pane" takes it.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.focused
   */
  focused(): AgentPlace | undefined {
    const pane = paneInFront();
    return this.places().find((place) => place.pane === pane);
  }

  /**
   * The document an agent named, or the focused one when it named none.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.place
   */
  placeNamed(id: string | undefined): AgentPlace {
    if (id !== undefined) {
      const places = this.places();
      const standIn = this.standIns.get(id);
      const found =
        places.find((place) => place.id === id) ??
        (standIn === undefined ? undefined : places.find((place) => place.id === standIn));
      if (found === undefined) throw new AgentToolError(noSuchDocument(id));
      return found;
    }
    const focused = this.focused();
    if (focused === undefined) throw new AgentToolError(NOTHING_OPEN);
    return focused;
  }

  /**
   * A background document let go to stay inside the bounds, read again under the id it had — or
   * found under the one it has now, when the agent opened the same path again meanwhile or the file
   * is open in the window. Nothing when the id was never one, is open now, or the file can no longer
   * be read; `placeNamed` then refuses it as it would any other.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.reopened
   * @upstream-differs a wait before the tool runs, reading the file being one, where upstream reads
   * it inside the lookup
   */
  async revive(id: string): Promise<void> {
    const path = this.released.get(id);
    if (path === undefined) return;
    const places = this.places();
    if (places.some((place) => place.id === id)) return;
    const standIn = this.standIns.get(id);
    if (standIn !== undefined && places.some((place) => place.id === standIn)) return;
    const bridge = this.bridge();
    if (bridge === undefined) return;
    try {
      const stat = await bridge.file({ op: "stat", path });
      const onScreen = this.onScreenPlaceOf(stat.path, stat);
      if (onScreen !== undefined) {
        this.standIns.set(id, onScreen.id);
        return;
      }
      const entry = await this.background.open(path, id);
      if (entry.id === id) {
        this.released.delete(id);
        this.standIns.delete(id);
      } else {
        this.standIns.set(id, entry.id);
      }
    } catch {
      // A file that can no longer be read is no document: the call names an id nothing answers to.
    }
  }

  /**
   * The on-screen place holding the file at `path`, if the window has it open: the same name,
   * size and date, which is what a page can tell of a file it was handed.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.onScreenPlace
   * @upstream-differs a file the page opens has no path of its own, so the file the shell stat gave is matched by its name, size and date
   */
  onScreenPlaceOf(path: string, stat: { size: number; modified: number }): AgentPlace | undefined {
    return this.places().find((place) => {
      const held = place.state;
      return (
        place.isOnScreen &&
        held !== undefined &&
        !held.untitled &&
        held.file.name === baseName(path) &&
        held.file.size === stat.size &&
        Math.abs(held.file.lastModified - stat.modified) < 2
      );
    });
  }

  /** The place of a pane, if its document is open. */
  placeOf(pane: PaneId): AgentPlace | undefined {
    return this.places().find((place) => place.pane === pane);
  }
}

/**
 * "A" or "B" for one of the workspace's own panes, "part" for a fragment panel, "background" for
 * a file opened by path with no window.
 */
export type AgentSlot = "A" | "B" | "part" | "background";

/**
 * One open document: the pane it is in — none for a background document.
 *
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.id
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.pane
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.slot
 */
export class AgentPlace {
  readonly id: string;
  readonly slot: AgentSlot;
  /** The pane that holds it; none for a background document. */
  readonly pane: PaneId | undefined;
  readonly document: SessionView;
  readonly name: string;
  /**
   * What to call it to the person (`labelled`): the file's name, told apart from another of the
   * same name. Ids are for tools.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.label
   */
  label = "";
  /** The file's path, where it has one the page was told: a file an agent opened by path. */
  path: string | undefined;

  constructor(
    id: string,
    slot: AgentSlot,
    pane: PaneId | undefined,
    document: SessionView,
    name: string
  ) {
    this.id = id;
    this.slot = slot;
    this.pane = pane;
    this.document = document;
    this.name = name;
  }

  /**
   * The label with the id, for a sentence the agent reads: it names the document to the person by
   * the first and to a tool by the second.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.named
   */
  get named(): string {
    return this.label === "" || this.label === this.id ? this.id : `${this.label} (${this.id})`;
  }

  /** @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.isOnScreen */
  get isOnScreen(): boolean {
    return this.pane !== undefined && this.slot !== "background";
  }

  /**
   * The pane, for a tool that shows something; a background document is refused with the way to
   * put it on screen.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.onScreen
   */
  onScreen(): PaneId {
    if (this.pane === undefined || this.slot === "background") {
      throw new AgentToolError(
        `${this.named} is open in the background, not on screen. Call \`show\` to put it on screen first.`
      );
    }
    return this.pane;
  }

  /**
   * The pane, for a read that does not show anything: a document on screen and a background one
   * both have a pane, the second in no dock.
   */
  onScreenOrBackground(): PaneId {
    if (this.pane === undefined) throw new AgentToolError(noSuchDocument(this.id));
    return this.pane;
  }

  get isPart(): boolean {
    return this.slot === "part";
  }

  /** What the pane's state says of the document now, where it is on screen. */
  get state() {
    return this.pane === undefined ? undefined : paneState(this.pane);
  }
}

/**
 * Each place with what to call it to the person: the file's name — a part's own name — and, where
 * another open document has the same name, what tells them apart: the folder, when they are
 * different files; the pane, or "not on screen", when they are one file open twice.
 *
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.labelled
 * @upstream-differs no tab to name, the web having one workspace per tab; and only a file an
 * agent opened by path has a folder to tell it apart by, a page never being told the path of a
 * file it opens
 */
export function labelled(places: AgentPlace[]): AgentPlace[] {
  for (const [index, place] of places.entries()) {
    const twins = places.filter((other, at) => at !== index && other.name === place.name);
    if (twins.length === 0) {
      place.label = place.name;
      continue;
    }
    const path = place.path;
    const samePath = twins.some((other) => other.path !== undefined && other.path === path);
    const others = twins.every((other) => other.path !== undefined);
    if (path !== undefined && others && !samePath) {
      place.label = `${folderName(path)}/${place.name}`;
    } else if (place.isOnScreen) {
      place.label = `${place.name}, ${place.slot}`;
    } else {
      place.label = `${place.name}, not on screen`;
    }
  }
  return places;
}

/** The last folder of a path, either separator. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? "") : "";
}

/**
 * Why a document could not be found, worded for the model reading it.
 *
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDeskError
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDeskError.description
 */
export const noSuchDocument = (id: string): string =>
  `No open document has the id ${id}. Call \`documents\` for the ones that are open.`;
export const NOTHING_OPEN = "No file is open in ByteRipper.";
