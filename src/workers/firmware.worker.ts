/// <reference lib="webworker" />

import { assembleWord, type ByteSource } from "@/firmware/byteSource";
import { readFitTable } from "@/firmware/fit/fitTable";
import { ImageReader } from "@/firmware/imageReader";
import { MEADatabase } from "@/firmware/me/data/meaDatabase";
import { analyzeMeRegion } from "@/firmware/me/engine/analyzer";
import { meRegion } from "@/firmware/me/layout/flashDescriptor";
import {
  type ChecksumRepair,
  repairsForFile,
  repairsForMicrocode,
  repairsForVolume,
} from "@/firmware/uefi/checksumRepair";
import { diagnosticMessage, severityOf, type UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { guidText } from "@/firmware/uefi/efiGuid";
import { DEFAULT_LIMITS, Parser, ProgressSink } from "@/firmware/uefi/parserState";
import { runSecondPass } from "@/firmware/uefi/secondPass";
import { childrenOf, rootsOf, stampIds } from "@/firmware/uefi/treeMaterialization";
import { UEFIImage } from "@/firmware/uefi/uefiImage";
import { nodeRange, type UEFINode } from "@/firmware/uefi/uefiNode";
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

/** A `Blob`, read synchronously, which is a thing only a worker can do. */
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
  if (!("range" in outcome)) {
    return `The microcode is out of the table${moved}.`;
  }
  const where = `0x${outcome.range.start.toString(16).toUpperCase()}`;
  return outcome.kind === "added"
    ? `The microcode went in at ${where}${moved}.`
    : `The microcode at ${where} was replaced${moved}.`;
}

/** The image currently open. One per worker, as one worker serves one pane. */
let reader: ImageReader | undefined;
/** The tree as the worker knows it, so a child request can find its node. */
let roots: UEFINode[] = [];

const post = (message: FirmwareWorkerResponse) => scope.postMessage(message);

const wireDiagnostics = (diagnostics: readonly UEFIDiagnostic[]): WireDiagnostic[] =>
  diagnostics.map((one) => ({
    message: diagnosticMessage(one),
    severity: severityOf(one.detail),
    offset: one.offset,
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
  isCompressed: node.isCompressed,
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

/** Opens one collapsed node where it stands, keeping its children for later asks. */
function open(node: UEFINode, into: UEFIDiagnostic[]): void {
  if (reader === undefined || !node.isExpandable) return;
  const result = childrenOf(node, reader, DEFAULT_LIMITS);
  node.children = stampIds(result.nodes, node.id);
  node.isExpandable = false;
  into.push(...result.diagnostics);
}

/**
 * The writes that would put a node's checksums right, which is what lets the
 * detail say a checksum is wrong and what it should read. A file's fixed body
 * sum follows the revision of the volume it sits in, found on the way down.
 */
function repairsFor(node: UEFINode, path: readonly number[]): ChecksumRepair[] {
  if (reader === undefined) return [];
  switch (node.kind) {
    case "volume":
      return repairsForVolume(node, reader);
    case "microcode":
      return repairsForMicrocode(node, reader);
    case "file": {
      let nodes = roots;
      let revision = 2;
      for (const index of path) {
        const next = nodes[index];
        if (next === undefined) break;
        if (next.kind === "volume" && next.subtype !== undefined) revision = next.subtype;
        nodes = next.children;
      }
      return repairsForFile(node, revision, reader);
    }
    default:
      return [];
  }
}

scope.onmessage = (event: MessageEvent<FirmwareWorkerRequest>) => {
  const request = event.data;
  try {
    switch (request.kind) {
      case "openFirmware": {
        reader = new ImageReader(new BlobByteSource(request.content));
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
        const parser = new Parser(reader, DEFAULT_LIMITS);
        const second = runSecondPass(parser, roots);
        post({ kind: "firmwareAddresses", id: request.id, addressDiff: second.addressDiff });
        return;
      }

      case "firmwareRepair": {
        const node = nodeAt(request.node);
        if (reader === undefined || node === undefined) {
          post({ kind: "firmwareRepair", id: request.id, node: request.node, writes: [] });
          return;
        }
        const repairs =
          node.kind === "volume"
            ? repairsForVolume(node, reader)
            : node.kind === "microcode"
              ? repairsForMicrocode(node, reader)
              : repairsForFile(node, request.volumeRevision, reader);
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
        // Address row wants it, and the anchor is already in hand once the tree
        // is.
        const parser = new Parser(reader, DEFAULT_LIMITS);
        const image = new UEFIImage({
          size: reader.count,
          roots,
          addressDiff: runSecondPass(parser, roots).addressDiff,
        });
        post({
          kind: "firmwareDetail",
          id: request.id,
          node: request.node,
          detail: buildNodeDetail(node, image, reader, repairsFor(node, request.node)),
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
        const parser = new Parser(reader, DEFAULT_LIMITS);
        const image = new UEFIImage({
          size: reader.count,
          roots,
          addressDiff: runSecondPass(parser, roots).addressDiff,
        });
        post({ kind: "fitReport", id: request.id, report: readFitTable(reader, image) });
        return;
      }

      case "fitEdit": {
        if (reader === undefined) {
          post({ ...NO_EDIT, id: request.id, problem: "No image is open." });
          return;
        }
        const parser = new Parser(reader, DEFAULT_LIMITS);
        const diff = runSecondPass(parser, roots).addressDiff;
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
        const result =
          edit.kind === "remove"
            ? removeMicrocodeAt(edit.index, report.table, image, reader, addressDiff)
            : edit.kind === "replaceAt"
              ? replaceMicrocodeAt(
                  edit.index,
                  edit.component,
                  report.table,
                  image,
                  reader,
                  addressDiff
                )
              : addOrReplaceMicrocode(edit.component, report.table, image, reader, addressDiff);
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
        // The ME analysis works over one region's bytes in memory, where the
        // UEFI parser streams a whole image: it walks its structures in every
        // direction and a region is megabytes, not gigabytes. Which region is
        // the descriptor's business, and a bare region is its own.
        const whole = reader.bytes(reader.all);
        const found = whole === undefined ? undefined : meRegion(whole);
        const regionOffset = found?.base ?? 0;
        const bytes =
          whole === undefined
            ? undefined
            : found === undefined
              ? whole
              : whole.subarray(found.base, found.base + found.size);
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
