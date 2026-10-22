import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installDesktopWorkspaceForTesting,
  resetWindowLaunchForTesting,
  type WindowLaunch,
} from "@/platform/desktop/desktopWindows";
import { forgetWorkspace, forgetWorkspacesExcept } from "@/state/workspace/shellWorkspace";
import {
  settleWorkspaceIdentity,
  WORKSPACE_KEY,
  workspaceId,
} from "@/state/workspace/workspaceIdentity";
import {
  allWorkspaceRecords,
  readKeptBytes,
  writeKeptBytes,
  writeWorkspaceRecord,
} from "@/state/workspace/workspaceRecords";

// `Design/DESKTOP_WINDOWS.md`, D2: a window of the desktop shell is the workspace its launch names,
// and the record of a window closed for good goes.

/** A `sessionStorage` per test: the window's own. */
function freshSessionStorage(): void {
  const values = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function launchWith(launch: WindowLaunch): void {
  resetWindowLaunchForTesting();
  installDesktopWorkspaceForTesting({ launch: () => launch, hold: () => {} });
}

const tab = {
  panes: [
    {
      id: "a" as const,
      document: {
        kind: "untitled" as const,
        untitled: { id: "u", name: "Untitled", size: 1, dirty: true },
      },
      selectionStart: 0,
      selectionEnd: 0,
      inputRegion: "hex" as const,
      insertMode: false,
      topOffset: 0,
    },
    undefined,
  ],
  activePane: 0,
  surface: {},
  fragments: [],
};

async function recordFor(id: string, leftAt: number): Promise<void> {
  await writeWorkspaceRecord(id, {
    workspace: { version: 1, tab } as never,
    leftAt,
    handles: {},
  });
}

describe("a window of the desktop shell", () => {
  beforeEach(() => freshSessionStorage());
  afterEach(() => {
    installDesktopWorkspaceForTesting();
    resetWindowLaunchForTesting();
    for (const id of ["w-restored", "w-left", "w-closed", "w-kept"]) void forgetWorkspace(id);
  });

  it("is the workspace its launch restores", async () => {
    await recordFor("w-left", Date.now());
    launchWith({ id: "w-restored", adopt: false });
    expect(await settleWorkspaceIdentity(true)).toBe("w-restored");
  });

  it("opened with New Window takes up no workspace a tab left", async () => {
    await recordFor("w-left", Date.now());
    launchWith({ adopt: false });
    const id = await settleWorkspaceIdentity(true);
    expect(id).not.toBe("w-left");
  });

  it("opened by a launch that names none takes up the one left most recently", async () => {
    await recordFor("w-left", Date.now());
    launchWith({ adopt: true });
    expect(await settleWorkspaceIdentity(true)).toBe("w-left");
  });

  it("keeps its own id across a reload", async () => {
    sessionStorage.setItem(WORKSPACE_KEY, "w-own");
    launchWith({ id: "w-restored", adopt: false });
    expect(await settleWorkspaceIdentity(true)).toBe("w-own");
  });
});

describe("a window closed for good", () => {
  beforeEach(() => {
    freshSessionStorage();
    sessionStorage.setItem(WORKSPACE_KEY, "w-kept");
  });

  it("takes its record and what it kept with it", async () => {
    await recordFor("w-closed", Date.now());
    await writeKeptBytes("w-closed", "d-1", new Uint8Array([1]));
    await forgetWorkspace("w-closed");
    expect((await allWorkspaceRecords()).some((one) => one.id === "w-closed")).toBe(false);
    expect(await readKeptBytes("w-closed", "d-1")).toBeUndefined();
  });

  it("is never this window itself", async () => {
    await recordFor(workspaceId(), Date.now());
    await forgetWorkspace(workspaceId());
    expect((await allWorkspaceRecords()).some((one) => one.id === "w-kept")).toBe(true);
  });

  it("is every record a launch did not name, bar a project's", async () => {
    await recordFor("w-restored", Date.now());
    await recordFor("w-closed", Date.now());
    await writeWorkspaceRecord("w-project", {
      workspace: { version: 1, tab } as never,
      leftAt: Date.now(),
      handles: {},
      project: "p-1",
    });
    await forgetWorkspacesExcept(["w-restored"]);
    const ids = (await allWorkspaceRecords()).map((one) => one.id).sort();
    expect(ids.filter((id) => id !== "w-kept")).toEqual(["w-project", "w-restored"]);
    await forgetWorkspace("w-project");
  });
});
