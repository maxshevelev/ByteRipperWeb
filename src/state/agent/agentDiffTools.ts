import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import {
  type AgentCall,
  type AgentTool,
  AgentToolError,
  agentTool,
  jsonAnswer,
  READ_ONLY,
  VIEW,
} from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import type { DiffBlock } from "@/core/diff/diffBlock";
import { DiffCancelled, scanDiffRange } from "@/core/diff/diffEngine";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { hexText, rangeJson } from "@/state/agent/agentHostTools";
import type { AgentModuleTools } from "@/state/agent/agentModuleTools";
import { agentShell } from "@/state/agent/agentShell";
import { diffStore } from "@/state/diffStore";
import { recordJump } from "@/state/navigationStore";
import { openInPane, paneState, type SlotId } from "@/state/workspaceStore";
import type { ToolAgentPlace, ToolReadHost } from "@/tools/toolAgent";
import type { ToolModule } from "@/tools/toolModule";

/**
 * Two documents compared byte by byte (`Design/PORT_AGENT.md`): `diff`, the runs where they differ,
 * read without touching the screen; then `compare` and `reveal_diff`, the same two shown to the
 * person as a pair and walked through difference by difference.
 *
 * The comparison is the window's own: `scanDiffRange` at the same absolute offsets — never aligned,
 * so data that moved is one long run — and runs merged across matching bytes the way the window's
 * hunks are. Where a run is comes from the tool-modules (`ToolAgentLocator`), the finest one that
 * can say.
 *
 * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools
 * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.desk
 * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.init
 * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.tools
 * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.defaultMergeGap
 * @upstream-differs a pair is shown in the window's two panes, where upstream opens a tab; the bytes are read from the documents as they are now
 */

/** @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.defaultMergeGap */
export const DEFAULT_MERGE_GAP = 0x10;

/**
 * One run of differences: its span after merging and the bytes in it that differ.
 *
 * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.Run
 */
export interface DiffRun {
  start: number;
  end: number;
  differing: number;
}

/**
 * The runs of differing ranges in order, merged across at most `mergeGap` matching bytes, each with
 * the bytes in it that differ.
 *
 * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.runs
 */
export function runsOf(
  differing: readonly { readonly start: number; readonly end: number }[],
  mergeGap: number
): DiffRun[] {
  const runs: DiffRun[] = [];
  for (const range of differing) {
    const last = runs.at(-1);
    if (last !== undefined && range.start - last.end <= mergeGap) {
      last.end = range.end;
      last.differing += range.end - range.start;
    } else {
      runs.push({ start: range.start, end: range.end, differing: range.end - range.start });
    }
  }
  return runs;
}

type Span = { readonly start: number; readonly end: number };

/**
 * `area` replaced by the finer areas inside it, the stretches between them kept under `area`'s own
 * name — so a region a finer module divides still accounts for every byte of it. `area` itself when
 * none is inside.
 *
 * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.divided
 */
export function divided(area: ToolAgentPlace, finer: readonly ToolAgentPlace[]): ToolAgentPlace[] {
  const bounds = area.range;
  if (bounds === undefined) return [area];
  const inside = finer
    .filter(
      (one): one is ToolAgentPlace & { range: Span } =>
        one.range !== undefined && bounds.start <= one.range.start && one.range.end <= bounds.end
    )
    .sort((one, two) => one.range.start - two.range.start);
  if (inside.length === 0) return [area];
  const result: ToolAgentPlace[] = [];
  let cursor = bounds.start;
  for (const piece of inside) {
    if (piece.range.start < cursor) continue;
    if (piece.range.start > cursor)
      result.push({ ...area, range: { start: cursor, end: piece.range.start } });
    result.push(piece);
    cursor = piece.range.end;
  }
  if (cursor < bounds.end) result.push({ ...area, range: { start: cursor, end: bounds.end } });
  return result;
}

/** @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.placeJSON */
export function placeJson(place: ToolAgentPlace): Json {
  const members: { [key: string]: Json } = { kind: place.kind, name: place.name };
  if (place.id !== "") members.id = place.id;
  return members;
}

/** The largest document whose bytes `compare` copies into panes of their own. @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.copyLimit */
export const COPY_LIMIT = 64 << 20;

export class AgentDiffTools {
  readonly desk: AgentDesk;
  private readonly moduleTools: AgentModuleTools;
  private readonly modules: () => readonly ToolModule[];

  constructor(
    desk: AgentDesk,
    moduleTools: AgentModuleTools,
    modules: () => readonly ToolModule[]
  ) {
    this.desk = desk;
    this.moduleTools = moduleTools;
    this.modules = modules;
  }

  tools(): AgentTool[] {
    return [this.diffTool(), this.compareTool(), this.revealDiffTool()];
  }

  // MARK: - diff

  private diffTool(): AgentTool {
    return agentTool({
      name: "diff",
      title: "Byte differences",
      description:
        "The runs of bytes where `document` and `against` differ, in address order — compared at the " +
        "same absolute offsets, unsaved edits included, as the window's A/B comparison compares. Never " +
        "aligned: data that moved shows as one long run, not as a move. Runs closer than `merge_gap` " +
        "matching bytes are one run; each has `start`, `end` (half-open), `length` and " +
        "`differing_bytes`, which is less than `length` where matching bytes were merged in. `totals` " +
        "count the whole range, whatever the page. Only bytes both files hold are compared: when the " +
        "sizes differ, `tail` says where the longer file's extra bytes are, and they are not counted. " +
        'With `structure` "auto" each run says `where` it is in `document`: the top-level area ' +
        "(region, volume, ME partition) and the deepest node that covers the run whole — a run across " +
        "a boundary is placed at the node holding both sides, never split. Ids are those `uefi_node` " +
        "and `me_tree` take; `where` is empty when nothing covers it. `summary: true` answers the " +
        "areas instead, those with no differences too. Pages: `limit` is a ceiling — a page also " +
        'stops before the answer passes the size bound, and then says `truncated: "size"`; pass ' +
        "`next` back as `after` until it is null. A page asked for after either document changed is " +
        "refused. Reads only; nothing on screen moves.",
      inputSchema: AgentSchema.object(
        {
          document: AgentSchema.string(
            "The first document's id from `documents`. Default: the focused one."
          ),
          against: AgentSchema.string(
            "The id of the document to compare it with, from `documents` or `open_dump`."
          ),
          offset: AgentSchema.offset(
            "Where the compared range starts, the same in both. Default 0x0."
          ),
          end: AgentSchema.offset(
            "The first byte after the range. Default: the end of the shorter file."
          ),
          merge_gap: AgentSchema.integer(
            "At most this many matching bytes between two runs make them one. Default 16; 0 merges nothing."
          ),
          structure: AgentSchema.choice(
            ["auto", "none"],
            "Place each run in the firmware's structure, or not. Default auto."
          ),
          summary: AgentSchema.boolean(
            "Answer the areas of the image with their differences instead of the runs. Default false."
          ),
          limit: AgentSchema.limit(100, 1000),
          after: AgentSchema.after,
        },
        ["against"]
      ),
      annotations: READ_ONLY,
      run: async (call) => jsonAnswer(await this.diff(call)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.diff */
  async diff(call: AgentCall): Promise<Json> {
    const args = call.arguments;
    const place = this.desk.placeNamed(args.optionalString("document"));
    const other = this.desk.placeNamed(args.string("against"));
    if (other.document === place.document) {
      throw new AgentToolError(`\`document\` and \`against\` are the same document, ${place.id}.`);
    }
    const sizes = [place.document.size, other.document.size] as const;
    const common = Math.min(sizes[0], sizes[1]);
    const start = args.optionalOffset("offset") ?? 0;
    const end = args.optionalOffset("end") ?? common;
    if (end > common) {
      throw new AgentToolError(
        `\`end\` ${hexText(end)} is past the end of the shorter document, which is ${hexText(common)} bytes long.`
      );
    }
    if (start >= end) {
      throw new AgentToolError(
        common === 0
          ? "One of the documents is empty; there is nothing to compare."
          : `\`offset\` ${hexText(start)} is not below \`end\` ${hexText(end)}.`
      );
    }
    const mergeGap = args.has("merge_gap")
      ? Math.max(0, Math.min(0x10_0000, args.integer("merge_gap")))
      : DEFAULT_MERGE_GAP;
    const structure = args.choice("structure", ["auto", "none"] as const, "auto");
    const summary = args.bool("summary", false);
    const limit = args.limit(100, 1000);

    const host = this.moduleTools.hostFor(place);
    const otherHost = this.moduleTools.hostFor(other);
    const paging = new AgentPage(
      args,
      AgentPage.fingerprint([
        host.contentVersion,
        otherHost.contentVersion,
        start,
        end,
        mergeGap,
        structure,
      ]),
      "A document changed since that page, or the range or `merge_gap` did; ask again without `after`."
    );

    const versions = [host.contentVersion, otherHost.contentVersion];
    let blocks: DiffBlock[];
    try {
      blocks = await scanDiffRange(
        place.document.storage,
        other.document.storage,
        { start, end },
        {
          shouldCancel: () => call.signal.aborted,
        }
      );
    } catch (error) {
      if (error instanceof DiffCancelled) throw error;
      throw new AgentToolError(`The documents could not be compared: ${String(error)}`);
    }
    if (versions[0] !== host.contentVersion || versions[1] !== otherHost.contentVersion) {
      throw new AgentToolError("A document changed while it was being compared; ask again.");
    }
    const differingRanges = blocks.filter((one) => one.kind === "different");
    const runs = runsOf(differingRanges, mergeGap);
    const differing = runs.reduce((sum, one) => sum + one.differing, 0);

    const answer: { [key: string]: Json } = {
      range: rangeJson(start, end),
      sizes: { document: hexText(sizes[0]), against: hexText(sizes[1]) },
      totals: { runs: runs.length, differing_bytes: differing },
    };
    if (sizes[0] !== sizes[1]) {
      answer.tail = {
        in: sizes[0] > sizes[1] ? "document" : "against",
        start: hexText(common),
        end: hexText(Math.max(sizes[0], sizes[1])),
      };
      answer.truncated_at = hexText(common);
    }
    answer.document = place.id;
    answer.against = other.id;
    if (summary) {
      answer.areas = await this.areas(host, { start, end }, runs, differingRanges);
      return answer;
    }
    const page = runs.slice(paging.first, paging.first + limit);
    const places =
      structure === "auto"
        ? await this.locate(
            host,
            page.map((one) => ({ start: one.start, end: one.end }))
          )
        : page.map((): ToolAgentPlace[] => []);
    const items = page.map((run, index): Json => {
      const members: { [key: string]: Json } = {
        start: hexText(run.start),
        end: hexText(run.end),
        length: hexText(run.end - run.start),
        differing_bytes: run.differing,
      };
      if (structure === "auto") members.where = (places[index] ?? []).map(placeJson);
      return members;
    });
    // A run too large alone keeps only the deepest place it is in.
    return paging.answer(answer, "runs", items, runs.length, args.answerBound, (item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
      const members = item as { [key: string]: Json };
      const held = members.where;
      const deepest = Array.isArray(held) ? held.at(-1) : undefined;
      if (deepest === undefined) return undefined;
      return { ...members, where: [deepest], truncated: "item" };
    });
  }

  // MARK: - Structure

  /** The locators, finest first. */
  private locators() {
    return this.modules()
      .flatMap((module) => (module.agentLocator === undefined ? [] : [module.agentLocator]))
      .sort((one, two) => two.precedence - one.precedence);
  }

  /**
   * Each range placed by the finest locator that can say.
   *
   * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.locate
   */
  async locate(host: ToolReadHost, ranges: readonly Span[]): Promise<ToolAgentPlace[][]> {
    const result: ToolAgentPlace[][] = ranges.map(() => []);
    if (ranges.length === 0) return result;
    for (const locator of this.locators()) {
      const open = result.map((_, index) => index).filter((index) => result[index]?.length === 0);
      if (open.length === 0) break;
      const answers = await locator.locate(
        host,
        open.map((index) => ranges[index] as Span)
      );
      for (const [at, index] of open.entries()) result[index] = answers[at] ?? [];
    }
    return result;
  }

  /**
   * The areas of the image that overlap `range`, each with the bytes and runs of differences in it —
   * the coarsest locator's areas, with any that a finer one divides replaced by the finer ones. One
   * area for the whole range when no locator knows the file.
   *
   * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.areas
   */
  private async areas(
    host: ToolReadHost,
    range: Span,
    runs: readonly DiffRun[],
    differing: readonly Span[]
  ): Promise<Json[]> {
    let areas: ToolAgentPlace[] = [];
    for (const locator of [...this.locators()].reverse()) {
      const finer = (await locator.areas(host)).filter((one) => one.range !== undefined);
      if (finer.length === 0) continue;
      if (areas.length === 0) {
        areas = finer;
        continue;
      }
      areas = areas.flatMap((area) => divided(area, finer));
    }
    if (areas.length === 0) {
      areas = [{ kind: "file", id: "", name: host.fileName, range }];
    }
    const clamp = (one: Span, to: Span): Span => ({
      start: Math.max(one.start, to.start),
      end: Math.min(one.end, to.end),
    });
    const count = (one: Span) => Math.max(0, one.end - one.start);
    let attributed = 0;
    const result: Json[] = [];
    for (const area of areas) {
      if (area.range === undefined) continue;
      const bounds = clamp(area.range, range);
      if (count(bounds) === 0) continue;
      const bytes = differing.reduce((sum, one) => sum + count(clamp(one, bounds)), 0);
      attributed += bytes;
      result.push({
        ...(placeJson(area) as { [key: string]: Json }),
        start: hexText(bounds.start),
        end: hexText(bounds.end),
        differing_bytes: bytes,
        runs: runs.filter((one) => one.start < bounds.end && bounds.start < one.end).length,
      });
    }
    const total = differing.reduce((sum, one) => sum + count(one), 0);
    if (total > attributed) {
      result.push({
        kind: "outside",
        name: "Bytes in no area",
        differing_bytes: total - attributed,
      });
    }
    return result;
  }

  // MARK: - compare

  private compareTool(): AgentTool {
    return agentTool({
      name: "compare",
      title: "Show two documents side by side",
      description:
        "Shows `document` and `against` to the person as a pair — A and B side by side, their " +
        "differences coloured — in the window's own comparison. A pair already on screen is brought " +
        "forward; a document alone in the window gets the other beside it in the free pane. Never " +
        "replaces a file the window holds: with a pane taken by another file it says so. Answers the " +
        "ids of A and B as they are on screen (a background document gets a new one). Then " +
        "`reveal_diff` walks the differences. A part (`open_part`), or anything never saved, has no " +
        "file to open beside another: when both panes are free the two open as copies of their bytes, " +
        "and the answer says `copies` — an edit there reaches neither the documents nor a parent.",
      inputSchema: AgentSchema.object(
        {
          document: AgentSchema.string("The document to show as A. Default: the focused one."),
          against: AgentSchema.string("The document to show beside it, as B."),
        },
        ["against"]
      ),
      annotations: VIEW,
      run: async (call) => jsonAnswer(await this.compare(call.arguments)),
    });
  }

  private pairOf(
    first: AgentPlace,
    second: AgentPlace
  ): { a: AgentPlace; b: AgentPlace } | undefined {
    const a = this.desk.places().find((one) => one.slot === "A");
    const b = this.desk.places().find((one) => one.slot === "B");
    if (a === undefined || b === undefined) return undefined;
    const matches =
      (a.document === first.document && b.document === second.document) ||
      (a.document === second.document && b.document === first.document);
    return matches ? { a, b } : undefined;
  }

  private shown(pair: { a: AgentPlace; b: AgentPlace }, was: boolean): { [key: string]: Json } {
    return { a: pair.a.id, b: pair.b.id, was_shown: was, names: [pair.a.name, pair.b.name] };
  }

  /** @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.compare */
  async compare(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const other = this.desk.placeNamed(args.string("against"));
    if (other.document === place.document) {
      throw new AgentToolError(`\`document\` and \`against\` are the same document, ${place.id}.`);
    }
    const already = this.pairOf(place, other);
    if (already !== undefined) {
      agentShell.bringForward?.("a");
      return this.shown(already, true);
    }
    // Where each goes: the pane it is in, or a free one; never over a file the window holds.
    const taken = (slot: SlotId) => paneState(slot) !== undefined;
    const slotOf = (one: AgentPlace): SlotId | undefined =>
      one.slot === "A" ? "a" : one.slot === "B" ? "b" : undefined;
    const needs = [place, other].filter((one) => slotOf(one) === undefined);
    const free = (["a", "b"] as const).filter((slot) => !taken(slot));
    // A part, or anything else never saved, has no file to open beside another.
    const unsaved = needs.some((one) => one.state?.untitled === true || one.isPart);
    if (needs.length > free.length) {
      throw new AgentToolError(
        "Both panes of the window hold files, and an agent does not replace one. " +
          "Ask the person to close one, or compare the documents with `diff`."
      );
    }
    if (needs.length === 1 && unsaved) {
      throw new AgentToolError(
        `${(needs[0] as AgentPlace).id} has never been saved; only a file on disk can be opened beside another. ` +
          "Compare them with `diff`."
      );
    }
    const copies = unsaved;
    for (const one of needs) {
      const slot = free.shift();
      if (slot === undefined) break;
      const held = one.state;
      if (held === undefined) throw new AgentToolError(`${one.id} has no file.`);
      if (copies) {
        const size = one.document.size;
        if (size > COPY_LIMIT) {
          throw new AgentToolError(
            `Copies are made of documents up to ${hexText(COPY_LIMIT)} bytes; compare them with \`diff\`, or open a smaller part.`
          );
        }
        const bytes = await one.document.read(0, size);
        openInPane(slot, {
          name: one.name,
          size,
          lastModified: Date.now(),
          source: new Blob([bytes.slice()], { type: "application/octet-stream" }),
        });
      } else {
        openInPane(slot, held.file);
      }
      // A background copy gives way to the pane, as with `show`.
      if (!one.isOnScreen && one.pane !== undefined) this.desk.background.close(one.pane);
    }
    // What was put in a pane is a new document there: the pair is the window's two panes now.
    const places = this.desk.places();
    const a = places.find((one) => one.slot === "A");
    const b = places.find((one) => one.slot === "B");
    if (a === undefined || b === undefined) {
      throw new AgentToolError(
        `ByteRipper could not put ${place.name} and ${other.name} side by side.`
      );
    }
    const pair = { a, b };
    agentShell.bringForward?.("a");
    const answer = this.shown(pair, false);
    if (copies) {
      answer.copies =
        "copies of the documents' bytes as they are now: an edit in these panes reaches neither them nor a parent";
    }
    return answer;
  }

  // MARK: - reveal_diff

  private revealDiffTool(): AgentTool {
    return agentTool({
      name: "reveal_diff",
      title: "Show the next difference",
      description:
        "Moves both panes of a pair `compare` showed to the next or previous difference — the step " +
        "the window's own difference arrows take, with the person's grouping of nearby differences — " +
        "from `from`, or from the caret. A step of the navigation history, so the person's Back " +
        "returns. Answers the difference, or `found: false` at the end. `document` is either side of " +
        "the pair.",
      inputSchema: AgentSchema.object({
        document: AgentSchema.string("A or B of the pair. Default: the focused one."),
        direction: AgentSchema.choice(["next", "previous"], "Which way. Default next."),
        from: AgentSchema.offset("Where to look from. Default: the caret."),
      }),
      annotations: VIEW,
      run: async (call) => jsonAnswer(await this.revealDiff(call.arguments)),
    });
  }

  /**
   * @upstream ByteRipperApp/Agent/AgentDiffTools.swift#AgentDiffTools.revealDiff
   * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.revealDifferenceForAgent
   */
  async revealDiff(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const direction = args.choice("direction", ["next", "previous"] as const, "next");
    const from = args.optionalOffset("from");
    const pane = place.onScreen();
    if (
      (place.slot !== "A" && place.slot !== "B") ||
      paneState("a") === undefined ||
      paneState("b") === undefined
    ) {
      throw new AgentToolError(
        `${place.id} is not one of a pair shown side by side. \`compare\` shows it beside another.`
      );
    }
    agentShell.bringForward?.(pane);
    // The comparison is built behind the panes; it is waited for, a moment at most.
    await settledComparison();
    const hunks = diffStore.getSnapshot().hunks;
    const origin = from ?? paneState(pane)?.document.caret ?? 0;
    const block =
      hunks === undefined
        ? undefined
        : direction === "next"
          ? hunks.nextDifference(origin)
          : hunks.previousDifference(origin);
    if (block === undefined) return { document: place.id, found: false };
    // Forward lands on the block's first byte, backward on its last — the byte past it would let the
    // next step find the same block again.
    const landing = direction === "next" ? block.start : Math.max(block.start, block.end - 1);
    recordJump(pane);
    await agentShell.reveal?.(pane, landing, landing, false);
    return {
      ...(rangeJson(block.start, block.end) as { [key: string]: Json }),
      document: place.id,
      found: true,
    };
  }
}

/** Waits until the window's comparison has been built, or gives up after a few seconds. */
function settledComparison(): Promise<void> {
  const done = () => {
    const state = diffStore.getSnapshot();
    return state.status !== "scanning" && state.hunks !== undefined;
  };
  if (done()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = diffStore.subscribe(() => {
      if (!done()) return;
      window.clearTimeout(timer);
      stop();
      resolve();
    });
    const timer = window.setTimeout(() => {
      stop();
      resolve();
    }, 5000);
  });
}
