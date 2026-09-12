/// <reference lib="webworker" />

import { assembleWord, type ByteSource } from "@/firmware/byteSource";
import { ImageReader } from "@/firmware/imageReader";
import {
  repairsForFile,
  repairsForMicrocode,
  repairsForVolume,
} from "@/firmware/uefi/checksumRepair";
import { readDescriptorInfo } from "@/firmware/uefi/descriptorInfo";
import { regionLabel } from "@/firmware/uefi/descriptorParser";
import { diagnosticMessage, severityOf, type UEFIDiagnostic } from "@/firmware/uefi/diagnostic";
import { guidText } from "@/firmware/uefi/efiGuid";
import { DEFAULT_LIMITS, Parser, ProgressSink } from "@/firmware/uefi/parserState";
import { runSecondPass } from "@/firmware/uefi/secondPass";
import { childrenOf, rootsOf, stampIds } from "@/firmware/uefi/treeMaterialization";
import type { UEFINode } from "@/firmware/uefi/uefiNode";
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
        const result = childrenOf(node, reader, DEFAULT_LIMITS);
        // Kept, so a later request for a grandchild finds its parent here.
        node.children = stampIds(result.nodes, node.id);
        node.isExpandable = false;
        post({
          kind: "firmwareChildren",
          id: request.id,
          node: request.node,
          children: node.children.map(wireNode),
          diagnostics: wireDiagnostics(result.diagnostics),
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
            address: undefined,
            descriptor: undefined,
          });
          return;
        }
        // The mapping is worked out here rather than asked for separately: a
        // panel showing one node's address would otherwise need two round
        // trips, and the anchor is already in hand once the tree is.
        const parser = new Parser(reader, DEFAULT_LIMITS);
        const diff = runSecondPass(parser, roots).addressDiff;
        const start = node.header.start;
        const address = diff === undefined || start >= reader.count ? undefined : start + diff;

        const info =
          node.kind === "flashDescriptor"
            ? readDescriptorInfo(node.header.start, reader)
            : undefined;
        post({
          kind: "firmwareDetail",
          id: request.id,
          node: request.node,
          address,
          descriptor:
            info === undefined
              ? undefined
              : {
                  reservedVector: [...info.reservedVector]
                    .map((byte) => byte.toString(16).toUpperCase().padStart(2, "0"))
                    .join(" "),
                  regionOffsets: info.regionOffsets.map((one) => ({
                    name: regionLabel(one.type),
                    offset: one.offset,
                  })),
                  masters: info.masters.map((one) => ({ ...one })),
                  maskDigits: info.maskDigits,
                  biosAccess: info.biosAccess.map((one) => ({ ...one })),
                  chips: info.chips.map((one) => ({ ...one })),
                },
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
