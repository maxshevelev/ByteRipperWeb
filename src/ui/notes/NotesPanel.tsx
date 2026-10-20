import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  type AgentAnnotation,
  annotationFileName,
  annotationPath,
  annotationTitles,
} from "@/core/agent/agentAnnotation";
import { TOPIC, topicLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import {
  agentAnnotationStore,
  arrangeAnnotations,
  orderedAnnotations,
  updateAnnotation,
} from "@/state/agent/agentAnnotationStore";
import { agentService } from "@/state/agent/agentService";
import { recordStepFromNotes } from "@/state/navigationStore";
import { askNote } from "@/state/noteFormStore";
import { notesPanelStore, removeFromPanel } from "@/state/notesPanelStore";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";
import { DockPanelHeader } from "@/ui/fragments/DockPanelHeader";
import { HelpButton } from "@/ui/help/HelpButton";
import { type CardFrame, type CardLayout, carryTarget, layOutCards } from "@/ui/notes/notesLayout";
import { AgentGlyph } from "@/ui/shell/ToolbarIcons";

/**
 * A card on its way to another place: where it stands in the cards now, where the pointer took
 * hold of it, where the pointer is, and where the cards last moved aside for it.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.Carry
 */
interface Carry {
  readonly id: string;
  /** The cards' order while it is carried, first first. */
  readonly ids: readonly string[];
  /** Where the pointer took hold of it, from the card's corner. */
  readonly grip: { readonly x: number; readonly y: number };
  /** The pointer, in the list's coordinates. */
  readonly at: { readonly x: number; readonly y: number };
  /**
   * Where the pointer was when the cards last moved aside: they move again only once it has gone
   * on, or two cards of unlike heights would trade places for as long as the pointer rests between
   * them.
   */
  readonly settledAt: { readonly x: number; readonly y: number } | undefined;
  /** Let go: the card settling into its place. */
  readonly landing: boolean;
}

/**
 * How far the pointer goes before a press is a drag, not a click.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.dragThreshold
 */
const DRAG_THRESHOLD = 4;
/**
 * How long the cards take to move aside, a card to fade, and the carried card to settle in.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.moveDuration
 */
const MOVE_DURATION = 250;
/** How near the list's top or bottom edge a carried card scrolls it, and how fast. */
const SCROLL_EDGE = 24;
const SCROLL_STEP = 12;

/** A card's height before it has been measured, reckoned from its text, in pixels. */
const reckonedHeight = (annotation: AgentAnnotation, width: number): number => {
  const perLine = Math.max(20, Math.floor(width / 7));
  return (
    64 +
    18 * Math.ceil(annotation.title.length / perLine) +
    16 * Math.ceil(annotation.note.length / perLine) +
    16 * annotation.relatedTo.length
  );
};

/**
 * The Annotations panel: every annotation made on the files — by an agent or by the person — as
 * cards, in a panel of the dock beside the fragment panels.
 *
 * It is there while there is an annotation, and goes with the last one. It has no ✕: it folds
 * into its pill — by its ⌄, by Esc, by pulling its header down — and its pill counts the agent's
 * annotations made while it was out of view.
 *
 * The newest card comes first, and wears a **New** tag on its top edge until the panel goes out of
 * view. A card is dragged to another place: it lifts, follows the pointer, and the cards around it
 * move aside to make room, then it settles in and stays there. A card removed fades out while the
 * others move up to close the gap; one put back by ⌘Z fades in.
 *
 * A card, drawn as the annotation is over the dump — its author's hue, a dashed outline and a
 * light wash: the agent's picture on one the agent made, or the pencil that edits one the person
 * made, and the title; the file, after a dot filled while it is open; the place — the node it is
 * on after its parent, a link that shows it, or the addresses in a file with no firmware tree,
 * after the badges of the codecs a place in decoded bytes came through; the note whole; the
 * annotations it is about, as links to their cards. A click selects; ⇧-click selects the run from
 * the card last clicked and ⌘-click (Ctrl) adds or takes out one, and with either held a press
 * only selects. Ctrl+A or ⌘A selects every card; a double-click or Return goes to the place; the ✕
 * in the corner removes the card, Delete the selected ones, and ⌘Z puts them back; the arrows move
 * between cards.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationCardView
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationMasonryLayout
 * @upstream-differs a React panel of the dock; each card placed absolutely at the frame the layout
 * gives it and moved there by a CSS transition, where upstream lays a collection view out and
 * animates its updates
 */
// help: window.notes
export function NotesPanel() {
  const state = useStore(agentAnnotationStore);
  const panel = useStore(notesPanelStore);
  // Whether each file is open, which the cards' dots say, moves with the workspace.
  useStore(workspaceStore);
  const ordered = orderedAnnotations(state);
  const titles = annotationTitles(ordered);
  const byId = new Map(ordered.map((one) => [one.id, one]));
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(800);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [carry, setCarry] = useState<Carry | undefined>(undefined);
  const carryRef = useRef<Carry | undefined>(undefined);
  carryRef.current = carry;
  /** A press that may become a drag: the card, where it was pressed, which pointer. */
  const press = useRef<{ id: string; x: number; y: number; pointer: number } | undefined>(
    undefined
  );
  /** The click that ends a drag is no click. */
  const swallowClick = useRef(false);

  useEffect(() => {
    const element = list.current;
    if (element === null) return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    setWidth(element.clientWidth);
    return () => observer.disconnect();
  }, []);

  // The cards in the order they stand: the store's, or — while one is carried — as it is carried.
  // A card that went while it was carried takes the carry with it.
  const carriedGone = carry !== undefined && !byId.has(carry.id);
  useEffect(() => {
    if (carriedGone) setCarry(undefined);
  }, [carriedGone]);
  const rows: readonly AgentAnnotation[] =
    carry === undefined || carriedGone
      ? ordered
      : [
          ...carry.ids.flatMap((id) => {
            const one = byId.get(id);
            return one === undefined ? [] : [one];
          }),
          // A card made while one is carried goes in front, as a new card does.
          ...ordered.filter((one) => !carry.ids.includes(one.id)),
        ];
  const ids = rows.map((one) => one.id);

  const layout: CardLayout = layOutCards(rows.length, width, (index, columnWidth) => {
    const one = rows[index];
    if (one === undefined) return 0;
    return heights.get(one.id) ?? reckonedHeight(one, columnWidth);
  });
  const frameOf = new Map<string, CardFrame>();
  rows.forEach((one, index) => {
    const frame = layout.frames[index];
    if (frame !== undefined) frameOf.set(one.id, frame);
  });

  // Each card's height at the width it is drawn at, measured as it is laid out.
  const observed = useRef(new Map<string, HTMLElement>());
  const sizer = useRef<ResizeObserver | undefined>(undefined);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      setHeights((current) => {
        let next: Map<string, number> | undefined;
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.note;
          const height = (entry.target as HTMLElement).offsetHeight;
          if (id === undefined || current.get(id) === height) continue;
          next ??= new Map(current);
          next.set(id, height);
        }
        return next ?? current;
      });
    });
    sizer.current = observer;
    for (const element of observed.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // One callback per card, kept, so React hands each card's element over once rather than on
  // every render.
  const measurers = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const measure = (id: string) => {
    let made = measurers.current.get(id);
    if (made === undefined) {
      made = (element: HTMLElement | null) => {
        const held = observed.current.get(id);
        if (held === element) return;
        if (held !== undefined) sizer.current?.unobserve(held);
        if (element === null) {
          observed.current.delete(id);
          return;
        }
        observed.current.set(id, element);
        sizer.current?.observe(element);
      };
      measurers.current.set(id, made);
    }
    return made;
  };

  // Cards removed fade out where they stood while the rest move up; cards that arrive — a removal
  // undone, a new note — fade in. Nothing fades as the panel first comes up.
  const shown = useRef<
    { readonly ids: ReadonlySet<string>; readonly frames: Map<string, CardFrame> } | undefined
  >(undefined);
  const [leaving, setLeaving] = useState<
    readonly { annotation: AgentAnnotation; frame: CardFrame }[]
  >([]);
  const [arriving, setArriving] = useState<ReadonlySet<string>>(new Set());
  const lastAnnotations = useRef(new Map<string, AgentAnnotation>());
  useLayoutEffect(() => {
    const now = new Set(ids);
    const before = shown.current;
    if (before !== undefined) {
      const gone = [...before.ids].filter((id) => !now.has(id));
      const came = ids.filter((id) => !before.ids.has(id));
      if (gone.length > 0) {
        setLeaving((current) => [
          ...current,
          ...gone.flatMap((id) => {
            const annotation = lastAnnotations.current.get(id);
            const frame = before.frames.get(id);
            return annotation === undefined || frame === undefined ? [] : [{ annotation, frame }];
          }),
        ]);
        window.setTimeout(
          () => setLeaving((current) => current.filter((one) => !gone.includes(one.annotation.id))),
          MOVE_DURATION
        );
      }
      if (came.length > 0) {
        setArriving((current) => new Set([...current, ...came]));
        window.setTimeout(
          () => setArriving((current) => new Set([...current].filter((id) => !came.includes(id)))),
          MOVE_DURATION
        );
      }
    }
    shown.current = { ids: now, frames: frameOf };
    lastAnnotations.current = new Map(rows.map((one) => [one.id, one]));
  });

  // The selection stays with the cards it was on.
  useEffect(() => {
    const present = new Set(ordered.map((one) => one.id));
    if ([...chosen].some((id) => !present.has(id))) {
      setChosen(new Set([...chosen].filter((id) => present.has(id))));
    }
  });

  // Asked from outside the panel — a removal undone, the offset menu's Open Annotation: those
  // cards selected, and the first brought on screen.
  // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.select
  const asked = panel.select?.serial;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ask's serial is the whole condition
  useEffect(() => {
    const wanted = panel.select?.ids;
    if (wanted === undefined || wanted.length === 0) return;
    setChosen(new Set(wanted));
    anchor.current = wanted[0];
    list.current?.focus({ preventScroll: true });
    const first = wanted
      .map((id) => frameOf.get(id))
      .filter((frame) => frame !== undefined)
      .sort((left, right) => left.y - right.y)[0];
    if (first !== undefined) {
      list.current?.scrollTo({ top: Math.max(0, first.y - 12), behavior: "smooth" });
    }
  }, [asked]);

  /**
   * A click on card `id`: on its own, it alone; with ⇧, the cards from the one last clicked to
   * this one, in the cards' order; with ⌘ or Ctrl, this one added to the selection, or taken out.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.click
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.anchor
   */
  const choose = (id: string, how: "only" | "toggle" | "range") => {
    if (how === "range" && anchor.current !== undefined && ids.includes(anchor.current)) {
      const [from, to] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((a, b) => a - b);
      setChosen(new Set(ids.slice(from, (to ?? 0) + 1)));
      return;
    }
    if (how === "toggle") {
      setChosen((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
          anchor.current = id;
        }
        return next;
      });
      return;
    }
    anchor.current = id;
    setChosen(new Set([id]));
  };
  /**
   * A card's place gone to — a step out of the panel: Back in the dump comes here again.
   *
   * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.show
   */
  const show = (id: string) =>
    void agentService.annotationTools.show(id, true).then(() => recordStepFromNotes());
  const remove = (doomed: ReadonlySet<string>) => {
    removeFromPanel(doomed);
    setChosen(new Set());
  };
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
   * Return goes to the selected card's place, Delete removes the selected, the arrows move, and
   * Ctrl+A or ⌘A selects every card.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.selectAll
   * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.selectAll
   */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const first = ids.find((id) => chosen.has(id));
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      setChosen(new Set(ids));
    } else if (event.key === "Enter" && first !== undefined) {
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

  /** The pointer, in the list's own coordinates — its scroll included. */
  const pointIn = (clientX: number, clientY: number) => {
    const element = list.current;
    if (element === null) return { x: clientX, y: clientY };
    const box = element.getBoundingClientRect();
    return { x: clientX - box.left + element.scrollLeft, y: clientY - box.top + element.scrollTop };
  };

  /**
   * Lifts card `id`, held at `point`: its place stays, empty, and the card follows the pointer
   * above the others.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.beginCarry
   */
  const beginCarry = (id: string, point: { x: number; y: number }) => {
    const frame = frameOf.get(id);
    if (frame === undefined) return;
    if (!chosen.has(id)) {
      anchor.current = id;
      setChosen(new Set([id]));
    }
    setCarry({
      id,
      ids,
      grip: { x: point.x - frame.x, y: point.y - frame.y },
      at: point,
      settledAt: undefined,
      landing: false,
    });
  };

  /**
   * The pointer, carrying a card, is at `point`: the card follows it, and over another card the
   * carried one takes that card's place, the others moving aside.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.moveCarry
   */
  const moveCarry = (point: { x: number; y: number }) => {
    const carried = carryRef.current;
    if (carried === undefined || carried.landing) return;
    const settled = carried.settledAt;
    if (settled !== undefined && Math.hypot(point.x - settled.x, point.y - settled.y) < 8) {
      setCarry({ ...carried, at: point });
      return;
    }
    const index = carried.ids.indexOf(carried.id);
    const target = carryTarget(layout, point, index);
    if (target === undefined || target === index) {
      setCarry({ ...carried, at: point });
      return;
    }
    const moved = carried.ids.filter((one) => one !== carried.id);
    moved.splice(target, 0, carried.id);
    setCarry({ ...carried, ids: moved, at: point, settledAt: point });
  };

  /**
   * The card is let go: it settles into its place, and the order is kept.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.endCarry
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.onArrange
   */
  const endCarry = () => {
    const carried = carryRef.current;
    if (carried === undefined || carried.landing) return;
    arrangeAnnotations(carried.ids);
    setCarry({ ...carried, landing: true });
    window.setTimeout(() => setCarry(undefined), MOVE_DURATION);
  };

  // While a card is carried, the pointer is followed everywhere, and a pointer held still near the
  // list's top or bottom edge goes on scrolling it.
  // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.isCarrying
  const carrying = carry !== undefined && !carry.landing;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the carry's handlers read its ref
  useEffect(() => {
    if (!carrying) return;
    let last = { x: 0, y: 0 };
    const onMove = (event: globalThis.PointerEvent) => {
      last = { x: event.clientX, y: event.clientY };
      moveCarry(pointIn(event.clientX, event.clientY));
    };
    const onUp = () => endCarry();
    let frame = 0;
    const scroll = () => {
      const element = list.current;
      if (element !== null) {
        const box = element.getBoundingClientRect();
        const step =
          last.y < box.top + SCROLL_EDGE
            ? -SCROLL_STEP
            : last.y > box.bottom - SCROLL_EDGE
              ? SCROLL_STEP
              : 0;
        if (step !== 0 && last.y !== 0) {
          element.scrollTop += step;
          moveCarry(pointIn(last.x, last.y));
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [carrying]);

  /**
   * A press on card `id`: a drag once the pointer has gone far enough, otherwise a click for the
   * card to select by. With ⌘, Ctrl or ⇧ held it only selects, and never drags.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.dragIfDragged
   */
  const onCardPointerDown = (id: string, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    press.current = { id, x: event.clientX, y: event.clientY, pointer: event.pointerId };
  };
  const onListPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pressed = press.current;
    if (pressed === undefined || carryRef.current !== undefined) return;
    if (event.pointerId !== pressed.pointer || (event.buttons & 1) === 0) {
      press.current = undefined;
      return;
    }
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < DRAG_THRESHOLD) return;
    press.current = undefined;
    swallowClick.current = true;
    beginCarry(pressed.id, pointIn(pressed.x, pressed.y));
  };

  /**
   * A click on a card. With ⌘, Ctrl or ⇧ held the press lands on the card, never on the node's
   * link, a relation, the pencil or the ✕: caught on the way down, before any of them hears it.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationCardView.target
   * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationCardView.onSelectClick
   */
  const onCardClickCapture = (id: string, event: MouseEvent<HTMLElement>) => {
    if (swallowClick.current) {
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!(event.shiftKey || event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    choose(id, event.shiftKey ? "range" : "toggle");
    list.current?.focus({ preventScroll: true });
  };

  const carriedFrame = carry === undefined ? undefined : frameOf.get(carry.id);
  return (
    <section className="notes-panel" aria-label={L("Annotations")}>
      <DockPanelHeader
        glyph={<NotesGlyph />}
        title={L("Annotations")}
        closeLabel=""
        onClose={undefined}
      >
        <HelpButton link={topicLink(TOPIC.notes)} shape="inline" />
      </DockPanelHeader>
      {ordered.length === 0 && leaving.length === 0 ? <NotesEmpty /> : null}
      <div
        hidden={ordered.length === 0 && leaving.length === 0}
        className="notes-cards"
        ref={list}
        role="listbox"
        aria-label={L("Annotations")}
        aria-multiselectable
        tabIndex={0}
        data-carrying={carrying ? "" : undefined}
        onKeyDown={onKeyDown}
        onPointerMove={onListPointerMove}
        onPointerUp={() => {
          press.current = undefined;
        }}
      >
        <div className="notes-cards-content" style={{ height: layout.contentHeight }}>
          {leaving.map(({ annotation, frame }) => (
            <NoteCard
              key={`leaving-${annotation.id}`}
              annotation={annotation}
              titles={titles}
              frame={frame}
              motion="leaving"
              isOpen={false}
              isSelected={false}
              isNew={false}
            />
          ))}
          {rows.map((annotation) => {
            const frame = frameOf.get(annotation.id);
            if (frame === undefined) return null;
            const isCarried = carry?.id === annotation.id;
            return (
              <NoteCard
                key={annotation.id}
                annotation={annotation}
                titles={titles}
                frame={frame}
                measure={measure(annotation.id)}
                motion={isCarried ? "empty" : arriving.has(annotation.id) ? "arriving" : undefined}
                isOpen={agentService.annotationTools.placeOf(annotation) !== undefined}
                isSelected={chosen.has(annotation.id)}
                isNew={panel.newIds.has(annotation.id)}
                onPointerDown={(event) => onCardPointerDown(annotation.id, event)}
                onClickCapture={(event) => onCardClickCapture(annotation.id, event)}
                onChoose={() => {
                  choose(annotation.id, "only");
                  list.current?.focus({ preventScroll: true });
                }}
                onShow={() => show(annotation.id)}
                onRemove={() => remove(new Set([annotation.id]))}
                onEdit={() => edit(annotation)}
                onRelated={(id) => choose(id, "only")}
              />
            );
          })}
          {carry !== undefined && carriedFrame !== undefined && byId.has(carry.id) ? (
            <NoteCard
              key={`carried-${carry.id}`}
              annotation={byId.get(carry.id) as AgentAnnotation}
              titles={titles}
              frame={
                carry.landing
                  ? carriedFrame
                  : {
                      ...carriedFrame,
                      x: carry.at.x - carry.grip.x,
                      y: carry.at.y - carry.grip.y,
                    }
              }
              motion={carry.landing ? "landing" : "carried"}
              isOpen={false}
              isSelected
              isNew={panel.newIds.has(carry.id)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * One annotation, drawn as over the dump: its author's hue as a wash and a dashed outline — a
 * solid one while selected.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationCardView
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.content
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards.configure
 */
function NoteCard({
  annotation,
  titles,
  frame,
  measure,
  motion,
  isOpen,
  isSelected,
  isNew,
  onPointerDown,
  onClickCapture,
  onChoose,
  onShow,
  onRemove,
  onEdit,
  onRelated,
}: {
  readonly annotation: AgentAnnotation;
  readonly titles: ReadonlyMap<string, string>;
  readonly frame: CardFrame;
  readonly measure?: ((element: HTMLElement | null) => void) | undefined;
  /**
   * How the card moves: fading out where it stood, fading in, its place left empty while it is
   * carried, carried with the pointer, or settling into its place.
   */
  readonly motion?: "leaving" | "arriving" | "empty" | "carried" | "landing" | undefined;
  readonly isOpen: boolean;
  readonly isSelected: boolean;
  readonly isNew: boolean;
  readonly onPointerDown?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  readonly onClickCapture?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  readonly onChoose?: (() => void) | undefined;
  readonly onShow?: (() => void) | undefined;
  readonly onRemove?: (() => void) | undefined;
  readonly onEdit?: (() => void) | undefined;
  readonly onRelated?: ((id: string) => void) | undefined;
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
  const live = motion === undefined || motion === "arriving";
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: the list holds the keys
    <article
      ref={measure}
      className={`note-card ${byAgent ? "is-agent" : "is-person"}${isSelected ? " is-selected" : ""}`}
      data-note={live ? annotation.id : undefined}
      data-motion={motion}
      style={{ width: frame.width, transform: `translate(${frame.x}px, ${frame.y}px)` }}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onClick={onChoose}
      onDoubleClick={(event) => {
        if (event.shiftKey || event.metaKey || event.ctrlKey) return;
        onShow?.();
      }}
    >
      {isNew ? (
        // On the top edge, half out of the card, as the ✕ stands out of its corner.
        // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationNewTag
        // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationNewTag.text
        // @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationNewTag.hue
        <span className="note-card-new">{L("New", { context: "annotation tag" })}</span>
      ) : null}
      <button
        type="button"
        className="note-card-remove"
        aria-label={L("Remove Annotation")}
        title={L("Remove this annotation")}
        onClick={(event) => {
          event.stopPropagation();
          onRemove?.();
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
              event.stopPropagation();
              onEdit?.();
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
                event.stopPropagation();
                onShow?.();
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
            event.stopPropagation();
            onRelated?.(id);
          }}
        >
          → {id} {titles.get(id) ?? ""}
        </button>
      ))}
    </article>
  );
}

/**
 * What the panel shows with no annotation in it — after the last cards were removed here, while ⌘Z
 * can put them back: what goes here, and how to make one.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesEmptyView
 */
function NotesEmpty() {
  return (
    <div className="notes-empty">
      <span className="notes-empty-icon">
        <NotesGlyph size={48} />
      </span>
      <p className="notes-empty-title">{L("No Annotations")}</p>
      <p className="notes-empty-message">
        {L(
          "Annotations made by hand or by a connected agent are listed here. Select bytes in a dump, or a node in UEFI Structure, right-click and choose Add Annotation…"
        )}
      </p>
    </div>
  );
}

/** Upstream's `note.text`: what the pill and the header wear. */
export function NotesGlyph({ size = 14 }: { readonly size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <path d="M3 1.5h10v13H3Z" />
      <path d="M5.5 5h5M5.5 8h5M5.5 11h3" />
    </svg>
  );
}

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

/** Upstream's `long.text.page.and.pencil`. */
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
