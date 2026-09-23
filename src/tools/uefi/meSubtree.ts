import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { huffmanDictionariesWanted } from "@/firmware/me/engine/huffmanNeed";
import type { FirmwareAnalysis } from "@/firmware/me/models/firmwareAnalysis";
import { Sub } from "@/firmware/uefi/uefiTypes";
import { fileTableStore, loadFileTable } from "@/state/fileTableStore";
import { analyzePaneMe, checksumPaneMe, fileNamesPaneMe } from "@/state/firmwareStore";
import { huffmanDictionaryStore, loadHuffmanDictionaries } from "@/state/huffmanDictionaryStore";
import { loadMEDatabase, meDatabaseStore } from "@/state/meDatabaseStore";
import { useStore } from "@/state/useStore";
import type { PaneId } from "@/state/workspaceStore";
import { ConfigRecordPaths } from "@/tools/configRecordPaths";
import { EFSFileNames } from "@/tools/efsFileNames";
import {
  CHECKSUMS_TITLE,
  type MEAChecksums,
  type MEANode,
  meaNodeAt,
  presentMEA,
} from "@/tools/meaTree";
import { fileTableWanted, MFSFileNames } from "@/tools/mfsFileNames";
import { EMPTY_DETAIL, type NodeDetail, tonedField } from "@/tools/toolDetail";
import type { WireNode } from "@/workers/protocol";

/**
 * The ME region, inside the UEFI Structure tree
 * (`Design/ME_REGION_IN_UEFI_TREE.md`, upstream's
 * `Design/ME_REGION_IN_UEFI_TREE_PLAN.md`).
 *
 * The UEFI tree stops at the ME region: the descriptor names it, and nothing
 * below it is UEFI. What is below it is what the ME Analyzer reads, so opening
 * the region runs that analysis — the pane's own, shared with the ME panel —
 * and grafts the curated `MEANode` sub-tree under the region's row rather than
 * parsing the ME bytes a second way.
 *
 * This is upstream's `// MARK: - The ME sub-tree` section of `UEFIToolModule`,
 * kept in one file of its own: the panel reads rows and says what a row is, and
 * everything about *getting* the sub-tree is here.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession
 */

/**
 * Whether a node of the UEFI tree is the ME region — the graft point the ME
 * sub-tree opens under. The descriptor names it by its region type (0x02), and
 * it is the one region the UEFI tree does not scan as a raw area: opening it
 * runs the ME analysis instead.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#UEFIToolViewController.isMERegion
 */
export function isMeRegion(node: WireNode): boolean {
  return node.kind === "region" && node.subtype === Sub.meRegion;
}

/**
 * The path of the ME region node, when there is one — the graft point. Nothing
 * for a file with no ME region.
 *
 * A walk that stops at the first match: the ME region is a sibling of the
 * descriptor near the top of the tree, so this looks at a handful of nodes.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.meRegionID
 */
export function meRegionPath(roots: readonly WireNode[]): readonly number[] | undefined {
  for (const node of roots) if (isMeRegion(node)) return node.id;
  for (const node of roots) {
    const found = meRegionPath(node.children);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * What an ME row is called in the list's own keys.
 *
 * Prefixed, because the two halves of this outline are keyed by different
 * things: a UEFI row's key is its node's path joined by dots, and a one-level
 * ME path would read as a UEFI root. Upstream keeps them apart by holding two
 * kinds of row object; a list keyed by strings keeps them apart here.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolViewController.swift#MEOutlineRow.path
 * @upstream-differs a prefixed string key, where upstream's outline holds a row object per kind
 */
export const meKey = (path: readonly number[]): string => `me/${path.join("/")}`;

/** The path an ME row's key names, or nothing when the key is a UEFI row's. */
export function mePathOf(key: string): readonly number[] | undefined {
  if (!key.startsWith("me/")) return undefined;
  const rest = key.slice(3);
  return rest.length === 0 ? [] : rest.split("/").map(Number);
}

/**
 * What names an ME row in the detail: its title, and — when the row has nothing
 * else to say — the subtitle it carries.
 *
 * A row that stands for bytes already answers this in the fields under the
 * heading (`Offset`, `Size`), and a heading repeating them would say it twice.
 * A group carries no fields at all, so its heading is the whole of what the
 * detail can say about it: without the subtitle a count like "17 regions" would
 * be nowhere in the panel.
 *
 * This is the one place the subtitle can land. The ME Analyzer keeps it in a
 * Summary column of its own; this panel's tree has no column for it — the two
 * beside the name are a UEFI node's kind and subtype, which an ME row is
 * neither.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.meDetailTitle
 */
export function meDetailTitle(node: MEANode): string {
  if (node.fields.length > 0 || node.subtitle.length === 0) return node.title;
  return `${node.title} · ${node.subtitle}`;
}

/**
 * An ME row's detail, in the shape this panel's detail list draws.
 *
 * The curated fields render through the same label/value rows a UEFI node's
 * header does; a field whose tone is a check that passed keeps its green mark.
 * The full tone rendering is the ME Analyzer's — this is the sub-tree's view of
 * it.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.show
 */
export function meDetail(node: MEANode | undefined): NodeDetail {
  if (node === undefined) return EMPTY_DETAIL;
  return {
    title: meDetailTitle(node),
    fields: node.fields.map((one) => tonedField(one.label, one.value, one.tone ?? "standard")),
    tables: [],
  };
}

/**
 * The path of the innermost presented ME row whose range covers `offset`, or
 * nothing when the offset falls in none of them. A row that stands for no bytes
 * — the identity, a group — is descended through rather than answered with, the
 * same way `meaZones` refuses to zone one.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.mePath
 */
export function mePathCovering(
  nodes: readonly MEANode[],
  offset: number
): readonly number[] | undefined {
  for (const node of nodes) {
    const deeper = mePathCovering(node.children, offset);
    if (deeper !== undefined) return deeper;
    if (node.range !== undefined && offset >= node.range.start && offset < node.range.end) {
      return node.path;
    }
  }
  return undefined;
}

/** Whether this row is the Checksums group, whose digests are read on demand. */
const isChecksumsRow = (node: MEANode): boolean =>
  node.path.length === 1 && node.title === CHECKSUMS_TITLE;

/** What the panel has of the ME sub-tree, and what it can ask for. */
export interface MeSubtree {
  /**
   * The presented sub-tree — the rows the ME region node opens onto. Empty
   * until the analysis has run (or was found in the pane's cache), which is why
   * the region's row is shut on first paint.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.meRoots
   */
  readonly roots: readonly MEANode[];
  /** Why there is no sub-tree, when the reading could not be made. */
  readonly problem: string | undefined;
  /** Whether an analysis is running right now. */
  readonly isReading: boolean;
  /**
   * The reader opened the ME region: run the analysis, unless the pane already
   * holds one.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.openMERegion
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.runMEAnalysis
   */
  readonly open: () => void;
  /**
   * A row was picked: when it is the Checksums group, that is what asks for the
   * digests — the engine leaves them out of a parse because they are three
   * passes over the whole region.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.loadChecksums
   */
  readonly rowPicked: (node: MEANode) => void;
  /**
   * There is no ME region to present any more: the file in the pane was
   * replaced by one without it. Everything read of the last file goes, and the
   * region is not opened again until a reader opens one.
   *
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.contentChanged
   */
  readonly close: () => void;
}

/**
 * The shared ME analysis behind the region's row, presented.
 *
 * Nothing is read until {@link MeSubtree.open} is called: a panel whose reader
 * never opened the ME region pays for none of it, which is upstream's rule for
 * the same work.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.presentME
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.loadFileNames
 * @upstream-differs a hook, where upstream's session holds the same state in fields
 */
export function useMeSubtree(
  pane: PaneId,
  ready: boolean,
  uefiRoots: readonly WireNode[] | undefined
): MeSubtree {
  const database = useStore(meDatabaseStore);
  const huffman = useStore(huffmanDictionaryStore);
  const fileTable = useStore(fileTableStore);
  /** Whether the reader has opened the region at all. */
  const [wanted, setWanted] = useState(false);
  const [analysis, setAnalysis] = useState<FirmwareAnalysis | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [isReading, setIsReading] = useState(false);
  const [checksums, setChecksums] = useState<MEAChecksums | undefined>(undefined);
  const [names, setNames] = useState<MFSFileNames>(MFSFileNames.none);
  const [efsNames, setEfsNames] = useState<EFSFileNames>(EFSFileNames.none);
  const [configPaths, setConfigPaths] = useState<ConfigRecordPaths>(ConfigRecordPaths.none);
  /** Which analysis a landing belongs to: a landing a later one superseded is dropped. */
  const run = useRef(0);
  /** Whether the region is open at all, so closing it twice does nothing. */
  const isOpen = useRef(false);
  const fileNamesJob = useRef(0);
  const askedChecksums = useRef(false);
  /**
   * The analysis on screen, to tell a re-ask that came back with the same one
   * from a genuinely new reading. A tree change the region did not feel — an
   * unrelated branch expanding — re-runs the ask, and the pane answers it from
   * the cache with the very reading that is on screen; throwing the digests it
   * held away for that would send the Checksums row back to "Loading…" for
   * nothing. Not a gate: whether the reading is still the answer is the pane's
   * question, answered where the reading is kept (`analyzePaneMe`).
   *
   * @upstream Modules/MEATool/Sources/MEAToolUI/MEAToolModule.swift#MEAToolSession
   */
  const shown = useRef<FirmwareAnalysis | undefined>(undefined);

  const databaseText = database.text;
  const huffmanText = huffman.text;
  const fileTableText = fileTable.body?.text;

  // The database is fetched when the region is opened and not before, the way
  // upstream's data source is only reached by the reading itself.
  useEffect(() => {
    if (wanted) loadMEDatabase();
  }, [wanted]);

  // Read again when the image changes and when a data file lands: MEA.dat turns
  // a structure into an identity, Huffman.dat and FileTable.dat let the modules
  // be checked and the FTBL files named, and none of them must wait for a
  // click. The tree is the content's own change signal — a byte edit hands a
  // fresh one (`firmwareInvalidate` drops and re-reads only what the edit
  // made stale) — so a region the edit touched is re-read without a click, and
  // a region it did not touch is answered from the pane rather than re-read.
  // The reading is the pane's — a second panel, or a re-open of this one, is
  // answered from there rather than reading the region again. The ask crosses
  // every data file it has: the pane's cache is keyed on all of them, so a
  // reading made before one of them landed is not the answer to the question
  // that now includes it.
  useEffect(() => {
    if (!wanted) return;
    if (!ready || uefiRoots === undefined) {
      // The image is being read again — an edit landed, or the pane's content
      // was replaced. Whatever this holds describes the bytes as they were, so
      // it goes rather than standing there unmarked; the ask below runs again
      // when the tree is back, and the region's row fills in with it.
      //
      // The panel is also told the reading is not running, or a row held shut
      // for it would stay shut for good.
      // @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.contentChanged
      run.current++;
      setIsReading(false);
      setAnalysis(undefined);
      setProblem(undefined);
      shown.current = undefined;
      return;
    }
    const job = ++run.current;
    setIsReading(true);
    void analyzePaneMe(pane, databaseText, huffmanText, fileTableText).then((found) => {
      if (job !== run.current) return;
      setIsReading(false);
      if (found === undefined) return;
      // A new analysis is a new question: the digests it held were about the
      // bytes it read, and they go with it — but the pane answers a re-ask of
      // the same question with the very reading that is on screen, and a tree
      // change the region did not feel is just such a re-ask. Throwing the
      // digests away for that would send the Checksums row back to "Loading…"
      // for nothing.
      if (found.analysis !== shown.current) {
        askedChecksums.current = false;
        setChecksums(undefined);
      }
      shown.current = found.problem === undefined ? found.analysis : undefined;
      setAnalysis(found.analysis);
      setProblem(found.problem);
    });
  }, [wanted, ready, uefiRoots, pane, databaseText, huffmanText, fileTableText]);

  // Huffman.dat only for an analysis that has something to decompress with it,
  // the way the ME Analyzer fetches it and no other: most dumps never ask, and
  // the question — whether this region has a Huffman module the check can read
  // — is the analysis' own, so it is asked of the analysis rather than the
  // image. The dictionaries land out of step with the image, so the ask above
  // runs again when they do, and the pane's cache — keyed on them — hands the
  // second panel the same re-read rather than a dictionary-less standing-in.
  const wantsDictionaries = analysis !== undefined && huffmanDictionariesWanted(analysis);
  useEffect(() => {
    if (wantsDictionaries) loadHuffmanDictionaries();
  }, [wantsDictionaries]);

  // Every ID-keyed Configuration record in the analysis, wherever it came from.
  const configIDs = useMemo(
    () => [
      ...(analysis?.oemConfiguration?.recordsByID ?? []).map((one) => one.fileID),
      ...(analysis?.mfsVolume?.configurationsByID ?? []).flatMap((stream) =>
        stream.records.map((one) => one.fileID)
      ),
    ],
    [analysis]
  );

  // FileTable.dat only for an analysis that needs it, and asked for after the
  // analysis — most dumps never need it, and it is the largest of the files.
  const wantsNames = analysis !== undefined && fileTableWanted(analysis, configIDs);
  useEffect(() => {
    if (wantsNames) loadFileTable();
  }, [wantsNames]);

  // The names an analysis cannot give itself, looked up off the main thread, so
  // a row that read `File 63` gains its name in place. Silent on failure: the
  // rows keep the numbers their own bytes carry.
  useEffect(() => {
    setNames(MFSFileNames.none);
    setEfsNames(EFSFileNames.none);
    setConfigPaths(ConfigRecordPaths.none);
    if (analysis === undefined || fileTableText === undefined) return;
    const wantsMFS =
      analysis.mfsVolume !== undefined &&
      analysis.mfsVolume.usesFTBL === true &&
      analysis.mfsVolume.files.length > 0;
    const wantsEFS = analysis.efsVolume !== undefined;
    const wantsConfig = configIDs.length > 0;
    if (!wantsMFS && !wantsEFS && !wantsConfig) return;
    const job = ++fileNamesJob.current;
    void fileNamesPaneMe(pane, {
      mfs: wantsMFS ? analysis.mfsVolume : undefined,
      efs: wantsEFS ? analysis.efsVolume : undefined,
      configIDs: wantsConfig ? configIDs : [],
      platform: analysis.mfsVolume?.ftblPlatform ?? -1,
      dictionary: analysis.mfsVolume?.ftblDictionary ?? -1,
      fileTableText,
    }).then((found) => {
      if (job !== fileNamesJob.current) return;
      if (found === undefined) return;
      setNames(found.mfs ?? MFSFileNames.none);
      setEfsNames(found.efs ?? EFSFileNames.none);
      setConfigPaths(found.config ?? ConfigRecordPaths.none);
    });
  }, [analysis, configIDs, fileTableText, pane]);

  const roots = useMemo(
    () =>
      analysis === undefined ? [] : presentMEA(analysis, checksums, names, efsNames, configPaths),
    [analysis, checksums, names, efsNames, configPaths]
  );

  /**
   * Reading, from the moment the region is opened rather than from the effect
   * that starts the ask: the panel holds the region's row shut while this is
   * true, and a render in between with it false would let the row open onto
   * nothing and then never open again.
   */
  const open = useCallback(() => {
    isOpen.current = true;
    setWanted(true);
    setIsReading(true);
  }, []);

  /**
   * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.contentChanged
   */
  const close = useCallback(() => {
    if (!isOpen.current) return;
    isOpen.current = false;
    // Nothing in flight belongs to this panel any more.
    run.current++;
    askedChecksums.current = false;
    shown.current = undefined;
    setWanted(false);
    setIsReading(false);
    setAnalysis(undefined);
    setProblem(undefined);
    setChecksums(undefined);
    setNames(MFSFileNames.none);
    setEfsNames(EFSFileNames.none);
    setConfigPaths(ConfigRecordPaths.none);
  }, []);

  const rowPicked = useCallback(
    (node: MEANode) => {
      if (!isChecksumsRow(node) || askedChecksums.current) return;
      askedChecksums.current = true;
      const job = run.current;
      void checksumPaneMe(pane).then((found) => {
        if (job !== run.current || found === undefined) return;
        setChecksums({ sha256: found.sha256, sha384: found.sha384, crc32: found.crc32 });
      });
    },
    [pane]
  );

  return { roots, problem, isReading, open, rowPicked, close };
}

/** The node an ME row's key names, in the presented sub-tree. */
export function meNodeAt(roots: readonly MEANode[], key: string): MEANode | undefined {
  const path = mePathOf(key);
  return path === undefined ? undefined : meaNodeAt(roots, path);
}
