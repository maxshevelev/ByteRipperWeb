import type { Json } from "@/core/agent/json";
import { FLASH_REGIONS } from "@/firmware/uefi/descriptorParser";
import { nodeFileRange, nodeIdText, type UEFINode } from "@/firmware/uefi/uefiNode";
import { type AgentTree, expanded } from "@/tools/uefi/agent/uefiAgentTree";
import { ownName } from "@/tools/uefi/uefiTreeDisplay";

/**
 * Where ranges of the file are in the UEFI structure, for answers that are not the module's own —
 * the runs a byte comparison found (`ToolAgentLocator`, `Design/PORT_AGENT.md`).
 *
 * The areas are the parts of the image a reader names first: the descriptor's regions, and inside
 * the BIOS region its volumes and the padding between them — the children of the region in
 * `uefi_tree`. A range is placed by the chain of nodes holding its first byte and the chain holding
 * its last, opened as `uefi_at` opens them: the deepest node the two share covers the range whole.
 * Nodes inside a compressed section have no file address, so a range there is placed at the
 * compressed section.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentLocator.swift#UEFIAgentLocator
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentLocator.swift#UEFIAgentLocator.locator
 */

/** A place as it crosses the worker's wire. */
export interface WirePlace {
  readonly kind: string;
  readonly id: string;
  readonly name: string;
  readonly start?: number;
  readonly end?: number;
}

const BIOS_SUBTYPES: ReadonlySet<number> = new Set([
  FLASH_REGIONS.indexOf("bios"),
  FLASH_REGIONS.indexOf("bios2"),
]);

/**
 * The top-level parts of the image, in address order.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentLocator.swift#UEFIAgentLocator.areas
 */
export function areasIn(tree: AgentTree): UEFINode[] {
  const result: UEFINode[] = [];
  const walk = (nodes: readonly UEFINode[]): void => {
    for (const node of nodes) {
      if (nodeFileRange(node) === undefined) continue;
      if (node.kind === "capsule" || node.kind === "intelImage" || node.kind === "uefiImage") {
        walk(expanded(tree, node.id));
      } else if (
        node.kind === "region" &&
        node.subtype !== undefined &&
        BIOS_SUBTYPES.has(node.subtype)
      ) {
        const children = expanded(tree, node.id).filter((one) => nodeFileRange(one) !== undefined);
        if (children.length === 0) result.push(node);
        else result.push(...children);
      } else {
        result.push(node);
      }
    }
  };
  walk(tree.roots);
  return result.sort(
    (one, two) => (nodeFileRange(one)?.start ?? 0) - (nodeFileRange(two)?.start ?? 0)
  );
}

/**
 * The area `range` is in and the deepest node covering it whole; one place when the two are the
 * same node, none when no node covers it.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentLocator.swift#UEFIAgentLocator.locate
 */
export function locateIn(
  range: { readonly start: number; readonly end: number },
  tree: AgentTree,
  areas: ReadonlySet<string>
): WirePlace[] {
  if (range.end <= range.start) return [];
  const first = chain(tree, range.start);
  const last = range.end - range.start === 1 ? first : chain(tree, range.end - 1);
  const shared: UEFINode[] = [];
  for (const [index, one] of first.entries()) {
    const other = last[index];
    if (other === undefined || nodeIdText(one.id) !== nodeIdText(other.id)) break;
    shared.push(one);
  }
  const deepest = shared.at(-1);
  if (deepest === undefined) return [];
  const area = shared.find((one) => areas.has(nodeIdText(one.id)));
  if (area !== undefined && nodeIdText(area.id) !== nodeIdText(deepest.id)) {
    return [place(area), place(deepest)];
  }
  return [place(deepest)];
}

/** The nodes that hold a byte, outermost first, opening the containers on the way. */
function chain(tree: AgentTree, offset: number): UEFINode[] {
  const found: UEFINode[] = [];
  let nodes: readonly UEFINode[] = tree.roots;
  for (;;) {
    const node = nodes.find((one) => {
      const range = nodeFileRange(one);
      return range !== undefined && offset >= range.start && offset < range.end;
    });
    if (node === undefined) break;
    found.push(node);
    if (node.kind === "section" && node.isExpandable) break;
    if (node.isExpandable) tree.open(node);
    nodes = node.children;
  }
  return found;
}

/** @upstream Modules/UEFITool/Sources/UEFITool/UEFIAgentLocator.swift#UEFIAgentLocator.place */
export function place(node: UEFINode): WirePlace {
  const range = nodeFileRange(node);
  return {
    kind: "uefi",
    id: nodeIdText(node.id),
    name: ownName(node) ?? node.name,
    ...(range === undefined ? {} : { start: range.start, end: range.end }),
  };
}

/** The wire's places as JSON an answer carries. */
export const placesJson = (places: readonly WirePlace[]): Json => places.map((one) => ({ ...one }));
