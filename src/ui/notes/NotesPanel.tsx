import { type KeyboardEvent, useEffect, useRef, useState } from "react";
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
  allAnnotations,
  removeAnnotations,
  updateAnnotation,
} from "@/state/agent/agentAnnotationStore";
import { agentService } from "@/state/agent/agentService";
import { askNote } from "@/state/noteFormStore";
import { useStore } from "@/state/useStore";
import { workspaceStore } from "@/state/workspaceStore";
import { DockPanelHeader } from "@/ui/fragments/DockPanelHeader";
import { HelpButton } from "@/ui/help/HelpButton";
import { AgentGlyph } from "@/ui/shell/ToolbarIcons";

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
 * arrows move between cards.
 *
 * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AgentAnnotationCards
 * @upstream ByteRipperApp/Agent/AgentAnnotationCards.swift#AnnotationCardView
 * @upstream-differs a React panel of the dock; the cards in columns of their own, where upstream
 * lays a collection view out
 */
// help: window.notes
export function NotesPanel() {
  const state = useStore(agentAnnotationStore);
  // Whether each file is open, which the cards' dots say, moves with the workspace.
  useStore(workspaceStore);
  const notes = allAnnotations(state);
  const titles = annotationTitles(notes);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | undefined>(undefined);
  const list = useRef<HTMLDivElement | null>(null);
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
  const choose = (id: string, how: "only" | "toggle" | "range") => {
    if (how === "range" && anchor.current !== undefined && ids.includes(anchor.current)) {
      const [from, to] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort((a, b) => a - b);
      setChosen(new Set(ids.slice(from, (to ?? 0) + 1)));
      return;
    }
    anchor.current = id;
    if (how === "toggle") {
      setChosen((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setChosen(new Set([id]));
    }
  };
  const show = (id: string) => void agentService.annotationTools.show(id, true);
  const remove = (doomed: ReadonlySet<string>) => {
    removeAnnotations((one) => doomed.has(one.id));
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

  /** Return goes to the selected card's place, Delete removes the selected, the arrows move. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const first = ids.find((id) => chosen.has(id));
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

  const columns = masonry(notes, notesColumns(width), reckonedHeight);
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
      <div
        className="notes-cards"
        ref={list}
        role="listbox"
        aria-label={L("Annotations")}
        aria-multiselectable
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {columns.map((column, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a column is its place
          <div key={index} className="notes-column">
            {column.map((annotation) => (
              <NoteCard
                key={annotation.id}
                annotation={annotation}
                titles={titles}
                isOpen={agentService.annotationTools.placeOf(annotation) !== undefined}
                isSelected={chosen.has(annotation.id)}
                onChoose={(how) => choose(annotation.id, how)}
                onShow={() => show(annotation.id)}
                onRemove={() => remove(new Set([annotation.id]))}
                onEdit={() => edit(annotation)}
                onRelated={(id) => choose(id, "only")}
              />
            ))}
          </div>
        ))}
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
 */
function NoteCard({
  annotation,
  titles,
  isOpen,
  isSelected,
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
      className={`note-card ${byAgent ? "is-agent" : "is-person"}${isSelected ? " is-selected" : ""}`}
      data-note={annotation.id}
      onClick={(event) =>
        onChoose(event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "only")
      }
      onDoubleClick={onShow}
    >
      <button
        type="button"
        className="note-card-remove"
        aria-label={L("Remove Annotation")}
        title={L("Remove this annotation")}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        ×
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

/** Upstream's `note.text`: what the pill and the header wear. */
export function NotesGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
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
