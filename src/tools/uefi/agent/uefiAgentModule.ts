import { AgentArguments } from "@/core/agent/agentArguments";
import { parseHexBytes } from "@/core/agent/agentHexBytes";
import { AgentToolError, jsonAnswer } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import { isObject } from "@/core/agent/json";
import { L, withEnglish } from "@/core/localization/localization";
import { guidFromText } from "@/firmware/uefi/efiGuid";
import { GuidsCatalogue } from "@/firmware/uefi/guidsCatalogue";
import { readyFirmware } from "@/state/firmwareReady";
import {
  askFirmwareDmiStores,
  askUefiAgent,
  firmwareFor,
  firmwareStore,
} from "@/state/firmwareStore";
import { catalogueStore, liveCatalogueSource } from "@/state/guidCatalogue";
import type { CatalogueSource } from "@/state/guidCatalogueSource";
import type { PaneId } from "@/state/paneId";
import type {
  ToolAgentAction,
  ToolAgentComparison,
  ToolAgentEdit,
  ToolAgentLocator,
  ToolAgentPlace,
  ToolAgentQuery,
  ToolReadHost,
} from "@/tools/toolAgent";
import { UEFI_CHECKSUMS } from "@/tools/uefi/agent/uefiAgentChecksums";
import type { WirePlace } from "@/tools/uefi/agent/uefiAgentLocator";
import { UEFI_NODE_DATA } from "@/tools/uefi/agent/uefiAgentNodeData";
import {
  UEFI_AT,
  UEFI_FIND,
  UEFI_NODE,
  UEFI_TREE,
  type UefiAgentQueryName,
} from "@/tools/uefi/agent/uefiAgentQueries";
import { REGION_SCAN } from "@/tools/uefi/agent/uefiAgentRegions";
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
    | "uefi_fix_checksum"
    | "uefi_checksums"
    | "region_scan"
    | "uefi_areas"
    | "uefi_locate",
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
  readonly name: UefiAgentQueryName | "uefi_node_data" | "uefi_checksums" | "region_scan";
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

/**
 * The GUID catalogue the agent's `uefi_node` names a file by. A seam for a test, as upstream's
 * `UEFIToolSession.guidsSource` is.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.guidsSource
 */
export const agentGuids: { source: CatalogueSource } = { source: liveCatalogueSource };

/** How long a node's detail waits for the catalogue. */
const CATALOGUE_WAIT_MILLISECONDS = 5000;
/** How long a Lenovo DMI node's detail waits for the drivers that read the store. */
const LENOVO_READERS_WAIT_MILLISECONDS = 20_000;

/**
 * The GUID catalogue: the one the panel holds, or the download — waited for a few seconds at most,
 * so a bench with no network answers without the catalogue's names rather than late.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentCatalogue
 */
async function agentCatalogue(): Promise<GuidsCatalogue> {
  const held = catalogueStore.getSnapshot();
  if (held.status === "ready") return held.catalogue;
  const waiting = agentGuids.source.load().catch(() => GuidsCatalogue.empty);
  const timeout = new Promise<GuidsCatalogue>((resolve) =>
    setTimeout(() => resolve(GuidsCatalogue.empty), CATALOGUE_WAIT_MILLISECONDS)
  );
  return Promise.race([waiting, timeout]);
}

/**
 * Waits for the drivers that read Lenovo's DMI store, which the page has searched for since the
 * image was read; a while at most, and without them the detail says less, not wrong.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.lenovoDMIReaders
 */
async function lenovoReadersWait(pane: PaneId): Promise<void> {
  if (firmwareFor(pane)?.dmiStores === undefined) askFirmwareDmiStores(pane);
  await new Promise<void>((resolve) => {
    const settled = (): boolean => {
      const held = firmwareFor(pane);
      return (
        held?.lenovoDMIReaders !== undefined ||
        (held?.dmiStores !== undefined &&
          !held.dmiStores.some((store) => store.kind === "lenovoDMIStore"))
      );
    };
    if (settled()) {
      resolve();
      return;
    }
    const finish = () => {
      stop();
      clearTimeout(timer);
      resolve();
    };
    const stop = firmwareStore.subscribe(() => {
      if (settled()) finish();
    });
    const timer = setTimeout(finish, LENOVO_READERS_WAIT_MILLISECONDS);
  });
}

/**
 * A node as the panel's detail shows it: with the catalogue's name for a file, and for Lenovo's DMI
 * store the drivers that read it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentQueries.swift#UEFIAgentQueries.node
 * @upstream-differs the catalogue's name is put into the worker's answer here, as the panel puts
 * it into the worker's detail, since the page holds the catalogue
 */
async function nodeAsThePanelShowsIt(host: ToolReadHost, args: AgentArguments): Promise<Json> {
  const pane = await readyTree(host);
  const ask_ = () =>
    askUefiAgent(pane, {
      query: "uefi_node",
      values: args.values,
      answerBound: args.answerBound,
      contentVersion: host.contentVersion,
    });
  let response = await ask_();
  if (response.error !== undefined) throw new AgentToolError(response.error);
  if (response.needs === "lenovoReaders") {
    await lenovoReadersWait(pane);
    response = await ask_();
    if (response.error !== undefined) throw new AgentToolError(response.error);
  }
  const answer = response.answer ?? null;
  const node = isObject(answer) ? answer.node : undefined;
  if (!isObject(answer) || !isObject(node) || node.type !== "File") return answer;
  const guid = typeof node.guid === "string" ? guidFromText(node.guid) : undefined;
  if (guid === undefined) return answer;
  const listed = (await agentCatalogue()).nameOf(guid);
  if (listed === undefined || listed === answer.title || !Array.isArray(answer.fields)) {
    return answer;
  }
  // After the GUID, as the panel puts it; the label is the panel's, in English.
  const at = answer.fields.findIndex((one) => isObject(one) && one.label === "GUID");
  const place = at < 0 ? answer.fields.length : at + 1;
  const added = { label: withEnglish(() => L("Name in the catalogue")), value: listed };
  return {
    ...answer,
    fields: [...answer.fields.slice(0, place), added, ...answer.fields.slice(place)],
  };
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentQueries */
export const uefiAgentQueries: readonly ToolAgentQuery[] = [
  query(UEFI_TREE),
  {
    name: UEFI_NODE.name,
    title: UEFI_NODE.title,
    description: UEFI_NODE.description,
    properties: UEFI_NODE.properties,
    required: UEFI_NODE.required,
    run: async (host, args) => jsonAnswer(await nodeAsThePanelShowsIt(host, args)),
  },
  query(UEFI_FIND),
  query(UEFI_AT),
  query(UEFI_CHECKSUMS),
  query(REGION_SCAN),
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
    title: "Fix UEFI checksums",
    description:
      "Puts checksums right — a volume's header checksum, a file's header and data checksums, a " +
      "microcode's, an AMD PSP or BIOS directory's — computed by the code the UEFI Structure panel's " +
      "Fix Checksum runs, and writes them as one undo step. Give `node` for one node, or `all: true` " +
      "for every wrong checksum in the image (or under `node`) that can be written in place: a file " +
      "that holds a volume is put right after the files inside it, over their fixed bytes. " +
      "`uefi_checksums` lists the wrong ones, `uefi_node` marks one with `problem`. A node inside a " +
      "compressed section is never written (the file holds those bytes compressed): refused by " +
      "itself, left out of `all` and counted in `skipped_compressed`. Refused when nothing is wrong, " +
      "and without the person's permission to edit.",
    properties: {
      node: {
        type: "string",
        description: 'The node\'s id, e.g. "0.2.5". With `all`, only under it.',
      },
      all: {
        type: "boolean",
        description: "Every wrong checksum in the image, or under `node`. Default false.",
      },
    },
    undoName: () => L("Fix Checksum"),
    run: async (host, args) => {
      const answer = (await ask(host, "uefi_fix_checksum", args)) as {
        writes: { offset: number; bytes: string }[];
        fixed?: Json;
        skipped_compressed?: Json;
      };
      const transaction = {
        name: "Fix Checksum",
        writes: answer.writes.map((one) => ({
          offset: one.offset,
          bytes: parseHexBytes(one.bytes, "bytes"),
        })),
      };
      if (answer.fixed === undefined) return transaction;
      return {
        transaction,
        report: { fixed: answer.fixed, skipped_compressed: answer.skipped_compressed ?? 0 },
      };
    },
  },
];

/**
 * Where ranges of the file are in the UEFI structure (`uefiAgentLocator`), asked of the worker that
 * holds the tree. Nothing is known of a document whose image could not be read.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolModule.agentLocator
 */
export const uefiAgentLocator: ToolAgentLocator = {
  precedence: 0,
  areas: async (host) => {
    try {
      return placesOf(await ask(host, "uefi_areas", new AgentArguments({})));
    } catch {
      return [];
    }
  },
  locate: async (host, ranges) => {
    try {
      const answer = await ask(
        host,
        "uefi_locate",
        new AgentArguments({ ranges: ranges.map((one) => [one.start, one.end]) })
      );
      return (answer as Json[]).map(placesOf);
    } catch {
      return ranges.map(() => []);
    }
  },
};

/** The places a worker answered, as the seam's. */
export function placesOf(json: Json): ToolAgentPlace[] {
  return (json as unknown as WirePlace[]).map((one) => ({
    kind: one.kind,
    id: one.id,
    name: one.name,
    range:
      one.start === undefined || one.end === undefined
        ? undefined
        : { start: one.start, end: one.end },
  }));
}
