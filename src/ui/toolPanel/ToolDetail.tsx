import { useLayoutEffect, useRef } from "react";
import type { DetailSymbol, DetailTable, NodeDetail } from "@/tools/toolDetail";

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
}: {
  /** What the rows describe — a node's path — or nothing while none is chosen. */
  readonly subject: string | undefined;
  readonly detail: NodeDetail;
  readonly placeholder: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shownSubject = useRef<string | undefined>(undefined);
  const hasRows = detail.fields.length > 0;

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
          {detail.title.length === 0 ? null : <h3 className="tool-detail-title">{detail.title}</h3>}
          <dl className="tool-detail-fields">
            {/* A label is said once per node, so it is the row's identity. */}
            {detail.fields.map((one) => (
              <div className="tool-detail-row" key={one.label}>
                <dt>{one.label}</dt>
                <dd
                  // Digits of one width for a number, so an offset or a size
                  // reads against the dump; words stay in the body face.
                  data-mono={one.value.startsWith("0x") ? "" : undefined}
                  data-problem={one.isProblem ? "" : undefined}
                >
                  {one.isDone === true ? <DoneMark /> : null}
                  {one.value}
                </dd>
              </div>
            ))}
          </dl>
          {detail.tables.map((table) => (
            <DetailTableView key={table.title} table={table} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A table block: a glyph and a heading, a header line, and the cells — as wide
 * as what is in it, so a two-column table of short values reads as a table
 * rather than as two columns at opposite edges.
 */
function DetailTableView({ table }: { readonly table: DetailTable }) {
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
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, rebuilt whole
            <tr key={rowIndex}>
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
 * The green done mark before a value that is a check that passed — upstream's
 * `checkmark.circle.fill`, in the text so it wraps and selects with it.
 */
function DoneMark() {
  return (
    <svg className="tool-detail-done" viewBox="0 0 16 16" role="img" aria-label="Done">
      <circle cx="8" cy="8" r="7" />
      <path d="M4.8 8.3 7 10.4l4.2-4.6" />
    </svg>
  );
}

/** Upstream's system symbols, drawn as the same idea in a line glyph. */
function Glyph({ symbol }: { readonly symbol: DetailSymbol }) {
  const paths: Record<DetailSymbol, string> = {
    key: "M10.5 2.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM8.4 7.6 2.5 13.5M4.5 11.5l1.5 1.5M3 13l1 1",
    "lock.shield":
      "M8 1.8 13 3.6v4.2c0 3-2.1 5.2-5 6.4-2.9-1.2-5-3.4-5-6.4V3.6ZM6.2 8h3.6v2.8H6.2ZM6.8 8V6.8a1.2 1.2 0 0 1 2.4 0V8",
    cpu: "M4.5 4.5h7v7h-7ZM6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14",
  };
  return (
    <svg className="tool-detail-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path d={paths[symbol]} />
    </svg>
  );
}
