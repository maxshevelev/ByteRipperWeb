import type { AgentCallRecord } from "@/core/agent/agentServer";
import type { AgentTool } from "@/core/agent/agentTool";
import { L } from "@/core/localization/localization";

/**
 * One tool an agent is offered, as the Agent window's Tools page lists it: the tool as the agent
 * sees it, where it comes from and what it does to the world.
 *
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolEntry
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolEntry.tool
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolEntry.group
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolEntry.kind
 */
export interface AgentToolEntry {
  readonly tool: AgentTool;
  readonly group: AgentToolGroup;
  readonly kind: AgentToolKind;
}

/**
 * Where a tool comes from: a part of the host, or a tool-module.
 *
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolGroup
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolGroup.title
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolGroup.isEdits
 * @upstream-differs a record of the group's key and its title, where upstream's is an enum with a
 * case that carries the module
 */
export interface AgentToolGroup {
  /** What tells two groups apart: a host group's name, or a module's identifier. */
  readonly key: string;
  /** The heading of its section, in the language the app is speaking. */
  readonly title: () => string;
  readonly isEdits: boolean;
}

/** @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolGroup */
export const HOST_GROUPS = {
  files: { key: "files", title: () => L("Files and View"), isEdits: false },
  marks: { key: "marks", title: () => L("Marks"), isEdits: false },
  dumps: { key: "dumps", title: () => L("Dumps and Findings"), isEdits: false },
  comparison: { key: "comparison", title: () => L("Comparison"), isEdits: false },
  search: { key: "search", title: () => L("Search"), isEdits: false },
  edits: { key: "edits", title: () => L("Edits"), isEdits: true },
  panels: { key: "panels", title: () => L("Tool Panels"), isEdits: false },
} as const satisfies Record<string, AgentToolGroup>;

/**
 * What a tool does: reads, changes what is on screen (the view, a mark, a finding), or changes a
 * file.
 *
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolKind
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolKind.title
 */
export type AgentToolKind = "read" | "screen" | "edit";

export function kindTitle(kind: AgentToolKind): string {
  switch (kind) {
    case "read":
      return L("Read");
    case "screen":
      return L("On Screen");
    case "edit":
      return L("Edits a File");
  }
}

/**
 * How a tool has been used since the app started.
 *
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats.calls
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats.failures
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats.total
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats.longest
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats.answerBytes
 * @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats.last
 * @upstream-differs a value that is replaced, not changed in place: the store hands it to React
 */
export interface AgentToolStats {
  readonly calls: number;
  /** Calls that did not answer: refused, too long to send, withdrawn. */
  readonly failures: number;
  readonly totalMilliseconds: number;
  readonly longestMilliseconds: number;
  readonly answerBytes: number;
  readonly last: Date | undefined;
}

/** @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats.add */
export function addToStats(
  held: AgentToolStats | undefined,
  record: AgentCallRecord
): AgentToolStats {
  const before = held ?? {
    calls: 0,
    failures: 0,
    totalMilliseconds: 0,
    longestMilliseconds: 0,
    answerBytes: 0,
    last: undefined,
  };
  return {
    calls: before.calls + 1,
    failures: before.failures + (record.outcome.kind === "answered" ? 0 : 1),
    totalMilliseconds: before.totalMilliseconds + record.durationMilliseconds,
    longestMilliseconds: Math.max(before.longestMilliseconds, record.durationMilliseconds),
    answerBytes: before.answerBytes + record.answerBytes,
    last: record.finished,
  };
}

/** @upstream ByteRipperApp/Agent/AgentToolCatalogue.swift#AgentToolStats.average */
export const averageMilliseconds = (stats: AgentToolStats): number | undefined =>
  stats.calls === 0 ? undefined : stats.totalMilliseconds / stats.calls;

/** @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.durationText */
export function durationText(milliseconds: number): string {
  return milliseconds < 1000
    ? L("%1$@ ms", Math.round(milliseconds))
    : L("%1$@ s", (milliseconds / 1000).toFixed(1));
}

/**
 * The tools in sections, one to each group in the order the groups first come.
 *
 * @upstream ByteRipperApp/Agent/AgentToolsPage.swift#AgentToolsPage.show
 */
export function sectionsOf(
  entries: readonly AgentToolEntry[]
): { readonly title: string; readonly entries: readonly AgentToolEntry[] }[] {
  const order: string[] = [];
  const sections = new Map<string, { title: string; entries: AgentToolEntry[] }>();
  for (const entry of entries) {
    const title = entry.group.title();
    let section = sections.get(title);
    if (section === undefined) {
      section = { title, entries: [] };
      sections.set(title, section);
      order.push(title);
    }
    section.entries.push(entry);
  }
  return order.map((title) => sections.get(title) as { title: string; entries: AgentToolEntry[] });
}
