import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { hexText as bytesHex } from "@/core/agent/agentBytes";
import { AgentPage } from "@/core/agent/agentPage";
import { AgentToolError } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { withEnglish } from "@/core/localization/localization";
import { maskedMatches, maskedPattern } from "@/core/search/maskedSearch";
import type { ByteStorage } from "@/core/storage/byteStorage";
import { isFileSpace } from "@/firmware/uefi/byteSpace";
import { guidBytes, guidFromText, guidText } from "@/firmware/uefi/efiGuid";
import { nodeIdText, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import { ReaderStorage } from "@/tools/uefi/agent/uefiAgentFind";
import { compressedView, deepestCovering } from "@/tools/uefi/agent/uefiAgentNodeData";
import { hexText, type UefiAgentContext } from "@/tools/uefi/agent/uefiAgentQueries";
import { isBIOSRegion } from "@/tools/uefi/agent/uefiAgentRegions";
import {
  type AgentTree,
  allNodes,
  nodeAtPath,
  openEverything,
} from "@/tools/uefi/agent/uefiAgentTree";
import { decompressedBody } from "@/tools/uefi/uefiPresenter";
import { ownName, subtypeText, typeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * Who in a firmware image refers to an address or a GUID (`Design/AGENT_PROTOCOL.md`, `refs`):
 * every place its bytes occur — in the file and in what the compressed sections decompress to —
 * answered per FFS file rather than per section, so "which modules use this region" is one call
 * instead of a search and a lookup per hit.
 *
 * The search is `find_bytes`'s (`maskedMatches`) over the same buffers the tree decompressed;
 * nothing is decompressed a second time.
 *
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.tools
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.refsTool
 * @upstream-differs a function of the worker's tree: the buffers it searches are in the worker that holds the tree, where upstream's tool reads them on the main actor
 */

/** The most hits one file lists before the rest are only counted. @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.maxHitsPerFile */
export const MAX_HITS_PER_FILE = 20;

export const REFS = {
  name: "refs",
  title: "Find references to an address or a GUID",
  description:
    "Every place in a firmware image that refers to an address or a GUID, in the file and inside " +
    'its compressed sections, grouped by the FFS file each is in — so "which modules use this ' +
    'region" is one call. `guid` is written as usual and searched in its EFI byte order. ' +
    '`address` is a file address (or, with `relative_to` "region", an offset in the BIOS region) ' +
    "and is searched in the forms `forms` names: `bus` — where the BIOS region is mapped below " +
    "4 GiB, the region's end at 0x100000000, as 32 and 64 bits; `file` — the file address; " +
    "`region` — the offset in the BIOS region; each little-endian, 32 bits. Address hits are " +
    "chance as often as not in code: each says the `form` it matched, and none is hidden, but a " +
    'shorter form is not listed apart where it only matched inside a longer one. `scope`: "all" ' +
    '(default), "raw" (the file as stored) or "compressed" (what the sections decompress to). ' +
    "Per file: `file` (its id), `name`, `guid`, `type`, `in_compressed`, and `hits` — `form`, " +
    "`section` and `section_offset` in it, `file_start` where the hit has a file address. A hit " +
    "in no FFS file is listed by the deepest `node` holding it. `total` counts the hits, `files` " +
    "the groups. Pages: `limit` is a ceiling on files — a page also stops before the answer " +
    'passes the size bound and says `truncated: "size"`; pass `next` back as `after`. With ' +
    "`survey`, which dumps of a folder refer to a GUID.",
  properties: {
    guid: AgentSchema.string(
      'A GUID, e.g. "8C8CE578-8A3D-4F1C-9935-896185C32DD3". Give `guid` or `address`.'
    ),
    address: AgentSchema.offset('An address, e.g. "0x668000". Give `guid` or `address`.'),
    relative_to: AgentSchema.choice(
      ["file", "region"],
      "What `address` counts from: the file (default) or the BIOS region."
    ),
    forms: AgentSchema.strings(
      'Which forms of `address` to search: "bus", "file", "region". Default all three.'
    ),
    scope: AgentSchema.choice(["all", "raw", "compressed"], 'Where to search. Default "all".'),
    limit: AgentSchema.limit(50, 200),
    after: AgentSchema.after,
  },
} as const;

/**
 * One byte pattern and the form it stands for.
 *
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.Form
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.Form.name
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.Form.bytes
 */
export interface Form {
  readonly name: string;
  readonly bytes: readonly number[];
}

/**
 * The patterns `address` is searched as, longest first within a form. `bios` is the BIOS region's
 * file range, the whole file when the image is the BIOS alone. A form whose value fits in a byte
 * is left out: it would match nearly everywhere.
 *
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.forms
 */
export function forms(
  address: number,
  relativeToRegion: boolean,
  bios: { readonly start: number; readonly end: number },
  names: ReadonlySet<string>
): { forms: Form[]; skipped: string[] } {
  const file = relativeToRegion ? bios.start + address : address;
  const region = file - bios.start;
  const bus = 0x1_0000_0000 - (bios.end - file);
  const made: Form[] = [];
  const skipped: string[] = [];
  const add = (name: string, value: number, width: number): void => {
    if (!names.has(name)) return;
    if (value <= 0xff) {
      if (!skipped.includes(name)) skipped.push(name);
      return;
    }
    const bytes = Array.from(
      { length: width },
      (_, index) => Math.floor(value / 2 ** (8 * index)) % 256
    );
    // The same bytes under two names — a BIOS-only image, where the file and the region are one
    // — are searched once, by the first.
    if (made.some((one) => one.bytes.join(",") === bytes.join(","))) return;
    made.push({ name, bytes });
  };
  add("bus", bus, 8);
  add("bus", bus, 4);
  add("file", file, 4);
  add("region", region, 4);
  return { forms: made, skipped };
}

/**
 * One place the bytes were found: where in its space, and as which form.
 *
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.Hit
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.Hit.range
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.Hit.form
 * @upstream-differs the range is `start` and `end`
 */
export interface Hit {
  readonly start: number;
  readonly end: number;
  readonly form: number;
}

/**
 * The hits of one buffer without those that only matched inside a hit of a longer form — `bus`
 * 32 bits inside `bus` 64, a short value inside a long one.
 *
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.withoutInner
 */
export function withoutInner(hits: readonly Hit[], formsOf: readonly Form[]): Hit[] {
  // The hits come in order of where they start, and a form is at most 16 bytes: an enclosing
  // hit starts at most that far before.
  const sorted = [...hits].sort((one, two) => one.start - two.start);
  const encloses = (outer: Hit, inner: Hit): boolean =>
    (formsOf[outer.form]?.bytes.length ?? 0) > (formsOf[inner.form]?.bytes.length ?? 0) &&
    outer.start <= inner.start &&
    inner.end <= outer.end;
  return sorted.filter((hit, index) => {
    let other = index - 1;
    while (other >= 0 && hit.start - (sorted[other] as Hit).start <= 16) {
      if (encloses(sorted[other] as Hit, hit)) return false;
      other -= 1;
    }
    other = index + 1;
    while (other < sorted.length && (sorted[other] as Hit).start === hit.start) {
      if (encloses(sorted[other] as Hit, hit)) return false;
      other += 1;
    }
    return true;
  });
}

const formName = (form: Form): string => form.name + (form.bytes.length === 8 ? "64" : "");

const sameSpace = (one: readonly number[], two: readonly number[]): boolean =>
  one.length === two.length && one.every((part, index) => part === two[index]);

/** The nodes from the top of the tree down to `node`, `node` last. */
function chainTo(node: UEFINode, tree: AgentTree): UEFINode[] {
  const chain: UEFINode[] = [];
  for (let length = 1; length <= Math.max(1, node.id.length); length++) {
    const found = nodeAtPath(tree, node.id.slice(0, length));
    if (found !== undefined) chain.push(found);
  }
  return chain;
}

interface Buffer {
  readonly storage: ByteStorage;
  readonly space: readonly number[];
  readonly under: UEFINode | undefined;
}

/**
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.refs
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.biosRegion
 * @upstream ByteRipperApp/Agent/AgentRefsTools.swift#AgentRefsTools.chain
 */
export async function refs(
  tree: AgentTree,
  args: AgentArguments,
  context: UefiAgentContext
): Promise<Json> {
  // The questions the tree is asked are answered in English, whatever the page speaks; the
  // search between them is the only part that waits.
  const prepared = withEnglish(() => {
    const scope = args.choice("scope", ["all", "raw", "compressed"] as const, "all");
    const limit = args.limit(50, 200);
    const guidArgument = args.optionalString("guid");
    if ((guidArgument !== undefined) === args.has("address")) {
      throw new AgentToolError("Give `guid` or `address`, one of them.");
    }
    openEverything(tree);
    const nodes = allNodes(tree);

    const envelope: { [key: string]: Json } = { scope };
    let wanted: Form[];
    if (guidArgument !== undefined) {
      const guid = guidFromText(guidArgument);
      if (guid === undefined) {
        throw new AgentToolError(
          '`guid` is not a GUID; write it as "8C8CE578-8A3D-4F1C-9935-896185C32DD3".'
        );
      }
      wanted = [{ name: "guid", bytes: [...guidBytes(guid)] }];
      envelope.guid = guidText(guid);
    } else {
      const address = args.offset("address");
      const relative = args.choice("relative_to", ["file", "region"] as const, "file") === "region";
      const names = new Set(args.has("forms") ? args.strings("forms") : ["bus", "file", "region"]);
      const unknown = [...names].find((one) => !["bus", "file", "region"].includes(one));
      if (unknown !== undefined) {
        throw new AgentToolError(`\`forms\` takes "bus", "file" and "region"; not "${unknown}".`);
      }
      const found = nodes.find((node) => isFileSpace(node.space) && isBIOSRegion(node));
      const bios = found === undefined ? { start: 0, end: tree.size } : nodeRange(found);
      const file = relative ? bios.start + address : address;
      if (file >= tree.size) {
        throw new AgentToolError(`${hexText(file)} is past the end of the document.`);
      }
      const inside = file >= bios.start && file < bios.end;
      // An address outside the BIOS region has no bus or region form.
      if (!inside && !names.has("file")) {
        throw new AgentToolError(
          `${hexText(file)} is not inside the BIOS region ${hexText(bios.start)}–${hexText(bios.end)}; ` +
            "only the `file` form means anything for it."
        );
      }
      const made = forms(address, relative, bios, inside ? names : new Set(["file"]));
      wanted = made.forms;
      if (wanted.length === 0) {
        throw new AgentToolError(
          "Every form asked for is a value under 0x100, which matches nearly everywhere."
        );
      }
      if (made.skipped.length > 0) envelope.skipped_forms = made.skipped;
      const shown: { [key: string]: Json } = {};
      for (const form of wanted) shown[formName(form)] = bytesHex(Uint8Array.from(form.bytes));
      envelope.forms = shown;
    }

    // The buffers searched: the file as stored, and what each compressed section decompressed to —
    // each with the node its hits are placed under.
    const buffers: Buffer[] = [];
    if (scope !== "compressed") {
      buffers.push({ storage: new ReaderStorage(tree.reader), space: [], under: undefined });
    }
    if (scope !== "raw") {
      for (const node of nodes) {
        const body = decompressedBody(compressedView(node));
        if (body === undefined) continue;
        const reader = tree.spaceReaders.readerFor(body.space);
        if (reader === undefined || reader.count === 0) continue;
        buffers.push({ storage: new ReaderStorage(reader), space: body.space, under: node });
      }
    }
    return { scope, limit, guidArgument, envelope, wanted, buffers, nodes };
  });
  const { scope, limit, guidArgument, envelope, wanted, buffers } = prepared;
  const patterns = wanted.map((form) => maskedPattern(form.bytes));
  const found: { buffer: number; hit: Hit }[] = [];
  for (const [index, buffer] of buffers.entries()) {
    const hits: Hit[] = [];
    // One pass per form: a single pattern takes the engine's fast path, several at once do not.
    for (const [form, pattern] of patterns.entries()) {
      await maskedMatches(
        [pattern],
        buffer.storage,
        (match) => {
          hits.push({ start: match.start, end: match.end, form });
          return true;
        },
        { overlapping: true }
      );
    }
    for (const hit of withoutInner(hits, wanted)) found.push({ buffer: index, hit });
  }

  return withEnglish(() => {
    // Each hit placed in its FFS file, or in the deepest node when it is in none; the groups in the
    // order their first hits were found.
    const groups: {
      entry: { [key: string]: Json };
      hits: Json[];
      count: number;
    }[] = [];
    const groupIndex = new Map<string, number>();
    for (const { buffer: bufferIndex, hit } of found) {
      const buffer = buffers[bufferIndex] as Buffer;
      const top =
        buffer.under ??
        tree.roots.find((root) => {
          const range = nodeRange(root);
          return range.start <= hit.start && hit.end <= range.end;
        });
      if (top === undefined) continue;
      const deepest = deepestCovering(tree, hit, buffer.space, top);
      const chain = chainTo(deepest, tree);
      const file = [...chain].reverse().find((node) => node.kind === "file");
      const section = [...chain]
        .reverse()
        .find((node) => node.kind === "section" && sameSpace(node.space, buffer.space));
      const members: { [key: string]: Json } = { form: formName(wanted[hit.form] as Form) };
      if (section !== undefined) {
        members.section = nodeIdText(section.id);
        members.section_offset = hexText(hit.start - nodeRange(section).start);
      }
      if (buffer.space.length === 0) {
        members.file_start = hexText(hit.start);
      } else {
        members.node_start = hexText(hit.start);
        members.in_compressed = true;
      }
      if (deepest.id.join(".") !== (section ?? file)?.id.join(".")) {
        members.node = nodeIdText(deepest.id);
      }

      const owner = file ?? deepest;
      const key = nodeIdText(owner.id);
      const at = groupIndex.get(key);
      if (at !== undefined) {
        const group = groups[at] as (typeof groups)[number];
        group.count += 1;
        if (group.hits.length < MAX_HITS_PER_FILE) group.hits.push(members);
        continue;
      }
      const subtype = subtypeText(owner);
      const entry: { [key: string]: Json } = {
        name: ownName(owner) ?? owner.name,
        type: subtype === "" ? typeText(owner) : subtype,
        in_compressed: !isFileSpace(owner.space),
      };
      entry[file === undefined ? "node" : "file"] = key;
      if (owner.guid !== undefined) entry.guid = guidText(owner.guid);
      groupIndex.set(key, groups.length);
      groups.push({ entry, hits: [members], count: 1 });
    }
    envelope.total = found.length;
    envelope.files = groups.length;

    const paging = new AgentPage(
      args,
      AgentPage.fingerprint([
        context.contentVersion,
        guidArgument ?? null,
        scope,
        wanted.map((form) => bytesHex(Uint8Array.from(form.bytes))).join("|"),
      ])
    );
    const items: Json[] = groups.slice(paging.first, paging.first + limit).map((group) => {
      const entry: { [key: string]: Json } = { ...group.entry, hits: group.hits };
      if (group.count > group.hits.length) entry.hits_total = group.count;
      return entry;
    });
    return paging.answer(envelope, "refs", items, groups.length, args.answerBound);
  });
}
