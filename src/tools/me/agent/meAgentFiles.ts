import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import type { AgentPage } from "@/core/agent/agentPage";
import type { Json } from "@/core/agent/json";
import type {
  MEFileComparison,
  MEFileGap,
  MEFileRow,
  MEFileVolume,
} from "@/tools/meFileComparison";

/**
 * Two dumps' ME file systems compared file by file for an agent. The comparison is
 * `compareMEFiles`, the value a panel will show; this only words the answer.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentFiles.swift#MEAAgentFiles
 */

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

export const ME_FILES_COMPARE = {
  name: "me_files_compare",
  title: "Compare ME files",
  description:
    "Sets the files of the ME file systems of two documents side by side — `document` and " +
    "`against` — by what each volume calls them (an MFS file's index, an EFS file's file ID) " +
    "and by what they hold, not by address. An MFS volume moves its pages to spread the wear, " +
    "so one machine's two dumps keep the same file in different places, and `diff` over the MFS " +
    "partition mostly finds pages moved; this says which files changed. Content is compared " +
    "without the Integrity table a protected file ends with; that table changes whenever the " +
    "engine writes the file again, so it is reported apart (`integrity_differs`). Answers " +
    "`counts` (same — and of those, `moved` and `rewritten` — different, only in one, " +
    "incomplete), the files that differ with both sizes and how many content bytes differ, and " +
    "the files only in one dump. `name` is the file table's path or name where it gives one. " +
    "A volume that could not be read on either side is under `not_compared` with the reason, " +
    "and its files are not listed as missing. `incomplete` is a file whose chain of chunks " +
    "broke off, so what it holds is not known whole. With `extents`, each listed file says " +
    "where it is stored in each dump: the stretches in the file's own order, which `read` " +
    "reads back. Pages: the lists are one sequence — `different`, `only_in_document`, " +
    "`only_in_against`, `incomplete` — and `limit` is the most items of it on one page, a " +
    "ceiling: a page also stops before the answer passes the size bound and then says " +
    '`truncated: "size"`. Pass `next` back as `after` until it is null; `counts` are of the whole ' +
    "comparison. A file whose extents are too many for one answer lists the first of them, " +
    'marked `truncated: "item"`; `me_tree` on the file lists them. `encrypted` is the file ' +
    "table's flag: an encrypted file the engine wrote again with a new nonce differs in nearly " +
    "every byte, so for it `different` says it was written, not that what it holds changed.",
  properties: {
    volume: AgentSchema.string('Only this volume: "mfs" or "efs". Default: both.'),
    name: AgentSchema.string("Only files whose name contains this, any case."),
    extents: AgentSchema.boolean(
      "Say where each listed file is stored in each dump. Default false."
    ),
    limit: AgentSchema.limit(40, 200),
    after: AgentSchema.after,
  },
} as const;

/** How many stretches a file too large for one answer keeps, per dump. @upstream Modules/MEATool/Sources/MEATool/MEAAgentFiles.swift#MEAAgentFiles.extentsShortened */
export const EXTENTS_SHORTENED = 16;

/** The `volume` argument, or an answer to it. @upstream Modules/MEATool/Sources/MEATool/MEAAgentFiles.swift#MEAAgentFiles.compare */
export function volumeArgument(args: AgentArguments): MEFileVolume | undefined {
  const text = args.optionalString("volume");
  if (text === undefined) return undefined;
  const lower = text.toLowerCase();
  if (lower !== "mfs" && lower !== "efs") return undefined;
  return lower;
}

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentFiles.swift#MEAAgentFiles.answer */
export function filesAnswer(
  comparison: MEFileComparison,
  volume: MEFileVolume | undefined,
  name: string | undefined,
  extents: boolean,
  limit: number,
  page: AgentPage,
  bound: number
): Json {
  const needle = name?.toLowerCase();
  const rows = comparison.rows.filter(
    (row) =>
      (volume === undefined || row.volume === volume) &&
      (needle === undefined || row.name?.toLowerCase().includes(needle) === true)
  );
  const of = (status: MEFileRow["status"]) => rows.filter((row) => row.status === status);
  const same = of("same");
  const different = of("different");
  const onlyHere = of("onlyInA");
  const onlyThere = of("onlyInB");
  const incomplete = [...of("incomplete"), ...of("unknown")];

  const counts: { [key: string]: Json } = {
    same: same.length,
    moved: same.filter((row) => row.moved).length,
    rewritten: same.filter((row) => row.integrityDiffers === true).length,
    different: different.length,
    only_in_document: onlyHere.length,
    only_in_against: onlyThere.length,
  };
  if (incomplete.length > 0) counts.incomplete = incomplete.length;

  const envelope: { [key: string]: Json } = { counts };
  const gaps = comparison.gaps.filter((gap) => volume === undefined || gap.volume === volume);
  if (gaps.length > 0) {
    envelope.not_compared = gaps.map(
      (gap): Json => ({
        volume: gap.volume,
        in: gap.inA ? "document" : "against",
        reason: reasonText(gap),
      })
    );
  }
  // One sequence, list by list; the page's items built only for the stretch of it the page may hold.
  const lists: { key: string; rows: MEFileRow[] }[] = [
    { key: "different", rows: different },
    { key: "only_in_document", rows: onlyHere },
    { key: "only_in_against", rows: onlyThere },
    { key: "incomplete", rows: incomplete },
  ];
  const sequence = lists.flatMap((list) => list.rows.map((row) => ({ key: list.key, row })));
  const items = sequence
    .slice(page.first, page.first + limit)
    .map(({ key, row }) => ({ key, item: fileJson(row, extents) }));
  const keys = lists.map((list) => list.key);
  if (incomplete.length === 0) keys.pop();
  return page.answerLists(envelope, keys, items, sequence.length, bound, (item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return undefined;
    const members = item as { [key: string]: Json };
    const held = members.extents;
    if (typeof held !== "object" || held === null || Array.isArray(held)) return undefined;
    const stored = { ...(held as { [key: string]: Json }) };
    for (const [side, list] of Object.entries(stored)) {
      if (Array.isArray(list) && list.length > EXTENTS_SHORTENED) {
        stored[side] = list.slice(0, EXTENTS_SHORTENED);
        stored[`${side}_total`] = list.length;
      }
    }
    return { ...members, extents: stored, truncated: "item" };
  });
}

function fileJson(row: MEFileRow, extents: boolean): Json {
  const entry: { [key: string]: Json } = { volume: row.volume };
  entry[row.volume === "mfs" ? "index" : "file_id"] = row.key;
  if (row.name !== undefined) entry.name = row.name;
  if (row.status === "incomplete") {
    entry.why = "A chain of chunks broke off; the file is not known whole.";
  }
  if (row.status === "unknown") entry.why = "Neither the bytes nor a digest to compare.";
  const sizes: { [key: string]: Json } = {};
  if (row.a !== undefined) sizes.document = hex(row.a.contentSize);
  if (row.b !== undefined) sizes.against = hex(row.b.contentSize);
  entry.size = sizes;
  if (row.differingBytes !== undefined) entry.differing_bytes = row.differingBytes;
  if (row.integrityDiffers !== undefined) entry.integrity_differs = row.integrityDiffers;
  if (row.encrypted !== undefined) entry.encrypted = row.encrypted;
  if (extents) {
    const stored: { [key: string]: Json } = {};
    if (row.a !== undefined) stored.document = stretches(row.a.extents);
    if (row.b !== undefined) stored.against = stretches(row.b.extents);
    entry.extents = stored;
  }
  return entry;
}

const stretches = (list: readonly { start: number; end: number }[]): Json =>
  list.map((one): Json => ({ start: hex(one.start), end: hex(one.end) }));

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentFiles.swift#MEAAgentFiles.reason */
export function reasonText(gap: MEFileGap): string {
  const volume = gap.volume.toUpperCase();
  switch (gap.reason) {
    case "absent":
      return `This dump has no ${volume} volume.`;
    case "unreadable":
      return gap.volume === "efs"
        ? "The EFS partition holds no volume that could be read; its System page may be erased."
        : "The MFS partition holds no volume that could be read.";
    case "badSignature":
      return "The MFS volume header is missing or its signature is invalid.";
    case "filesNotNamed":
      return (
        "The EFS volume was read but not cut into files: that needs FileTable.dat, " +
        "which could not be had or does not describe this volume."
      );
  }
}
