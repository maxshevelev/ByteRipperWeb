import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type AgentAnnotation,
  annotationFileName,
  annotationPath,
  annotationTitles,
} from "@/core/agent/agentAnnotation";
import {
  type CardFrame,
  type ColumnSpan,
  cardChange,
  carryTarget,
  movedTo,
  stillSettled,
} from "@/core/agent/annotationOrder";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import {
  agentAnnotationStore,
  arrangeAnnotations,
  orderedAnnotations,
  redoRemoval,
  removeFromPanel,
  selectAnnotations,
  showAnnotationCards,
  undoRemoval,
  updateAnnotation,
} from "@/state/agent/agentAnnotationStore";
import { agentService } from "@/state/agent/agentService";
import { askNote } from "@/state/noteFormStore";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";
import { DockPanelHeader } from "@/ui/fragments/DockPanelHeader";
import { HelpButton } from "@/ui/help/HelpButton";
import { NotesGlyph } from "@/ui/notes/NotesGlyph";
import { detectKeyboardPlatform, shortcutKey } from "@/ui/pane/hexKeys";
import { AgentGlyph } from "@/ui/shell/ToolbarIcons";
import { prefersReducedMotion } from "@/ui/toolPanel/cardMotion";

/**
 * How many columns the cards take: one below 640 pixels, two below 980, three above.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.columns
 */
export const notesColumns = (width: number): number => (width < 640 ? 1 : width < 980 ? 2 : 3);

/**
 * The cards put in the shortest column, in order — each card's height reckoned from its text, so
 * a long note leaves no hole beside it.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.prepare
 * @upstream-differs the height is reckoned from the text's length before the card is drawn, where
 * upstream lays one out off screen to measure it
 */
export function masonry<T>(
  items: readonly T[],
  columns: number,
  height: (item: T) => number
): T[][] {
  const lists: T[][] = Array.from({ length: Math.max(1, columns) }, () => []);
  const tops = lists.map(() => 0);
  for (const item of items) {
    let shortest = 0;
    for (let index = 1; index < tops.length; index++) {
      if ((tops[index] ?? 0) < (tops[shortest] ?? 0)) shortest = index;
    }
    lists[shortest]?.push(item);
    tops[shortest] = (tops[shortest] ?? 0) + height(item);
  }
  return lists;
}

/** A card's height as its text would make it, in lines. */
const reckonedHeight = (annotation: AgentAnnotation): number =>
  4 +
  Math.ceil(annotation.title.length / 40) +
  Math.ceil(annotation.note.length / 48) +
  annotation.relatedTo.length;

/**
 * How far the pointer goes before a press is a drag, not a click.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.dragThreshold
 */
const DRAG_THRESHOLD = 4;

/**
 * How long the cards take to move aside, and the card to settle in, in milliseconds.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.moveDuration
 */
const MOVE_MS = 250;

/** How close to the list's top or bottom edge the pointer carrying a card makes it scroll. */
const SCROLL_EDGE = 32;

/**
 * A card on its way to another place.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.Carry
 */
interface Carry {
  readonly id: string;
  /** Where the pointer took hold of it, from the card's corner. */
  readonly gripX: number;
  readonly gripY: number;
  readonly width: number;
  /** The cards' order while it is carried: its place is where it would land. */
  readonly order: readonly string[];
  /** Where the pointer was, in the list's coordinates, when the cards last moved aside. */
  readonly settledAt: { readonly x: number; readonly y: number } | undefined;
  /** Let go: the picture is settling into the place. */
  readonly landing: boolean;
}

/**
 * The cards' order while one is carried: as the carry has it, with a card made meanwhile in front
 * and one removed meanwhile gone.
 */
const orderWhileCarried = (order: readonly string[], ids: readonly string[]): string[] => {
  const present = new Set(ids);
  const known = new Set(order);
  return [...ids.filter((id) => !known.has(id)), ...order.filter((id) => present.has(id))];
};

/**
 * The Annotations panel: every annotation made on the files — by an agent or by the person — as
 * cards, in a panel of the dock beside the fragment panels.
 *
 * It is there while there is an annotation, and goes with the last one. It has no ✕: it folds
 * into its pill — by its ⌄, by Esc, by pulling its header down — and its pill counts the agent's
 * annotations made while it was out of view.
 *
 * A card, drawn as the annotation is over the dump — its author's hue, a dashed outline and a
 * light wash: the agent's picture on one the agent made, or the pencil that edits one the person
 * made, and the title; the file, after a dot filled while it is open; the place — the node it is
 * on after its parent, a link that shows it, or the addresses in a file with no firmware tree,
 * after the badges of the codecs a place in decoded bytes came through; the note whole; the
 * annotations it is about, as links to their cards. A click selects, ⌘ and ⇧ add; a double-click
 * or Return goes to the place; the ✕ in the corner removes the card, Delete the selected ones; the
 * arrows move between cards; ⌘A takes every card, ⌘Z puts back the cards last removed, where they
 * stood. The newest card comes first and wears a New tag until the panel is folded; a card is
 * dragged to another place and stays there.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationCardView
 * @upstream-differs a React panel of the dock; the cards in columns of their own, where upstream
 * lays a collection view out; the picture of a carried card is the card drawn again over the page,
 * where upstream caches the card's drawing
 */
// help: window.notes
export function NotesPanel() {
  const state = useStore(agentAnnotationStore);
  // Whether each file is open, which the cards' dots say, moves with the workspace.
  useStore(workspaceStore);
  const notes = orderedAnnotations(state);
  const titles = annotationTitles(notes);
  const chosen = state.chosen;
  const list = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  // The card being carried — in state for the drawing, in a ref for the pointer's handlers.
  const [carry, setCarryState] = useState<Carry | undefined>(undefined);
  const carrying = useRef<Carry | undefined>(undefined);
  const setCarry = (next: Carry | undefined) => {
    carrying.current = next;
    setCarryState(next);
  };
  const ghost = useRef<HTMLDivElement | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  // The cards' boxes and the columns' spans as laid out, without the motion of moving aside.
  const laidOut = useRef<{
    ids: string[];
    frames: CardFrame[];
    columns: ColumnSpan[];
  }>({ ids: [], frames: [], columns: [] });
  // Each card as the last drawing laid it out, in the list's coordinates, and its element: where
  // the cards move from when they move aside, close up or make room.
  const lastLaidOut = useRef<Map<string, { box: CardFrame; card: HTMLElement }>>(new Map());
  const lastShown = useRef<readonly string[]>([]);
  // The carried card has just taken another's place: the cards move aside for it.
  const carryMoved = useRef(false);
  // What a carry leaves behind to undo if the panel goes in the middle of it.
  const carryCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => carryCleanup.current?.(), []);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const element = list.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  const ids = notes.map((one) => one.id);

  // A card selected from outside — the offset menu, a link, an undo — is scrolled into view.
  // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.select
  useEffect(() => {
    if (state.reveal === undefined) return;
    list.current
      ?.querySelector(`[data-note="${state.reveal.id}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.reveal]);
  // A click selects, Shift-click the run from the card last clicked, Ctrl/⌘-click one card.
  // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.click
  const choose = (id: string, how: "only" | "toggle" | "range") => {
    const anchor = state.anchor;
    if (how === "range" && anchor !== undefined && ids.includes(anchor)) {
      const [from, to] = [ids.indexOf(anchor), ids.indexOf(id)].sort((a, b) => a - b);
      selectAnnotations(ids.slice(from, (to ?? 0) + 1));
    } else if (how === "only") {
      selectAnnotations([id], id);
    } else if (chosen.has(id)) {
      selectAnnotations([...chosen].filter((one) => one !== id));
    } else {
      selectAnnotations([...chosen, id], id);
    }
  };
  const show = (id: string) => void agentService.annotationTools.show(id, true);
  const remove = (doomed: ReadonlySet<string>) => removeFromPanel(doomed);
  // help: window.notes.edit
  const edit = (annotation: AgentAnnotation) =>
    askNote({
      message: L("Edit Annotation"),
      information: L("The title and the note change; the place stays."),
      button: L("Save"),
      title: annotation.title,
      note: annotation.note,
      done: (title, note) => updateAnnotation(annotation.id, title, note),
    });

  /**
   * Undo and Redo take back and make again the removals made here, not an edit of a dump. Answered
   * by the list and by the panel itself, which holds the keys once the last card is gone — the list
   * is hidden then, and a hidden element holds no focus.
   *
   * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.putBack
   * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.removeAgain
   */
  const undoKeys = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return false;
    const chord = shortcutKey(event);
    const redo = chord === "y" ? detectKeyboardPlatform() === "other" : event.shiftKey;
    if (chord !== "z" && !(chord === "y" && redo)) return false;
    event.preventDefault();
    if (chord === "z" && !redo) undoRemoval();
    else redoRemoval();
    return true;
  };

  // The last card removed with the keys in the list: the list is hidden, and the keys go to the
  // panel rather than to the page, so Undo still reaches the removal; and back to the list when
  // the cards come back, so Delete and the arrows work on them again.
  const hasNotes = notes.length > 0;
  useEffect(() => {
    const held = document.activeElement;
    if (hasNotes) {
      if (held === panel.current) list.current?.focus({ preventScroll: true });
    } else if (held === null || held === document.body || list.current?.contains(held) === true) {
      panel.current?.focus({ preventScroll: true });
    }
  }, [hasNotes]);

  /** Return goes to the selected card's place, Delete removes the selected, the arrows move. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const first = ids.find((id) => chosen.has(id));
    // Select All takes every card, not the page's text.
    // @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.selectAll
    // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.selectAll
    if ((event.metaKey || event.ctrlKey) && !event.altKey && shortcutKey(event) === "a") {
      event.preventDefault();
      selectAnnotations(ids);
      return;
    }
    if (undoKeys(event)) return;
    if (event.key === "Enter" && first !== undefined) {
      event.preventDefault();
      show(first);
    } else if ((event.key === "Delete" || event.key === "Backspace") && chosen.size > 0) {
      event.preventDefault();
      remove(chosen);
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      const next =
        ids[Math.min(ids.length - 1, (first === undefined ? -1 : ids.indexOf(first)) + 1)];
      if (next !== undefined) choose(next, event.shiftKey ? "range" : "only");
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = ids[Math.max(0, (first === undefined ? 1 : ids.indexOf(first)) - 1)];
      if (next !== undefined) choose(next, event.shiftKey ? "range" : "only");
    }
  };

  // The cards as drawn: while one is carried, in the order that has it where it would land.
  const shownIds = carry === undefined ? ids : orderWhileCarried(carry.order, ids);
  const byId = new Map(notes.map((one) => [one.id, one]));
  const shown = shownIds.flatMap((id) => byId.get(id) ?? []);
  const latestIds = useRef(ids);
  latestIds.current = ids;

  /** The picture of the carried card, its corner where the pointer holds it. */
  const placeGhost = () => {
    const held = carrying.current;
    if (ghost.current === null || held === undefined) return;
    const x = pointer.current.x - held.gripX;
    const y = pointer.current.y - held.gripY;
    ghost.current.style.transform = `translate(${x}px, ${y}px)`;
  };

  /**
   * Lifts card `id`, pressed at the pointer: its place stays, empty, and a picture of it follows
   * the pointer above the others. A card not among the selected is selected alone.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.beginCarry
   */
  const beginCarry = (id: string, card: HTMLElement, x: number, y: number) => {
    const box = card.getBoundingClientRect();
    if (!chosen.has(id)) selectAnnotations([id]);
    setCarry({
      id,
      gripX: x - box.left,
      gripY: y - box.top,
      width: box.width,
      order: latestIds.current,
      settledAt: undefined,
      landing: false,
    });
  };

  /**
   * The pointer, carrying a card, has moved: the picture follows it, and over another card the
   * carried one takes that card's place, the others moving aside.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.moveCarry
   */
  const moveCarry = () => {
    const held = carrying.current;
    const element = list.current;
    if (held === undefined || held.landing || element === null) return;
    placeGhost();
    const box = element.getBoundingClientRect();
    const x = pointer.current.x - box.left - element.clientLeft + element.scrollLeft;
    const y = pointer.current.y - box.top - element.clientTop + element.scrollTop;
    if (stillSettled(held.settledAt, x, y)) return;
    const { ids: order, frames, columns } = laidOut.current;
    const from = order.indexOf(held.id);
    if (from < 0) return;
    const to = carryTarget(frames, columns, from, x, y);
    if (to === undefined || to === from) return;
    carryMoved.current = true;
    setCarry({ ...held, order: movedTo(order, from, to), settledAt: { x, y } });
  };

  /**
   * The card is let go: it settles into its place, and the order is kept. One removed while it was
   * carried — by the agent — is let go of where it is.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.endCarry
   */
  const endCarry = () => {
    const held = carrying.current;
    if (held === undefined) return;
    const order = orderWhileCarried(held.order, latestIds.current);
    const place = list.current?.querySelector<HTMLElement>(`[data-note="${held.id}"]`);
    if (!order.includes(held.id) || place == null || ghost.current === null) {
      setCarry(undefined);
      return;
    }
    arrangeAnnotations(order);
    setCarry({ ...held, landing: true });
    const box = place.getBoundingClientRect();
    const duration = prefersReducedMotion() ? 0 : MOVE_MS;
    ghost.current.style.transition = `transform ${duration}ms ease`;
    ghost.current.style.transform = `translate(${box.left}px, ${box.top}px)`;
    const settled = window.setTimeout(() => setCarry(undefined), duration);
    carryCleanup.current = () => window.clearTimeout(settled);
  };

  /**
   * A press on a card: past the threshold it is a drag, carried until the button is let go;
   * short of it, a click, left to the card. A press with Shift or Ctrl/⌘ only selects, and one
   * on the card's ✕, pencil or link is theirs.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.dragIfDragged
   */
  const press = (id: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || selectsOnly(event) || carrying.current !== undefined) return;
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    const card = event.currentTarget;
    const start = { x: event.clientX, y: event.clientY };
    let dragged = false;
    // The pointer held still near an edge goes on scrolling.
    let scrolling: number | undefined;
    const scroll = () => {
      const element = list.current;
      if (element === null) return;
      const box = element.getBoundingClientRect();
      const { y } = pointer.current;
      const step =
        y < box.top + SCROLL_EDGE
          ? -Math.ceil((box.top + SCROLL_EDGE - y) / 2)
          : y > box.bottom - SCROLL_EDGE
            ? Math.ceil((y - box.bottom + SCROLL_EDGE) / 2)
            : 0;
      if (step === 0) return;
      element.scrollTop += step;
      moveCarry();
    };
    const move = (next: PointerEvent) => {
      pointer.current = { x: next.clientX, y: next.clientY };
      if (!dragged) {
        if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < DRAG_THRESHOLD) return;
        dragged = true;
        beginCarry(id, card, start.x, start.y);
        scrolling = window.setInterval(scroll, 50);
        return;
      }
      moveCarry();
      scroll();
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (scrolling !== undefined) window.clearInterval(scrolling);
    };
    const up = () => {
      stop();
      if (!dragged) return;
      endCarry();
      // The release ends a drag, not a click on whatever card it is over.
      const swallow = (click: Event) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    carryCleanup.current = stop;
  };

  // The picture takes its place under the pointer as soon as it is drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placed once, when a carry begins
  useLayoutEffect(placeGhost, [carry?.id]);

  // After every drawing: the boxes the pointer is tested against, read without the motion; and the
  // cards moved, as upstream moves them — aside for a carried card, up to close the gap a removed
  // one leaves, aside to make room for one put in — each sent from where it was to where it is.
  // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.show
  // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.remove
  // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.insert
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    const cards = new Map(
      [...element.querySelectorAll<HTMLElement>("[data-note]")].map((card) => [
        card.dataset.note ?? "",
        card,
      ])
    );
    // Offsets, not the boxes on screen: a card still moving is where it goes.
    const boxOf = (card: HTMLElement): CardFrame => ({
      x: card.offsetLeft,
      y: card.offsetTop,
      width: card.offsetWidth,
      height: card.offsetHeight,
    });
    const before = lastLaidOut.current;
    const now = new Map([...cards].map(([id, card]) => [id, { box: boxOf(card), card }]));
    lastLaidOut.current = now;
    const half = 6;
    laidOut.current = {
      ids: shownIds,
      frames: shownIds.map((id) => now.get(id)?.box ?? { x: 0, y: 0, width: 0, height: 0 }),
      columns: [...element.querySelectorAll<HTMLElement>(".notes-column")].map((column) => ({
        left: column.offsetLeft - half,
        right: column.offsetLeft + column.offsetWidth + half,
      })),
    };
    const shownBefore = lastShown.current;
    lastShown.current = shownIds;
    const moved = carryMoved.current;
    carryMoved.current = false;
    // Moved only when cards only went or only came, the rest standing in the order they stood; any
    // other change — an order arranged, the panel widened — lays the cards out again at once.
    const change = moved
      ? "carry"
      : carry === undefined
        ? cardChange(shownBefore, shownIds)
        : "other";
    const animate = change !== "other" && !prefersReducedMotion();
    const moving: HTMLElement[] = [];
    for (const [id, { box, card }] of now) {
      const was = before.get(id);
      if (was === undefined) {
        // A card put in shows itself in its place.
        if (animate && change === "insert") {
          card.style.transition = "none";
          card.style.opacity = "0";
          moving.push(card);
        }
        continue;
      }
      if (was.box.x === box.x && was.box.y === box.y) continue;
      if (!animate) {
        card.style.transition = "none";
        card.style.transform = "";
        continue;
      }
      // From where it is on screen: where it stood, and as far as a move still under way took it.
      const under = was.card.isConnected
        ? new DOMMatrix(getComputedStyle(was.card).transform)
        : undefined;
      const dx = was.box.x + (under?.m41 ?? 0) - box.x;
      const dy = was.box.y + (under?.m42 ?? 0) - box.y;
      card.style.transition = "none";
      card.style.transform = `translate(${dx}px, ${dy}px)`;
      moving.push(card);
    }
    // A card taken out fades where it stood, as the others close up.
    const fading: HTMLElement[] = [];
    if (animate && change === "remove") {
      for (const [id, { box, card }] of before) {
        if (now.has(id)) continue;
        const picture = card.cloneNode(true) as HTMLElement;
        picture.removeAttribute("data-note");
        picture.classList.add("note-card-leaving");
        Object.assign(picture.style, {
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          transform: "",
          transition: "none",
        });
        element.append(picture);
        fading.push(picture);
      }
    }
    if (moving.length === 0 && fading.length === 0) return;
    // The browser takes the cards where they were before they set off.
    void element.offsetWidth;
    const motion = `transform ${MOVE_MS}ms ease, opacity ${MOVE_MS}ms ease`;
    for (const card of moving) {
      card.style.transition = motion;
      card.style.transform = "";
      card.style.opacity = "";
    }
    for (const picture of fading) {
      picture.style.transition = motion;
      picture.style.opacity = "0";
      window.setTimeout(() => picture.remove(), MOVE_MS);
    }
  });

  const columns = masonry(shown, notesColumns(width), reckonedHeight);
  const carried = carry === undefined ? undefined : byId.get(carry.id);
  return (
    <section
      className="notes-panel"
      aria-label={L("Annotations")}
      ref={panel}
      tabIndex={-1}
      onKeyDown={(event) => {
        // The list answers its own keys; the panel only those that reach it directly.
        if (event.target === event.currentTarget) undoKeys(event);
      }}
    >
      <DockPanelHeader
        glyph={<NotesGlyph />}
        title={L("Annotations")}
        closeLabel=""
        onClose={undefined}
      >
        <HelpButton link={topicLink(TOPIC.notes)} shape="inline" />
      </DockPanelHeader>
      {/* What the panel shows with no annotation in it: what goes here, and how to make one,
          in the middle of the panel.
          @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesEmptyView
          @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesEmptyView.init
          @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesEmptyView.title
          @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesEmptyView.message
          @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesEmptyView.draw
          @upstream-differs the panel's own ground, where upstream fills the text background */}
      {notes.length === 0 ? (
        <div className="notes-empty">
          <NotesGlyph className="notes-empty-icon" size={48} />
          <h3>{L("No Annotations")}</h3>
          <p>
            {L(
              "Annotations made by hand or by a connected agent are listed here. Select bytes in a dump, or a node in UEFI Structure, right-click and choose Add Annotation…"
            )}
          </p>
          <HelpButton link={topicLink(TOPIC.notes)} />
        </div>
      ) : null}
      <div
        className="notes-cards"
        hidden={notes.length === 0}
        ref={list}
        role="listbox"
        aria-label={L("Annotations")}
        aria-multiselectable
        tabIndex={0}
        onKeyDown={onKeyDown}
        // A press on the ground between the cards takes the selection away, as a collection
        // view's does; with Shift or Ctrl/⌘ held it leaves it be. On the press rather than the
        // click: a card carried and let go over the ground ends in a click there.
        // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards
        // @upstream-differs NSCollectionView does it by itself; a list has to be told
        onPointerDown={(event) => {
          if (event.button !== 0 || selectsOnly(event)) return;
          if (event.target instanceof Element && event.target.closest(".note-card") !== null)
            return;
          if (chosen.size > 0) selectAnnotations([]);
        }}
      >
        {columns.map((column, index) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: a column is its place
            key={index}
            className="notes-column"
          >
            {column.map((annotation) => (
              <NoteCard
                key={annotation.id}
                annotation={annotation}
                titles={titles}
                isOpen={agentService.annotationTools.placeOf(annotation) !== undefined}
                isSelected={chosen.has(annotation.id)}
                isNew={state.marked.has(annotation.id)}
                isCarried={carry?.id === annotation.id}
                onPress={(event) => press(annotation.id, event)}
                onChoose={(how) => choose(annotation.id, how)}
                onShow={() => show(annotation.id)}
                onRemove={() => remove(new Set([annotation.id]))}
                onEdit={() => edit(annotation)}
                onRelated={(id) => showAnnotationCards([id])}
              />
            ))}
          </div>
        ))}
      </div>
      {carry !== undefined && carried !== undefined
        ? createPortal(
            <div
              ref={ghost}
              className="note-card-ghost"
              style={{ width: carry.width }}
              aria-hidden="true"
            >
              <NoteCard
                annotation={carried}
                titles={titles}
                isOpen={agentService.annotationTools.placeOf(carried) !== undefined}
                isSelected={chosen.has(carried.id)}
                isNew={state.marked.has(carried.id)}
                isCarried={false}
                onPress={() => undefined}
                onChoose={() => undefined}
                onShow={() => undefined}
                onRemove={() => undefined}
                onEdit={() => undefined}
                onRelated={() => undefined}
              />
            </div>,
            document.body
          )
        : null}
    </section>
  );
}

/** A press with Shift or Ctrl/⌘ held only selects: it lands on the card, never on what is in it. */
const selectsOnly = (event: MouseEvent): boolean =>
  event.shiftKey || event.metaKey || event.ctrlKey;

/**
 * One annotation, drawn as over the dump: its author's hue as a wash and a dashed outline — a
 * solid one while selected.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationCardView
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.content
 */
function NoteCard({
  annotation,
  titles,
  isOpen,
  isSelected,
  isNew,
  isCarried,
  onPress,
  onChoose,
  onShow,
  onRemove,
  onEdit,
  onRelated,
}: {
  readonly annotation: AgentAnnotation;
  readonly titles: ReadonlyMap<string, string>;
  readonly isOpen: boolean;
  readonly isSelected: boolean;
  /** Wears the New tag on its top edge. */
  readonly isNew: boolean;
  /**
   * Carried away: its place stays, empty.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout.emptyIndex
   */
  readonly isCarried: boolean;
  readonly onPress: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onChoose: (how: "only" | "toggle" | "range") => void;
  readonly onShow: () => void;
  readonly onRemove: () => void;
  readonly onEdit: () => void;
  readonly onRelated: (id: string) => void;
}) {
  const byAgent = annotation.author === "agent";
  // A place in decoded bytes is told in their addresses, after the badges of the codecs.
  const shown = annotation.decoded?.range ?? annotation.range;
  const hex = (value: number) => `0x${value.toString(16).toUpperCase()}`;
  const address =
    shown === undefined
      ? undefined
      : shown[1] - shown[0] <= 1
        ? hex(shown[0])
        : `${hex(shown[0])}–${hex(shown[1])}`;
  const path = annotationPath(annotation.file);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the list holds the keys
    <article
      className={`note-card ${byAgent ? "is-agent" : "is-person"}${isSelected ? " is-selected" : ""}${isCarried ? " is-carried" : ""}`}
      data-note={annotation.id}
      onPointerDown={onPress}
      onClick={(event) =>
        onChoose(event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "only")
      }
      onDoubleClick={onShow}
    >
      {/* @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationNewTag */}
      {isNew ? (
        <span className="note-card-new">{L("New", { context: "annotation tag" })}</span>
      ) : null}
      <button
        type="button"
        className="note-card-remove"
        aria-label={L("Remove Annotation")}
        title={L("Remove this annotation")}
        onClick={(event) => {
          if (selectsOnly(event)) return;
          event.stopPropagation();
          onRemove();
        }}
      >
        <RemoveGlyph />
      </button>
      <header className="note-card-head">
        {byAgent ? (
          <span className="note-card-icon" title={L("Made by the agent")}>
            <AgentGlyph connected />
          </span>
        ) : (
          <button
            type="button"
            className="note-card-icon note-card-edit"
            aria-label={L("Edit Annotation")}
            title={L("Edit this annotation")}
            onClick={(event) => {
              if (selectsOnly(event)) return;
              event.stopPropagation();
              onEdit();
            }}
          >
            <PencilGlyph />
          </button>
        )}
        <h3 className="note-card-title">{annotation.title}</h3>
      </header>
      <p
        className="note-card-file"
        title={[isOpen ? L("The file is open") : L("The file is not open"), path]
          .filter((one) => one !== undefined)
          .join("\n")}
      >
        <span className="note-card-dot">{isOpen ? "●" : "○"}</span>{" "}
        {annotationFileName(annotation.file)}
      </p>
      {annotation.site !== undefined || address !== undefined ? (
        <p className="note-card-place">
          {(annotation.decoded?.codecs ?? []).map((codec, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the codecs' order is the chain's
            <span key={index} className="pane-codec-badge">
              {codec}
            </span>
          ))}
          {annotation.site !== undefined ? (
            <button
              type="button"
              className="note-card-link"
              title={L("Show in UEFI Structure")}
              onClick={(event) => {
                if (selectsOnly(event)) return;
                event.stopPropagation();
                onShow();
              }}
            >
              {annotation.site.label}
            </button>
          ) : (
            <span className="note-card-address">{address}</span>
          )}
        </p>
      ) : null}
      {annotation.note === "" ? null : <p className="note-card-note">{annotation.note}</p>}
      {annotation.relatedTo.map((id) => (
        <button
          key={id}
          type="button"
          className="note-card-link"
          onClick={(event) => {
            if (selectsOnly(event)) return;
            event.stopPropagation();
            onRelated(id);
          }}
        >
          → {id} {titles.get(id) ?? ""}
        </button>
      ))}
    </article>
  );
}

/** Upstream's `long.text.page.and.pencil`. */
/**
 * The ✕ of a card's corner: a ring and a cross, both in the card's hue, over the panel's own
 * ground — drawn as upstream draws its badge, 20 points, a ring 1.5 wide inset by one, the cross's
 * arms 0.17 of the side, 1.8 wide, rounded.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationRemoveBadge.draw
 */
function RemoveGlyph() {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" fill="none">
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.9" />
      <path
        d="M6.6 6.6l6.8 6.8M6.6 13.4l6.8-6.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeOpacity="0.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PencilGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 13.5 3 11l7.5-7.5 2 2L5 13Z" />
      <path d="M9.5 4.5l2 2" />
    </svg>
  );
}
