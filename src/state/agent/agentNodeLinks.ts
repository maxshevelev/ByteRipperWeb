import { isObject, type Json } from "@/core/agent/json";
import type { PartCodec } from "@/core/parts/partCodec";
import { LenovoDMIBlockCodec } from "@/firmware/lenovoDmi/lenovoDmiValue";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import { readyFirmware } from "@/state/firmwareReady";
import { askUefiAgent } from "@/state/firmwareStore";
import { partsLinkedTo } from "@/state/partUpdate";
import { type PaneId, paneState } from "@/state/workspaceStore";

/**
 * The same node in the other documents of a parent-and-part pair, written into the UEFI tools'
 * answers (`counterpart`, `decoded_in`).
 *
 * A part opened with `open_part` has a tree of its own, with ids that start over: the parent's
 * 0.3.4.1.2.5 is 0.0.5 in the decoded block. An agent that had the parent's id in hand showed
 * the parent's node — the encoded bytes — while the decoded part, the one it meant, was open
 * beside it, and nothing in the answer said so. Every node of an answer whose bytes are also a
 * part's, or a parent's, now names that node there.
 *
 * Only where the codec keeps the addresses (`PartCodec.keepsOffsets`): a byte of a decompressed
 * body is no byte of the file, and a node there has no address to be matched by.
 *
 * @upstream ByteRipperApp/Agent/AgentNodeLinks.swift#AgentNodeLinks
 * @upstream ByteRipperApp/Agent/AgentNodeLinks.swift#AgentNodeLinks.desk
 */
export class AgentNodeLinks {
  readonly desk: AgentDesk;

  constructor(desk: AgentDesk) {
    this.desk = desk;
  }

  /**
   * `answer` with every node in it that is also in a related document carrying `counterpart`,
   * and `decoded_in` when that document is the node's block opened decoded. The answer as it is
   * when `place` is neither a parent of an open part nor a part.
   *
   * @upstream ByteRipperApp/Agent/AgentNodeLinks.swift#AgentNodeLinks.annotate
   */
  async annotate(answer: Json, place: AgentPlace): Promise<Json> {
    const related = this.related(place).filter((one) => one.keepsOffsets);
    if (related.length === 0) return answer;
    return this.walk(answer, place, related, new Map());
  }

  /**
   * Where else a node id that is not one of `place`'s is one: the open parts of `place` and its
   * parent, each with the node's name there — for a refusal to say which `document` the id was
   * listed on.
   *
   * @upstream ByteRipperApp/Agent/AgentNodeLinks.swift#AgentNodeLinks.documents
   */
  async documents(
    text: string,
    place: AgentPlace
  ): Promise<{ readonly document: string; readonly name: string }[]> {
    if (text === "" || !/^[0-9]+(\.[0-9]+)*$/.test(text)) return [];
    const holders: { document: string; name: string }[] = [];
    for (const other of this.related(place)) {
      const found = await ask(other.pane, "uefi_tree", { node: text, limit: 1 });
      const node = isObject(found) ? found.node : undefined;
      if (!isObject(node) || typeof node.name !== "string") continue;
      holders.push({ document: other.id, name: node.name });
    }
    return holders;
  }

  private related(place: AgentPlace): Related[] {
    const list: Related[] = [];
    const pane = place.pane;
    if (pane === undefined) return list;
    for (const part of partsLinkedTo(pane)) {
      const held = this.desk.placeOf(part);
      const origin = paneState(part)?.origin;
      if (held === undefined || origin === undefined) continue;
      const source = origin.sourceRange;
      list.push({
        id: held.id,
        pane: part,
        covers: source,
        shift: -source[0],
        relation: decodes(origin.codec) ? "decoded" : "same",
        keepsOffsets: origin.codec.keepsOffsets,
      });
    }
    const origin = paneState(pane)?.origin;
    const holder = origin === undefined ? undefined : this.desk.placeOf(origin.parent);
    if (origin !== undefined && holder !== undefined) {
      const source = origin.sourceRange;
      list.push({
        id: holder.id,
        pane: origin.parent,
        covers: [0, source[1] - source[0]],
        shift: source[0],
        relation: decodes(origin.codec) ? "encoded" : "same",
        keepsOffsets: origin.codec.keepsOffsets,
      });
    }
    return list;
  }

  private async walk(
    value: Json,
    place: AgentPlace,
    related: readonly Related[],
    found: Map<string, string | undefined>
  ): Promise<Json> {
    if (Array.isArray(value)) {
      const out: Json[] = [];
      for (const item of value) out.push(await this.walk(item, place, related, found));
      return out;
    }
    if (!isObject(value)) return value;
    const members: { [key: string]: Json } = { ...value };
    for (const key of Object.keys(members).sort()) {
      const member = members[key];
      if (member !== undefined) members[key] = await this.walk(member, place, related, found);
    }
    const id = members.id;
    const start = typeof members.start === "string" ? address(members.start) : undefined;
    const end = typeof members.end === "string" ? address(members.end) : undefined;
    if (
      typeof id !== "string" ||
      start === undefined ||
      end === undefined ||
      start >= end ||
      !related.some((one) => one.covers[0] <= start && end <= one.covers[1])
    ) {
      return members;
    }
    // A node that only wraps another of the same bytes — the top of a part, around the block it
    // is — is not the node the other side names; only the innermost of them is linked, both
    // ways.
    const ownKey = `${place.id}:${start}:${end}`;
    if (!found.has(ownKey) && place.pane !== undefined) {
      found.set(ownKey, await this.node(place.pane, start, end));
    }
    if (found.get(ownKey) !== id) return members;
    const counterparts: Json[] = [];
    for (const other of related) {
      if (!(other.covers[0] <= start && end <= other.covers[1])) continue;
      const key = `${other.id}:${start}:${end}`;
      if (!found.has(key)) {
        found.set(key, await this.node(other.pane, start + other.shift, end + other.shift));
      }
      const node = found.get(key);
      if (node === undefined) continue;
      counterparts.push({ document: other.id, node, as: other.relation });
      if (other.relation === "decoded") members.decoded_in = { document: other.id, node };
    }
    if (counterparts.length > 0) members.counterpart = counterparts;
    return members;
  }

  /**
   * The id of the innermost node of `pane` whose bytes are exactly `start..end`, or nothing
   * when its tree has none — a stretch of a part that its own tree reads differently.
   */
  private async node(pane: PaneId, start: number, end: number): Promise<string | undefined> {
    const state = paneState(pane);
    if (state === undefined || start >= state.document.size) return undefined;
    const chain = await ask(pane, "uefi_at", { offset: hex(start) });
    const items = isObject(chain) && Array.isArray(chain.chain) ? chain.chain : [];
    for (let at = items.length - 1; at >= 0; at--) {
      const item = items[at];
      if (!isObject(item) || typeof item.start !== "string" || typeof item.end !== "string") {
        continue;
      }
      if (address(item.start) === start && address(item.end) === end) {
        return typeof item.id === "string" ? item.id : undefined;
      }
    }
    return undefined;
  }
}

/**
 * A document the answer's nodes may also be in, and how an address of the answer's document is
 * one of its own.
 *
 * @upstream ByteRipperApp/Agent/AgentNodeLinks.swift#AgentNodeLinks.Related
 */
interface Related {
  readonly id: string;
  readonly pane: PaneId;
  /** The answer's addresses that are this document's too. */
  readonly covers: readonly [number, number];
  /** What to add to an address of the answer's document to get this one's. */
  readonly shift: number;
  /**
   * "decoded" for a block opened decoded, "encoded" for the parent of one, "same" for bytes
   * that are the same both sides.
   */
  readonly relation: "decoded" | "encoded" | "same";
  /**
   * Whether an address of one is the same byte of the other — not for a decompressed body,
   * whose bytes are no bytes of the file.
   */
  readonly keepsOffsets: boolean;
}

/** A block opened decoded, not one stored in the clear. */
const decodes = (codec: PartCodec): boolean =>
  codec instanceof LenovoDMIBlockCodec && codec.encodes;

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

function address(text: string): number | undefined {
  const lower = text.toLowerCase();
  const value = lower.startsWith("0x") ? Number.parseInt(lower.slice(2), 16) : Number(lower);
  return Number.isFinite(value) ? value : undefined;
}

/** A query of the UEFI tree of `pane`, answered from its worker; nothing when it is refused. */
async function ask(
  pane: PaneId,
  query: "uefi_at" | "uefi_tree",
  values: { [key: string]: Json }
): Promise<Json | undefined> {
  const state = paneState(pane);
  if (state === undefined) return undefined;
  await readyFirmware(pane);
  const response = await askUefiAgent(pane, {
    query,
    values,
    answerBound: 1 << 20,
    contentVersion: state.document.contentGeneration,
  });
  return response.error === undefined ? (response.answer ?? undefined) : undefined;
}
