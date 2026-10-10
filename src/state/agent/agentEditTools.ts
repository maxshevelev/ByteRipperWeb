import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { hexByteText, parseHexBytes } from "@/core/agent/agentHexBytes";
import {
  type AgentTool,
  AgentToolError,
  agentTool,
  EDIT,
  jsonAnswer,
} from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { L } from "@/core/localization/localization";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { hexText } from "@/state/agent/agentHostTools";
import { agentShell } from "@/state/agent/agentShell";
import { recordJump } from "@/state/navigationStore";
import { applyTransaction } from "@/state/toolEdits";
import {
  type ToolTransaction,
  transactionProblemMessage,
  validateTransaction,
} from "@/tools/toolTransaction";

/**
 * The one door an agent's change to a file goes through (`Design/PORT_AGENT.md`, "Edits"): `write`,
 * and every edit a tool-module works out (`ToolAgentEdit`), applied here and nowhere else.
 *
 * Only with the person's edit switch on, only to a document in the window — a file opened by path
 * is read, never changed. Each change is one undo step named after what the agent said it is, shows
 * red like a hand edit, and is brought on screen, so the person sees what changed and takes it back
 * with Undo. Nothing here saves.
 *
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.desk
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.isAllowed
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.init
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.tools
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.writeLimit
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.beforeLimit
 * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.locate
 */

/** The most bytes one `write` carries: a patch, not an image. */
export const WRITE_LIMIT = 0x1_0000;
/** The most bytes of what was there an answer repeats. */
export const BEFORE_LIMIT = 64;

export class AgentEditTools {
  readonly desk: AgentDesk;
  /** The edit switch, read at each call. */
  isAllowed: () => boolean = () => false;
  /**
   * Where a range lies in the firmware, as `diff` names it — set by the service, which has the
   * locators.
   */
  locate: (place: AgentPlace, range: { start: number; end: number }) => Promise<Json[]> =
    async () => [];

  constructor(desk: AgentDesk) {
    this.desk = desk;
  }

  tools(): AgentTool[] {
    return [this.writeTool(), this.copyTool()];
  }

  // MARK: - write

  private writeTool(): AgentTool {
    return agentTool({
      name: "write",
      title: "Write bytes",
      description:
        "Overwrites bytes in a document open in the window, as one step of its undo named by `label` — " +
        "write the label in the person's language, it is what their Edit menu offers to undo. The " +
        "bytes replace as many as they are, never inserting or deleting: a write past the end of " +
        "the file is refused. The written bytes show red until the person saves, and the dump " +
        "scrolls to them. `expect` makes the write conditional: the bytes there now must be these, " +
        "or nothing is written and the answer says what is there. Needs the person's permission " +
        '— Settings ▸ Agent, "Let agents edit open files"; without it the write is refused. Never ' +
        "saves; checksums are not updated — use a module's fix, such as `uefi_fix_checksum`.",
      inputSchema: AgentSchema.object(
        {
          document: AgentSchema.string(
            "The document's id from `documents`. Default: the focused one."
          ),
          offset: AgentSchema.offset('Where the bytes go, e.g. "0x7F3000".'),
          bytes: AgentSchema.string(
            'The bytes as hex, e.g. "DE AD BE EF" or "deadbeef"; at most 64 KiB.'
          ),
          label: AgentSchema.string(
            'What the change is, for the undo step: "Enable the debug option".'
          ),
          expect: AgentSchema.string("The bytes that must be at `offset` now, as hex. Optional."),
        },
        ["offset", "bytes", "label"]
      ),
      annotations: EDIT,
      run: async (call) => jsonAnswer(await this.write(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.write */
  async write(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    this.checkEditable(place);
    const offset = args.offset("offset");
    const bytes = parseHexBytes(args.string("bytes"), "bytes");
    const label = args.string("label").trim();
    if (label === "") throw new AgentToolError("`label` is empty; say what the change is.");
    if (bytes.length === 0) throw new AgentToolError("`bytes` is empty.");
    if (bytes.length > WRITE_LIMIT) {
      throw new AgentToolError(
        `${bytes.length} bytes is more than one write carries (${WRITE_LIMIT}).`
      );
    }
    if (args.has("expect")) {
      const expected = parseHexBytes(args.string("expect"), "expect");
      const size = place.document.size;
      if (offset + expected.length > size) {
        throw new AgentToolError(`\`expect\` runs past the end of ${place.id}.`);
      }
      const actual = await place.document.read(offset, expected.length);
      if (hexByteText(actual) !== hexByteText(expected)) {
        throw new AgentToolError(
          `Nothing written: the bytes at ${hexText(offset)} are ${hexByteText(actual)}, ` +
            `not ${hexByteText(expected)}.`
        );
      }
    }
    // The undo step is named in the app's own language: the person reads it in their Edit menu.
    const name = L("Agent: %1$@", label);
    return this.apply({ name, writes: [{ offset, bytes }] }, place);
  }

  // MARK: - copy_to_other_pane

  private copyTool(): AgentTool {
    return agentTool({
      name: "copy_to_other_pane",
      title: "Copy bytes to the other pane",
      description:
        "Copies a range of one of the window's two files over the same addresses in the other — " +
        "what Edit ▸ Copy to Other Pane does with the selection. The bytes go from file to file " +
        "inside ByteRipper and never through you, so there is no size limit: a whole region or " +
        "volume is one call. Overwrites only: a range past the end of the other file is refused, " +
        "never grown. One undo step in the receiving file, named by `label`; the copied bytes show " +
        "red until the person saves, and its pane scrolls to them. The answer says how many bytes " +
        "actually changed and where in the firmware the range lies. Needs the person's permission " +
        '— Settings ▸ Agent, "Let agents edit open files". Never saves; checksums are not updated.',
      inputSchema: AgentSchema.object(
        {
          document: AgentSchema.string(
            "The file to copy from: one of the window's two files, by its id from `documents`. " +
              "Default: the focused one."
          ),
          offset: AgentSchema.offset('The first byte, e.g. "0x7F3000".'),
          length: AgentSchema.offset("How many bytes, at least 1."),
          label: AgentSchema.string(
            "What the copy is, for the undo step, in the person's language. Default: Copy to Other Pane."
          ),
        },
        ["offset", "length"]
      ),
      annotations: EDIT,
      run: async (call) => jsonAnswer(await this.copyToOtherPane(call.arguments)),
    });
  }

  /**
   * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.copyToOtherPane
   * @upstream-differs no read-only refusal: a page edits every document it holds in memory, so
   * there is no destination that cannot be written into
   */
  async copyToOtherPane(args: AgentArguments): Promise<Json> {
    const source = this.desk.placeNamed(args.optionalString("document"));
    source.onScreen();
    if (source.slot !== "A" && source.slot !== "B") {
      throw new AgentToolError(
        `${source.id} is a part over a file, not one of the window's two files; it has no ` +
          "pane beside it. Use `write`, or copy in the window's own files."
      );
    }
    const other = this.desk.places().find((one) => one.slot === (source.slot === "A" ? "B" : "A"));
    if (other === undefined) {
      throw new AgentToolError(
        `${source.id} is alone in the window; there is no other pane to copy into. ` +
          "`compare` puts a second file beside it."
      );
    }
    const offset = args.offset("offset");
    const length = args.offset("length");
    if (length <= 0) throw new AgentToolError("Argument `length` must be at least 1.");
    const sourceSize = source.document.size;
    if (offset >= sourceSize || length > sourceSize - offset) {
      throw new AgentToolError(
        `The range ${hexText(offset)}+${hexText(length)} runs past the end of ${source.id}, ` +
          `which is ${hexText(sourceSize)} bytes long.`
      );
    }
    this.checkEditable(other);
    const end = offset + length;
    const otherSize = other.document.size;
    if (end > otherSize) {
      throw new AgentToolError(
        `The range ends at ${hexText(end)}, past the end of ${other.id}, which is ` +
          `${hexText(otherSize)} bytes long. Nothing was copied; a copy overwrites, it does not grow the file.`
      );
    }
    const bytes = await source.document.read(offset, length);
    const there = await other.document.read(offset, length);
    if (bytes.length !== length || there.length !== length) {
      throw new AgentToolError(`Could not read ${hexText(length)} bytes at ${hexText(offset)}.`);
    }
    let changed = 0;
    for (let index = 0; index < length; index++) if (bytes[index] !== there[index]) changed += 1;
    const label = (args.optionalString("label") ?? "").trim();
    // The undo step is named in the app's own language: the person reads it in their Edit menu.
    const name = L("Agent: %1$@", label === "" ? L("Copy to Other Pane") : label);
    const answer: { [key: string]: Json } = {
      from: source.id,
      to: other.id,
      start: hexText(offset),
      end: hexText(end),
      length: hexText(length),
      changed,
    };
    const places = await this.locate(source, { start: offset, end });
    if (places.length > 0) answer.where = places;
    if (changed === 0) {
      // Nothing to undo: the other file holds these bytes already.
      answer.undo = null;
      answer.note = "The other file already holds these bytes; nothing was written.";
      return answer;
    }
    const applied = await this.apply({ name, writes: [{ offset, bytes }] }, other);
    if (typeof applied === "object" && applied !== null && !Array.isArray(applied)) {
      answer.undo = applied.undo ?? null;
    }
    answer.saved = false;
    return answer;
  }

  // MARK: - Applying

  /**
   * Refuses unless the switch is on and `place` can be changed: the sentence the model is given says
   * what would make it possible.
   *
   * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.checkEditable
   */
  checkEditable(place: AgentPlace): void {
    if (!this.isAllowed()) {
      throw new AgentToolError(
        "Editing is switched off. The person allows it in ByteRipper's Settings ▸ Agent, " +
          '"Let agents edit open files". Say what you would change instead.'
      );
    }
    place.onScreen();
  }

  /**
   * Writes `transaction` into `place` as one undo step, brings the change on screen as a step of
   * the navigation history, and answers what was there before.
   *
   * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.apply
   */
  async apply(transaction: ToolTransaction, place: AgentPlace): Promise<Json> {
    this.checkEditable(place);
    const pane = place.onScreen();
    const checked = validateTransaction(transaction);
    if (!checked.ok) {
      throw new AgentToolError(
        `The change cannot be made: ${transactionProblemMessage(checked.problem)}`
      );
    }
    const writes = checked.transaction.writes;
    const size = place.document.size;
    const past = writes.find((write) => write.offset + write.bytes.length > size);
    if (past !== undefined) {
      throw new AgentToolError(
        `A write at ${hexText(past.offset)} runs past the end of ${place.id}, ` +
          `which is ${hexText(size)} bytes long. Writes overwrite; they do not grow the file.`
      );
    }
    const before = await Promise.all(
      writes.map((write) =>
        place.document.read(write.offset, Math.min(write.bytes.length, BEFORE_LIMIT))
      )
    );
    const problem = await applyTransaction(pane, checked.transaction);
    if (problem !== undefined) {
      throw new AgentToolError(`Could not write into ${place.id}: ${problem}`);
    }
    const first = writes[0];
    const last = writes.at(-1);
    if (first !== undefined && last !== undefined) {
      agentShell.bringForward?.(pane);
      recordJump(pane);
      await agentShell.reveal?.(pane, first.offset, last.offset + last.bytes.length, false);
    }
    return {
      document: place.id,
      written: writes.map((write, index): Json => {
        const was = before[index] ?? new Uint8Array();
        const members: { [key: string]: Json } = {
          start: hexText(write.offset),
          end: hexText(write.offset + write.bytes.length),
          before: hexByteText(was),
        };
        if (was.length < write.bytes.length) members.before_cut = true;
        return members;
      }),
      undo: checked.transaction.name,
      saved: false,
    };
  }
}
