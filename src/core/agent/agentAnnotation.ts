import { L } from "@/core/localization/localization";
import type { SessionView } from "@/core/session/sessionView";

/**
 * What tells a file on disk apart from another, as far as a page can tell: its name, size and date
 * — and its full path, which the desktop shell gives for every file the person opens and for every
 * file read by path.
 *
 * @web-only upstream's `FileIdentity` is an inode and a volume, which a browser cannot see; with a
 * path on both sides the path decides, and a browser, which tells a page no path, knows a file by
 * its name, size and date, so a save there gives it a new date, and it is then another file
 */
export interface FileIdentity {
  readonly name: string;
  readonly size: number;
  /** Milliseconds since the epoch. */
  readonly modified: number;
  readonly path?: string | undefined;
}

/** Whether two identities name the same file. */
export function sameFile(one: FileIdentity, other: FileIdentity): boolean {
  if (one.path !== undefined && other.path !== undefined) return one.path === other.path;
  return (
    one.name === other.name &&
    one.size === other.size &&
    Math.abs(one.modified - other.modified) < 2
  );
}

/**
 * The file an annotation belongs to.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.File
 */
export type AnnotationFile =
  /**
   * A file on disk, found again by its identity when it is opened.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.File.url
   * @upstream-differs known by its identity — with its full path in the desktop shell, by name, size
   * and date in a browser
   */
  | { readonly kind: "disk"; readonly identity: FileIdentity }
  /**
   * A document with no file — a copy, a part of one — which the annotation lives and dies with.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#WeakDocument
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#WeakDocument.document
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#WeakDocument.holds
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#WeakDocument.init
   * @upstream-differs a `WeakRef`, compared by the document it holds
   */
  | {
      readonly kind: "document";
      readonly document: WeakRef<SessionView>;
      readonly name: string;
    }
  /**
   * A document with no file that another of the desktop shell's windows holds: named by that
   * window and the pane it is in there, which is what is asked to show it or let it go
   * (`Design/DESKTOP_WINDOWS.md`, D7c).
   *
   * @web-only upstream's windows share the document itself; a page cannot hold another's
   */
  | {
      readonly kind: "elsewhere";
      readonly window: string;
      readonly pane: string;
      readonly name: string;
    };

/**
 * A place in bytes that are not the file's own, as a fragment panel opens them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Decoded
 */
export interface AnnotationDecoded {
  /**
   * The node the panel is opened from, in the file's tree: the compressed section, or the LENV
   * block.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Decoded.holder
   */
  readonly holder: string;
  /**
   * What the panel is linked to in the file: the bytes it is decoded from.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Decoded.source
   */
  readonly source: readonly [number, number];
  /**
   * The buffer the panel shows; nothing for a LENV block, whose bytes are the block's own, decoded.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Decoded.space
   */
  readonly space: readonly number[] | undefined;
  /**
   * Half-open, in the panel's own addresses.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Decoded.range
   */
  readonly range: readonly [number, number];
  /**
   * The badges of the codecs the bytes came through, outermost first — `LZMA`, `XOR C0`.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Decoded.codecs
   */
  readonly codecs: readonly string[];
  /**
   * The key a LENV block is decoded with; nothing for a decompressed body.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Decoded.xorKey
   */
  readonly xorKey: number | undefined;
}

/**
 * What its place is called on screen: the node as UEFI Structure names it, and that node's id in
 * the file's tree.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Site
 * @upstream-differs one label for the card and for an agent, the tree's names being the parser's
 */
export interface AnnotationSite {
  /** @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Site.label */
  readonly label: string;
  /** @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Site.node */
  readonly node: string;
}

/**
 * A note about a place in a file — made by an agent (`Design/AGENT_PLAN.md`, "Annotations") or by
 * the person: what the bytes are, or what was found there.
 *
 * It belongs to the file, not to a window: it is kept while the app runs, whether the file is open
 * or not, and drawn over the bytes — a dashed outline, the note on hover — whenever the file is on
 * screen, in a pane or in a part that keeps the file's addresses. It goes when the agent or the
 * person removes it; one on a document that was never saved goes with that document.
 *
 * Its edits — a new title and note, a relation gone — are spreads where they are made
 * (`updateAnnotation`, `removeAnnotations`).
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.with
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.dropping
 */
export interface AgentAnnotation {
  /**
   * `a1`, `a2`… — one counter for the app.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.id
   */
  readonly id: string;
  /** @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.file */
  readonly file: AnnotationFile;
  /**
   * Half-open, in the file's addresses. Nothing for a place known only as a node, or only decoded.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.range
   */
  readonly range: readonly [number, number] | undefined;
  /**
   * The UEFI node the annotation is about, when it was given as one.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.node
   */
  readonly node: string | undefined;
  /**
   * A few words: what the bytes are.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.title
   */
  readonly title: string;
  /**
   * A sentence or two: why they matter, or what was found.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.note
   */
  readonly note: string;
  /**
   * Where the bytes are read decoded.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.decoded
   */
  readonly decoded: AnnotationDecoded | undefined;
  /**
   * The annotations this one is about.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.relatedTo
   */
  readonly relatedTo: readonly string[];
  /** @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.site */
  readonly site: AnnotationSite | undefined;
  /**
   * Who made it: the agent, or the person, from the dump's right-click menu.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.author
   * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.Author
   */
  readonly author: "agent" | "person";
}

/** The file's name, for the card and for a refusal. */
export function annotationFileName(file: AnnotationFile): string {
  return file.kind === "disk" ? file.identity.name : file.name;
}

/** The file's path, where it has one the page was told. */
export const annotationPath = (file: AnnotationFile): string | undefined =>
  file.kind === "disk" ? file.identity.path : undefined;

/**
 * "Related Annotations: a1 FIT pointer, a3", or "" for one about no other.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.relations
 */
export function annotationRelations(
  annotation: AgentAnnotation,
  titles: ReadonlyMap<string, string>
): string {
  if (annotation.relatedTo.length === 0) return "";
  const named = annotation.relatedTo.map((id) => {
    const title = titles.get(id);
    return title === undefined ? id : `${id} ${title}`;
  });
  return L("Related Annotations: %1$@", named.join(", "));
}

/**
 * What the callout over the bytes says: the title, the note and the annotations this one is about,
 * named by `titles` where it knows them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.hoverText
 */
export const annotationHoverText = (
  annotation: AgentAnnotation,
  titles: ReadonlyMap<string, string>
): string =>
  [annotation.title, annotation.note, annotationRelations(annotation, titles)]
    .filter((part) => part !== "")
    .join("\n");

/**
 * Each annotation's title by its id: what a relation is named by.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.titles
 */
export function annotationTitles(annotations: readonly AgentAnnotation[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const one of annotations) if (!titles.has(one.id)) titles.set(one.id, one.title);
  return titles;
}

/**
 * An annotation as a pane draws it, at the pane's own addresses.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotation.swift#AgentAnnotation.at
 */
export interface DrawnAnnotation {
  readonly annotation: AgentAnnotation;
  readonly start: number;
  readonly end: number;
}

/**
 * What was said in the note on `[start, end)` — the outline the pointer is on — and whether the
 * person said it rather than the agent, or `undefined` for none. Two notes on the same bytes draw
 * one outline; the first made is the one that speaks.
 *
 * @upstream ByteRipperApp/Pane/PaneViewModel.swift#PaneViewModel.hexAgentMarkHover
 * @upstream ByteRipperApp/Hex/HexView.swift#HexViewDataSource.hexAgentMarkHover
 */
export function drawnHover(
  drawn: readonly DrawnAnnotation[],
  start: number,
  end: number,
  titles: ReadonlyMap<string, string>
): { readonly text: string; readonly byPerson: boolean } | undefined {
  const note = drawn.find((one) => one.start === start && one.end === end);
  if (note === undefined) return undefined;
  const text = annotationHoverText(note.annotation, titles);
  return text.length === 0 ? undefined : { text, byPerson: note.annotation.author === "person" };
}
