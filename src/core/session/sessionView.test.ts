import { describe, expect, it } from "vitest";
import { BinaryDocument, JoinEmpty } from "@/core/document/binaryDocument";
import { selection } from "@/core/document/selectionModel";
import { SessionHost } from "@/core/session/sessionHost";
import type { SessionContentChange } from "@/core/session/sessionView";
import { SessionClient } from "@/core/session/sessionView";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { linePair, quiet } from "@/core/testing/sessionLines";
import { asArray, readAll, storageOver } from "@/core/testing/support";

/**
 * A file session lives in the host and two windows see one object (`Design/FILE_SESSIONS.md`, S1):
 * what one window does, the other sees; the history is the session's, so either window takes back
 * what either did; and a window reads its own selection back at once.
 */

const documentOf = (bytes: number[]) =>
  new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(bytes))));

function hostWith(sessions: Record<string, number[]>) {
  const host = new SessionHost();
  for (const [id, bytes] of Object.entries(sessions)) host.open(id, documentOf(bytes));
  const window = () => {
    const { view, host: end } = linePair();
    host.connect(end);
    return new SessionClient(view);
  };
  return { host, window };
}

const content = async (host: SessionHost, id: string) => {
  const document = host.document(id);
  if (document === undefined) throw new Error(`no session ${id}`);
  return asArray(await readAll(document.storage));
};

describe("a session two windows show", () => {
  it("is one object: an edit in one window is seen, state and bytes, in the other", async () => {
    const { window } = hostWith({ s: [0, 0, 0, 0] });
    const a = await window().show("s");
    const b = await window().show("s");
    const heard: SessionContentChange[] = [];
    b.onContentChanged((change) => heard.push(change));

    await a.overwrite(1, new Uint8Array([7, 8]));
    await quiet();

    expect(heard).toEqual([{ spans: [{ kind: "overwrite", at: 1, count: 2 }], restoring: false }]);
    expect(b.isDirty).toBe(true);
    expect(b.canUndo).toBe(true);
    expect(b.contentGeneration).toBe(a.contentGeneration);
    expect(asArray(await b.read(0, 4))).toEqual([0, 7, 8, 0]);
  });

  it("keeps one history: the other window undoes and redoes what the first did", async () => {
    const { host, window } = hostWith({ s: [1, 2, 3] });
    const a = await window().show("s");
    const b = await window().show("s");

    a.beginEditGroup("Add Microcode");
    await a.insert(3, new Uint8Array([9, 9]));
    a.endEditGroup();
    await a.settled();
    await quiet();
    expect(b.undoLabel).toBe("Add Microcode");
    expect(b.size).toBe(5);

    expect(await b.undo()).toEqual([{ kind: "delete", at: 3, count: 2 }]);
    expect(await content(host, "s")).toEqual([1, 2, 3]);
    await quiet();
    expect(a.isDirty).toBe(false);
    expect(a.redoLabel).toBe("Add Microcode");

    await a.redo();
    expect(await content(host, "s")).toEqual([1, 2, 3, 9, 9]);
    expect(await b.undo()).toBeDefined();
    expect(await b.undo(), "nothing more to take back").toBeUndefined();
  });

  it("applies one window's requests in the order sent, whatever it awaited", async () => {
    const { host, window } = hostWith({ s: [0, 0, 0, 0] });
    const a = await window().show("s");
    a.beginEditGroup();
    const first = a.overwrite(0, new Uint8Array([1]));
    const second = a.overwrite(1, new Uint8Array([2]));
    a.endEditGroup();
    await Promise.all([first, second]);
    await a.settled();
    expect(await content(host, "s")).toEqual([1, 2, 0, 0]);
    await a.undo();
    expect(await content(host, "s"), "the group is one step").toEqual([0, 0, 0, 0]);
  });

  it("counts an open group's bytes as unsaved, and a cancelled group as nothing", async () => {
    const { host, window } = hostWith({ s: [5, 5] });
    const a = await window().show("s");
    a.beginEditGroup();
    await a.overwrite(0, new Uint8Array([6]));
    expect(a.isDirty).toBe(true);
    await a.cancelEditGroup();
    expect(a.isDirty).toBe(false);
    expect(a.canUndo).toBe(false);
    expect(await content(host, "s")).toEqual([5, 5]);
  });

  it("takes back a byte, then the rest of the typing series in one fast undo", async () => {
    const { host, window } = hostWith({ s: [0, 1, 2, 3] });
    const a = await window().show("s");
    const b = await window().show("s");
    a.beginSeries(1);
    for (let at = 0; at < 3; at++) {
      await a.overwrite(at, new Uint8Array([0xa0 + at]));
      a.setSelection(selection(at + 1, at + 1, 4));
    }
    a.endSeries();
    await b.undo(false);
    expect(await content(host, "s")).toEqual([0xa0, 0xa1, 2, 3]);
    await b.undo(true);
    expect(await content(host, "s")).toEqual([0, 1, 2, 3]);
    expect(b.canUndo).toBe(false);
  });
});

describe("the selection", () => {
  it("is this window's at once, and the other's once the host has it", async () => {
    const { window } = hostWith({ s: Array(16).fill(0) });
    const a = await window().show("s");
    const b = await window().show("s");
    const seen: number[] = [];
    b.onSelectionChanged((value) => seen.push(value.start));

    a.setSelection(selection(4, 8, 16));
    expect(a.selection, "read back in the same breath").toEqual(selection(4, 8, 16));
    a.setSelection(selection(10, 10, 16));
    await a.settled();
    await quiet();
    expect(a.selection.start).toBe(10);
    expect(b.selection.start).toBe(10);
    expect(seen.at(-1)).toBe(10);
  });

  it("is not taken back by news of an older one while this window's newer one is on its way", async () => {
    const { window } = hostWith({ s: Array(16).fill(0) });
    const a = await window().show("s");
    const moves: number[] = [];
    a.onSelectionChanged((value) => moves.push(value.start));
    for (const at of [1, 2, 3, 4]) a.setSelection(selection(at, at, 16));
    await a.settled();
    expect(moves, "never back to an older one").toEqual([1, 2, 3, 4]);
  });

  it("is the one the history restores, seen by both windows", async () => {
    const { window } = hostWith({ s: Array(16).fill(0) });
    const a = await window().show("s");
    const b = await window().show("s");
    a.setSelection(selection(2, 2, 16));
    await a.overwrite(2, new Uint8Array([1, 1, 1]));
    a.setSelection(selection(12, 12, 16));
    await b.undo();
    await quiet();
    expect(a.selection.start).toBe(2);
    expect(b.selection.start).toBe(2);
  });
});

describe("what crosses and what fails", () => {
  it("joins another session's bytes, the step's serial answered", async () => {
    const { host, window } = hostWith({ s: [1], t: [2, 3] });
    const a = await window().show("s");
    const serial = await a.join({ kind: "session", session: "t" }, "end");
    expect(serial).toBe(a.lastCommittedSerial);
    expect(await content(host, "s")).toEqual([1, 2, 3]);
    expect(a.undoLabel).toBe("Append File");
  });

  it("throws what the document threw", async () => {
    const { window } = hostWith({ s: [1], empty: [] });
    const a = await window().show("s");
    await expect(a.join({ kind: "session", session: "empty" }, "end")).rejects.toBeInstanceOf(
      JoinEmpty
    );
  });

  it("refuses to show a session the host does not have", async () => {
    const { window } = hostWith({});
    await expect(window().show("nothing")).rejects.toThrow(/not open/);
  });

  it("tells every window when the session ends", async () => {
    const { host, window } = hostWith({ s: [1] });
    const a = await window().show("s");
    let closed = false;
    a.onClosed(() => {
      closed = true;
    });
    host.close("s");
    await quiet();
    expect(closed).toBe(true);
    await expect(a.overwrite(0, new Uint8Array([2]))).rejects.toThrow(/closed/);
  });

  it("knows which sessions some window still shows", async () => {
    const { host, window } = hostWith({ s: [1], t: [2] });
    const one = window();
    await one.show("s");
    const other = window();
    await other.show("s");
    await other.show("t");
    other.hide("t");
    await quiet();
    expect([...host.shownSessions()]).toEqual(["s"]);
  });
});
