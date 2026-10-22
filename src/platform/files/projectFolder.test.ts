import { describe, expect, it } from "vitest";
import { HistoryLogWriter, readHistoryLog } from "@/core/edit/historyLog";
import { type KeptTransaction, UndoHistory } from "@/core/edit/undoHistory";
import { UndoBytes, UndoJournal } from "@/core/edit/undoJournal";
import {
  decodeEdits,
  encodeEdits,
  isProjectFolderName,
  type ProjectBridge,
  ProjectFolder,
  projectName,
} from "@/platform/files/projectFolder";

describe("a project's folder", () => {
  it("keeps a file's changes as runs and the bytes editing added", () => {
    const edits = {
      baseSize: 0x1000,
      runs: [
        { kind: "base" as const, start: 0, end: 0x10 },
        { kind: "added" as const, start: 0, end: 2 },
        { kind: "base" as const, start: 0x12, end: 0x1000 },
      ],
      added: new Uint8Array([0x77, 0x99]),
    };
    expect(decodeEdits(encodeEdits(edits))).toEqual(edits);
  });

  it("reads nothing back from bytes that are not such a record", () => {
    expect(decodeEdits(new Uint8Array([1, 2]))).toBeUndefined();
    expect(decodeEdits(new Uint8Array([0xff, 0, 0, 0, 0x7b]))).toBeUndefined();
  });

  it("is named by its folder without the extension", () => {
    expect(projectName("Job 1234.brw")).toBe("Job 1234");
    expect(projectName("Bench")).toBe("Bench");
    expect(isProjectFolderName("A.BRW")).toBe(true);
    expect(isProjectFolderName("dumps")).toBe(false);
  });
});

/** The shell's half of a project, over a log kept in memory as `desktop/projects.cjs` keeps it. */
function memoryBridge(): { bridge: ProjectBridge; logs: Map<string, Uint8Array> } {
  const logs = new Map<string, Uint8Array>();
  const bridge: ProjectBridge = {
    record: async () => undefined,
    keeps: async () => undefined,
    writeKept: async () => undefined,
    readKept: async () => undefined,
    log: async (request) => {
      const log = logs.get(request.key) ?? new Uint8Array(0);
      switch (request.op) {
        case "write": {
          const grown = new Uint8Array(Math.max(log.length, request.at + request.bytes.length));
          grown.set(log);
          grown.set(request.bytes, request.at);
          logs.set(request.key, grown);
          return undefined;
        }
        case "read":
          if (request.at + request.count > log.length) throw new Error("short");
          return log.slice(request.at, request.at + request.count);
        case "truncate":
          logs.set(request.key, log.slice(0, request.at));
          return undefined;
        case "sync":
          return undefined;
      }
    },
  };
  return { bridge, logs };
}

describe("a kept document's journal in the project's folder (P5)", () => {
  it("is the history's journal, read back as its log, and cut back to where it was pinned", async () => {
    const { bridge, logs } = memoryBridge();
    const store = new ProjectFolder("Job", bridge).journalStore("d1");
    const history = new UndoHistory();
    history.moveJournal(new UndoJournal(store));
    history.recordAtCaret(
      [{ kind: "insert", at: 0, bytes: UndoBytes.of(new Uint8Array([1, 2, 3])) }],
      0,
      3,
      0
    );
    const journal = history.currentJournal as UndoJournal;
    const writer = new HistoryLogWriter(journal);
    writer.append(history.heldTransactions[0] as KeptTransaction);
    const pinned = await writer.pin();
    if (pinned === undefined) throw new Error("not pinned");
    await store.synchronize();

    // Past the pin: what a crash leaves after the last manifest.
    writer.appendSelection(1, { start: 0, end: 0, fileSize: 3 });
    await writer.pin();
    expect(logs.get("d1")?.length).toBeGreaterThan(pinned.length);
    await store.truncate(pinned.length);
    expect(logs.get("d1")?.length).toBe(pinned.length);

    const read = await readHistoryLog(new UndoJournal(store, pinned), pinned.length, pinned.hash);
    const op = read[0]?.transaction.ops[0];
    expect(op?.kind === "insert" && [...(await op.bytes.load())]).toEqual([1, 2, 3]);
  });
});
