import { type AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import { AgentToolError } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import {
  type MFSState,
  type MFSStateBasis,
  type MFSStateEFS,
  type MFSStateReservedFiles,
  type MFSStateStep,
  mfsStateBasisIsIncomplete,
} from "@/firmware/me/models/firmwareFacts";
import {
  bootGuardProfileIndex,
  type ManufacturingBasis,
  type ManufacturingState,
} from "@/firmware/me/models/manufacturingFacts";
import { buildSummary, isSummaryValue, summaryValueText } from "@/tools/me/meaSummary";
import { manufacturingEvidence, manufacturingStateText } from "@/tools/meaBenchFactsText";
import { fileSystemStateText } from "@/tools/meaStateBasisText";
import { type MEANode, meaFieldText, meaNodeAt } from "@/tools/meaTree";
import { isStatusTone, type ToolValueTone } from "@/tools/toolValueTone";

/**
 * What the ME Analyzer answers an agent from the bytes alone, with its panel open or not: the
 * summary, and the tree of what the engine decoded, a node at a time. The caller runs these under
 * the English override.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries
 */

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`;

// MARK: - me_summary

export const ME_SUMMARY = {
  name: "me_summary",
  title: "ME summary",
  description:
    "The Intel ME / CSME / TXE / SPS firmware in the image, as the ME Analyzer panel's Summary tab " +
    "gives it: family, version, release, type, SKU, the platform, the security version (SVN), " +
    "whether the firmware database knows this build, and the analysis's messages (a corrupted " +
    "partition, a module whose hash fails, an update that will not apply). `tone` marks a verdict: " +
    'good, caution or bad. A value of "Coming soon" is a row this engine does not answer yet. ' +
    "The File System State row carries `basis`: what each of the three steps that decide it found " +
    "(the reserved MFS files, whether the EFS volume holds files, the configuration partitions), " +
    "which step decided it, `complete: false` when a step that could have raised the state could " +
    "not be taken — an EFS partition that could not be read — and an `explanation`, which is the " +
    "row's own line: the state and, in brackets, the evidence it was read from. Say the evidence " +
    "when you report the state: Configured with an unreadable EFS is not the same fact as " +
    "Configured with an empty one. Rows of our own answer what a bench asks of a dump it is about " +
    'to flash: "EOM on First Boot" (whether the platform closes End of Manufacturing on the first ' +
    'boot of this image — "Will close on the EOM flag" or "Will close on the descriptor\'s rights" ' +
    "(the two mechanisms: the flag only MFIT sets, and the access rights a serial image relies " +
    'on), "Will not close", "Will close on the EOM flag, with the descriptor open", "Not readable ' +
    'from this image" or "No such switch in this firmware"), which carries a `basis` of its own ' +
    "(the flag and which page it was read from, `flexible_eom_settings` — MFIT's " +
    "`FlexibleEomSettings` — and the descriptor's state); \"Manufacturing Lock\", the board's own " +
    'record of having been through End of Manufacturing; "Boot Guard", the profile the image is ' +
    "built for (0 - No_FVME, 3 - VM, 4 - FVE, 5 - FVME, with `profile` and `profile_index` beside " +
    'it, or "No profile record in this image"); "RPMC Hardware Binding"; and "OEM Public Key ' +
    'Hash", the hash the ME region carries, all zeros meaning OEM signing is disabled. The first ' +
    "call on a dump analyses its ME region, which takes a second or two.",
  properties: {},
} as const;

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.summary */
export function meSummaryAnswer(analysis: FirmwareAnalysis): Json {
  const blocks = buildSummary(analysis);
  return {
    blocks: blocks.map((block): Json => {
      const members: { [key: string]: Json } = {
        rows: block.rows.map((row): Json => {
          const entry: { [key: string]: Json } = {
            label: row.label,
            value: summaryValueText(row.value),
          };
          if (isSummaryValue(row.value) && isStatusTone(row.tone)) entry.tone = row.tone;
          // The one verdict whose evidence is not in the row: what each of its three steps found,
          // and which decided it.
          if (
            row.label === "File System State" &&
            isSummaryValue(row.value) &&
            analysis.mfsState !== undefined &&
            analysis.mfsStateBasis !== undefined
          ) {
            entry.basis = basisJson(analysis.mfsState, analysis.mfsStateBasis);
          }
          // The Manufacturing verdict's evidence likewise: the two pages of the setting, and
          // the descriptor's state.
          // @upstream-differs matched by the row's label as the Summary now names it, "EOM on
          // First Boot": upstream still asks for "Manufacturing", a label no row carries since
          // c6e5f94f, so its answer never has the basis
          if (
            row.label === "EOM on First Boot" &&
            isSummaryValue(row.value) &&
            analysis.manufacturingState !== undefined &&
            analysis.manufacturingBasis !== undefined
          ) {
            entry.basis = manufacturingBasisJson(
              analysis.manufacturingState,
              analysis.manufacturingBasis
            );
          }
          if (
            row.label === "Boot Guard" &&
            isSummaryValue(row.value) &&
            analysis.bootGuardProfile !== undefined
          ) {
            entry.profile = analysis.bootGuardProfile;
            entry.profile_index = bootGuardProfileIndex(analysis.bootGuardProfile);
          }
          return entry;
        }),
      };
      if (block.title !== undefined) members.title = block.title;
      return members;
    }),
  };
}

// MARK: - The Manufacturing verdict's basis

/**
 * The End of Manufacturing verdict's evidence, for the same reason the File System State
 * carries its own: an agent that acts on the verdict needs to see what it was read from.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.manufacturingBasisJSON
 */
export function manufacturingBasisJson(state: ManufacturingState, basis: ManufacturingBasis): Json {
  const verdict = manufacturingStateText(state, basis);
  const evidence = manufacturingEvidence(state, basis);
  return {
    flag: basis.flag ?? null,
    flexible_eom_settings: basis.flexible ?? null,
    flag_page: basis.page ?? "none",
    descriptor:
      basis.descriptorOpen === undefined ? "not read" : basis.descriptorOpen ? "open" : "locked",
    live_files: basis.liveFilesResolved ? "read" : "not read",
    // What the row itself reads, brackets and all.
    explanation: evidence === "" ? verdict : `${verdict} (${evidence})`,
  };
}

// MARK: - The File System State's basis

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.basisJSON */
export function basisJson(state: MFSState, basis: MFSStateBasis): Json {
  return {
    decided_by: stepName(basis.decidedBy),
    reserved_files: reservedText(basis.reservedFiles),
    efs: efsText(basis.efs),
    configuration: [...basis.configuration],
    complete: !mfsStateBasisIsIncomplete(basis),
    explanation: explanation(state, basis),
  };
}

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.stepName */
function stepName(step: MFSStateStep): string {
  switch (step) {
    case "reservedFiles":
      return "reserved_files";
    case "efs":
      return "efs";
    case "configuration":
      return "configuration";
    case "nothing":
      return "nothing";
  }
}

const list = (indices: readonly number[]): string =>
  indices.map((index) => `file ${index}`).join(", ");

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.reservedText */
export function reservedText(files: MFSStateReservedFiles): string {
  switch (files.kind) {
    case "notRead":
      return "not read: this volume names its files through its own tables (CSME 15/16), so no state is claimed from file indices";
    case "none":
      return "none of the reserved low-level files (0–5, 7, 8, 9) is present";
    case "initializing":
      return `present: ${list(files.indices)}, which mean Initialized`;
    case "configuring":
      return `present: ${list(files.indices)}, which mean Configured`;
  }
}

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.efsText */
export function efsText(efs: MFSStateEFS): string {
  switch (efs.kind) {
    case "holdsFiles":
      return "the EFS volume holds file content, which means Initialized";
    case "noFileContent":
      return "the EFS volume was read and holds no file content";
    case "filesNotNamed":
      return "the EFS volume was read, but its files are known only from the firmware database's file table, which was not available";
    case "unreadable":
      return `unreadable: the partition table lists an EFS partition at ${hex(efs.offset)}, but no EFS volume could be read there`;
    case "noPartition":
      return "no EFS partition";
  }
}

/**
 * What the row itself reads: the state, then its evidence in brackets — the panel's own words
 * in the English every agent call is answered in.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.explanation
 */
export const explanation = (state: MFSState, basis: MFSStateBasis): string =>
  fileSystemStateText(state, basis);

// MARK: - me_tree

/**
 * How many of a file's stretches `me_tree` lists: a 12 KiB MFS file is some 190 chunks.
 *
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.extentsShown
 */
export const EXTENTS_SHOWN = 64;

export const ME_TREE = {
  name: "me_tree",
  title: "ME structure",
  description:
    "The structure the ME engine decoded, as the ME Analyzer panel's Full Info tab shows it: the " +
    "partition table, partitions, code partition manifests and modules, the MFS or EFS file " +
    "system and its files, the configuration records, the checksums. Without `node`, the top " +
    "groups; with it, that node's fields and its children. Each node: `id` (pass it back as " +
    "`node`; ids are positions, so they hold for this dump only), `title`, `subtitle`, its bytes " +
    "(`start`, `end`) when it stands for some, `children` as a count, and `problem` with its " +
    "lines when the panel marks one. An MFS or EFS file has no one range: its bytes are scattered " +
    "over the volume's pages, so it says `stretches`, how many, and asked for as `node` lists " +
    "them as `extents`, in the file's own order. Pages: `limit` is the most children on one page, " +
    "a ceiling — a page also stops before the answer passes the size bound and then says " +
    '`truncated: "size"`; pass `next` back as `after` until it is null. `total` counts the children.',
  properties: {
    node: AgentSchema.string('A node id such as "2.0.3" from an earlier answer. Default: the top.'),
    limit: AgentSchema.limit(100, 400),
    after: AgentSchema.after,
  },
} as const;

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.tree */
export function meTreeAnswer(
  roots: readonly MEANode[],
  args: AgentArguments,
  contentVersion: number
): Json {
  const path = parsePath(args.optionalString("node"));
  const limit = args.limit(100, 400);
  const paging = new AgentPage(args, AgentPage.fingerprint([contentVersion, idText(path)]));
  const answer: { [key: string]: Json } = {};
  let children: readonly MEANode[];
  if (path.length === 0) {
    children = roots;
  } else {
    const node = meaNodeAt(roots, path);
    if (node === undefined) {
      throw new AgentToolError(
        `No ME node ${idText(path)}. Ids come from \`me_tree\` on the same document.`
      );
    }
    const detail = summaryOf(node) as { [key: string]: Json };
    detail.fields = node.fields.map((field): Json => {
      const entry: { [key: string]: Json } = { label: field.label, value: meaFieldText(field) };
      const tone: ToolValueTone = field.tone ?? "standard";
      if (isStatusTone(tone)) entry.tone = tone;
      return entry;
    });
    // A file's bytes are where the volume put them: the stretches in the file's order, which
    // `read` reads back.
    const extents = node.extents;
    if (extents !== undefined && extents.length > 0) {
      detail.extents = extents
        .slice(0, EXTENTS_SHOWN)
        .map((one): Json => ({ start: hex(one.start), end: hex(one.end) }));
      if (extents.length > EXTENTS_SHOWN) {
        detail.extents_note = `${extents.length} stretches; the first ${EXTENTS_SHOWN} are listed.`;
      }
    }
    answer.node = detail;
    children = node.children;
  }
  answer.total = children.length;
  return paging.answer(
    answer,
    "children",
    children.slice(paging.first, paging.first + limit).map(summaryOf),
    children.length,
    args.answerBound
  );
}

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.summaryOf */
function summaryOf(node: MEANode): Json {
  const members: { [key: string]: Json } = { id: idText(node.path), title: node.title };
  if (node.subtitle !== "") members.subtitle = node.subtitle;
  if (node.range !== undefined) {
    members.start = hex(node.range.start);
    members.end = hex(node.range.end);
  }
  if (node.extents !== undefined && node.extents.length > 0)
    members.stretches = node.extents.length;
  if (node.children.length > 0) members.children = node.children.length;
  if (node.isEmptySection) members.empty = true;
  const problem = node.marks?.problem;
  if (problem !== undefined) {
    members.problem = {
      severity: problem.isError ? "error" : "caution",
      lines: [...problem.lines],
    };
  }
  return members;
}

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.id */
export const idText = (path: readonly number[]): string => path.join(".");

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.path */
export function parsePath(text: string | undefined): number[] {
  if (text === undefined || text === "" || text === "root") return [];
  const parts = text.split(".").map((part) => (/^[0-9]+$/.test(part) ? Number(part) : -1));
  if (parts.some((part) => part < 0)) {
    throw new AgentToolError(
      `\`${text}\` is not an ME node id. Ids look like "2.0.3" and come from \`me_tree\`.`
    );
  }
  return parts;
}
