import type { Json } from "@/core/agent/json";
import type { DMIStore } from "@/firmware/uefi/dmiStore";
import { nodeFileRange, type UEFINode, type UEFINodeKind } from "@/firmware/uefi/uefiNode";
import {
  detailMembers,
  hexText,
  nodeSummary,
  pathNames,
} from "@/tools/uefi/agent/uefiAgentQueries";
import type { AgentTree } from "@/tools/uefi/agent/uefiAgentTree";

/**
 * Where the image keeps the board's identity, for an agent: the stores the UEFI Structure's DMI
 * button goes to (`DMIStore`), each with what the panel's detail says about it. The search is the
 * panel's own, so the agent finds a store exactly where the button would.
 *
 * The parser knows a few layouts, each by checks of its own. A dump with none of them found can
 * still hold the board's identity — another vendor's layout, or a known one damaged or moved — and
 * every answer says so, so that "none found" is never read as "none there".
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentDMI.swift#UEFIAgentDMI
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentDMI.swift#UEFIAgentDMI.all
 */

/**
 * What an answer says about what the parser can and cannot find.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentDMI.swift#UEFIAgentDMI.scope
 */
const SCOPE =
  "The parser finds a DMI area only by its algorithms for the dump layouts it knows: Lenovo's " +
  "DMI store (an LDBG change log and two LENV blocks), AMI's GPNV store as ASUS writes it, " +
  "Acer's 8 KiB DMI area, and HP's HP_MUD variable in the main VSS2 store, with BuildId, " +
  "FactoryConfig (the feature byte) and HP_TAGS (the asset tracking number) beside it — what HP's " +
  "BCU reports. An area that is not found is not therefore absent from the dump: it may " +
  "be in a layout the parser does not know, or a known one that is damaged, wiped or moved so its " +
  "checks fail.";

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentDMI.swift#UEFIAgentDMI.stores */
export const UEFI_DMI = {
  name: "uefi_dmi",
  title: "DMI area",
  description:
    "The image's DMI areas — where the firmware keeps the board's identity: serial numbers, UUID, " +
    "model — as the UEFI Structure panel's DMI button finds them. It opens every container in the " +
    'file, but no compressed section. Each area: `layout` ("Lenovo DMI store", "GPNV store", "Acer ' +
    'DMI" — the Type column calls these Padding — or "HP DMI", a VSS entry that may be one the ' +
    "store marks deleted, as most HP boards keep it), its node as `uefi_tree` gives it (`id`, `label`, " +
    "`start`, `end`, `encoded` for an XORed LENV block), `size`, `path`, and the panel's `fields` " +
    "and `tables` for it; `uefi_node` on its children reads further, `uefi_node_data` reads the " +
    `bytes. ${SCOPE} So an empty \`areas\` means only that the parser recognised none — say so to ` +
    "the person, never that the dump has no DMI; `region_scan` judges the nameless areas by their " +
    'bytes, which is where to look next. With `survey`, group a folder of dumps by "total" or ' +
    '"areas.0.layout" — the whole answer holds each board\'s own serials, so no two dumps would ' +
    "share a group.",
  properties: {},
} as const;

/**
 * The answer for `stores`, the DMI areas the worker found over the image opened all the way down
 * but for compressed sections.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentDMI.swift#UEFIAgentDMI.stores
 * @upstream-differs the stores come from the worker, which holds the search the DMI button asks
 */
export function uefiDMI(tree: AgentTree, stores: readonly DMIStore[]): Json {
  const areas: Json[] = [];
  for (const store of stores) {
    const node = storeNode(tree, store);
    if (node === undefined) continue;
    areas.push({
      ...nodeSummary(tree, node),
      layout: dmiLayout(store.kind),
      size: hexText(store.range.end - store.range.start),
      path: pathNames(tree, node.id),
      ...detailMembers(tree.detail(node, node.id)),
    });
  }
  return {
    areas,
    total: areas.length,
    note: areas.length === 0 ? `None found. ${SCOPE}` : SCOPE,
  };
}

/** The node of the agent's tree that is `store`, its branches opened on the way down. */
function storeNode(tree: AgentTree, store: DMIStore): UEFINode | undefined {
  let nodes: UEFINode[] = tree.roots;
  for (;;) {
    const holding = nodes.filter((one) => {
      const range = nodeFileRange(one);
      return (
        range !== undefined && store.range.start >= range.start && store.range.end <= range.end
      );
    });
    const found = holding.find((one) => {
      const range = nodeFileRange(one);
      return (
        one.kind === store.kind &&
        range?.start === store.range.start &&
        range.end === store.range.end
      );
    });
    if (found !== undefined) return found;
    const next = holding[0];
    if (next === undefined || (next.kind === "section" && next.isExpandable)) return undefined;
    if (next.isExpandable) tree.open(next);
    nodes = next.children;
  }
}

/**
 * Which of the known layouts a store is, by the name the bench knows it by: the Type column calls
 * every one of them Padding, as UEFITool does.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentDMI.swift#UEFIAgentDMI.layout
 */
export function dmiLayout(kind: UEFINodeKind): string {
  switch (kind) {
    case "lenovoDMIStore":
      return "Lenovo DMI store";
    case "gpnvStore":
      return "GPNV store";
    case "acerDMIStore":
      return "Acer DMI";
    case "vssEntry":
      return "HP DMI";
    default:
      return "Unknown";
  }
}
