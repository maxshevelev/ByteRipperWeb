import { type AgentArguments, AgentSchema, parseOffset } from "@/core/agent/agentArguments";
import {
  contextArgument,
  previewJson,
  toWire,
  type WantedPattern,
  wantedPatterns,
} from "@/core/agent/agentFind";
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
import { type Json, jsonText, member } from "@/core/agent/json";
import { CopyPartCodec } from "@/core/parts/partCodec";
import { maskedMatches } from "@/core/search/maskedSearch";
import type { ByteStorage } from "@/core/storage/byteStorage";
import type { AgentDesk } from "@/state/agent/agentDesk";
import type { AgentDiffTools } from "@/state/agent/agentDiffTools";
import { placeJson } from "@/state/agent/agentDiffTools";
import { hexText, rangeJson } from "@/state/agent/agentHostTools";
import type { AgentModuleTools } from "@/state/agent/agentModuleTools";
import { readyFirmware } from "@/state/firmwareReady";
import {
  askFirmwareLayout,
  askFirmwarePart,
  askUefiAgent,
  expandFirmwareNodeAndWait,
  firmwareFor,
  firmwareNodeAt,
} from "@/state/firmwareStore";
import { openLinkedPart } from "@/state/openLinkedPart";
import { UEFIPartCodec } from "@/state/uefiPartCodec";
import { paneState } from "@/state/workspaceStore";
import type { ToolAgentPlace } from "@/tools/toolAgent";
import { isSecretName } from "@/tools/uefi/agent/uefiAgentRegions";
import { compressionName, nodeOpen, partName } from "@/tools/uefi/uefiPresenter";

/**
 * Searching a document's bytes, and opening a stretch of them as a part (`Design/PORT_AGENT.md`,
 * search and extract).
 *
 * The search is the find bar's own engine (`maskedMatches`), so an agent and a person find the same;
 * it is given holes in a hex pattern and, when asked, matches that overlap. A node inside a
 * compressed section is searched in what the tree decompressed it to. A part opens as the window
 * opens one — Open Zone's way for a range, the UEFI panel's Open for a node — over its parent,
 * linked back to it.
 *
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.desk
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.diff
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.init
 * @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.tools
 */

/** The UEFI Structure panel, which a part taken out of its tree opens with on. */
const UEFI_TOOL = "dev.maxik.tool.uefi-structure";

export class AgentFindTools {
  private readonly desk: AgentDesk;
  /** Where a match is in the firmware: the byte comparison's own helper. */
  private readonly diff: AgentDiffTools;
  private readonly moduleTools: AgentModuleTools;

  constructor(desk: AgentDesk, diff: AgentDiffTools, moduleTools: AgentModuleTools) {
    this.desk = desk;
    this.diff = diff;
    this.moduleTools = moduleTools;
  }

  tools(): AgentTool[] {
    return [this.findTool(), this.openPartTool()];
  }

  // MARK: - find_bytes

  private findTool(): AgentTool {
    return agentTool({
      name: "find_bytes",
      title: "Find bytes or text",
      description:
        "Every place a text or a byte pattern occurs in a document, in address order, read as it is " +
        "now with unsaved edits — the find bar's own search. `text` is looked for as ASCII, as " +
        "UTF-16LE, or both (`encoding`, default both), any case with `ignore_case`; `hex` is bytes, " +
        'with `??` for a byte that may be anything ("24 ?? 4D 49"). The file is searched as it is ' +
        "stored, so nothing inside a compressed section is found that way: give `node` (an id from " +
        "`uefi_tree`, `uefi_find` or `uefi_at`) to search that node's bytes, and for a node inside a " +
        "compressed section, what it decompressed to; a compressed section itself is searched in " +
        "what it decompresses to (`decompressed: true`). Matches in a decompressed buffer say " +
        "`node_start` and `node_end` inside it instead of file addresses, and `uefi_node_data` reads " +
        "around them — with part `decompressed` for a section's. " +
        "Each match: `start`, `end` (half-open), the `encoding` that matched, `where` it is — as " +
        "`diff` places a run: the top-level area and the deepest node that holds it — and, with " +
        "`context`, a `preview` of the bytes around it — none, and `redacted: true`, in an area the flash " +
        "map names MSDM, Password or Key. `total` counts every match in the range. " +
        'Matches do not overlap unless `overlapping`: "AA" in "AAAA" is two, or three with it. ' +
        "Pages: `limit` is a ceiling — a page also stops before the answer passes the size bound and " +
        'says `truncated: "size"`; pass `next` back as `after` until it is null. With `survey`, which ' +
        "dumps of a folder hold a string.",
      inputSchema: AgentSchema.object({
        document: AgentSchema.string(
          "The document's id from `documents`. Default: the focused one."
        ),
        text: AgentSchema.string("A text to find. Give `text` or `hex`."),
        hex: AgentSchema.string('Bytes to find, as hex pairs; `??` for any byte: "24 ?? 4D 49".'),
        encoding: AgentSchema.choice(
          ["ascii", "utf16le", "both"],
          'How `text` is stored. Default "both".'
        ),
        ignore_case: AgentSchema.boolean(
          "Letters in either case — ASCII letters of `text`. Default false."
        ),
        overlapping: AgentSchema.boolean("Count matches that overlap one another. Default false."),
        offset: AgentSchema.offset(
          "Where the search starts — inside the node with `node`. Default 0x0."
        ),
        end: AgentSchema.offset("The first byte after the searched range. Default: the end."),
        node: AgentSchema.string(
          "Search only this UEFI node's bytes, decompressed where it is in a compressed section."
        ),
        context: AgentSchema.integer(
          "Bytes before and after each match to show in `preview`. Default 0, at most 64."
        ),
        limit: AgentSchema.limit(100, 1000),
        after: AgentSchema.after,
      }),
      annotations: READ_ONLY,
      run: async (call) => jsonAnswer(await this.find(call)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.find */
  async find(call: AgentCall): Promise<Json> {
    const args = call.arguments;
    const place = this.desk.placeNamed(args.optionalString("document"));
    const wanted = wantedPatterns(args);
    const overlapping = args.bool("overlapping", false);
    const context = contextArgument(args);
    const limit = args.limit(100, 1000);
    const host = this.moduleTools.hostFor(place);
    const question: { [key: string]: Json } = { ...args.values };
    delete question.after;
    delete question.limit;
    const paging = new AgentPage(
      args,
      AgentPage.fingerprint([host.contentVersion, jsonText(question)])
    );
    const envelope: { [key: string]: Json } = { document: place.id };
    const nodeText = args.optionalString("node");
    const offset = args.optionalOffset("offset") ?? 0;

    let total: number;
    let items: { [key: string]: Json }[];
    let inCompressed = false;
    if (nodeText !== undefined) {
      await readyFirmware(host.pane);
      const response = await askUefiAgent(host.pane, {
        query: "uefi_find_bytes",
        values: {
          node: nodeText,
          ...(args.has("offset") ? { offset } : {}),
          ...(args.has("end") ? { end: args.offset("end") } : {}),
          patterns: wanted.map((one) => ({ ...toWire(one) })) as unknown as Json,
          overlapping,
          context,
          first: paging.first,
          limit,
        },
        answerBound: args.answerBound,
        contentVersion: host.contentVersion,
      });
      if (response.error !== undefined) throw new AgentToolError(response.error);
      const found = response.answer as {
        envelope: { [key: string]: Json };
        total: number;
        range: { start: number; end: number };
        items: { [key: string]: Json }[];
      };
      Object.assign(envelope, found.envelope);
      envelope.range = rangeJson(found.range.start, found.range.end);
      total = found.total;
      items = found.items;
      inCompressed = found.envelope.in_compressed === true;
    } else {
      const size = place.document.size;
      const end = args.optionalOffset("end") ?? size;
      if (!(offset < end && end <= size)) {
        throw new AgentToolError(
          `The range ${hexText(offset)}–${hexText(end)} is not inside ${place.id}, which is ${hexText(size)} bytes long.`
        );
      }
      envelope.range = rangeJson(offset, end);
      if (wanted.every((one) => one.pattern.bytes.length > end - offset)) {
        throw new AgentToolError("The pattern is longer than the range searched.");
      }
      const found = await this.searchDocument(call, place.document.storage, wanted, {
        range: { start: offset, end },
        overlapping,
        first: paging.first,
        limit,
        context,
      });
      total = found.total;
      items = found.items;
    }
    envelope.total = total;

    // Where each match is: the firmware's areas for the file's bytes (a buffer's were placed where
    // the tree holds it).
    if (!inCompressed) {
      const spans = items.map((one) => ({
        start: parseOffset(String(one.start)) ?? 0,
        end: parseOffset(String(one.end)) ?? 0,
      }));
      const places: ToolAgentPlace[][] = await this.diff.locate(host, spans);
      for (const [index, item] of items.entries()) {
        item.where = (places[index] ?? []).map(placeJson);
      }
    }
    // An area the flash map names for a secret — MSDM, a password, a key — gives its matches but
    // not the bytes around them.
    //
    // @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.find
    if (context > 0) {
      for (const item of items) {
        const places = Array.isArray(item.where) ? item.where : [];
        const secret = places.some((one) => {
          const name = member(one, "name");
          return typeof name === "string" && isSecretName(name);
        });
        if (!secret) continue;
        delete item.preview;
        item.redacted = true;
      }
    }
    return paging.answer(envelope, "matches", items, total, args.answerBound, (item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
      const members = item as { [key: string]: Json };
      if (members.preview === undefined) return undefined;
      const { preview: _dropped, ...rest } = members;
      return { ...rest, truncated: "item" };
    });
  }

  private async searchDocument(
    call: AgentCall,
    storage: ByteStorage,
    wanted: readonly WantedPattern[],
    options: {
      readonly range: { start: number; end: number };
      readonly overlapping: boolean;
      readonly first: number;
      readonly limit: number;
      readonly context: number;
    }
  ): Promise<{ total: number; items: { [key: string]: Json }[] }> {
    let total = 0;
    const page: { start: number; end: number; pattern: number }[] = [];
    await maskedMatches(
      wanted.map((one) => one.pattern),
      storage,
      (match, pattern) => {
        if (total >= options.first && page.length < options.limit) {
          page.push({ start: match.start, end: match.end, pattern });
        }
        total += 1;
        return true;
      },
      {
        range: options.range,
        overlapping: options.overlapping,
        shouldCancel: () => call.signal.aborted,
      }
    );
    const items: { [key: string]: Json }[] = [];
    for (const match of page) {
      const encoding = wanted[match.pattern]?.encoding ?? "hex";
      const members: { [key: string]: Json } = {
        encoding,
        start: hexText(match.start),
        end: hexText(match.end),
      };
      if (options.context > 0) {
        const around = {
          start: Math.max(0, match.start - Math.min(options.context, match.start)),
          end: Math.min(storage.size, match.end + options.context),
        };
        const bytes = await storage.read(around.start, around.end - around.start);
        members.preview = previewJson(bytes, encoding, match.start - around.start);
      }
      items.push(members);
    }
    return { total, items };
  }

  // MARK: - open_part

  private openPartTool(): AgentTool {
    return agentTool({
      name: "open_part",
      title: "Open a part",
      description:
        "Opens a stretch of a document as a part of its own, over its parent's pane — as Open Zone " +
        "and the UEFI Structure panel's Open do — and answers its new `document` id. The part's " +
        "addresses start at 0, so two blocks at different addresses of two dumps compare with `diff` " +
        "and `compare`; every tool that takes `document` works on it. Give `offset` and `length`, or " +
        '`node` (with `part` "all", the default, or "body") for a UEFI node\'s bytes — a node inside a ' +
        "compressed section opens as what it decompressed to. The part stays linked: edits to it stay " +
        "in it until the person puts them back with Update in Parent, which for a decompressed node " +
        "compresses them again. The parent must be on screen (`show` puts a background dump there). " +
        "Closes with `close_dump` or by the person.",
      inputSchema: AgentSchema.object({
        document: AgentSchema.string("The parent's id from `documents`. Default: the focused one."),
        offset: AgentSchema.offset("Where the part starts in the parent."),
        length: AgentSchema.offset("How many bytes the part is."),
        node: AgentSchema.string("Instead of `offset` and `length`: a UEFI node's id."),
        part: AgentSchema.choice(
          ["all", "body"],
          'With `node`: the whole node, or its body. Default "all".'
        ),
        name: AgentSchema.string(
          "What the part is called. Default: the parent's name and what it is."
        ),
      }),
      annotations: VIEW,
      run: async (call) => jsonAnswer(await this.openPart(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentFindTools.swift#AgentFindTools.openPart */
  async openPart(args: AgentArguments): Promise<Json> {
    const place = this.desk.placeNamed(args.optionalString("document"));
    const parent = place.onScreen();
    const parentName = paneState(parent)?.name ?? place.name;
    const named = args.optionalString("name");
    const answer: { [key: string]: Json } = { parent: place.id };
    let opened: string | undefined;

    const nodeText = args.optionalString("node");
    if (nodeText !== undefined) {
      if (args.has("offset") || args.has("length")) {
        throw new AgentToolError("Give `node`, or `offset` and `length` — not both.");
      }
      const body = args.choice("part", ["all", "body"] as const, "all") === "body";
      await readyFirmware(parent);
      const path = nodePath(nodeText);
      // The branches on the way are read where the tree is, and the panel's copy follows.
      for (let length = 1; length < path.length; length++) {
        await expandFirmwareNodeAndWait(parent, path.slice(0, length));
      }
      const roots = firmwareFor(parent)?.roots ?? [];
      const node = firmwareNodeAt(roots, path);
      if (node === undefined) {
        throw new AgentToolError(
          `No node ${nodeText} in this image. Ids come from \`uefi_tree\`, \`uefi_find\` or \`uefi_at\` on the same document.`
        );
      }
      const open = nodeOpen(node, body, roots);
      if (open === undefined) {
        throw new AgentToolError(
          `Node ${nodeText} cannot be opened as a part: there is nothing there, ` +
            "or its compressed section cannot be traced back to the file."
        );
      }
      // As the UEFI panel's Open: the file's own bytes go back as they are, or through the planner for
      // a structure; a decompressed node's go back through its section, compressed again.
      const codec =
        open.space.length === 0 && open.rebuild === undefined
          ? new CopyPartCodec()
          : new UEFIPartCodec({
              pane: parent,
              target: open.rebuild ?? {
                space: open.space,
                range: { start: open.range[0], end: open.range[1] },
              },
              compression: compressionName(open.space, roots),
            });
      const part = await openLinkedPart({
        parent,
        name: named ?? open.suggestedName,
        source: open.source,
        partName: named ?? partName(open.suggestedName, parentName),
        codec,
        layout: await askFirmwareLayout(parent, { node: node.id, body }),
        tool: UEFI_TOOL,
      });
      opened = part;
      answer.node = nodeText;
      answer.in_compressed = open.space.length !== 0;
      answer.source = rangeJson(open.source[0], open.source[1]);
      answer.size = hexText(open.range[1] - open.range[0]);
    } else {
      if (!args.has("offset") || !args.has("length")) {
        throw new AgentToolError("Give `offset` and `length`, or `node`.");
      }
      const offset = args.offset("offset");
      const length = args.offset("length");
      const size = place.document.size;
      if (!(length > 0 && offset < size && length <= size - offset)) {
        throw new AgentToolError(
          `${hexText(offset)} and ${hexText(length)} bytes do not fit in ${place.id}, which is ${hexText(size)} bytes long.`
        );
      }
      const source: [number, number] = [offset, offset + length];
      const dot = parentName.lastIndexOf(".");
      const stem = dot <= 0 ? parentName : parentName.slice(0, dot);
      // As Open Zone: a stretch that is a structure of the image goes back through the rebuild
      // planner, any other as it is.
      const reading = await askFirmwarePart(parent, { range: source });
      const part = await openLinkedPart({
        parent,
        name: named ?? `${stem}_${hexText(offset)}-${hexText(source[1])}`,
        source,
        layout: reading.layout,
        codec:
          reading.rebuild === undefined
            ? new CopyPartCodec()
            : new UEFIPartCodec({ pane: parent, target: reading.rebuild }),
      });
      opened = part;
      answer.source = rangeJson(source[0], source[1]);
      answer.size = hexText(length);
    }
    const slot = opened === undefined ? undefined : paneState(opened as `part:${number}`);
    if (opened === undefined || slot === undefined) {
      throw new AgentToolError("The part could not be opened.");
    }
    answer.document = this.desk.id(slot.document);
    answer.name = slot.name;
    return answer;
  }
}

/** A node id as indices; the top is no node. */
function nodePath(text: string): number[] {
  if (!/^[0-9]+(\.[0-9]+)*$/.test(text)) {
    throw new AgentToolError(
      `\`${text}\` is not a node id. Ids look like "0.2.5" and come from \`uefi_tree\`, \`uefi_find\` or \`uefi_at\`.`
    );
  }
  return text.split(".").map(Number);
}
