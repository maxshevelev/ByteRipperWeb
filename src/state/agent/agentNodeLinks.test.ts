import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentArguments } from "@/core/agent/agentArguments";
import { type Json, member } from "@/core/agent/json";
import { LenovoDMIBlockCodec } from "@/firmware/lenovoDmi/lenovoDmiValue";
import { LENVBlock } from "@/firmware/lenovoDmi/lenvBlock";
import { MTM, SERIAL, STANDARD_LOG, testBlock, testLog } from "@/firmware/testing/testLenovoDMI";
import { AgentDesk } from "@/state/agent/agentDesk";
import { AgentNodeLinks } from "@/state/agent/agentNodeLinks";
import { EMPTY_DOCK } from "@/state/fragmentDock";
import { openLinkedPart } from "@/state/openLinkedPart";
import { closePart, openEmptyInPane, paneState, workspaceStore } from "@/state/workspaceStore";
import { runUefiAgentQuery } from "@/tools/uefi/agent/uefiAgentQueries";
import { agentTreeOver } from "@/tools/uefi/agent/uefiAgentTree";

/**
 * The same node in the other documents of a parent-and-part pair.
 *
 * The firmware worker is stood in for by the queries it runs, over the bytes of the pane asked.
 *
 * @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests
 */

vi.mock("@/state/firmwareReady", () => ({ readyFirmware: async () => undefined }));
vi.mock("@/state/firmwareStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/state/firmwareStore")>()),
  askUefiAgent: async (
    pane: "a" | "b" | `part:${number}`,
    request: { query: string; values: { [key: string]: Json }; answerBound: number }
  ) => {
    const held = paneState(pane);
    if (held === undefined) return { error: "no pane" };
    const bytes = await held.document.read(0, held.document.size);
    try {
      return {
        answer: runUefiAgentQuery(
          request.query as "uefi_at" | "uefi_tree",
          agentTreeOver(bytes),
          new AgentArguments(request.values, request.answerBound),
          { contentVersion: 1 }
        ),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
}));

/** Padding, the store at `0x4000`, whose block 2 (`0x7000`) holds the serial — and padding. */
const store = (): Uint8Array =>
  Uint8Array.from([
    ...new Array<number>(0x4000).fill(0xff),
    ...testLog(STANDARD_LOG.slice(2), 0x77),
    ...testBlock({ generation: 3, key: 0x77, entries: [SERIAL, MTM] }),
    ...testBlock({ generation: 4, key: 0x77, entries: [SERIAL] }),
    ...new Array<number>(0x4000).fill(0xff),
  ]);

const BLOCK_2: readonly [number, number] = [0x7000, 0x8000];
const SERIAL_AT = 0x7010;

let desk: AgentDesk;
let part: `part:${number}`;

beforeEach(async () => {
  desk = new AgentDesk();
  const bytes = store();
  openEmptyInPane("a", "lenovo.bin");
  await paneState("a")?.document.insert(0, bytes);
  const stored = bytes.slice(BLOCK_2[0], BLOCK_2[1]);
  const opened = await openLinkedPart({
    parent: "a",
    name: "lenovo_block (decoded).bin",
    source: BLOCK_2,
    codec: new LenovoDMIBlockCodec(new LENVBlock(BLOCK_2[0], stored)),
  });
  if (opened === undefined) throw new Error("the part did not open");
  part = opened;
});

afterEach(() => {
  for (const panel of workspaceStore.getSnapshot().dock.panels) closePart(`part:${panel}`);
  workspaceStore.update((state) => ({
    ...state,
    panes: { a: undefined, b: undefined },
    parts: {},
    dock: EMPTY_DOCK,
  }));
});

/** The answer of `uefi_at` on `pane` at `offset`, as the worker gives it. */
async function chainAt(pane: "a" | `part:${number}`, offset: number): Promise<Json[]> {
  const held = paneState(pane);
  const bytes = await held?.document.read(0, held.document.size);
  const answer = runUefiAgentQuery(
    "uefi_at",
    agentTreeOver(bytes ?? new Uint8Array()),
    new AgentArguments({ offset: `0x${offset.toString(16)}` }),
    { contentVersion: 1 }
  );
  return member(answer, "chain") as Json[];
}

describe("a node of a parent and of its decoded part", () => {
  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testANodeNamesItsDecodedCounterpartAndTheOtherWayRound
  it("names its counterpart in the part, and `decoded_in`", async () => {
    const parentPlace = desk.placeOf("a");
    const partPlace = desk.placeOf(part);
    if (parentPlace === undefined || partPlace === undefined) throw new Error("not open");
    const chain = await chainAt("a", SERIAL_AT);
    const answer = await new AgentNodeLinks(desk).annotate({ chain }, parentPlace);
    const entry = (member(answer, "chain") as Json[]).at(-1);
    const decoded = member(entry, "decoded_in");
    expect(member(decoded, "document")).toBe(partPlace.id);
    expect(member(decoded, "node")).not.toBe(member(entry, "id"));
    const counterpart = (member(entry, "counterpart") as Json[])[0];
    expect(member(counterpart, "as")).toBe("decoded");
    // The store around the block is no part of it.
    const outer = (member(answer, "chain") as Json[]).find(
      (one) => member(one, "start") === "0x4000"
    );
    expect(member(outer, "counterpart")).toBeUndefined();
  });

  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testANodeNamesItsDecodedCounterpartAndTheOtherWayRound
  it("names, from the part, the parent's node as the encoded one", async () => {
    const parentPlace = desk.placeOf("a");
    const partPlace = desk.placeOf(part);
    if (parentPlace === undefined || partPlace === undefined) throw new Error("not open");
    const chain = await chainAt(part, SERIAL_AT - BLOCK_2[0]);
    const answer = await new AgentNodeLinks(desk).annotate({ chain }, partPlace);
    const own = (member(answer, "chain") as Json[]).at(-1);
    const counterpart = (member(own, "counterpart") as Json[])[0];
    expect(member(counterpart, "document")).toBe(parentPlace.id);
    expect(member(counterpart, "as")).toBe("encoded");
    const there = (await chainAt("a", SERIAL_AT)).at(-1);
    expect(member(counterpart, "node")).toBe(member(there, "id"));
    // Only the innermost of the nodes of the same bytes is linked: the part's top wraps the block.
    const wrappers = (member(answer, "chain") as Json[]).filter(
      (one) => member(one, "start") === "0x0" && member(one, "end") === "0x1000"
    );
    expect(wrappers.filter((one) => member(one, "counterpart") !== undefined).length).toBe(1);
  });

  // @upstream ByteRipperTests/AgentFindToolsTests.swift#AgentFindToolsTests.testANodeNamesItsDecodedCounterpartAndTheOtherWayRound
  it("says which document has a node id the call's document has not", async () => {
    const partPlace = desk.placeOf(part);
    if (partPlace === undefined) throw new Error("not open");
    const held = await new AgentNodeLinks(desk).documents("0.1.2.0", partPlace);
    expect(held).toEqual([{ document: desk.placeOf("a")?.id, name: "Baseboard serial number" }]);
    expect(await new AgentNodeLinks(desk).documents("9.9.9", partPlace)).toEqual([]);
  });

  it("leaves an answer alone when the document is neither a parent of a part nor a part", async () => {
    const lone = new AgentDesk();
    // A second window's document with no parts: pane B.
    openEmptyInPane("b", "other.bin");
    const place = lone.placeOf("b");
    if (place === undefined) throw new Error("not open");
    const answer: Json = { chain: [{ id: "0", start: "0x0", end: "0x10" }] };
    expect(await new AgentNodeLinks(lone).annotate(answer, place)).toEqual(answer);
  });
});
