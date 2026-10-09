import type { AgentArguments } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import { AgentToolError, jsonAnswer } from "@/core/agent/agentTool";
import { withEnglish } from "@/core/localization/localization";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { type MeAgentReading, meAgentReading } from "@/state/meAgentReading";
import {
  ME_SUMMARY,
  ME_TREE,
  meSummaryAnswer,
  meTreeAnswer,
} from "@/tools/me/agent/meAgentAnswers";
import { filesAnswer, ME_FILES_COMPARE, volumeArgument } from "@/tools/me/agent/meAgentFiles";
import { presentMEA } from "@/tools/meaTree";
import { compareMEFiles, type MEFileReader } from "@/tools/meFileComparison";
import type { ToolAgentComparison, ToolAgentQuery, ToolReadHost } from "@/tools/toolAgent";

/**
 * What the ME Analyzer module says to an agent: the summary, the structure the engine decoded, and
 * two dumps' file systems compared file by file.
 *
 * The analysis is the pane's own: one the panel or the UEFI Structure already made is answered from
 * at once, and one made here is kept for them. Asked for with the panel open or not.
 *
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolModule.agentQueries
 * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolModule.agentComparisons
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.all
 * @upstream Modules/MEATool/Sources/MEATool/MEAAgentFiles.swift#MEAAgentFiles.comparisons
 */

/** @upstream Modules/MEATool/Sources/MEATool/MEAAgentQueries.swift#MEAAgentQueries.all */
export const meAgentQueries: readonly ToolAgentQuery[] = [
  {
    name: ME_SUMMARY.name,
    title: ME_SUMMARY.title,
    description: ME_SUMMARY.description,
    properties: ME_SUMMARY.properties,
    run: async (host) => {
      const reading = await meAgentReading(host.pane);
      return jsonAnswer(withEnglish(() => meSummaryAnswer(reading.analysis)));
    },
  },
  {
    name: ME_TREE.name,
    title: ME_TREE.title,
    description: ME_TREE.description,
    properties: ME_TREE.properties,
    run: async (host, args) => {
      const reading = await meAgentReading(host.pane);
      return jsonAnswer(
        withEnglish(() =>
          meTreeAnswer(
            presentMEA(
              reading.analysis,
              undefined,
              reading.names,
              reading.efsNames,
              reading.configPaths
            ),
            args,
            host.contentVersion
          )
        )
      );
    },
  },
];

/** The dump's bytes where a file's content is read from, as the analysis addresses them. */
async function readerOf(host: ToolReadHost): Promise<MEFileReader | undefined> {
  // A dump is read whole for the comparison to count the bytes that differ; one too large to hold
  // is compared by its digests alone.
  if (host.contentSize > MAX_SNAPSHOT) return undefined;
  const bytes = await host.read(0, host.contentSize);
  return (start, end) =>
    start < 0 || end > bytes.length || end < start ? undefined : bytes.subarray(start, end);
}

const MAX_SNAPSHOT = 0x400_0000;

const isFileSystem = (analysis: FirmwareAnalysis): boolean =>
  analysis.mfsVolume !== undefined ||
  analysis.efsVolume !== undefined ||
  analysis.regions.some((region) => region.name === "MFS" || region.name === "EFS");

/** @upstream Modules/MEATool/Sources/MEATool/MEAToolUI/MEAToolModule.swift#MEAToolModule.agentComparisons */
export const meAgentComparisons: readonly ToolAgentComparison[] = [
  {
    name: ME_FILES_COMPARE.name,
    title: ME_FILES_COMPARE.title,
    description: ME_FILES_COMPARE.description,
    properties: ME_FILES_COMPARE.properties,
    run: async (host, against, args: AgentArguments) => {
      const given = args.optionalString("volume");
      const volume = volumeArgument(args);
      if (given !== undefined && volume === undefined) {
        throw new AgentToolError('`volume` is "mfs" or "efs".');
      }
      const name = args.optionalString("name");
      const withExtents = args.bool("extents", false);
      const limit = args.limit(40, 200);
      const paging = new AgentPage(
        args,
        AgentPage.fingerprint([
          host.contentVersion,
          against.contentVersion,
          volume ?? null,
          name?.toLowerCase() ?? null,
          withExtents,
        ])
      );
      const mine: MeAgentReading = await meAgentReading(host.pane);
      const theirs: MeAgentReading = await meAgentReading(against.pane);
      if (!isFileSystem(mine.analysis) && !isFileSystem(theirs.analysis)) {
        throw new AgentToolError(
          "Neither document has an MFS or EFS file system the ME engine could find."
        );
      }
      const comparison = compareMEFiles(
        mine.analysis,
        theirs.analysis,
        {
          a: { mfs: mine.names, efs: mine.efsNames },
          b: { mfs: theirs.names, efs: theirs.efsNames },
        },
        await readerOf(host),
        await readerOf(against)
      );
      return jsonAnswer(
        withEnglish(() =>
          filesAnswer(comparison, volume, name, withExtents, limit, paging, args.answerBound)
        )
      );
    },
  },
];
