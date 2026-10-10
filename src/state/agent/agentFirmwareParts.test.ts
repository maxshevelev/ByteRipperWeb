import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Json, member, parseJson } from "@/core/agent/json";
import { decodeUtf8, encodeUtf8 } from "@/core/text/utf";
import { compress } from "@/firmware/compression/firmwareCompression";
import { checksum16 } from "@/firmware/uefi/checksums";
import { guidBytes } from "@/firmware/uefi/efiGuid";
import { FFS_V2 } from "@/firmware/uefi/knownGuids";
import type { AgentBridge } from "@/platform/desktop/agentBridge";
import { AgentService } from "@/state/agent/agentService";
import { closeFirmware, firmwareStore, noteFirmwareOperations } from "@/state/firmwareStore";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { surfaceOf } from "@/state/paneId";
import { partsLinkedTo } from "@/state/partUpdate";
import { sessionOn, toolController } from "@/state/toolController";
import {
  closePart,
  editingHooks,
  openInPane,
  type PaneId,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";

/**
 * Parts of a firmware image opened and put back by an agent — a compressed section's body, a
 * Lenovo LENV block decoded — over the real parser, compressor and rebuild.
 *
 * Vitest has no Web Workers, and these paths all go through the pane's firmware worker: the tree,
 * the decompressed buffers, the rebuild that compresses a body again. So the worker module itself
 * runs here, in this thread — one instance of it per worker the store makes, each with a `self` of
 * its own to answer through, and a `FileReaderSync` that reads the blobs this side hands over.
 * Nothing about the worker is faked but the thread it runs on.
 *
 * What cannot run here is the React half: a tool panel's live session, which `uefi_select` acts
 * on, is a mounted component's.
 *
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests
 * @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests
 */

// MARK: - The worker, in this thread

/** A `Blob` whose bytes are at hand, so a `FileReaderSync` can be stood in for. */
class HeldBlob extends Blob {
  readonly held: Uint8Array<ArrayBuffer>;
  constructor(held: Uint8Array<ArrayBuffer>) {
    super([held]);
    this.held = held;
  }
  override slice(start?: number, end?: number): Blob {
    return new HeldBlob(this.held.slice(start, end));
  }
}

(globalThis as { FileReaderSync?: unknown }).FileReaderSync = class {
  readAsArrayBuffer(blob: Blob): ArrayBuffer {
    if (!(blob instanceof HeldBlob)) throw new Error("only a held blob reads synchronously here");
    return blob.held.slice().buffer;
  }
};

/**
 * What a case answers in the worker's place: a request it returns an answer for never reaches the
 * worker. For a failure the bytes of a test image cannot be made to give.
 */
let answeredInstead: ((request: { [key: string]: unknown }) => unknown) | undefined;

let workerCount = 0;
/** Module instances are made one at a time: each reads `self` as it is evaluated. */
let made: Promise<unknown> = Promise.resolve();

/**
 * `firmware.worker.ts` behind the `Worker` interface the store uses: a module instance of its own
 * (the query makes it one), its messages delivered in the order they were sent and its answers a
 * turn later, as a worker's are. A blob crosses as one whose bytes are held, which is all the
 * worker's `FileReaderSync` needs.
 */
class InProcessWorker {
  private readonly listeners: ((event: { data: unknown }) => void)[] = [];
  private delivered: Promise<(data: unknown) => void>;
  private terminated = false;

  constructor() {
    workerCount += 1;
    const instance = workerCount;
    const scope = {
      onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
      postMessage: (data: unknown) => this.answer(data),
    };
    const making = made.then(async () => {
      (globalThis as { self?: unknown }).self = scope;
      await import(/* @vite-ignore */ `../../workers/firmware.worker.ts?instance=${instance}`);
      return (data: unknown) => scope.onmessage?.({ data });
    });
    made = making;
    this.delivered = making;
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    if (type === "message") this.listeners.push(listener);
  }
  removeEventListener(): void {}
  terminate(): void {
    this.terminated = true;
  }

  private answer(data: unknown): void {
    setTimeout(() => {
      if (this.terminated) return;
      for (const listener of this.listeners) listener({ data });
    }, 0);
  }

  postMessage(request: { [key: string]: unknown }): void {
    if (this.terminated) return;
    const instead = answeredInstead?.(request);
    if (instead !== undefined) {
      this.answer(instead);
      return;
    }
    this.delivered = this.delivered.then(async (deliver) => {
      const message = { ...request };
      for (const [key, value] of Object.entries(message)) {
        if (value instanceof Blob && !(value instanceof HeldBlob)) {
          message[key] = new HeldBlob(new Uint8Array(await value.arrayBuffer()));
        }
      }
      deliver(message);
      return deliver;
    });
  }
}

(globalThis as { Worker?: unknown }).Worker = InProcessWorker;

// MARK: - The service

const bridge = (): AgentBridge => ({
  setEnabled: async () => ({ ok: true }),
  info: async () => undefined,
  onConnection: () => () => undefined,
  onData: () => () => undefined,
  onClose: () => () => undefined,
  send: () => undefined,
  end: () => undefined,
  file: (async () => {
    throw new Error("ENOENT");
  }) as AgentBridge["file"],
});

let service: AgentService;

async function call(name: string, args: { [key: string]: Json } = {}) {
  const written: Json[] = [];
  const connection = service.connect((line) => written.push(parseJson(decodeUtf8(line))));
  connection.receive(
    encodeUtf8(
      `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })}\n`
    )
  );
  await connection.waitUntilIdle();
  const result = member(written[0], "result");
  const text = member((member(result, "content") as Json[])[0], "text") as string;
  const isError = member(result, "isError") === true;
  return { isError, text, json: isError ? undefined : (parseJson(text) as Json) };
}

function open(bytes: Uint8Array): void {
  openInPane("a", {
    name: "front.bin",
    size: bytes.length,
    lastModified: 0,
    source: new Blob([Uint8Array.from(bytes)]),
  });
}

beforeEach(() => {
  service = new AgentService(bridge());
  // As the shell wires it: an edit is news to the tree the worker holds.
  editingHooks.onContentChange = noteFirmwareOperations;
});

afterEach(() => {
  answeredInstead = undefined;
  editingHooks.onContentChange = undefined;
  // Each case's file is a file of its own: the trees read of the last one go with it.
  for (const pane of Object.keys(firmwareStore.getSnapshot().panes)) closeFirmware(pane as PaneId);
  service.desk.background.closeAll();
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
    alert: undefined,
  }));
});

// MARK: - Images

const u24 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
const u32 = (value: number): number[] => [0, 1, 2, 3].map((at) => (value >>> (8 * at)) & 0xff);

/**
 * A volume holding one file whose only section is LZMA-compressed, and in it a raw section with
 * `text`: bytes the file holds only compressed.
 *
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#CompressedTestImage
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#CompressedTestImage.make
 */
function compressedTestImage(text: string): Uint8Array {
  const payload = [...encodeUtf8(text), ...new Array<number>(12).fill(0)];
  const raw = [...u24(4 + payload.length), 0x19, ...payload];
  const stream = compress(Uint8Array.from(raw), { variant: "LZMA" });
  const section = [...u24(4 + 5 + stream.length), 0x01, ...u32(raw.length), 0x02, ...stream];
  while (section.length % 4 !== 0) section.push(0xff);
  const fileSize = 0x18 + section.length;
  const guid = [3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0];
  const file = [...guid, 0, 0xaa, 0x07, 0x00, ...u24(fileSize), 0xf8, ...section];

  const volumeLength = 0x1000;
  const image = new Uint8Array(volumeLength).fill(0xff);
  const header = [
    ...new Array<number>(0x10).fill(0),
    ...guidBytes(FFS_V2),
    ...u32(volumeLength),
    ...u32(0),
    ...u32(0x4856_465f),
    ...u32(0x0000_0800),
    ...[0x48, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02],
    ...u32(1),
    ...u32(volumeLength),
    ...u32(0),
    ...u32(0),
  ];
  const checksum = checksum16(Uint8Array.from(header)) ?? 0;
  header[0x32] = checksum & 0xff;
  header[0x33] = (checksum >> 8) & 0xff;
  image.set(header, 0);
  image.set(file, 0x48);
  return image;
}

/**
 * A Lenovo DMI store: padding, the log at `0x1000`, two blocks at `0x3000` and `0x4000` whose
 * serial number is `PF0TEST1`, and padding.
 *
 * @upstream ByteRipperTests/LenovoTestImage.swift#LenovoTestImage
 */
const LENOVO = {
  key: 0x77,
  namespace: [0x55, 0x57, 0x0e, 0xc2, 0x69, 0x11, 0x56, 0x4c, 0xa4, 0x8a, 0x98, 0x24, 0xab, 0x43],
  area: 0x1000,
  /** Block 2's serial number value, in the file. */
  serialInBlock2: 0x4000 + 0x10 + 0x18,

  block(generation: number): number[] {
    let body = [...this.namespace, 0x00, 0x04, ...u32(8), 0, 0, 0, 0, ...encodeUtf8("PF0TEST1")];
    body = [...body, ...new Array<number>(0x1000 - 16 - body.length).fill(0)];
    body = body.map((byte) => byte ^ this.key);
    const sum = body.reduce((total, byte) => (total + byte) & 0xffff, 0);
    return [
      ...encodeUtf8("LENV"),
      ...u32(generation),
      ...u32(1),
      0,
      this.key,
      sum & 0xff,
      sum >> 8,
      ...body,
    ];
  },

  make(): Uint8Array {
    const log = [
      ...encodeUtf8("LDBG"),
      ...u32(0x20),
      ...new Array<number>(24).fill(0),
      ...new Array<number>(0x2000 - 0x20).fill(this.key),
    ];
    return Uint8Array.from([
      ...new Array<number>(this.area).fill(0xff),
      ...log,
      ...this.block(4),
      ...this.block(5),
      ...new Array<number>(0x1000).fill(0xff),
    ]);
  },
};

/** The id of the image's compressed section, as `uefi_find` lists it. */
async function compressedSection(): Promise<Json> {
  const found = await call("uefi_find", { type: "Section", limit: 50 });
  const section = (member(found.json, "matches") as Json[]).find(
    (one) => member(one, "subtype") === "Compressed section"
  );
  if (section === undefined) throw new Error(`no compressed section in ${found.text}`);
  return section;
}

/** The id of the innermost node over block 2's serial number. */
async function serialEntry(): Promise<string> {
  const at = await call("uefi_at", { offset: `0x${LENOVO.serialInBlock2.toString(16)}` });
  const id = member((member(at.json, "chain") as Json[]).at(-1), "id");
  if (typeof id !== "string") throw new Error(`no node at the serial: ${at.text}`);
  return id;
}

describe("open_part, decompressed", () => {
  // What a compressed section decompresses to opens as a part, in a panel over the same window —
  // not a tab — and goes back compressed.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testACompressedSectionOpensDecompressedInAPanel
  it("opens what a compressed section decompresses to, in a panel over the same window", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const section = member(await compressedSection(), "id") as string;
    const opened = (await call("open_part", { node: section, part: "decompressed" })).json;
    expect(member(opened, "in_compressed")).toBe(true);
    expect(member(opened, "parent")).toBe("d1");
    expect(partsLinkedTo("a")).toHaveLength(1);
    const part = member(opened, "document") as string;
    const found = (await call("find_bytes", { document: part, text: "GH51G" })).json;
    expect(member(found, "total")).toBe(1);

    const plain = await call("open_part", { node: section, part: "decoded" });
    expect(plain.isError).toBe(true);
  });

  // `size` is the length of what the section decompresses to, known before the part opens — and
  // in the answer that raises the part already open.
  // Upstream's `PartPlan.size` is `found.reader.count` in both answers.
  it("says the decompressed size, the second time too", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const section = member(await compressedSection(), "id") as string;
    const opened = (await call("open_part", { node: section, part: "decompressed" })).json;
    const part = member(opened, "document") as string;
    const size = paneState(partsLinkedTo("a")[0] ?? "a")?.document.size ?? 0;
    expect(size).toBe(4 + 18 + 12);
    expect(member(opened, "size")).toBe(`0x${size.toString(16).toUpperCase()}`);

    // The focus is on the part now: the node is the parent's.
    const again = (await call("open_part", { document: "d1", node: section, part: "decompressed" }))
      .json;
    expect(member(again, "reused")).toBe(true);
    expect(member(again, "document")).toBe(part);
    expect(member(again, "size")).toBe(member(opened, "size"));
    expect(partsLinkedTo("a")).toHaveLength(1);
  });

  // A section whose stream is damaged has nothing under it to open: refused, with nothing put in
  // front of the person and no panel.
  it("refuses a section whose stream is damaged, before anything opens", async () => {
    const image = compressedTestImage("SECRET-MODEL-GH51G");
    // The LZMA stream's properties byte, past the largest a stream can have (225 and up).
    image[0x60 + 9] = 0xff;
    open(image);
    const section = member(await compressedSection(), "id") as string;
    const refused = await call("open_part", { node: section, part: "decompressed" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(
      `Node ${section} is not a compressed section; part "decompressed" is a compressed section's.`
    );
    expect(workspaceStore.getSnapshot().alert).toBeUndefined();
    expect(partsLinkedTo("a")).toHaveLength(0);
  });

  // The section is decompressed where the tree is before anything opens, as upstream's
  // `UEFIAgentNodeData.bytes` does: when the tree has no buffer to give, its refusal is the
  // agent's answer — not an alert put in front of the person and "The part could not be opened."
  it("is refused in the tree's words when the tree cannot decompress it", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const section = member(await compressedSection(), "id") as string;
    answeredInstead = (request) => {
      const values = request.values as { [key: string]: unknown } | undefined;
      return request.kind === "agentUefi" &&
        request.query === "uefi_node_data" &&
        values?.part === "decompressed"
        ? {
            kind: "agentUefi",
            id: request.id,
            error: `Section ${section} could not be decompressed.`,
          }
        : undefined;
    };
    const refused = await call("open_part", { node: section, part: "decompressed" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toBe(`Section ${section} could not be decompressed.`);
    expect(workspaceStore.getSnapshot().alert).toBeUndefined();
    expect(partsLinkedTo("a")).toHaveLength(0);
  });

  // A decompressed part is a file of its own to every tool: read, searched, its own UEFI tree —
  // and `documents` says what its bytes are. A finding in bytes the file holds only compressed
  // leads to the section they came out of.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testADecompressedPartIsAFileToEveryTool
  // @upstream-differs no `uefi_select` on the part's panel: the session it acts on is the mounted panel's, and no component is mounted here
  it("is a file of its own to every tool", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    const section = member(await compressedSection(), "id") as string;
    const opened = (await call("open_part", { node: section, part: "decompressed" })).json;
    const part = member(opened, "document") as string;

    const documents = (await call("documents")).json;
    const entry = (member(documents, "documents") as Json[]).find(
      (one) => member(one, "id") === part
    );
    expect(member(entry, "decoded")).toBe("LZMA");
    expect(member(entry, "keeps_offsets")).toBe(false);

    const found = (await call("find_bytes", { document: part, text: "GH51G" })).json;
    expect(member(found, "total")).toBe(1);
    const raw = (await call("uefi_tree", { document: part })).json;
    expect(member((member(raw, "children") as Json[])[0], "name")).toBe("Raw");

    // Its own tool panel; the parent's is untouched.
    const panel = (await call("open_panel", { document: part, module: "uefi-structure" })).json;
    expect(member(panel, "document")).toBe(part);
    const partPane = partsLinkedTo("a")[0];
    if (partPane === undefined) throw new Error("the part should be open");
    const tools = toolController.getSnapshot();
    expect(sessionOn(tools, surfaceOf(partPane)).activeIdentifier).toBe(
      "dev.maxik.tool.uefi-structure"
    );
    expect(surfaceOf(partPane)).not.toBe(surfaceOf("a"));
    expect(sessionOn(tools, surfaceOf("a")).activeIdentifier).toBeUndefined();

    const finding = (await call("finding", { document: part, offset: "0x4", length: 4, text: "t" }))
      .json;
    expect(member(member(finding, "from_part"), "exact")).toBe(false);
    expect(member(member(finding, "range"), "start")).toBe(
      member(member(opened, "source"), "start")
    );
    expect(member(member(finding, "range"), "end")).toBe(member(member(opened, "source"), "end"));
  });
});

describe("open_part, decoded", () => {
  // A LENV block, or an entry in one, opens with its XOR encoding removed.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testALENVBlockOpensDecodedInAPanel
  it("opens a LENV block with its XOR encoding removed", async () => {
    open(LENOVO.make());
    const entry = await serialEntry();
    const opened = (await call("open_part", { node: entry, part: "decoded" })).json;
    expect(member(opened, "size")).toBe("0x1000");
    expect(partsLinkedTo("a")).toHaveLength(1);
    const part = member(opened, "document") as string;
    const read = (
      await call("read", { document: part, offset: "0x28", length: 8, format: "ascii" })
    ).json;
    expect(member(read, "text")).toBe("PF0TEST1");
    expect(member(opened, "part")).toBe("decoded");
    expect(member(opened, "hint")).toBeUndefined();
  });

  // A LENV block opened as it is says it is encoded and how to open it decoded; an argument
  // `open_part` does not take is refused, not dropped.
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testALENVBlockOpenedAsItIsSaysHowToDecodeIt
  it("says, opened as it is, how to open it decoded", async () => {
    open(LENOVO.make());
    const entry = await serialEntry();
    const raw = (await call("open_part", { node: entry })).json;
    expect(member(raw, "part")).toBe("all");
    expect(String(member(raw, "hint"))).toContain('part: "decoded"');

    const refused = await call("open_part", { node: entry, decoded: true });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain('Perhaps `part: "decoded"`');
  });
});

describe("open_part, asked again", () => {
  // The part already open is found by the name it is given when the call names none, as upstream
  // finds it: a call that names the same bytes under a name of its own raises that panel rather
  // than opening a copy beside it.
  it("is found by the name it would be given, whatever the call names it", async () => {
    open(new Uint8Array(0x1000));
    const first = (await call("open_part", { offset: "0x800", length: "0x100" })).json;
    const named = (
      await call("open_part", { document: "d1", offset: "0x800", length: "0x100", name: "Mine" })
    ).json;
    expect(member(named, "reused")).toBe(true);
    expect(member(named, "document")).toBe(member(first, "document"));
    expect(partsLinkedTo("a")).toHaveLength(1);
  });
});

describe("update_in_parent, decompressed", () => {
  // A decompressed body goes back compressed: the file then holds the change only inside the
  // section, and the section reads it.
  // @upstream ByteRipperTests/AgentEditToolsTests.swift#AgentEditToolsTests.testADecompressedPartGoesBackCompressed
  it("puts a decompressed part back compressed", async () => {
    open(compressedTestImage("SECRET-MODEL-GH51G"));
    service.setEditsAllowed(true);
    const section = member(await compressedSection(), "id") as string;
    const part = member(
      (await call("open_part", { node: section, part: "decompressed" })).json,
      "document"
    ) as string;
    const at = (await call("find_bytes", { document: part, text: "GH51G" })).json;
    const start = member((member(at, "matches") as Json[])[0], "start") as string;
    await call("write", { document: part, offset: start, bytes: "58593939 5A", label: "t" });

    const updated = await call("update_in_parent", { document: part });
    expect(member(updated.json, "updated"), updated.text).toBe(true);
    expect(paneState("a")?.document.isDirty).toBe(true);
    const inFile = (await call("find_bytes", { document: "d1", text: "XY99Z" })).json;
    expect(member(inFile, "total")).toBe(0);
    const inSection = (await call("find_bytes", { document: "d1", node: section, text: "XY99Z" }))
      .json;
    expect(member(inSection, "total")).toBe(1);
  });
});
