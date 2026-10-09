import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AGENT_FORMATS, type AgentFormat, shownBytes } from "@/core/agent/agentBytes";
import {
  type AgentTool,
  AgentToolError,
  agentTool,
  jsonAnswer,
  VIEW,
} from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { agentShell } from "@/state/agent/agentShell";
import { recordJump } from "@/state/navigationStore";
import { scrollLink } from "@/ui/pane/scrollLink";

/**
 * The tools the app answers itself, as opposed to the ones a tool-module contributes: what is
 * open, where the reader is, the bytes, and moving the view.
 *
 * Every name, description and answer here is read by a model and stays in English without the localization lookup
 * (`Design/LOCALIZATION.md`). Addresses and sizes are answered as hex strings — `"0x7F3000"` —
 * because that is how the dump, the panels and every tool-module write them, and how a model
 * hands them back.
 *
 * @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools
 */

/** The most a `read` returns. @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.maxRead */
export const MAX_READ = 4096;

/** @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.hexText */
export const hexText = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

/** @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.hex */
export const hexJson = (value: number): Json => hexText(value);

/**
 * A half-open range, as the app keeps every range: `end` is the first byte after it.
 *
 * @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.range
 */
export const rangeJson = (start: number, end: number): Json => ({
  start: hexText(start),
  end: hexText(end),
  length: hexText(end - start),
});

/** The bytes in a row of the dump, for the first byte on screen. */
const BYTES_PER_ROW = 16;

export class AgentHostTools {
  /** @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.desk */
  readonly desk: AgentDesk;

  /** @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.init */
  constructor(desk: AgentDesk) {
    this.desk = desk;
  }

  /** The tools, in the order `tools/list` gives them. @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.tools */
  tools(): AgentTool[] {
    return [this.documentsTool(), this.focusTool(), this.readTool(), this.revealTool()];
  }

  // MARK: - documents

  private documentsTool(): AgentTool {
    return agentTool({
      name: "documents",
      title: "Open documents",
      description:
        "Lists every file open in ByteRipper: its id (pass it as `document` to the other tools), " +
        "name, size, whether it has unsaved edits, and where it is — pane A or B of a tab, " +
        'or a part opened over its parent file ("part", with the parent\'s id and the bytes of ' +
        "the parent it came from). The document the reader is in is marked `focused`. Ids last as " +
        "long as the file stays open.",
      run: async () => jsonAnswer(this.documents()),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.documents */
  documents(): Json {
    const focused = this.desk.focused();
    const entries = this.desk.places().map((place): Json => {
      const entry: { [key: string]: Json } = {
        id: place.id,
        name: place.name,
        size: hexText(place.document.size),
        slot: place.slot,
      };
      if (place.isOnScreen) {
        entry.tab = 1;
        entry.unsaved_edits = place.document.isDirty;
        entry.read_only = false;
      }
      const origin = place.state?.origin;
      if (origin !== undefined) {
        const parent = this.desk.placeOf(origin.parent);
        if (parent !== undefined) entry.part_of = parent.id;
        entry.source = rangeJson(origin.sourceRange[0], origin.sourceRange[1]);
      }
      if (focused !== undefined && focused.pane === place.pane) entry.focused = true;
      return entry;
    });
    return { documents: entries };
  }

  // MARK: - focus

  private focusTool(): AgentTool {
    return agentTool({
      name: "focus",
      title: "Where the reader is",
      description:
        "What the person at ByteRipper is looking at and pointing to: the document they are in, " +
        "the caret, the selection (null when there is only a caret), and the bytes on screen. " +
        'Call it when they say "this", "here" or "what I selected". In a comparison of two files ' +
        "it also names the other one, which scrolls with this one.",
      run: async () => jsonAnswer(this.focus()),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.focus */
  focus(): Json {
    const place = this.desk.focused();
    if (place === undefined) throw new AgentToolError("No file is open in ByteRipper.");
    const pane = place.onScreen();
    const document = place.document;
    const answer: { [key: string]: Json } = {
      document: place.id,
      name: place.name,
      caret: hexText(document.caret),
    };
    const selection = document.selection;
    answer.selection =
      selection.start === selection.end ? null : rangeJson(selection.start, selection.end);
    const visible = scrollLink.visibleRange(pane, BYTES_PER_ROW);
    if (visible !== undefined) {
      answer.on_screen = rangeJson(visible.start, Math.min(visible.end, document.size));
    }
    if (place.slot === "A" || place.slot === "B") {
      const other = this.desk.placeOf(place.slot === "A" ? "b" : "a");
      if (other !== undefined) answer.compared_with = other.id;
    }
    return answer;
  }

  // MARK: - read

  private readTool(): AgentTool {
    return agentTool({
      name: "read",
      title: "Read bytes",
      description:
        "Reads bytes of an open document as it is now, unsaved edits included. `format`: " +
        '"hex" (default) gives rows of 16 bytes with their address and text, as the dump shows them; ' +
        '"ascii" a string with "." for bytes that are not printable; "utf16le" the bytes decoded as ' +
        'UTF-16LE text; "u8", "u16", "u32", "u64" a list of unsigned integers in hex, ' +
        `little-endian unless \`endian\` is "big". At most ${MAX_READ} bytes; a range running past the ` +
        "end of the file is cut there and says so.",
      inputSchema: AgentSchema.object(
        {
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
          offset: AgentSchema.offset('Where to start, e.g. "0x7F3000".'),
          length: AgentSchema.offset(`How many bytes. Default 256, at most ${MAX_READ}.`),
          format: AgentSchema.choice(AGENT_FORMATS, 'How to show them. Default "hex".'),
          endian: AgentSchema.choice(["little", "big"], 'For u16, u32 and u64. Default "little".'),
        },
        ["offset"]
      ),
      run: async (call) => jsonAnswer(await this.read(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.read */
  async read(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const offset = args.offset("offset");
    const asked = args.optionalOffset("length") ?? 256;
    const format: AgentFormat = args.choice("format", AGENT_FORMATS, "hex");
    const bigEndian = args.choice("endian", ["little", "big"] as const, "little") === "big";
    if (asked <= 0) throw new AgentToolError("Argument `length` must be at least 1.");
    if (asked > MAX_READ) {
      throw new AgentToolError(`Argument \`length\`: at most ${MAX_READ} bytes in one read.`);
    }
    const size = place.document.size;
    if (offset >= size) throw pastTheEnd(offset, place, size);
    const end = Math.min(offset + asked, size);
    const bytes = await place.document.read(offset, end - offset);
    const answer: { [key: string]: Json } = {
      ...shownBytes(bytes, offset, format, bigEndian),
      document: place.id,
      offset: hexText(offset),
      length: hexText(end - offset),
    };
    if (end - offset < asked) answer.cut_at_end_of_file = true;
    return answer;
  }

  // MARK: - reveal

  private revealTool(): AgentTool {
    return agentTool({
      name: "reveal",
      title: "Show bytes to the reader",
      description:
        "Shows a place in a document to the person: brings its tab forward, scrolls the dump to " +
        "it and moves the caret there — selecting `length` bytes when `select` is true, which is " +
        "the default when a length is given. It is a step of the navigation history, so the " +
        "person's Back returns to where they were. Use it to point at what you are talking about.",
      inputSchema: AgentSchema.object(
        {
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
          offset: AgentSchema.offset("The first byte to show."),
          length: AgentSchema.offset("How many bytes the place is. Default 0: just the caret."),
          select: AgentSchema.boolean("Select the bytes. Default: true when `length` is given."),
        },
        ["offset"]
      ),
      annotations: VIEW,
      run: async (call) => jsonAnswer(await this.reveal(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentHostTools.swift#AgentHostTools.reveal */
  async reveal(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const offset = args.offset("offset");
    const length = args.optionalOffset("length") ?? 0;
    const select = args.bool("select", length > 0);
    const pane = place.onScreen();
    const size = place.document.size;
    if (!(offset < size || (offset === size && length === 0)))
      throw pastTheEnd(offset, place, size);
    const end = Math.min(offset + length, size);
    // The place the reader is leaving goes into the history first, so their Back undoes what the
    // agent did.
    recordJump(pane);
    await agentShell.reveal?.(pane, offset, end, select && end > offset);
    return {
      document: place.id,
      shown: rangeJson(offset, end),
      selected: select && end > offset,
    };
  }
}

function pastTheEnd(offset: number, place: AgentPlace, size: number): AgentToolError {
  return new AgentToolError(
    `Offset ${hexText(offset)} is past the end of ${place.id}, which is ${hexText(size)} bytes long.`
  );
}
