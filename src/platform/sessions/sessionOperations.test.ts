import { describe, expect, it } from "vitest";
import { BinaryDocument } from "@/core/document/binaryDocument";
import { SessionHost } from "@/core/session/sessionHost";
import { SessionClient } from "@/core/session/sessionView";
import { EditOverlayStorage } from "@/core/storage/editOverlayStorage";
import { linePair, quiet } from "@/core/testing/sessionLines";
import { storageOver } from "@/core/testing/support";
import { installSessionOperations, operate } from "@/platform/sessions/sessionOperations";

/**
 * What the platform does to a session in the host is the session's, whichever window asked: a name
 * an agent knows a document by is one of them (`Design/FILE_SESSIONS.md`, S9).
 */
function twoWindows() {
  const host = new SessionHost();
  installSessionOperations(host);
  host.open("s", new BinaryDocument(new EditOverlayStorage(storageOver(new Uint8Array(8)))));
  const window = () => {
    const { view, host: end } = linePair();
    host.connect(end);
    return new SessionClient(view);
  };
  return { first: window(), second: window() };
}

describe("an agent's name for a document", () => {
  it("is the session's: given in one window, it is the name in another, and stays the first", async () => {
    const { first, second } = twoWindows();
    const here = await first.show("s");
    expect(await operate(here, "agentName", "d7")).toBe("d7");
    const there = await second.show("s");
    await quiet();
    expect(there.agentId).toBe("d7");
    expect(await operate(there, "agentName", "d9"), "the first name stands").toBe("d7");
  });
});
