import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { HelpTermId } from "@/core/help/helpIds";
import { termLink } from "@/core/help/helpIds";
import { L } from "@/core/localization/localization";
import type { DetailSymbol, DetailTable, DetailTableTarget, NodeDetail } from "@/tools/toolDetail";
import { HelpButton } from "@/ui/help/HelpButton";
import { HelpTermPopover } from "@/ui/help/HelpTermPopover";
import { TintedSymbol } from "@/ui/theme/TintedSymbol";
import {
  initialPictureBackground,
  nextPictureBackground,
  type PictureBackground,
} from "@/ui/toolPanel/pictureBackground";

/**
 * A panel's detail: a title, a column of label/value rows, and the tables after
 * them — on the panel's own ground, starting at the top, and scrolling only once
 * it outgrows its box. Ported from upstream's `ToolDetailScroll` and the detail
 * half of `UEFIToolViewController`.
 *
 * Its height is the splitter's, never the content's: a detail that sized itself
 * to what it said took the tree's room from one selection to the next, and left
 * the panel a different shape every time.
 *
 * The scroll goes back to the top only when the subject changes. A panel
 * re-renders for reasons that have nothing to do with the user — a checksum
 * pass, the GUID names arriving — and resetting on those would throw a reader
 * back to the top of the detail they were part-way through.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailScroll.swift#ToolDetailScroll
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailScroll.swift#ToolDetailScroll.showPlaceholder
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailScroll.swift#ToolDetailScroll.prepareForRows
 * @upstream-differs a component: its placeholder and its scroll-to-top on a new subject are what it renders
 */
export function ToolDetail({
  subject,
  detail,
  placeholder,
  helpTerm,
  onSelectNode,
  onOutlineRange,
}: {
  /** What the rows describe — a node's path — or nothing while none is chosen. */
  readonly subject: string | undefined;
  readonly detail: NodeDetail;
  readonly placeholder: string;
  /**
   * Which glossary entry says what the row in focus *is*, where the panel knows
   * one. The `?` is drawn only for a row that has one — a file called
   * `home/bup/si_features` is not a term, and a button that opened a page about
   * files would answer a question nobody asked.
   *
   * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailScroll.swift#ToolDetailScroll.setTerm
   */
  readonly helpTerm?: HelpTermId | undefined;
  /**
   * What a click on a table row that stands for a node does: puts that node in
   * focus. Without it the rows are text only.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.tableRowClicked
   */
  readonly onSelectNode?: ((path: readonly number[]) => void) | undefined;
  /**
   * What a click on a table row that names bytes which are not one node does:
   * outlines them in the dump under the name, and leaves the focus where it is.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.onOutlineRange
   */
  readonly onOutlineRange?: ((start: number, end: number, name: string) => void) | undefined;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shownSubject = useRef<string | undefined>(undefined);
  const termButton = useRef<HTMLSpanElement | null>(null);
  const [termShown, setTermShown] = useState(false);
  const hasRows = detail.fields.length > 0;

  // The popover belongs to the row it was opened for: moving to another row
  // with it up would leave a sentence about the row that is gone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the subject changing is the whole condition
  useLayoutEffect(() => setTermShown(false), [subject, helpTerm]);

  useLayoutEffect(() => {
    if (!hasRows) {
      shownSubject.current = undefined;
      return;
    }
    if (subject === shownSubject.current) return;
    shownSubject.current = subject;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [subject, hasRows]);

  return (
    <div className="tool-detail" ref={scrollRef}>
      {!hasRows ? (
        <p className="tool-detail-placeholder">
          {detail.title.length > 0 ? detail.title : placeholder}
        </p>
      ) : (
        <div className="tool-detail-content">
          {detail.title.length === 0 ? null : (
            <h3 className="tool-detail-title">
              {detail.title}
              {/* Level with the name it explains, and scrolling with it: a
                  reader who has scrolled past the name is no longer looking at
                  the thing the button is about.
                  @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolDetailScroll.swift#ToolDetailScroll.termButton */}
              {/* help: panel.node-term */}
              {helpTerm === undefined ? null : (
                <span className="tool-detail-term" ref={termButton}>
                  <HelpButton
                    link={termLink(helpTerm)}
                    shape="inline"
                    label={L("What %1$@ is", detail.title)}
                    onOpen={() => setTermShown((shown) => !shown)}
                  />
                  {termShown ? (
                    <HelpTermPopover
                      term={helpTerm}
                      anchor={termButton.current}
                      onClose={() => setTermShown(false)}
                    />
                  ) : null}
                </span>
              )}
            </h3>
          )}
          <dl className="tool-detail-fields">
            {/* A label is the row's identity — and its place, for the node that says one
                twice: a DVAR entry's header has a Type of its own beside the common one. */}
            {detail.fields.map((one, at) => (
              <div className="tool-detail-row" key={positional(at, one.label)}>
                <dt>{one.label}</dt>
                {/*
                  One rendering for a value that carries a status, wherever it
                  is drawn: bold, in the tone's colour, and led by the tick when
                  the status is a passed check. The ME Analyzer's Summary row
                  asks the same tone for the same string, so the two cannot come
                  apart (`ToolValueTone.attributedValue`).
                */}
                <dd
                  // Digits of one width for a number, so an offset or a size
                  // reads against the dump; words stay in the body face.
                  data-mono={one.value.startsWith("0x") ? "" : undefined}
                  data-tone={one.tone === "standard" ? undefined : one.tone}
                >
                  {one.tone === "good" ? <DoneMark /> : null}
                  {one.value}
                </dd>
              </div>
            ))}
          </dl>
          {detail.tables.map((table) => (
            <DetailTableView
              key={table.title}
              table={table}
              onSelectNode={onSelectNode}
              onOutlineRange={onOutlineRange}
            />
          ))}
          {detail.picture === undefined ? null : (
            <PicturePreview bytes={detail.picture.bytes} mime={detail.picture.mime} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The picture a node is, drawn under its rows: as wide as the list at most, never
 * larger than its own pixels, in its own proportions, in a hairline frame, on a
 * ground a click changes. Bytes the browser cannot decode leave the rows as they
 * are — the fields have already said what the parser read.
 *
 * The frame and the ground are upstream's `PicturePreviewView`: a logo is often
 * white or transparent, so the frame says where the picture is whatever its
 * colours, and the ground is what lets its pixels be seen. The ground is chosen
 * by what the decoded pixels say about an alpha channel, not by the mime, and is
 * not remembered — the next picture starts from what suits it.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.addPicture
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView.background
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView.mouseDown
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView.accessibilityPerformPress
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView.resetCursorRects
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/PicturePreviewView.swift#PicturePreviewView.draw
 * @upstream-differs an `<img>` in a framed `<button>`, which the browser decodes;
 * the frame and the ground are CSS, and the button's one click answers both the
 * pointer and the keyboard's press, where upstream has a mouse event and an
 * accessibility press
 */
// help: panel.uefi.picture-preview
function PicturePreview({ bytes, mime }: { readonly bytes: Uint8Array; readonly mime: string }) {
  const [failed, setFailed] = useState(false);
  const [background, setBackground] = useState<PictureBackground | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const url = useMemo(
    () => URL.createObjectURL(new Blob([bytes.slice()], { type: mime })),
    [bytes, mime]
  );
  // A new picture is a new ground: whatever the last one was cycled to goes.
  useEffect(() => {
    setFailed(false);
    setBackground(null);
    return () => URL.revokeObjectURL(url);
  }, [url]);

  // The alpha, found by decoding rather than by the mime: a PNG without an alpha
  // channel and a JPEG both start on the panel's own, whatever the name says.
  const onImageLoad = () => {
    const img = imgRef.current;
    if (img === null || img.naturalWidth === 0 || img.naturalHeight === 0) return;
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return;
    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hasAlpha = false;
    for (let at = 3; at < pixels.length; at += 4) {
      if ((pixels[at] ?? 0) < 255) {
        hasAlpha = true;
        break;
      }
    }
    setBackground(initialPictureBackground(hasAlpha));
  };

  const cycle = () => setBackground((one) => (one === null ? one : nextPictureBackground(one)));

  if (failed) return null;
  // A button, not a div with a role: the browser's own press of a button — the
  // pointer's and the keyboard's alike — is one click, as upstream's two handlers
  // are one intent.
  return (
    <button
      type="button"
      className={
        background === null
          ? "tool-detail-picture"
          : `tool-detail-picture tool-detail-picture-${background}`
      }
      title={L("Click to change the background")}
      onClick={cycle}
    >
      <img
        ref={imgRef}
        className="tool-detail-picture-img"
        src={url}
        alt={L("Picture preview")}
        onLoad={onImageLoad}
        onError={() => setFailed(true)}
      />
    </button>
  );
}

/**
 * A table block: a glyph and a heading, a header line, and the cells — as wide
 * as what is in it, so a two-column table of short values reads as a table
 * rather than as two columns at opposite edges.
 *
 * The last column gives way when the list is narrower — cut short, whole on
 * hover — and the others keep their width: a column of numbers squeezed to one
 * letter says nothing.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.addTable
 * @upstream-differs a cap on the last column's width, where upstream's compression priority
 * makes it give way to whatever the list leaves
 */
function DetailTableView({
  table,
  onSelectNode,
  onOutlineRange,
}: {
  readonly table: DetailTable;
  readonly onSelectNode: ((path: readonly number[]) => void) | undefined;
  readonly onOutlineRange: ((start: number, end: number, name: string) => void) | undefined;
}) {
  const linkColumn = table.linkColumn ?? 1;
  /** Whether a click on this row goes anywhere here. */
  const goes = (target: DetailTableTarget | undefined): boolean =>
    target !== undefined &&
    (target.kind === "node" ? onSelectNode !== undefined : onOutlineRange !== undefined);
  return (
    <section className="tool-detail-table">
      <h4 className="tool-detail-table-title">
        <Glyph symbol={table.symbol} />
        {table.title}
      </h4>
      <table className="tool-detail-grid">
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col" className="tool-detail-grid-head">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr
              key={positional(rowIndex, "row")}
              data-target={goes(table.rowTargets?.[rowIndex]) ? "" : undefined}
              onClick={() => {
                const target = table.rowTargets?.[rowIndex];
                if (target === undefined) return;
                if (target.kind === "node") onSelectNode?.(target.path);
                else onOutlineRange?.(target.start, target.end, target.name);
              }}
              title={
                !goes(table.rowTargets?.[rowIndex])
                  ? undefined
                  : table.rowTargets?.[rowIndex]?.kind === "node"
                    ? L("Show this copy")
                    : L("Show this region in the dump")
              }
            >
              {/* By column, whose names are unique in a table. A permission is read
                  by its colour as much as by its word — a column of green with
                  one red in it answers at a glance. */}
              {table.columns.map((column, at) => {
                const one = row[at];
                return (
                  <td
                    key={column}
                    className="tool-detail-grid-cell"
                    data-tone={one === undefined || one.tone === "plain" ? undefined : one.tone}
                    data-last={at === table.columns.length - 1 ? "" : undefined}
                    data-link={at === linkColumn ? "" : undefined}
                    title={at === table.columns.length - 1 ? one?.text : undefined}
                  >
                    {one?.text ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The mark before a value that is a check that passed — upstream's `checkmark`,
 * in the text so it wraps and selects with what it marks, and in the tone's own
 * colour (`currentColor`, which the row's tone sets).
 *
 * The tick and not a filled disc: at a label's size the disc's own tick is a
 * few pixels across, and the mark then reads as a green dot on the row rather
 * than as "this checks out".
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolValueTone.swift#ToolValueTone.attributedValue
 * @upstream-differs an element in the text, where upstream attaches an image to the attributed string,
 * tinted through the one helper the app tints its symbols with
 */
export function DoneMark() {
  return (
    <TintedSymbol
      name="checkmark"
      color="currentColor"
      label={L("Done")}
      className="tool-detail-done"
    />
  );
}

/**
 * The key of something that has no identity but its place: a row rebuilt whole with
 * its table, or a label a node says twice.
 */
const positional = (index: number, what: string): string => `${index}\u0000${what}`;

/** Upstream's system symbols, drawn as the same idea in a line glyph. */
function Glyph({ symbol }: { readonly symbol: DetailSymbol }) {
  const paths: Record<DetailSymbol, string> = {
    key: "M10.5 2.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8.4 7.6 2.5 13.5M4.5 11.5l1.5 1.5M3 13l1 1",
    "lock.shield":
      "M8 1.8 13 3.6v4.2c0 3-2.1 5.2-5 6.4-2.9-1.2-5-3.4-5-6.4V3.6ZM6.2 8h3.6v2.8H6.2ZM6.8 8V6.8a1.2 1.2 0 0 1 2.4 0V8",
    number: "M2.8 2.8h10.4v10.4H2.8ZM7 5.2 6.4 10.8M10 5.2 9.4 10.8M5 6.9h6.2M4.8 9.1h6.2",
    "info.circle": "M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4ZM8 7.2v4M8 4.8v.02",
    "square.split.2x2": "M2.5 2.5h11v11h-11ZM8 2.5v11M2.5 8h11",
    "clock.arrow.circlepath": "M13.2 8a5.2 5.2 0 1 1-1.6-3.7M13.4 2.4v2.6h-2.6M8 5v3.2l2 1.2",
    "list.bullet.rectangle":
      "M2.5 2.5h11v11h-11ZM5 5.8h.8M5 8h.8M5 10.2h.8M7.6 5.8h3.6M7.6 8h3.6M7.6 10.2h3.6",
    cpu: "M4.5 4.5h7v7h-7ZM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14",
  };
  return (
    <svg className="tool-detail-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d={paths[symbol]} />
    </svg>
  );
}
