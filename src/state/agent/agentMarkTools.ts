import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import type { AgentMark } from "@/core/agent/agentMark";
import { AgentPage } from "@/core/agent/agentPage";
import {
  type AgentTool,
  AgentToolError,
  agentTool,
  jsonAnswer,
  READ_ONLY,
} from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { hexText, rangeJson } from "@/state/agent/agentHostTools";
import { agentMarksFor, setAgentMarks } from "@/state/agent/agentMarkStore";
import { agentShell } from "@/state/agent/agentShell";
import { recordJump } from "@/state/navigationStore";
import type { PaneId } from "@/state/paneId";

/**
 * `mark`, `unmark` and `marks`: an agent labelling bytes for the person and saying how they hang
 * together (`Design/PORT_AGENT.md`, "Marks").
 *
 * The marks live with the panes (`agentMarkStore`), so they are drawn with the dump and go with
 * the document. What is kept here is the counter their ids come from — one for the whole app, so
 * `m3` names one mark however many documents are open.
 *
 * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools
 * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.desk
 * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.init
 * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.tools
 * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.nextID
 * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.maxLabel
 * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.maxNote
 * @upstream-differs the Agent window listens to the mark store, where upstream's `onChange` told it
 */

/**
 * A mark and the document it is in.
 *
 * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.Located
 */
export interface LocatedMark {
  readonly mark: AgentMark;
  readonly place: AgentPlace;
}

export const MAX_LABEL = 80;
export const MAX_NOTE = 600;

export class AgentMarkTools {
  readonly desk: AgentDesk;
  private nextId = 1;

  constructor(desk: AgentDesk) {
    this.desk = desk;
  }

  tools(): AgentTool[] {
    return [this.markTool(), this.unmarkTool(), this.marksTool()];
  }

  // MARK: - What is marked

  /**
   * Every mark in every open document, documents in `documents` order and marks in the order they
   * were made.
   *
   * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.all
   */
  all(): LocatedMark[] {
    return this.desk
      .places()
      .flatMap((place) =>
        place.pane === undefined ? [] : agentMarksFor(place.pane).map((mark) => ({ mark, place }))
      );
  }

  // MARK: - mark

  private markTool(): AgentTool {
    return agentTool({
      name: "mark",
      title: "Mark bytes for the reader",
      description:
        "Marks a range of an open document with a short label and, optionally, a note — drawn over the " +
        "dump with a dashed outline in a colour of its own, the note shown when the person rests the " +
        "pointer on the bytes, and listed in the Agent window. Use it to show what bytes are while you " +
        "talk about them. `related_to` names marks this one is about (a pointer and its target, a " +
        "checksum and what it covers); the Agent window shows each pair. Does not move the view — " +
        "`reveal` does. Marks stay until removed with `unmark`, cleared by the person, or the document " +
        "closes.",
      inputSchema: AgentSchema.object(
        {
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
          offset: AgentSchema.offset("The first byte."),
          length: AgentSchema.offset("How many bytes, at least 1."),
          label: AgentSchema.string(
            `A few words: what the bytes are. At most ${MAX_LABEL} characters.`
          ),
          note: AgentSchema.string(
            `A sentence or two: why they matter. At most ${MAX_NOTE} characters.`
          ),
          related_to: AgentSchema.strings('Ids of marks this one is about, e.g. ["m1"].'),
        },
        ["offset", "length", "label"]
      ),
      annotations: { readOnly: false, destructive: false, idempotent: false },
      run: async (call) => jsonAnswer(this.mark(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.mark */
  mark(args: AgentArguments): Json {
    const place = this.desk.placeNamed(args.optionalString("document"));
    // A mark is drawn on the dump; a file with no window has none to draw it on, and would carry a
    // mark nobody can see.
    const pane = place.onScreen();
    const offset = args.offset("offset");
    const length = args.offset("length");
    const label = args.string("label").trim();
    const note = (args.optionalString("note") ?? "").trim();
    const related = args.strings("related_to");
    if (length <= 0) throw new AgentToolError("Argument `length` must be at least 1.");
    if (label === "") throw new AgentToolError("Argument `label` must say something.");
    if ([...label].length > MAX_LABEL) {
      throw new AgentToolError(
        `Argument \`label\`: at most ${MAX_LABEL} characters; put the rest in \`note\`.`
      );
    }
    if ([...note].length > MAX_NOTE) {
      throw new AgentToolError(`Argument \`note\`: at most ${MAX_NOTE} characters.`);
    }
    const size = place.document.size;
    if (!(offset < size && length <= size - offset)) {
      throw new AgentToolError(
        `The range ${hexText(offset)}+${hexText(length)} runs past the end of ${place.id}, ` +
          `which is ${hexText(size)} bytes long.`
      );
    }
    const known = new Set(this.all().map((one) => one.mark.id));
    const missing = related.find((id) => !known.has(id));
    if (missing !== undefined) {
      throw new AgentToolError(`No mark ${missing}. Call \`marks\` for the ones there are.`);
    }
    const mark: AgentMark = {
      id: `m${this.nextId}`,
      start: offset,
      end: offset + length,
      label,
      note,
      relatedTo: related,
    };
    this.nextId += 1;
    setAgentMarks(pane, [...agentMarksFor(pane), mark]);
    return AgentMarkTools.describe({ mark, place });
  }

  // MARK: - unmark

  private unmarkTool(): AgentTool {
    return agentTool({
      name: "unmark",
      title: "Remove marks",
      description:
        "Removes marks: the ones named in `ids`, or every mark in `document`, or — with `all` — every " +
        "mark in every document. Relations to a removed mark go with it.",
      inputSchema: AgentSchema.object({
        ids: AgentSchema.strings('The marks to remove, e.g. ["m2", "m3"].'),
        document: AgentSchema.string("Remove every mark in this document."),
        all: AgentSchema.boolean("Remove every mark in every document."),
      }),
      annotations: { readOnly: false, destructive: false, idempotent: true },
      run: async (call) => jsonAnswer(this.unmark(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.unmark */
  unmark(args: AgentArguments): Json {
    const ids = new Set(args.strings("ids"));
    const everything = args.bool("all", false);
    const document = args.optionalString("document");
    if (ids.size === 0 && !everything && document === undefined) {
      throw new AgentToolError("Name the marks in `ids`, a `document`, or pass `all: true`.");
    }
    const documentPane = document === undefined ? undefined : this.desk.placeNamed(document).pane;
    const removed = this.remove(
      (located) =>
        everything ||
        ids.has(located.mark.id) ||
        (documentPane !== undefined && located.place.pane === documentPane)
    );
    if (ids.size > 0 && removed.length < ids.size) {
      const gone = new Set(removed);
      const unknown = [...ids].filter((id) => !gone.has(id)).sort();
      return { removed, not_found: unknown };
    }
    return { removed };
  }

  /**
   * Removes the marks `doomed` picks, drops relations to them, and returns their ids. What the Agent
   * window's buttons call as well.
   *
   * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.remove
   */
  remove(doomed: (located: LocatedMark) => boolean): string[] {
    const located = this.all();
    const removed = located.filter(doomed).map((one) => one.mark.id);
    if (removed.length === 0) return [];
    const gone = new Set(removed);
    const seen = new Set<PaneId>();
    for (const { place } of located) {
      const pane = place.pane;
      if (pane === undefined || seen.has(pane)) continue;
      seen.add(pane);
      setAgentMarks(
        pane,
        agentMarksFor(pane)
          .filter((mark) => !gone.has(mark.id))
          .map((mark) => ({ ...mark, relatedTo: mark.relatedTo.filter((id) => !gone.has(id)) }))
      );
    }
    return removed;
  }

  /**
   * Brings the mark's document forward and selects its bytes — what a double-click on its row in
   * the Agent window does. A step of the navigation history, like `reveal`.
   *
   * @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.show
   */
  async show(id: string): Promise<void> {
    const located = this.all().find((one) => one.mark.id === id);
    const pane = located?.place.pane;
    if (located === undefined || pane === undefined) return;
    agentShell.bringForward?.(pane);
    recordJump(pane);
    await agentShell.reveal?.(pane, located.mark.start, located.mark.end, true);
  }

  // MARK: - marks

  private marksTool(): AgentTool {
    return agentTool({
      name: "marks",
      title: "List marks",
      description:
        "The marks in `document`, or in every open document: id, document, range, label, note, related " +
        "marks. Pages: `limit` is a ceiling — a page also stops before the answer passes the size bound " +
        'and then says `truncated: "size"`; pass `next` back as `after` until it is null. A page asked ' +
        "for after the marks changed is refused.",
      inputSchema: AgentSchema.object({
        document: AgentSchema.string("Only this document's marks. Default: every document's."),
        limit: AgentSchema.limit(50, 200),
        after: AgentSchema.after,
      }),
      annotations: READ_ONLY,
      run: async (call) => jsonAnswer(this.list(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.list */
  list(args: AgentArguments): Json {
    const document = args.optionalString("document");
    const pane = document === undefined ? undefined : this.desk.placeNamed(document).pane;
    const marks = this.all().filter((one) => pane === undefined || one.place.pane === pane);
    const limit = args.limit(50, 200);
    const described = marks.map((one) => AgentMarkTools.describe(one));
    const paging = new AgentPage(
      args,
      AgentPage.fingerprint([described]),
      "The marks changed since that page; ask again without `after`."
    );
    return paging.answer(
      { total: marks.length },
      "marks",
      described.slice(paging.first, paging.first + limit),
      marks.length,
      args.answerBound
    );
  }

  // MARK: - Shapes

  /** @upstream ByteRipperApp/Agent/AgentMarkTools.swift#AgentMarkTools.describe */
  static describe(located: LocatedMark): Json {
    const { mark, place } = located;
    const entry: { [key: string]: Json } = {
      id: mark.id,
      document: place.id,
      range: rangeJson(mark.start, mark.end),
      label: mark.label,
    };
    if (mark.note !== "") entry.note = mark.note;
    if (mark.relatedTo.length > 0) entry.related_to = [...mark.relatedTo];
    return entry;
  }
}
