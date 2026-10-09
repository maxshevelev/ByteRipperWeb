import type { AgentArguments } from "@/core/agent/agentArguments";
import { parseHexBytes } from "@/core/agent/agentHexBytes";
import { AgentToolError, jsonAnswer } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { L } from "@/core/localization/localization";
import { readyFirmware } from "@/state/firmwareReady";
import { askUefiAgent } from "@/state/firmwareStore";
import type { PaneId } from "@/state/paneId";
import type {
  ToolAgentAction,
  ToolAgentComparison,
  ToolAgentEdit,
  ToolAgentQuery,
  ToolReadHost,
} from "@/tools/toolAgent";
import { UEFI_NODE_DATA } from "@/tools/uefi/agent/uefiAgentNodeData";
import {
  UEFI_AT,
  UEFI_FIND,
  UEFI_NODE,
  UEFI_TREE,
  type UefiAgentQueryName,
} from "@/tools/uefi/agent/uefiAgentQueries";
import {
  VARIABLES,
  VARIABLES_COMPARE,
  type VariableRow,
  variablesAnswer,
  variablesCompareAnswer,
} from "@/tools/uefi/agent/uefiAgentVariables";

/**
 * What the UEFI Structure module says to an agent: the questions the tree answers from the bytes
 * alone — with the panel open or not — the variables two dumps keep, and what the open panel does
 * at an agent's asking.
 *
 * The tree is the pane's own, in the firmware worker, so a question is a message there and the
 * answer comes back already in English.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentQueries
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentComparisons
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentActions
 * @upstream-differs the queries are asked of the worker that holds the tree, where upstream's read the
 * tree on the main actor
 */

async function readyTree(host: ToolReadHost): Promise<PaneId> {
  await readyFirmware(host.pane);
  return host.pane;
}

async function ask(
  host: ToolReadHost,
  query:
    | "uefi_tree"
    | "uefi_node"
    | "uefi_find"
    | "uefi_at"
    | "uefi_node_data"
    | "uefi_fix_checksum",
  args: AgentArguments
): Promise<Json> {
  const pane = await readyTree(host);
  const response = await askUefiAgent(pane, {
    query,
    values: args.values,
    answerBound: args.answerBound,
    contentVersion: host.contentVersion,
  });
  if (response.error !== undefined) throw new AgentToolError(response.error);
  return response.answer ?? null;
}

async function rowsOf(host: ToolReadHost): Promise<readonly VariableRow[]> {
  const pane = await readyTree(host);
  const response = await askUefiAgent(pane, {
    query: "variable_rows",
    values: {},
    answerBound: 0,
    contentVersion: host.contentVersion,
  });
  if (response.error !== undefined) throw new AgentToolError(response.error);
  return response.rows ?? [];
}

function query(definition: {
  readonly name: UefiAgentQueryName | "uefi_node_data";
  readonly title: string;
  readonly description: string;
  readonly properties: { readonly [key: string]: Json };
  readonly required?: readonly string[];
}): ToolAgentQuery {
  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    properties: definition.properties,
    ...(definition.required === undefined ? {} : { required: definition.required }),
    run: async (host, args) => jsonAnswer(await ask(host, definition.name, args)),
  };
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentQueries */
export const uefiAgentQueries: readonly ToolAgentQuery[] = [
  query(UEFI_TREE),
  query(UEFI_NODE),
  query(UEFI_FIND),
  query(UEFI_AT),
  query(UEFI_NODE_DATA),
  {
    name: VARIABLES.name,
    title: VARIABLES.title,
    description: VARIABLES.description,
    properties: VARIABLES.properties,
    run: async (host, args) =>
      jsonAnswer(variablesAnswer(await rowsOf(host), args, host.contentVersion)),
  },
];

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentComparisons */
export const uefiAgentComparisons: readonly ToolAgentComparison[] = [
  {
    name: VARIABLES_COMPARE.name,
    title: VARIABLES_COMPARE.title,
    description: VARIABLES_COMPARE.description,
    properties: VARIABLES_COMPARE.properties,
    run: async (host, against, args) =>
      jsonAnswer(
        variablesCompareAnswer(await rowsOf(host), await rowsOf(against), args, [
          host.contentVersion,
          against.contentVersion,
        ])
      ),
  },
];

/**
 * What an agent does in the open UEFI Structure panel: it chooses a node, and says which node the
 * reader chose.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.agentSelect
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.agentSelection
 */
export interface UefiAgentSession {
  /** Chooses the node at `path`, opening the branches on the way; what it is, once chosen. */
  select(path: readonly number[]): Promise<Json>;
  /** The node in focus, or nothing for none. */
  selection(): Json | undefined;
}

/**
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentActions
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.selectAction
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.selectionAction
 */
export const uefiAgentActions: readonly ToolAgentAction[] = [
  {
    name: "uefi_select",
    title: "Select a UEFI node",
    description:
      "Chooses a node in the open UEFI Structure panel — its row selected, the branches on the way " +
      "opened, its detail up and its bytes outlined in the dump — as a click on it would. The dump " +
      "does not move; `reveal` takes it there. Answers what the node is.",
    properties: { node: { type: "string", description: 'The node\'s id, e.g. "0.2.5".' } },
    required: ["node"],
    changesView: true,
    run: async (session, args) => {
      const id = args.string("node");
      if (!/^\d+(\.\d+)*$/.test(id)) {
        throw new AgentToolError(`Argument \`node\`: "${id}" is not a node id such as "0.2.5".`);
      }
      return jsonAnswer(await (session as UefiAgentSession).select(id.split(".").map(Number)));
    },
  },
  {
    name: "uefi_selection",
    title: "The selected UEFI node",
    description:
      'The node the reader has chosen in the open UEFI Structure panel — what "this node" means — ' +
      "or `selected: null` when none is.",
    changesView: false,
    run: async (session) =>
      jsonAnswer({ selected: (session as UefiAgentSession).selection() ?? null }),
  },
];

/**
 * The changes the UEFI Structure works out for an agent: a node's checksum put right, by the code
 * the panel's Fix Checksum runs. The module only computes the writes; the app applies them, if the
 * person's edit switch allows it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentEdits.swift#UEFIAgentEdits
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentEdits.swift#UEFIAgentEdits.all
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentEdits.swift#UEFIAgentEdits.fixChecksum
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentEdits
 */
export const uefiAgentEdits: readonly ToolAgentEdit[] = [
  {
    name: "uefi_fix_checksum",
    title: "Fix a UEFI checksum",
    description:
      "Puts a node's checksums right — a volume's header checksum, a file's header and data " +
      "checksums, a microcode's — computed by the code the UEFI Structure panel's Fix Checksum runs, " +
      "and writes them as one undo step. `uefi_node` marks a wrong checksum with `problem`. Refused " +
      "for a node inside a compressed section (the file holds those bytes compressed), for one whose " +
      "checksums already check out, and without the person's permission to edit.",
    properties: { node: { type: "string", description: 'The node\'s id, e.g. "0.2.5".' } },
    required: ["node"],
    undoName: () => L("Fix Checksum"),
    run: async (host, args) => {
      const answer = await ask(host, "uefi_fix_checksum", args);
      const writes = (answer as { writes: { offset: number; bytes: string }[] }).writes;
      return {
        name: "Fix Checksum",
        writes: writes.map((one) => ({
          offset: one.offset,
          bytes: parseHexBytes(one.bytes, "bytes"),
        })),
      };
    },
  },
];
