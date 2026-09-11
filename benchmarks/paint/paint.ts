/**
 * The canvas half of the benchmark harness.
 *
 * `npm run bench` measures everything that runs in Node. A repaint does not:
 * there is no canvas there, and a canvas shimmed in software would measure the
 * shim. So the frame-cost rows live here, in a page, and are measured on the
 * machine and in the browser whose numbers are wanted — which is the only place
 * they mean anything anyway. M12's Playwright pass drives this same page from
 * CI.
 *
 * Run it with `npm run dev` and open `/benchmarks/paint/`.
 */

import { makeByteDecoder } from "@/core/text/byteDecoderRegistry";
import { GlyphAtlas } from "@/render/hexGrid/glyphAtlas";
import { HexGridRenderer, type HexGridSource } from "@/render/hexGrid/hexGridRenderer";
import { HexLayout } from "@/render/hexGrid/hexLayout";
import { readHexColors } from "@/ui/theme/hexColors";

/** The budget from `Design/ANALYSIS.md`: a scroll frame under 8 ms. */
const SCROLL_FRAME_BUDGET_MS = 8;

const VIEWPORT = { widthCss: 900, heightCss: 800 };

interface Row {
  name: string;
  medianMs: number;
  bestMs: number;
  budgetMs?: number;
  note?: string;
}

function measure(body: () => void, samples = 60, warmups = 10): { median: number; best: number } {
  for (let i = 0; i < warmups; i++) body();
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    body();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);
  return { median: times[times.length >> 1] ?? Number.NaN, best: times[0] ?? Number.NaN };
}

/**
 * A 16 MB dump whose bytes are always resident, so what is measured is the
 * painting and not the reading — the reads have their own rows in `npm run bench`.
 */
function residentSource(size: number): HexGridSource {
  const bytes = new Uint8Array(size);
  let seed = 0x9e3779b9;
  for (let i = 0; i < size; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    bytes[i] = i % 64 < 40 ? seed >>> 24 : 0xff;
  }
  return {
    size,
    peek: (at, length) => bytes.subarray(at, Math.min(at + length, size)),
    prefetch: () => Promise.resolve(),
  };
}

function run(): Row[] {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);

  const decoder = makeByteDecoder("cp1252");
  const colors = readHexColors();
  const layout = new HexLayout({ charWidth: 8, rowHeight: 17 });
  const source = residentSource(16 * 1024 * 1024);
  const rowsOnScreen = Math.ceil(VIEWPORT.heightCss / layout.rowHeight);

  const renderer = new HexGridRenderer(canvas);
  const configure = () =>
    renderer.configure({
      layout,
      decoder,
      colors,
      fontFamily: "monospace",
      fontSizePx: 13,
      devicePixelRatio: window.devicePixelRatio,
    });

  const rows: Row[] = [];

  const atlas = measure(
    () =>
      GlyphAtlas.build(
        {
          fontFamily: "monospace",
          fontSizePx: 13,
          charWidth: 8,
          rowHeight: 17,
          devicePixelRatio: window.devicePixelRatio,
          colors,
          decoderIdentifier: decoder.identifier,
          placeholder: decoder.placeholder,
        },
        decoder
      ),
    20,
    3
  );
  rows.push({
    name: "Build the glyph atlas",
    medianMs: atlas.median,
    bestMs: atlas.best,
    note: "Once per font, size, theme, decoding table or devicePixelRatio — never in a scroll frame.",
  });

  configure();
  renderer.setSource(source);
  renderer.setViewport({ scrollTop: 0, scrollLeft: 0, ...VIEWPORT });

  const full = measure(() => {
    renderer.invalidateAll();
    renderer.draw();
  });
  rows.push({
    name: `Full repaint, ${rowsOnScreen} rows`,
    medianMs: full.median,
    bestMs: full.best,
    budgetMs: SCROLL_FRAME_BUDGET_MS,
    note: "Every visible row from scratch — a theme change, a resize, a word-size switch.",
  });

  let scrollTop = 0;
  const scroll = measure(() => {
    scrollTop += layout.rowHeight;
    renderer.setViewport({ scrollTop, scrollLeft: 0, ...VIEWPORT });
    renderer.draw();
  });
  rows.push({
    name: "Scroll one row",
    medianMs: scroll.median,
    bestMs: scroll.best,
    budgetMs: SCROLL_FRAME_BUDGET_MS,
    note: "The blit path: the rows that stayed move, and one band is painted.",
  });

  let page = 0;
  const paged = measure(() => {
    page += VIEWPORT.heightCss;
    renderer.setViewport({ scrollTop: page, scrollLeft: 0, ...VIEWPORT });
    renderer.draw();
  });
  rows.push({
    name: "Scroll one screen",
    medianMs: paged.median,
    bestMs: paged.best,
    budgetMs: SCROLL_FRAME_BUDGET_MS,
    note: "Nothing painted is still on screen, so this is a full repaint with a wasted blit.",
  });

  let caret = 0;
  const caretMove = measure(() => {
    caret += 16;
    renderer.setSelection({ start: caret, end: caret });
    renderer.draw();
  });
  rows.push({
    name: "Move the caret one row",
    medianMs: caretMove.median,
    bestMs: caretMove.best,
    budgetMs: SCROLL_FRAME_BUDGET_MS,
    note: "What dirty regions are for: two rows repainted, not a screen.",
  });

  canvas.remove();
  return rows;
}

function render(rows: Row[]): string {
  const cells = (row: Row) => [
    row.name,
    `${row.medianMs.toFixed(2)} ms`,
    `${row.bestMs.toFixed(2)} ms`,
    row.budgetMs === undefined ? "—" : `${row.budgetMs.toFixed(1)} ms`,
    row.budgetMs === undefined
      ? "—"
      : row.medianMs <= row.budgetMs * 0.75
        ? "ok"
        : row.medianMs <= row.budgetMs
          ? "close"
          : "OVER",
  ];
  const head = ["Operation", "Median", "Best", "Budget", "Verdict"];
  const table = [head, ...rows.map(cells)];
  const widths = head.map((_, i) => Math.max(...table.map((line) => (line[i] ?? "").length)));
  const line = (values: string[]) =>
    values
      .map((value, i) => value.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();

  return [
    line(head),
    line(widths.map((width) => "-".repeat(width))),
    ...rows.map((row) => line(cells(row))),
    "",
    ...rows.filter((row) => row.note !== undefined).map((row) => `  ${row.name}: ${row.note}`),
    "",
    `devicePixelRatio ${window.devicePixelRatio} · viewport ${VIEWPORT.widthCss}×${VIEWPORT.heightCss}`,
  ].join("\n");
}

const output = document.querySelector("#out");
if (output !== null) output.textContent = render(run());
