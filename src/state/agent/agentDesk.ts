import { AgentToolError } from "@/core/agent/agentTool";
import type { BinaryDocument } from "@/core/document/binaryDocument";
import {
  isSlot,
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
 * a new id.
 *
 * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk
 */
export class AgentDesk {
  private readonly ids = new WeakMap<BinaryDocument, string>();
  private nextId = 1;

  /**
   * The document's id, minted the first time it is asked for: `d1`, `d2`… Short, because a model
   * writes it back on every call.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.id
   */
  id(document: BinaryDocument): string {
    const held = this.ids.get(document);
    if (held !== undefined) return held;
    const id = `d${this.nextId++}`;
    this.ids.set(document, id);
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
    return result;
  }

  private place(pane: PaneId, document: BinaryDocument, name: string, slot: AgentSlot): AgentPlace {
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
      const found = this.places().find((place) => place.id === id);
      if (found === undefined) throw new AgentToolError(noSuchDocument(id));
      return found;
    }
    const focused = this.focused();
    if (focused === undefined) throw new AgentToolError(NOTHING_OPEN);
    return focused;
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
  readonly document: BinaryDocument;
  readonly name: string;

  constructor(
    id: string,
    slot: AgentSlot,
    pane: PaneId | undefined,
    document: BinaryDocument,
    name: string
  ) {
    this.id = id;
    this.slot = slot;
    this.pane = pane;
    this.document = document;
    this.name = name;
  }

  /** @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.isOnScreen */
  get isOnScreen(): boolean {
    return this.pane !== undefined;
  }

  /**
   * The pane, for a tool that shows something; a background document is refused with the way to
   * put it on screen.
   *
   * @upstream ByteRipperApp/Agent/AgentDesk.swift#AgentDesk.Place.onScreen
   */
  onScreen(): PaneId {
    if (this.pane === undefined) {
      throw new AgentToolError(
        `${this.id} is open in the background, not on screen. Call \`show\` to open it in a tab first.`
      );
    }
    return this.pane;
  }

  /**
   * The pane, for a read that does not show anything: a document on screen and a background one
   * both have a pane, the second in no dock.
   */
  onScreenOrBackground(): PaneId {
    if (this.pane === undefined) {
      throw new AgentToolError(
        `${this.id} is open in the background, which this build reads through a pane no dock shows; it has none yet.`
      );
    }
    return this.pane;
  }

  get isPart(): boolean {
    return this.pane !== undefined && !isSlot(this.pane);
  }

  /** What the pane's state says of the document now, where it is on screen. */
  get state() {
    return this.pane === undefined ? undefined : paneState(this.pane);
  }
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
