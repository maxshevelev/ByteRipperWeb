/// <reference lib="webworker" />

import { assembleWord, type ByteSource, sourceOver } from "@/firmware/byteSource";
import { readFitTable } from "@/firmware/fit/fitTable";
import type { ImageRange } from "@/firmware/imageReader";
import { ImageReader } from "@/firmware/imageReader";
import { FileTable } from "@/firmware/me/data/fileTable";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import {
  type HuffmanDictionaries,
  parseHuffmanDictionaries,
} from "@/firmware/me/decompress/huffman";
import { analyzeMeRegion, checksums } from "@/firmware/me/engine/analyzer";
import { meRegion } from "@/firmware/me/layout/flashDescriptor";
import {
  type ChecksumRepair,
  repairsForFile,
  repairsForMicrocode,
  repairsForVolume,
} from "@/firmware/uefi/checksumRepair";
import { DecompressedBuffers } from "@/firmware/uefi/decompressedBuffers";
import { diagnosticMessage, severityOf, type UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { guidText } from "@/firmware/uefi/efiGuid";
import { DEFAULT_LIMITS, Parser, ProgressSink } from "@/firmware/uefi/parserState";
import {
  isIbbKind,
  type ProtectedRange,
  type ProtectedRanges,
  protectedRangeKindName,
  readProtectedRanges,
} from "@/firmware/uefi/protectedRanges";
import {
  runSecondPass,
  type SecondPass,
  secondPassAnchoredOn,
  volumeTopFileInTail,
} from "@/firmware/uefi/secondPass";
import { tcgHashName } from "@/firmware/uefi/tcgHash";
import { invalidating } from "@/firmware/uefi/treeInvalidation";
import { childrenOf, materializeAll, rootsOf, stampIds } from "@/firmware/uefi/treeMaterialization";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { isNodeCompressed, nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
import {
  addOrReplaceMicrocode,
  type FITEditOutcome,
  type FITRemovalOutcome,
  fitEditProblemMessage,
  removeMicrocodeAt,
  replaceMicrocodeAt,
} from "@/tools/fit/fitEditor";
import { EMPTY_DETAIL } from "@/tools/toolDetail";
import { buildNodeDetail } from "@/tools/uefi/uefiNodeDetail";
import { subtypeText, typeText } from "@/tools/uefi/uefiTreeDisplay";
import type {
  FirmwareWorkerRequest,
  FirmwareWorkerResponse,
  WireDiagnostic,
  WireNode,
  WireProtectedRange,
} from "@/workers/protocol";

/**
 * Parsing a firmware image, off the main thread.
 *
 * The whole reason the parser is written against *synchronous* reads lives
 * here: a worker has `FileReaderSync`, so a `Blob` can be read a slice at a
 * time without a promise, and six thousand lines of parser port as they stand
 * rather than being turned inside out into continuations. On the main thread
 * the same code would need every field read to be awaited.
 *
 * The two expensive containers — a raw-area region and a volume's body — are
 * never opened until something asks, which is what keeps opening a 16 MB image
 * from reading every file body in it.
 */

/**
 * A `Blob`, read synchronously, which is a thing only a worker can do.
 *
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource.byteCount
 * @upstream Packages/UEFIContentSource/Sources/UEFIContentSource/ToolContentByteSource.swift#ToolContentByteSource.bytes
 * @upstream-differs reads the pane's Blob in the worker, not a live reader over the document
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource.byteCount
 * @upstream ByteRipperApp/Tools/PaneToolHost.swift#LiveDocumentByteSource.bytes
 */
class BlobByteSource implements ByteSource {
  private readonly blob: Blob;
  private readonly reader = new FileReaderSync();

  constructor(blob: Blob) {
    this.blob = blob;
  }

  get byteCount(): number {
    return this.blob.size;
  }

  bytes(start: number, end: number): Uint8Array {
    if (end <= start) return new Uint8Array(0);
    return new Uint8Array(this.reader.readAsArrayBuffer(this.blob.slice(start, end)));
  }

  word(offset: number, count: number): number {
    return assembleWord(this.bytes(offset, offset + count), 0, count);
  }
}

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** A FIT edit that did not happen, which only the reason differs between. */
const NO_EDIT = {
  kind: "fitEdit",
  name: undefined,
  writes: [],
  summary: undefined,
  landed: undefined,
} as const;

/** What the edit came to, in the sentence the panel says afterwards. */
function summaryOf(outcome: FITEditOutcome | FITRemovalOutcome): string {
  const moved = outcome.moved === 0 ? "" : `, and ${outcome.moved} behind it moved up to suit`;
  const protection = protectionNote(outcome.protectionWarnings);
  // That the Top Swap backup of the boot block got the same change is said,
  // because it is a second place in the file the edit wrote to.
  const backup = outcome.topSwapBackup;
  const topSwap =
    backup === undefined
      ? ""
      : ` The Top Swap backup at 0x${backup.start.toString(16).toUpperCase()} got the same change.`;
  if (!("range" in outcome)) {
    return `The microcode is out of the table${moved}.${topSwap}${protection}`;
  }
  const where = `0x${outcome.range.start.toString(16).toUpperCase()}`;
  return outcome.kind === "added"
    ? `The microcode went in at ${where}${moved}.${topSwap}${protection}`
    : `The microcode at ${where} was replaced${moved}.${topSwap}${protection}`;
}

/**
 * What the protected ranges said about the edit — and, where they were not read
 * at all, that they were not.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.protectionNote
 */
function protectionNote(warnings: readonly string[] | undefined): string {
  if (warnings === undefined) return " Boot Guard and vendor protected ranges were not checked.";
  if (warnings.length === 0) {
    return " Nothing was written inside a Boot Guard or vendor protected range.";
  }
  return ` ${warnings.join(" ")}`;
}

/** The image currently open. One per worker, as one worker serves one pane. */
let reader: ImageReader | undefined;
/** The tree as the worker knows it, so a child request can find its node. */
let roots: UEFINode[] = [];
/**
 * What the compressed sections opened so far decompress to, so a branch closed
 * and opened again is decoded once.
 */
let buffers = new DecompressedBuffers();
/**
 * The protected ranges, once something has asked for them: reading them opens
 * every volume's files and hashes megabytes, so it is done once and kept until
 * an edit makes it stale.
 */
let protectedRanges: ProtectedRanges | undefined;
/**
 * Where the image is mapped, once something has asked: the same reading the
 * ranges need, and an edit makes it stale the same way.
 */
let addresses: SecondPass | undefined;

const post = (message: FirmwareWorkerResponse) => scope.postMessage(message);

/** A range of the file as the main thread sends it — a pair over the wire. */
const rangeOf = (range: readonly [number, number]): ImageRange => ({
  start: range[0],
  end: range[1],
});

const wireDiagnostics = (diagnostics: readonly UEFIDiagnostic[]): WireDiagnostic[] =>
  diagnostics.map((one) => ({
    message: diagnosticMessage(one),
    severity: severityOf(one.detail),
    offset: one.offset,
    ...(one.inside === undefined ? {} : { inside: one.inside }),
  }));

/**
 * A node as it crosses the wire: the ranges flattened to pairs and the GUID to
 * its text, because what the panel does with either is show it.
 */
const wireNode = (node: UEFINode): WireNode => ({
  id: node.id,
  kind: node.kind,
  subtype: node.subtype,
  name: node.name,
  guid: node.guid === undefined ? undefined : guidText(node.guid),
  header: [node.header.start, node.header.end],
  body: [node.body.start, node.body.end],
  tail: [node.tail.start, node.tail.end],
  isFixed: node.isFixed,
  space: node.space,
  compression: node.compression,
  isErased: node.isErased,
  isExpandable: node.isExpandable,
  childDepth: node.childDepth,
  typeText: typeText(node),
  subtypeText: subtypeText(node),
  children: node.children.map(wireNode),
});

function nodeAt(path: readonly number[]): UEFINode | undefined {
  let nodes = roots;
  let found: UEFINode | undefined;
  for (const index of path) {
    const next = nodes[index];
    if (next === undefined) return undefined;
    found = next;
    nodes = next.children;
  }
  return found;
}

/**
 * The reader a node's own ranges are offsets into: the file, or the buffer the
 * compressed section holding it decompresses to. A section on the way in that no
 * longer decodes leaves nothing to read, and the fields that would have come
 * from it go with it rather than being read off the file at buffer offsets.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.show
 */
function readerFor(node: UEFINode): ImageReader | undefined {
  if (reader === undefined) return undefined;
  const read = buffers.readerFor(node.space, reader, DEFAULT_LIMITS.maxDecompressedSize);
  return read.ok ? read.reader : undefined;
}

/**
 * Where this image is mapped, worked out once.
 *
 * The anchor is the last Volume Top File, and finding it by walking means
 * opening every container down to the last node — which the lazily built tree
 * has not done, so a walk over `roots` as they stand answers "unknown" for an
 * image that plainly has one. Upstream looks in the tail first, where the
 * format says the file has to be: a couple of reads instead of a parse of the
 * whole BIOS region. Only when the tail says nothing does it descend.
 *
 * The descent here is a materialized **copy**, for the reason `readRanges` uses
 * one: a branch the reader opened meanwhile is not thrown away when this lands.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/LazyUEFITree.swift#LazyUEFITree.resolveAddresses
 */
function addressing(): SecondPass {
  if (addresses !== undefined) return addresses;
  if (reader === undefined) return { addressDiff: undefined, resetVector: undefined };
  const parser = new Parser(reader, DEFAULT_LIMITS);
  const tail = volumeTopFileInTail(parser);
  if (tail !== undefined) {
    const second = secondPassAnchoredOn(parser, tail);
    if (second.addressDiff !== undefined) {
      addresses = second;
      return second;
    }
  }
  const copy = structuredClone(roots) as UEFINode[];
  const discarded: UEFIDiagnostic[] = [];
  materializeAll(copy, reader, DEFAULT_LIMITS, buffers, discarded, { opensCompressed: false });
  addresses = runSecondPass(parser, copy);
  return addresses;
}

/**
 * The protected ranges, read over a **copy** of the tree opened as far as the
 * lists need: every volume's files, and the compressed sections only when a
 * range that starts at the DXE root volume could not be placed without them,
 * since decoding one is megabytes of work.
 *
 * The copy is dropped rather than written back, so a branch the reader opened
 * meanwhile survives; what it decoded stays in the buffers.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/TreeMaterialization.swift#TreeMaterialization.protectedRanges
 */
function readRanges(): ProtectedRanges {
  if (protectedRanges !== undefined) return protectedRanges;
  if (reader === undefined) return { ranges: [], obbDigests: [], diagnostics: [] };
  const copy = structuredClone(roots) as UEFINode[];
  const discarded: UEFIDiagnostic[] = [];
  materializeAll(copy, reader, DEFAULT_LIMITS, buffers, discarded, { opensCompressed: false });
  const parser = new Parser(reader, DEFAULT_LIMITS);
  const second = runSecondPass(parser, copy);
  const imageOf = () =>
    new UEFIImage({
      size: reader?.count ?? 0,
      roots: copy,
      addressDiff: second.addressDiff,
      resetVector: second.resetVector,
    });
  let found = readProtectedRanges(imageOf(), reader);
  const needsTheDxeCore = found.ranges.some(
    (one) => (one.kind === "postIbb" || one.kind === "amiV1") && one.range === undefined
  );
  if (needsTheDxeCore) {
    materializeAll(copy, reader, DEFAULT_LIMITS, buffers, discarded);
    found = readProtectedRanges(imageOf(), reader);
  }
  protectedRanges = found;
  return found;
}

/** @upstream Modules/UEFITool/Sources/UEFIToolUI/UEFIToolModule.swift#UEFIToolSession.show */
const wireProtectedRange = (range: ProtectedRange): WireProtectedRange => ({
  kind: range.kind,
  range: range.range === undefined ? undefined : [range.range.start, range.range.end],
  source: [range.source.start, range.source.end],
  algorithms: range.digests.map((one) => tcgHashName(one.algorithm)),
  verdict: range.verdict.kind,
  unsupported:
    range.verdict.kind === "unsupported" ? tcgHashName(range.verdict.algorithm) : undefined,
  name: protectedRangeKindName(range.kind),
  isIbb: isIbbKind(range.kind),
});

/** Opens one collapsed node where it stands, keeping its children for later asks. */
function open(node: UEFINode, into: UEFIDiagnostic[]): void {
  if (reader === undefined || !node.isExpandable) return;
  const result = childrenOf(node, reader, DEFAULT_LIMITS, buffers);
  node.children = stampIds(result.nodes, node.id);
  node.isExpandable = false;
  into.push(...result.diagnostics);
}

/**
 * The writes that would put a node's checksums right, which is what lets the
 * detail say a checksum is wrong and what it should read. A file's fixed body
 * sum follows the revision of the volume it sits in, found on the way down.
 *
 * @upstream Modules/UEFITool/Sources/UEFITool/UEFIChecksumCheck.swift#UEFIChecksumCheck.repairs
 */
function repairsFor(node: UEFINode, path: readonly number[]): ChecksumRepair[] {
  const spaceReader = readerFor(node);
  if (spaceReader === undefined) return [];
  switch (node.kind) {
    case "volume":
      return repairsForVolume(node, spaceReader);
    case "microcode":
      return repairsForMicrocode(node, spaceReader);
    case "file": {
      let nodes = roots;
      let revision = 2;
      for (const index of path) {
        const next = nodes[index];
        if (next === undefined) break;
        if (next.kind === "volume" && next.subtype !== undefined) revision = next.subtype;
        nodes = next.children;
      }
      return repairsForFile(node, revision, spaceReader);
    }
    default:
      return [];
  }
}

/**
 * The bytes the ME analysis works over, and where they begin in the image.
 *
 * One region's bytes in memory, where the UEFI parser streams a whole image: the
 * analysis walks its structures in every direction and a region is megabytes,
 * not gigabytes. Which region is the descriptor's business, and a bare region is
 * its own. The checksums read the same bytes, so the digests describe the buffer
 * the analysis was made from.
 */
function meRegionBytes():
  | { readonly bytes: Uint8Array; readonly regionOffset: number }
  | undefined {
  if (reader === undefined) return undefined;
  const whole = reader.bytes(reader.all);
  if (whole === undefined) return undefined;
  const found = meRegion(whole);
  return found === undefined
    ? { bytes: whole, regionOffset: 0 }
    : { bytes: whole.subarray(found.base, found.base + found.size), regionOffset: found.base };
}

/**
 * `Huffman.dat` as dictionaries. One that does not parse is no dictionaries: the
 * checks that need them are skipped, and the analysis is not failed for it.
 */
function parsedDictionaries(text: string): HuffmanDictionaries | undefined {
  try {
    return parseHuffmanDictionaries(text);
  } catch {
    return undefined;
  }
}

/**
 * The table, or nothing — a body that is not one is not a reason to fail an
 * analysis.
 *
 * Kept against the text it was parsed from, because the file is ~5 MB and an
 * image is analysed again on every edit: parsing it once per download rather
 * than once per analysis is the difference between a pause nobody notices and
 * one everybody does. The panel's side holds its own parse for the same reason
 * (`fileTableStore`), and a worker cannot be handed that one.
 */
let fileTableText: string | undefined;
let fileTableParsed: FileTable | undefined;
function parsedFileTable(text: string): FileTable | undefined {
  if (text === fileTableText) return fileTableParsed;
  fileTableText = text;
  try {
    fileTableParsed = FileTable.parse(text);
  } catch {
    fileTableParsed = undefined;
  }
  return fileTableParsed;
}

scope.onmessage = (event: MessageEvent<FirmwareWorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.kind) {
      case "openFirmware": {
        reader = new ImageReader(new BlobByteSource(request.content));
        buffers = new DecompressedBuffers();
        protectedRanges = undefined;
        addresses = undefined;
        const sink = new ProgressSink(reader.count, (fraction) =>
          post({ kind: "firmwareProgress", id: request.id, fraction })
        );
        const built = rootsOf(reader, DEFAULT_LIMITS, sink);
        roots = stampIds(built.nodes, []);
        post({
          kind: "firmwareRoots",
          id: request.id,
          size: reader.count,
          roots: roots.map(wireNode),
          diagnostics: wireDiagnostics(built.diagnostics),
        });
        return;
      }

      case "firmwareInvalidate": {
        // The reader is swapped for one over the content as it now stands
        // before the collapse, so whichever container the collapse dropped is
        // read again — by a later `firmwareChildren` — from current bytes. This
        // is the whole of what a live byte source buys upstream.
        reader = new ImageReader(new BlobByteSource(request.content));
        // A buffer whose section the edit touched is stale with the nodes that
        // came out of it: an overwrite drops what it overlaps, and an insert or
        // a delete drops everything at or past it, the offsets behind it having
        // moved.
        const edited = rangeOf(request.range);
        if (request.sizeDelta === 0) buffers.dropOverlapping(edited);
        else buffers.dropFrom(edited.start);
        // The ranges were read off bytes that may have just been typed over,
        // and their digests over bytes that certainly were.
        protectedRanges = undefined;
        addresses = undefined;
        roots = invalidating(roots, edited, request.sizeDelta);
        // No diagnostics come back with this: what was found in the subtrees
        // just dropped went with them, as it does upstream, and what is left is
        // re-collected as those subtrees are read again. The panel's own list
        // is replaced rather than added to, so a file that is no longer there
        // stops being complained about.
        post({
          kind: "firmwareInvalidated",
          id: request.id,
          size: reader.count,
          roots: roots.map(wireNode),
        });
        return;
      }

      case "firmwareChildren": {
        const node = nodeAt(request.node);
        if (reader === undefined || node === undefined) {
          post({
            kind: "firmwareChildren",
            id: request.id,
            node: request.node,
            children: [],
            diagnostics: [],
          });
          return;
        }
        // Kept, so a later request for a grandchild finds its parent here.
        const diagnostics: UEFIDiagnostic[] = [];
        open(node, diagnostics);
        post({
          kind: "firmwareChildren",
          id: request.id,
          node: request.node,
          children: node.children.map(wireNode),
          diagnostics: wireDiagnostics(diagnostics),
        });
        return;
      }

      case "firmwareNodeAtOffset": {
        // Down through whatever covers the offset, opening each branch on the
        // way: the node under the caret may sit in a volume nobody has read,
        // and a tree that has not read it has nothing to show.
        const diagnostics: UEFIDiagnostic[] = [];
        let nodes = roots;
        let path: number[] | undefined;
        for (;;) {
          const index = nodes.findIndex((one) => {
            const range = nodeRange(one);
            return request.offset >= range.start && request.offset < range.end;
          });
          const node = nodes[index];
          if (node === undefined) break;
          path = [...(path ?? []), index];
          open(node, diagnostics);
          nodes = node.children;
        }
        post({
          kind: "firmwareNodeAtOffset",
          id: request.id,
          roots: roots.map(wireNode),
          path,
          diagnostics: wireDiagnostics(diagnostics),
        });
        return;
      }

      case "firmwareAddresses": {
        if (reader === undefined) {
          post({ kind: "firmwareAddresses", id: request.id, addressDiff: undefined });
          return;
        }
        post({ kind: "firmwareAddresses", id: request.id, addressDiff: addressing().addressDiff });
        return;
      }

      case "firmwareProtectedRanges": {
        const ranges = readRanges();
        post({
          kind: "firmwareProtectedRanges",
          id: request.id,
          ranges: ranges.ranges.map(wireProtectedRange),
          obbDigests: ranges.obbDigests.map((one) => tcgHashName(one.algorithm)),
          diagnostics: wireDiagnostics(ranges.diagnostics),
        });
        return;
      }

      case "firmwareRepair": {
        const node = nodeAt(request.node);
        if (reader === undefined || node === undefined) {
          post({ kind: "firmwareRepair", id: request.id, node: request.node, writes: [] });
          return;
        }
        // A node inside a compressed section is checked in its buffer and
        // never repaired: a write there is a write into bytes that are not the
        // file's, so the panel does not offer the fix and this answers nothing.
        const spaceReader = isNodeCompressed(node) ? undefined : readerFor(node);
        const repairs =
          spaceReader === undefined
            ? []
            : node.kind === "volume"
              ? repairsForVolume(node, spaceReader)
              : node.kind === "microcode"
                ? repairsForMicrocode(node, spaceReader)
                : repairsForFile(node, request.volumeRevision, spaceReader);
        post({
          kind: "firmwareRepair",
          id: request.id,
          node: request.node,
          writes: repairs.map((one) => ({ offset: one.offset, bytes: one.bytes })),
        });
        return;
      }

      case "firmwareDetail": {
        const node = nodeAt(request.node);
        if (reader === undefined || node === undefined) {
          post({
            kind: "firmwareDetail",
            id: request.id,
            node: request.node,
            detail: EMPTY_DETAIL,
          });
          return;
        }
        // The mapping is worked out here rather than asked for separately: the
        // Address row wants it, and `addressing` keeps it once it is found.
        const image = new UEFIImage({
          size: reader.count,
          roots,
          addressDiff: addressing().addressDiff,
          // Whatever has been read so far: the detail says what protects a node
          // once something has asked for the ranges, and reads nothing itself.
          protectedRanges,
        });
        post({
          kind: "firmwareDetail",
          id: request.id,
          node: request.node,
          detail: buildNodeDetail(
            node,
            image,
            readerFor(node) ?? new ImageReader(sourceOver(new Uint8Array(0))),
            repairsFor(node, request.node)
          ),
        });
        return;
      }

      case "fitRead": {
        if (reader === undefined) {
          post({ kind: "firmwareFailed", id: request.id, problem: "No image is open." });
          return;
        }
        // The tree as it stands, which is what names what a row points at. A
        // branch nobody has opened names nothing, and the reader says so rather
        // than guessing — see `targetOf` in fitTable.
        const image = new UEFIImage({
          size: reader.count,
          roots,
          addressDiff: addressing().addressDiff,
          // Whatever has been read so far: the detail says what protects a node
          // once something has asked for the ranges, and reads nothing itself.
          protectedRanges,
        });
        post({ kind: "fitReport", id: request.id, report: readFitTable(reader, image) });
        return;
      }

      case "fitEdit": {
        if (reader === undefined) {
          post({ ...NO_EDIT, id: request.id, problem: "No image is open." });
          return;
        }
        const diff = addressing().addressDiff;
        const image = new UEFIImage({ size: reader.count, roots, addressDiff: diff });
        const report = readFitTable(reader, image);
        if (report.table === undefined) {
          post({ ...NO_EDIT, id: request.id, problem: fitEditProblemMessage({ kind: "noTable" }) });
          return;
        }
        // The addresses the rows are rewritten with come from the same mapping
        // the table was read against, so a repointed row lands where the reader
        // will look for it.
        const addressDiff = report.addressDiff;
        const edit = request.edit;
        // The ranges, if the panel has read them: a write inside the IBB is
        // refused, one inside a range the firmware checks is made and said.
        const ranges = readRanges();
        const result =
          edit.kind === "remove"
            ? removeMicrocodeAt(edit.index, report.table, image, reader, addressDiff, ranges)
            : edit.kind === "replaceAt"
              ? replaceMicrocodeAt(
                  edit.index,
                  edit.component,
                  report.table,
                  image,
                  reader,
                  addressDiff,
                  ranges
                )
              : addOrReplaceMicrocode(
                  edit.component,
                  report.table,
                  image,
                  reader,
                  addressDiff,
                  ranges
                );
        if (!result.ok) {
          post({ ...NO_EDIT, id: request.id, problem: fitEditProblemMessage(result.problem) });
          return;
        }
        post({
          kind: "fitEdit",
          id: request.id,
          name: result.transaction.name,
          writes: result.transaction.writes.map((one) => ({
            offset: one.offset,
            bytes: one.bytes,
          })),
          problem: undefined,
          summary: summaryOf(result.outcome),
          landed:
            "range" in result.outcome
              ? [result.outcome.range.start, result.outcome.range.end]
              : undefined,
        });
        return;
      }

      case "meChecksums": {
        const region = meRegionBytes();
        const readable = region !== undefined && region.bytes.length > 0;
        post({
          kind: "meChecksums",
          id: request.id,
          ...(readable
            ? checksums(region.bytes)
            : { sha256: undefined, sha384: undefined, crc32: undefined }),
        });
        return;
      }

      case "meAnalyze": {
        if (reader === undefined) {
          post({
            kind: "meAnalyze",
            id: request.id,
            regionOffset: 0,
            analysis: undefined,
            problem: "No image is open.",
          });
          return;
        }
        const region = meRegionBytes();
        const regionOffset = region?.regionOffset ?? 0;
        const bytes = region?.bytes;
        if (bytes === undefined) {
          post({
            kind: "meAnalyze",
            id: request.id,
            regionOffset: 0,
            analysis: undefined,
            problem: "That image could not be read.",
          });
          return;
        }
        const dictionaries =
          request.huffmanText === undefined ? undefined : parsedDictionaries(request.huffmanText);
        const table =
          request.fileTableText === undefined ? undefined : parsedFileTable(request.fileTableText);
        post({
          kind: "meAnalyze",
          id: request.id,
          regionOffset,
          analysis: analyzeMeRegion({
            bytes,
            baseOffset: regionOffset,
            ...(request.databaseText === undefined
              ? {}
              : { database: MEADatabase.parse(request.databaseText) }),
            ...(dictionaries === undefined ? {} : { huffmanDictionaries: dictionaries }),
            ...(table === undefined ? {} : { fileTable: table }),
          }),
          problem: undefined,
        });
        return;
      }

      case "cancel":
        // Nothing to cancel: every request here answers in one turn of the
        // worker's loop, and the main thread drops a reply to a job it has
        // already superseded.
        return;
    }
  } catch (error) {
    post({
      kind: "firmwareFailed",
      id: request.id,
      problem: error instanceof Error ? error.message : "That image could not be parsed.",
    });
  }
};
