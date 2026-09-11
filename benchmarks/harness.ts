/**
 * The benchmark harness.
 *
 * Decision D14: this exists from M0, before there is anything worth measuring,
 * because a performance argument made in prose is not an argument. Each
 * milestone adds its own rows; the budgets are the table in
 * `Design/ANALYSIS.md` and nothing else.
 *
 * It runs under Node rather than in a browser, which is a real limitation and
 * is stated in the output: a canvas repaint cannot be measured here at all, and
 * chunked reads come off Node's `openAsBlob` rather than a `File` handed over
 * by a file picker. What it does measure is the same code path over the same
 * `Blob.slice()` interface, which is where the cost is.
 */

export interface Measurement {
  /** Milliseconds, the median of the samples taken. */
  readonly medianMs: number;
  /** Milliseconds, the fastest sample — the machine at its least disturbed. */
  readonly bestMs: number;
  /** Bytes moved per run, when the row is a throughput one. */
  readonly bytes?: number;
}

export interface Row {
  readonly name: string;
  /** The budget from `ANALYSIS.md`, or undefined where that table sets none. */
  readonly budgetMs?: number;
  /** Anything the reader needs in order not to over-read the number. */
  readonly note?: string;
  readonly measurement: Measurement;
}

/** Runs `body` a few times and reports the median, which is the honest one. */
export async function measure(
  body: () => Promise<void> | void,
  options: { readonly samples?: number; readonly warmups?: number; readonly bytes?: number } = {}
): Promise<Measurement> {
  const samples = options.samples ?? 7;
  const warmups = options.warmups ?? 1;

  for (let i = 0; i < warmups; i++) await body();

  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    await body();
    times.push(performance.now() - started);
  }
  times.sort((a, b) => a - b);

  const median = times[times.length >> 1] ?? Number.NaN;
  const best = times[0] ?? Number.NaN;
  return options.bytes === undefined
    ? { medianMs: median, bestMs: best }
    : { medianMs: median, bestMs: best, bytes: options.bytes };
}

function verdictOf(row: Row): string {
  if (row.budgetMs === undefined) return "—";
  const ratio = row.measurement.medianMs / row.budgetMs;
  if (ratio <= 0.75) return "ok";
  if (ratio <= 1) return "close";
  return "OVER";
}

function throughputOf(row: Row): string {
  const { bytes, medianMs } = row.measurement;
  if (bytes === undefined || medianMs <= 0) return "";
  const gbPerSecond = bytes / (medianMs / 1000) / 1024 ** 3;
  return `${gbPerSecond.toFixed(2)} GB/s`;
}

const ms = (value: number) => `${value.toFixed(1)} ms`;

/** Prints the table. Columns are padded rather than drawn, so it pastes well. */
export function printTable(rows: readonly Row[]): void {
  const columns = [
    { head: "Operation", cell: (r: Row) => r.name },
    { head: "Median", cell: (r: Row) => ms(r.measurement.medianMs) },
    { head: "Best", cell: (r: Row) => ms(r.measurement.bestMs) },
    { head: "Budget", cell: (r: Row) => (r.budgetMs === undefined ? "—" : ms(r.budgetMs)) },
    { head: "Verdict", cell: verdictOf },
    { head: "Throughput", cell: throughputOf },
  ];

  const widths = columns.map((column, index) =>
    Math.max(
      column.head.length,
      ...rows.map((row) => (columns[index] as typeof column).cell(row).length)
    )
  );
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();

  console.log(line(columns.map((column) => column.head)));
  console.log(line(widths.map((width) => "-".repeat(width))));
  for (const row of rows) console.log(line(columns.map((column) => column.cell(row))));

  const notes = rows.filter((row) => row.note !== undefined);
  if (notes.length > 0) {
    console.log("");
    for (const row of notes) console.log(`  ${row.name}: ${row.note}`);
  }
}

/** True when any row with a budget missed it — the process's exit status. */
export function anyOverBudget(rows: readonly Row[]): boolean {
  return rows.some((row) => verdictOf(row) === "OVER");
}
