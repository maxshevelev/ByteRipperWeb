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
 */

/** The most bytes one `write` carries: a patch, not an image. */
export const WRITE_LIMIT = 0x1_0000;
/** The most bytes of what was there an answer repeats. */
export const BEFORE_LIMIT = 64;

export class AgentEditTools {
  readonly desk: AgentDesk;
  /** The edit switch, read at each call. */
  isAllowed: () => boolean = () => false;

  constructor(desk: AgentDesk) {
    this.desk = desk;
  }

  tools(): AgentTool[] {
    return [this.writeTool()];
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
