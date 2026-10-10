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
import { appLanguage, LIn } from "@/core/localization/localization";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { hexText, rangeJson } from "@/state/agent/agentHostTools";
import { agentShell } from "@/state/agent/agentShell";
import { recordJump } from "@/state/navigationStore";
import { aDialogIsOpen, updateInParentQuietly, updateStepName } from "@/state/partUpdate";
import { applyTransaction } from "@/state/toolEdits";
import type { PartId } from "@/state/workspaceStore";
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
    return [this.writeTool(), this.copyTool(), this.updateInParentTool()];
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
    const name = LIn("Agent: %1$@", appLanguage(), label);
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
    const app = appLanguage();
    const name = LIn("Agent: %1$@", app, label === "" ? LIn("Copy to Other Pane", app) : label);
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

  // MARK: - update_in_parent

  private updateInParentTool(): AgentTool {
    return agentTool({
      name: "update_in_parent",
      title: "Update in Parent",
      description:
        "Puts a part's bytes back into the document it was opened from — File ▸ Update in Parent. " +
        "The part's codec says how: a copy goes back as it is, a decompressed body is compressed again " +
        "and the image laid out around it, a decoded block is encoded again with its checksum. One undo " +
        "step in the parent; the parent's bytes show red until the person saves, and the parent is " +
        "shown where they landed. A part with nothing new answers `updated: false`. Refused, with " +
        "nothing written: when the parent is closed; when the codec cannot put the bytes " +
        "back (a part whose length changed, a body that no longer fits once compressed — the answer " +
        "gives the codec's reason); when the parent changed while the update was worked out (call " +
        "again); and when the bytes the part came from have changed in the parent since it was " +
        "opened — then ask the person, and call again with `overwrite_changed_source: true` only if " +
        'they agree. Needs the person\'s permission — Settings ▸ Agent, "Let agents edit open files". ' +
        "Never saves.",
      inputSchema: AgentSchema.object({
        document: AgentSchema.string("The part's id from `documents`. Default: the focused one."),
        overwrite_changed_source: AgentSchema.boolean(
          "Overwrite the parent's bytes even though they changed since the part was opened. " +
            "Only after the person said so. Default false."
        ),
      }),
      annotations: EDIT,
      run: async (call) => jsonAnswer(await this.updateInParent(call.arguments)),
    });
  }

  /**
   * @upstream ByteRipperApp/Agent/AgentEditTools.swift#AgentEditTools.updateInParent
   * @upstream-differs no read-only parent to refuse: a page edits every document it holds in memory
   */
  async updateInParent(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const pane = place.onScreen();
    const origin = place.state?.origin;
    if (origin === undefined || place.slot !== "part") {
      throw new AgentToolError(
        `${place.id} is not a part, so it has no parent to go back into. ` +
          "`open_part` opens a part; `documents` lists which documents are parts."
      );
    }
    if (!this.isAllowed()) {
      throw new AgentToolError(
        "Editing is switched off. The person allows it in ByteRipper's Settings ▸ Agent, " +
          '"Let agents edit open files". Say what you would put back instead.'
      );
    }
    const parentId = this.desk.placeOf(origin.parent)?.id;
    const parentName = parentId ?? "the parent";
    if (aDialogIsOpen()) {
      throw new AgentToolError(
        "A dialog is open in that window. Ask the person to finish it first. Nothing was written."
      );
    }
    const overwrite = args.bool("overwrite_changed_source", false);
    const sourceBefore = origin.sourceRange;
    const answer: { [key: string]: Json } = { document: place.id };
    if (parentId !== undefined) answer.parent = parentId;
    const outcome = await updateInParentQuietly(pane as PartId, overwrite);
    switch (outcome.kind) {
      case "unchanged":
        answer.updated = false;
        answer.note = `The part holds nothing ${parentName} has not got back already; nothing was written.`;
        return answer;
      case "refused":
        throw new AgentToolError(
          `${outcome.refusal.title.textIn("en")}. ${outcome.refusal.messageText.textIn("en")} Nothing was written.`
        );
      case "sourceChanged":
        throw new AgentToolError(
          `The bytes ${place.id} was opened from (${hexText(sourceBefore[0])}–` +
            `${hexText(sourceBefore[1])} in ${parentName}) have changed there since. ` +
            "Updating would overwrite those changes. Nothing was written. Ask the person; call again with " +
            "`overwrite_changed_source: true` only if they agree."
        );
      case "parentChanged":
        throw new AgentToolError(
          `${parentName} changed while the update was being worked out. Nothing was written; ` +
            "call again to work it out over its bytes as they are now."
        );
      case "writeFailed":
        throw new AgentToolError(
          `Could not write into ${parentName}: ${outcome.reason}. Nothing was written.`
        );
      case "updated": {
        const { update } = outcome;
        answer.updated = true;
        answer.written = rangeJson(update.offset, update.offset + update.bytes.length);
        answer.source = rangeJson(update.source[0], update.source[1]);
        if (update.notes.length > 0) answer.notes = update.notes.map((note) => note.textIn("en"));
        answer.undo = updateStepName(place.name);
        answer.saved = false;
        // Shown where the bytes landed, as the command does.
        const parent = origin.parent;
        agentShell.bringForward?.(parent);
        await agentShell.reveal?.(
          parent,
          update.offset,
          update.offset + Math.max(1, update.bytes.length),
          false
        );
        return answer;
      }
    }
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
