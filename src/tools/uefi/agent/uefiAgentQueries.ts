import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import { AgentToolError } from "@/core/agent/agentTool";
import { type Json, member } from "@/core/agent/json";
import { guidText } from "@/firmware/uefi/efiGuid";
import {
  type NodeID,
  nodeFileRange,
  nodeIdText,
  nodeRange,
  type UEFINode,
} from "@/firmware/uefi/uefiNode";
import { isProblemField } from "@/tools/toolDetail";
import {
  type AgentTree,
  allNodes,
  expanded,
  nodeAtPath,
  openEverything,
  parseNodeId,
  reachable,
  unknownNode,
} from "@/tools/uefi/agent/uefiAgentTree";
import { ownName, subtypeText, summary, typeText } from "@/tools/uefi/uefiTreeDisplay";

/**
 * What the UEFI Structure answers an agent from the bytes alone, with its panel open or not: the
 * tree, one node in full, a search, and what holds an address.
 *
 * Every answer is read off the pane's one shared tree — the tree the panel draws — so a question
 * asked with the panel closed opens the same branches the panel will find open, and costs it nothing.
 *
 * Plain functions of a tree and the arguments: they run where the tree is, in the firmware worker,
 * and answer in English (`withEnglish`).
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries
 */

/** The questions the worker answers about the tree, by tool name. */
export type UefiAgentQueryName = "uefi_tree" | "uefi_node" | "uefi_find" | "uefi_at";

/** What a question knows besides the tree and the arguments. */
export interface UefiAgentContext {
  /** The content's version, which a page's cursor is bound to. */
  readonly contentVersion: number;
}

export const hexText = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

/**
 * A node as a row of an answer.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.summary
 */
export function nodeSummary(node: UEFINode): { [key: string]: Json } {
  const entry: { [key: string]: Json } = {
    id: nodeIdText(node.id),
    type: typeText(node),
    name: ownName(node) ?? node.name,
  };
  const subtype = subtypeText(node);
  if (subtype !== "") entry.subtype = subtype;
  if (node.guid !== undefined) entry.guid = guidText(node.guid);
  const range = nodeFileRange(node);
  if (range !== undefined) {
    entry.start = hexText(range.start);
    entry.end = hexText(range.end);
  } else {
    entry.in_compressed = true;
    const own = nodeRange(node);
    entry.size = hexText(own.end - own.start);
  }
  if (node.isExpandable && node.children.length === 0) entry.children = "unread";
  else if (node.children.length > 0) entry.children = node.children.length;
  if (node.isErased) entry.erased = true;
  return entry;
}

/** The names from the top of the tree down to `id`. @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.path */
export function pathNames(tree: AgentTree, id: NodeID): string[] {
  const names: string[] = [];
  for (let length = 1; length <= Math.max(1, id.length); length++) {
    const node = nodeAtPath(tree, id.slice(0, length));
    if (node !== undefined) names.push(ownName(node) ?? node.name);
  }
  return names;
}

// MARK: - uefi_tree

export const UEFI_TREE = {
  name: "uefi_tree",
  title: "UEFI tree",
  description:
    "The structure of a firmware image as the UEFI Structure panel shows it: regions, volumes, " +
    "files, sections, NVRAM stores and the rest. Without `node`, the top of the tree and a one-line " +
    "summary of the image; with it, that node and its children. `depth` (1–3) goes further down. " +
    "Each node: `id` (pass it back as `node`), type, subtype, name, GUID, its bytes (`start`, `end`, " +
    "or `in_compressed: true` when it lives inside a decompressed section and has no file address), " +
    'and `children` — a count, or "unread" for a container not opened yet (asking for it opens it). ' +
    "With `depth` above 1 a child carries the levels under it as `below`. Pages: `limit` is the most " +
    "children of `node` on one page, a ceiling — a page also stops before the answer passes the size " +
    'bound and then says `truncated: "size"`; pass `next` back as `after` until it is null. A child ' +
    'whose levels below are too large alone comes without them, marked `truncated: "item"`; ask for ' +
    "it as `node`.",
  properties: {
    node: AgentSchema.string('A node id such as "0.2.5" from an earlier answer. Default: the top.'),
    depth: AgentSchema.integer("How many levels below the node. Default 1, at most 3."),
    limit: AgentSchema.limit(100, 400),
    after: AgentSchema.after,
  },
} as const;

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.tree */
export function uefiTree(tree: AgentTree, args: AgentArguments, context: UefiAgentContext): Json {
  const id = parseNodeId(args.optionalString("node"));
  const depth = Math.max(1, Math.min(3, args.has("depth") ? args.integer("depth") : 1));
  const limit = args.limit(100, 400);
  const paging = new AgentPage(
    args,
    AgentPage.fingerprint([context.contentVersion, nodeIdText(id), depth])
  );

  const listed = (node: UEFINode, level: number): Json => {
    const entry = nodeSummary(node);
    if (level < depth && (node.children.length > 0 || node.isExpandable)) {
      entry.below = expanded(tree, node.id).map((child) => listed(child, level + 1));
    }
    return entry;
  };

  const answer: { [key: string]: Json } = {};
  if (id.length === 0) {
    answer.image = summary(tree.roots as never);
  } else {
    const node = nodeAtPath(tree, id);
    if (node === undefined) throw unknownNode(id);
    answer.node = nodeSummary(node);
  }
  const children = expanded(tree, id);
  const items = children.slice(paging.first, paging.first + limit).map((child) => listed(child, 1));
  answer.total = children.length;
  return paging.answer(answer, "children", items, children.length, args.answerBound, (item) => {
    if (
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item) ||
      item.below === undefined
    ) {
      return undefined;
    }
    const { below: _below, ...rest } = item;
    return { ...rest, truncated: "item" };
  });
}

// MARK: - uefi_node

export const UEFI_NODE = {
  name: "uefi_node",
  title: "UEFI node",
  description:
    "Everything the UEFI Structure panel's detail says about one node: its fields (header values, " +
    "sizes, attributes, checksums — a wrong checksum is marked `problem`), its tables, the path of " +
    "names down to it, and the parser's diagnostics inside its bytes. NVRAM variables come with their " +
    "value decoded.",
  properties: { node: AgentSchema.string('The node\'s id, e.g. "0.2.5".') },
  required: ["node"],
} as const;

/**
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.node
 * @upstream-differs the parser's diagnostics are the page's to add: the worker keeps none, and the
 * panel's store holds what the branches opened so far complained of
 */
export function uefiNode(tree: AgentTree, args: AgentArguments): Json {
  const id = parseNodeId(args.string("node"));
  if (id.length === 0) {
    throw new AgentToolError("The top of the tree is not a node; call `uefi_tree`.");
  }
  reachable(tree, id);
  const node = nodeAtPath(tree, id);
  if (node === undefined) throw unknownNode(id);
  const detail = tree.detail(node, id);
  const answer: { [key: string]: Json } = {
    node: nodeSummary(node),
    path: pathNames(tree, id),
    title: detail.title,
    fields: detail.fields.map((field) => {
      const entry: { [key: string]: Json } = { label: field.label, value: field.value };
      if (isProblemField(field)) entry.problem = true;
      return entry;
    }),
  };
  if (detail.tables.length > 0) {
    answer.tables = detail.tables.map((table) => ({
      title: table.title,
      columns: [...table.columns],
      rows: table.rows.map((row) => row.map((cell) => cell.text)),
    }));
  }
  return answer;
}

// MARK: - uefi_find

export const UEFI_FIND = {
  name: "uefi_find",
  title: "Find UEFI nodes",
  description:
    "Finds nodes anywhere in the image — opening every volume and decompressing every section it " +
    "can, which takes a few seconds on a large image the first time. Give any of: `name` (part of the " +
    "name, any case; the whole name with `exact`), `guid` (exact), `type` (the Type column, e.g. " +
    '"File", "Section", "Volume", "VSS entry", "NVAR entry"). All given must match. Each match has its ' +
    "id and the path of names to it; `total` counts them all. Pages: `limit` is a ceiling — a page " +
    'also stops before the answer passes the size bound and then says `truncated: "size"`; pass ' +
    "`next` back as `after` until it is null.",
  properties: {
    name: AgentSchema.string("Part of the node's name, any case."),
    exact: AgentSchema.boolean("Match the whole name rather than a part of it. Default false."),
    guid: AgentSchema.string('A GUID, e.g. "8C8CE578-8A3D-4F1C-9935-896185C32DD3".'),
    type: AgentSchema.string("The node type as the Type column shows it."),
    limit: AgentSchema.limit(50, 200),
    after: AgentSchema.after,
  },
} as const;

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.find */
export function uefiFind(tree: AgentTree, args: AgentArguments, context: UefiAgentContext): Json {
  const name = args.optionalString("name")?.toLowerCase();
  const guid = args.optionalString("guid")?.toUpperCase();
  const type = args.optionalString("type")?.toLowerCase();
  const exact = args.bool("exact", false);
  if (name === undefined && guid === undefined && type === undefined) {
    throw new AgentToolError("Give at least one of `name`, `guid` or `type`.");
  }
  const limit = args.limit(50, 200);
  const paging = new AgentPage(
    args,
    AgentPage.fingerprint([context.contentVersion, name ?? null, guid ?? null, type ?? null, exact])
  );
  openEverything(tree);

  const matches: Json[] = [];
  let total = 0;
  for (const node of allNodes(tree)) {
    if (name !== undefined) {
      const own = ownName(node) ?? "";
      const names = [node.name.toLowerCase(), own.toLowerCase()];
      if (!(exact ? names.includes(name) : names.some((one) => one.includes(name)))) continue;
    }
    if (
      guid !== undefined &&
      (node.guid === undefined || guidText(node.guid).toUpperCase() !== guid)
    ) {
      continue;
    }
    if (type !== undefined && typeText(node).toLowerCase() !== type) continue;
    total += 1;
    if (total > paging.first && matches.length < limit) {
      matches.push({ ...nodeSummary(node), path: pathNames(tree, node.id) });
    }
  }
  return paging.answer({ total }, "matches", matches, total, args.answerBound);
}

// MARK: - uefi_at

export const UEFI_AT = {
  name: "uefi_at",
  title: "UEFI nodes at an address",
  description:
    "The chain of nodes that hold a byte of the file, outermost first — region, volume, file, " +
    "section — opening the containers on the way. The last one is the innermost.",
  properties: { offset: AgentSchema.offset('A file address, e.g. "0x7F3000".') },
  required: ["offset"],
} as const;

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.at */
export function uefiAt(tree: AgentTree, args: AgentArguments): Json {
  const offset = args.offset("offset");
  if (offset >= tree.size) {
    throw new AgentToolError(
      `Offset ${hexText(offset)} is past the end of the file, which is ${hexText(tree.size)} bytes long.`
    );
  }
  // Down through whatever covers the offset, opening each branch on the way. A byte of the file inside
  // a compressed stream is no one byte of what it decompresses to, so the chain ends at the section.
  const chain: UEFINode[] = [];
  let nodes: UEFINode[] = tree.roots;
  for (;;) {
    const node = nodes.find((one) => {
      const range = nodeFileRange(one);
      return range !== undefined && offset >= range.start && offset < range.end;
    });
    if (node === undefined) break;
    chain.push(node);
    if (node.kind === "section" && node.isExpandable) break;
    if (node.isExpandable) tree.open(node);
    nodes = node.children;
  }
  return { offset: hexText(offset), chain: chain.map((node) => nodeSummary(node)) };
}

/** Runs the question a worker was asked, or fails with a sentence for the model. */
export function runUefiAgentQuery(
  name: UefiAgentQueryName,
  tree: AgentTree,
  args: AgentArguments,
  context: UefiAgentContext
): Json {
  switch (name) {
    case "uefi_tree":
      return uefiTree(tree, args, context);
    case "uefi_node":
      return uefiNode(tree, args);
    case "uefi_find":
      return uefiFind(tree, args, context);
    case "uefi_at":
      return uefiAt(tree, args);
  }
}

export { member };
