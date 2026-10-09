import type { AgentArguments } from "@/core/agent/agentArguments";
import { AgentToolError } from "@/core/agent/agentTool";
import { type Json, jsonByteCount, jsonText } from "@/core/agent/json";

/**
 * One page of a list answer, cut to fit the answer bound.
 *
 * An answer over the bound is refused whole by the connection, and a model cannot tell
 * beforehand what `limit` will fit: an item's size depends on the data. So `limit` is a
 * ceiling, and a page stops at whichever comes first — `limit` items, or the item that would
 * take the answer over the bound. Either way the page ends with `next`, the cursor to pass back
 * as `after`, or null when nothing is left; a page cut by size says `truncated: "size"`, so a
 * model can tell "all I asked for, and there is more" from "shortened to fit".
 *
 * The size is the answer's own: the fields around the list are encoded once, with room kept
 * for the longest `next` and for `truncated`, and each item adds what it encodes to. The JSON
 * is compact with its keys sorted, so the sum is the length to the byte and nothing has to be
 * taken back.
 *
 * A list may be several lists in turn — what only one document holds, then what only the other
 * does — paged as one sequence: each keeps its key, empty on a page that holds none of it, and
 * the cursor counts across them.
 *
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentPage.swift#AgentPage
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentPage.swift#AgentPage.first
 * @upstream Packages/AgentKit/Sources/AgentKit/AgentPage.swift#Dictionary.jsonByteCount
 */
export class AgentPage {
  /** Where this page starts in the whole sequence. */
  readonly first: number;
  /** What the cursor is bound to: the content of the documents and the question, so a `next` is refused once either changed. */
  readonly fingerprint: string;

  /**
   * Reads `after` against the fingerprint of the question now. `changed` is the sentence for a
   * cursor from another question or older content.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentPage.swift#AgentPage.init
   */
  constructor(
    args: AgentArguments,
    fingerprint: string,
    changed = "A document changed since that page, or the question did; ask again without `after`."
  ) {
    this.fingerprint = fingerprint;
    const after = args.optionalString("after");
    if (after === undefined) {
      this.first = 0;
      return;
    }
    const parts = after.split(":");
    const index =
      parts.length === 2 && /^[0-9]+$/.test(parts[0] ?? "") ? Number(parts[0]) : undefined;
    if (index === undefined) throw new AgentToolError("`after` is not a `next` this tool gave.");
    if (parts[1] !== fingerprint) throw new AgentToolError(changed);
    this.first = index;
  }

  /**
   * A fingerprint of the parts — content versions and the arguments that shape the list. Good for
   * this run of the app, which is as long as a cursor lives.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentPage.swift#AgentPage.fingerprint
   */
  static fingerprint(parts: readonly (Json | undefined)[]): string {
    // FNV-1a over the parts' compact text, twice with two seeds for 52 bits of it.
    const text = jsonText(parts.map((part) => part ?? null));
    let low = 0x811c9dc5;
    let high = 0x01000193;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      low = Math.imul(low ^ code, 0x01000193) >>> 0;
      high = Math.imul(high ^ code, 0x85ebca6b) >>> 0;
    }
    return `${(high & 0xfffff).toString(16)}${low.toString(16).padStart(8, "0")}`;
  }

  /**
   * The answer: `envelope`, each list under its key, `next`, and `truncated` when the bound cut
   * it.
   *
   * `items` are the candidates from `first` on, in order, each with the key of the list it
   * belongs to, at most `limit` of them; `total` is the length of the whole sequence. `keys` are
   * every list's key, so a list with nothing on this page is still there, empty. An item that
   * would not fit even on a page of its own is given smaller by `shorten` — marked by the tool,
   * as `truncated: "item"` — and when that does not fit either, or there is none, it ends the
   * page, or is refused by name when it is the page's first.
   *
   * @upstream Packages/AgentKit/Sources/AgentKit/AgentPage.swift#AgentPage.answer
   */
  answerLists(
    envelope: { [key: string]: Json },
    keys: readonly string[],
    items: readonly { readonly key: string; readonly item: Json }[],
    total: number,
    bound: number,
    shorten: (item: Json) => Json | undefined = () => undefined
  ): Json {
    const reserved: { [key: string]: Json } = { ...envelope };
    for (const key of keys) reserved[key] = [];
    reserved.next = `${total}:${this.fingerprint}`;
    reserved.truncated = "size";
    const base = jsonByteCount(reserved);
    let size = base;
    const lists = new Map<string, Json[]>(keys.map((key) => [key, []]));
    let taken = 0;
    for (const { key, item: original } of items) {
      let item = original;
      let length = jsonByteCount(item);
      // Too large for any page, even alone: shortened wherever it falls. One that would fit a
      // page of its own waits for the next one.
      if (base + length > bound) {
        const shorter = shorten(item);
        if (shorter === undefined || base + jsonByteCount(shorter) > bound) {
          if (taken > 0) break;
          throw new AgentToolError(
            `Item ${this.first} alone is over the ${bound}-byte bound for one answer, even shortened; ` +
              "narrow the question so it is not among the answers."
          );
        }
        item = shorter;
        length = jsonByteCount(item);
      }
      const list = lists.get(key) ?? [];
      const cost = length + (list.length === 0 ? 0 : 1);
      if (size + cost > bound) break;
      list.push(item);
      lists.set(key, list);
      size += cost;
      taken += 1;
    }
    const answer: { [key: string]: Json } = { ...envelope };
    for (const [key, list] of lists) answer[key] = list;
    const following = this.first + taken;
    answer.next = following < total ? `${following}:${this.fingerprint}` : null;
    if (taken < items.length) answer.truncated = "size";
    return answer;
  }

  /** The answer for a page that is one list. */
  answer(
    envelope: { [key: string]: Json },
    key: string,
    items: readonly Json[],
    total: number,
    bound: number,
    shorten?: (item: Json) => Json | undefined
  ): Json {
    return this.answerLists(
      envelope,
      [key],
      items.map((item) => ({ key, item })),
      total,
      bound,
      shorten
    );
  }
}
