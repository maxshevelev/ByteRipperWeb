// The app's windows (Design/DESKTOP_WINDOWS.md, D1): where a new one goes, and how Exit walks them.
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const projects = require("../projects.cjs");
const { register, cascadeFrom, reachableFrame, CASCADE } = require("../windows.cjs");

const workArea = { x: 0, y: 25, width: 1920, height: 1055 };

// Upstream: MultiWindowTests.testASecondWindowOpensAtAUsableSize.
test("a new window stands off the one in front, at its size", () => {
  assert.deepEqual(cascadeFrom({ x: 100, y: 100, width: 1400, height: 900 }, workArea), {
    x: 100 + CASCADE,
    y: 100 + CASCADE,
    width: 1400,
    height: 900,
  });
});

test("a cascade that would leave the screen starts again at the work area's corner", () => {
  assert.deepEqual(cascadeFrom({ x: 600, y: 170, width: 1400, height: 900 }, workArea), {
    x: 0,
    y: 25,
    width: 1400,
    height: 900,
  });
});

test("a window larger than the screen is brought within it", () => {
  const bounds = cascadeFrom({ x: 0, y: 25, width: 2500, height: 1200 }, workArea);
  assert.equal(bounds.width, workArea.width);
  assert.equal(bounds.height, workArea.height);
});

test("with no window in front, the system places the new one", () => {
  assert.equal(cascadeFrom(undefined, workArea), undefined);
});

/**
 * Windows whose pages answer the quit's question, each with an answer to the dialog over it, and a
 * structure kept in memory.
 */
function harness({ saved, toOpen, toSave, ownFrames } = {}) {
  const app = Object.assign(new EventEmitter(), { quitCalled: 0, quit: () => app.quitCalled++ });
  const made = [];
  const asked = [];
  const written = [];
  let stayedHeard = 0;
  const displays = [{ workArea }];
  const framesWritten = [];
  const deps = {
    BrowserWindow: { getFocusedWindow: () => undefined },
    Menu: { setApplicationMenu: () => undefined },
    screen: { getDisplayMatching: () => ({ workArea }), getAllDisplays: () => displays },
    app,
    store: {
      read: () => saved,
      write: (value) => written.push(JSON.parse(JSON.stringify(value))),
    },
    confirmLeave: async (window) => {
      asked.push(window);
      return window.leaves;
    },
    onStayed: () => stayedHeard++,
    projects: {
      ...projects,
      recent: projects.recentStore(() =>
        path.join(fs.mkdtempSync(path.join(os.tmpdir(), "byteripper-recent-")), "Recent.json")
      ),
    },
    pickProjectToOpen: async () => toOpen,
    pickProjectToSave: async () => toSave,
    createOwn: (kind, bounds, message, shown) => {
      const window = deps.create(bounds, { own: kind, show: message });
      window.visible = shown;
      return window;
    },
    ownFrames: {
      read: () => ownFrames,
      write: (value) => framesWritten.push(JSON.parse(JSON.stringify(value))),
    },
    create: (bounds, launch) => {
      let destroyed = false;
      const window = Object.assign(new EventEmitter(), {
        bounds: bounds ?? { x: 10, y: 35, width: 1400, height: 900 },
        launch,
        asks: false,
        leaves: true,
        lastSnapshot: 0,
        forgot: [],
        calls: [],
        sent: [],
        answers: {},
        isDestroyed: () => destroyed,
        isMinimized: () => false,
        visible: true,
        show: () => {
          window.visible = true;
        },
        hide: () => {
          window.visible = false;
        },
        focus: () => window.emit("focus"),
        getBounds: () => window.bounds,
        destroy: () => {
          destroyed = true;
          window.emit("closed");
        },
        // A close as the ✕ asks for it: the shell's own handlers may hold it back.
        close: () => {
          let prevented = false;
          window.emit("close", { preventDefault: () => (prevented = true) });
          if (!prevented) window.destroy();
        },
        webContents: {
          send: (channel, message) => window.sent.push([channel, message]),
          executeJavaScript: async (code) => {
            const [, name, args] = /__byteripperShell\?\.(\w+)\?\.\((.*)\)$/s.exec(code) ?? [];
            const values = args ? JSON.parse(`[${args}]`) : [];
            window.calls.push([name, ...values]);
            if (name === "quit") {
              window.lastSnapshot++;
              return { asks: window.asks };
            }
            if (name === "forget") window.forgot.push(values[0]);
            return window.answers[name];
          },
        },
      });
      made.push(window);
      return window;
    },
  };
  const windows = register(deps);
  return { app, made, asked, written, framesWritten, windows, stayed: () => stayedHeard };
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

test("a window made after another is cascaded off it", () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.makeWindow();
  assert.deepEqual(made[1].bounds, { x: 10 + CASCADE, y: 35 + CASCADE, width: 1400, height: 900 });
});

test("the window last focused is the one in front", () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.makeWindow();
  made[0].emit("focus");
  assert.equal(windows.windows()[0], made[0]);
  windows.makeWindow();
  assert.deepEqual(made[2].bounds.x, made[0].bounds.x + CASCADE, "cascaded off the focused one");
});

// Upstream: WorkspaceRestoreTests.testTheLastSnapshotCallsBackInsteadOfWaiting, the shell's half.
test("a quit has every window write its last snapshot, and then they all go", async () => {
  const { app, made, windows } = harness();
  windows.makeWindow();
  windows.makeWindow();
  await windows.quit();
  assert.deepEqual(
    made.map((window) => window.lastSnapshot),
    [1, 1]
  );
  assert.equal(windows.windows().length, 0);
  assert.equal(app.quitCalled, 1);
});

test("a window holding work it cannot keep asks, and staying keeps every window", async () => {
  const { app, made, asked, windows, stayed } = harness();
  windows.makeWindow();
  windows.makeWindow();
  windows.makeWindow();
  // Front to back: made[2], made[1], made[0].
  made[0].asks = true;
  made[1].asks = true;
  made[1].leaves = false;
  await windows.quit();
  assert.deepEqual(asked, [made[1]], "asked front to back, and the walk ends at the stay");
  assert.equal(windows.windows().length, 3, "nothing went before everyone agreed");
  assert.equal(app.quitCalled, 0);
  assert.equal(stayed(), 1);
  // A later quit asks again.
  made[1].leaves = true;
  await windows.quit();
  assert.deepEqual(asked, [made[1], made[1], made[0]]);
  assert.equal(windows.windows().length, 0);
});

test("a quit asked of the app walks the windows instead of dropping them", async () => {
  const { app, made, windows } = harness();
  windows.makeWindow();
  made[0].asks = true;
  made[0].leaves = false;
  let prevented = false;
  app.emit("before-quit", { preventDefault: () => (prevented = true) });
  await settle();
  assert.equal(prevented, true);
  assert.equal(windows.windows().length, 1);
});

// Upstream: ProjectTests.testClosingTheLastWindowOfAProjectQuitsInstead, for the workspace.
test("closing the last window is the app quitting, keeping it", async () => {
  const { app, made, windows } = harness();
  windows.makeWindow();
  made[0].close();
  await settle();
  assert.equal(made[0].lastSnapshot, 1, "its last snapshot written before it went");
  assert.equal(app.quitCalled, 1);
});

test("a window closed while others stay leaves the workspace, its record forgotten", async () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.makeWindow();
  windows.hold(made[0], "w-first", true);
  windows.hold(made[1], "w-second", true);
  made[0].close();
  await settle();
  assert.equal(made[0].lastSnapshot, 0, "a window closed on its own is not a quit");
  assert.deepEqual(made[1].forgot, ["w-first"]);
  assert.deepEqual(
    windows.structure().windows.map((one) => one.id),
    ["w-second"]
  );
});

test("the structure is the windows front to back with their ids and frames", () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.makeWindow();
  windows.hold(made[0], "w-back", true);
  windows.hold(made[1], "w-front", true);
  assert.deepEqual(windows.structure(), {
    version: 1,
    windows: [
      { id: "w-front", frame: made[1].bounds },
      { id: "w-back", frame: made[0].bounds },
    ],
  });
});

test("with the workspace not reopened at launch the structure names no window", () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.hold(made[0], "w-one", false);
  assert.deepEqual(windows.structure(), { version: 1, windows: [] });
});

test("the structure is written as it stands before a quit asks anything", async () => {
  const { made, written, windows } = harness();
  windows.makeWindow();
  windows.hold(made[0], "w-one", true);
  await windows.quit();
  assert.deepEqual(
    written.at(-1).windows.map((one) => one.id),
    ["w-one"]
  );
});

// Upstream: AppDelegate.rebuild — the front window made last, so it ends up in front.
test("a launch opens every window the structure names, the front one last and in front", () => {
  const saved = {
    version: 1,
    windows: [
      { id: "w-front", frame: { x: 100, y: 100, width: 1200, height: 800 } },
      { id: "w-back", frame: { x: 300, y: 200, width: 1000, height: 700 } },
    ],
  };
  const { made, windows } = harness({ saved });
  windows.launch();
  assert.deepEqual(
    made.map((window) => window.launch.id),
    ["w-back", "w-front"]
  );
  assert.deepEqual(made[1].bounds, saved.windows[0].frame);
  assert.equal(windows.windows()[0], made[1]);
  assert.deepEqual(
    made[1].launch.keep,
    ["w-front", "w-back"],
    "the front one is told what is held"
  );
  assert.equal(made[0].launch.keep, undefined);
  assert.equal(made[0].launch.adopt, false);
});

test("a launch with no structure opens one window, which may take up a workspace left", () => {
  const { made, windows } = harness();
  windows.launch();
  assert.equal(made.length, 1);
  assert.equal(made[0].launch.adopt, true);
  assert.equal(made[0].launch.id, undefined);
});

test("a new window takes up no workspace", () => {
  const { made, windows } = harness();
  windows.makeWindow();
  assert.equal(made[0].launch.adopt, false);
});

test("a frame no screen shows any more is left to the system", () => {
  assert.equal(
    reachableFrame({ x: 4000, y: 100, width: 1200, height: 800 }, [workArea]),
    undefined
  );
  assert.deepEqual(reachableFrame({ x: 100, y: 100, width: 1200, height: 800 }, [workArea]), {
    x: 100,
    y: 100,
    width: 1200,
    height: 800,
  });
});

// Design/DESKTOP_WINDOWS.md, D3: a project is every window, and opening one replaces them all.

const projectFolder = (windows) => {
  const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "byteripper-job-")), "Job.brw");
  fs.mkdirSync(folder);
  projects.write(folder, windows);
  return folder;
};
const tab = (name) => ({ version: 1, tab: { name } });

// Upstream: ProjectTests.testOpeningAProjectReplacesEverythingOpen.
test("opening a project replaces every window with the project's, the front one in front", async () => {
  const folder = projectFolder([
    { id: "w-front", frame: { x: 100, y: 100, width: 900, height: 700 }, workspace: tab("front") },
    { id: "w-back", workspace: tab("back") },
  ]);
  const { made, windows } = harness({ toOpen: folder });
  windows.makeWindow();
  windows.makeWindow();
  await windows.openProject(made[1], undefined, "Project");
  assert.equal(made[0].isDestroyed(), true);
  assert.equal(made[1].isDestroyed(), true);
  const opened = windows.windows();
  assert.deepEqual(
    opened.map((window) => window.launch.id),
    ["w-front", "w-back"]
  );
  assert.deepEqual(opened[0].launch.project, { path: folder, name: "Job" });
  assert.deepEqual(windows.projectWindow(opened[0]), tab("front"));
  assert.equal(windows.projectWindow(opened[0]), undefined, "handed over once");
  assert.equal(windows.currentProject(), folder);
});

test("a session holding nothing is not asked about before a project replaces it", async () => {
  const folder = projectFolder([{ workspace: tab("one") }]);
  const { made, windows } = harness({ toOpen: folder });
  windows.makeWindow();
  made[0].answers.holdsAnything = false;
  await windows.openProject(made[0], undefined, "Project");
  assert.equal(
    made[0].calls.some(([name]) => name === "askSaveSession"),
    false
  );
  assert.equal(windows.currentProject(), folder);
});

test("cancelling the question keeps the session as it was", async () => {
  const folder = projectFolder([{ workspace: tab("one") }]);
  const { made, windows } = harness({ toOpen: folder });
  windows.makeWindow();
  made[0].answers.holdsAnything = true;
  made[0].answers.askSaveSession = "cancel";
  await windows.openProject(made[0], undefined, "Project");
  assert.equal(made[0].isDestroyed(), false);
  assert.equal(windows.currentProject(), undefined);
});

test("Don't Save asks every window about its changes, then discards each session", async () => {
  const folder = projectFolder([{ workspace: tab("one") }]);
  const { made, windows } = harness({ toOpen: folder });
  windows.makeWindow();
  windows.makeWindow();
  for (const window of made) {
    window.answers.holdsAnything = true;
    window.answers.confirmDiscard = true;
  }
  made[1].answers.askSaveSession = "discard";
  const session = [...made];
  await windows.openProject(made[1], undefined, "Project");
  for (const window of session) {
    assert.equal(
      window.calls.some(([name]) => name === "confirmDiscard"),
      true
    );
    assert.equal(
      window.calls.some(([name]) => name === "discard"),
      true
    );
  }
  assert.equal(windows.currentProject(), folder);
});

test("a window that will not lose its changes keeps the session", async () => {
  const folder = projectFolder([{ workspace: tab("one") }]);
  const { made, windows } = harness({ toOpen: folder });
  windows.makeWindow();
  made[0].answers.holdsAnything = true;
  made[0].answers.askSaveSession = "discard";
  made[0].answers.confirmDiscard = false;
  await windows.openProject(made[0], undefined, "Project");
  assert.equal(windows.currentProject(), undefined);
  assert.equal(
    made[0].calls.some(([name]) => name === "discard"),
    false
  );
});

test("a path the page names is opened only when it is a recent project", async () => {
  const folder = projectFolder([{ workspace: tab("one") }]);
  const { windows, made } = harness();
  windows.makeWindow();
  assert.deepEqual(await windows.openProject(made[0], folder, "Project"), {});
  assert.equal(windows.currentProject(), undefined);
});

test("a folder that holds no project is said to be unreadable", async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "byteripper-empty-"));
  const { windows, made } = harness({ toOpen: empty });
  windows.makeWindow();
  const answer = await windows.openProject(made[0], undefined, "Project");
  assert.equal(answer.error, "unreadable");
});

// Upstream: ProjectTests.testSaveAsProjectWritesEveryWindow.
test("Save as Project… has every window record into the new project", async () => {
  const job = fs.mkdtempSync(path.join(os.tmpdir(), "byteripper-save-"));
  const target = path.join(job, "Bench.brw");
  const { made, windows } = harness({ toSave: target });
  windows.makeWindow();
  windows.makeWindow();
  windows.hold(made[0], "w-back", true);
  windows.hold(made[1], "w-front", true);
  for (const [index, window] of made.entries()) {
    // The page answers by recording its workspace into the project, as `followProject` does.
    window.answers.projectChanged = true;
    window.webContents.executeJavaScript = ((original) => async (code) => {
      if (code.includes("projectChanged")) {
        windows.projectRecorded(window, tab(`window ${index}`));
        windows.projectKeeps(window, []);
      }
      return original(code);
    })(window.webContents.executeJavaScript);
  }
  const answer = await windows.saveAsProject(made[1], "Project");
  assert.equal(answer.ok, true);
  assert.equal(windows.currentProject(), target);
  for (const window of made) {
    const call = window.calls.find(([name]) => name === "projectChanged");
    assert.deepEqual(call, ["projectChanged", { path: target, name: "Bench" }, true]);
  }
  assert.deepEqual(
    projects.read(target).map((one) => [one.id, one.workspace.tab.name]),
    [
      ["w-front", "window 1"],
      ["w-back", "window 0"],
    ]
  );
  assert.equal(windows.structure().project, target);
});

test("Close Project leaves one empty window and no project", async () => {
  const folder = projectFolder([{ workspace: tab("one") }, { workspace: tab("two") }]);
  const { made, windows } = harness({ toOpen: folder });
  windows.makeWindow();
  made[0].answers.holdsAnything = false;
  await windows.openProject(made[0], undefined, "Project");
  await windows.closeProject();
  const left = windows.windows();
  assert.equal(left.length, 1);
  assert.equal(left[0].launch.project, undefined);
  assert.equal(left[0].launch.adopt, false);
  assert.equal(windows.currentProject(), undefined);
});

// Upstream: RecentProjectsStore.lastProject — the project open at the last quit opens again.
test("a launch opens the project the structure names", () => {
  const folder = projectFolder([{ id: "w-one", workspace: tab("one") }]);
  const { made, windows } = harness({ saved: { version: 1, project: folder, windows: [] } });
  windows.launch();
  assert.equal(made.length, 1);
  assert.deepEqual(made[0].launch.project, { path: folder, name: "Job" });
  assert.equal(made[0].launch.id, "w-one");
});

test("a launch whose project is gone opens one window", () => {
  const { made, windows } = harness({
    saved: { version: 1, project: "/nowhere/Gone.brw", windows: [] },
  });
  windows.launch();
  assert.equal(made.length, 1);
  assert.equal(made[0].launch.project, undefined);
});

// The app's own windows (D7): the help, the annotations, the agent.

// Upstream: NotesWindowController.instance — one window, made the first time it is asked for.
test("the app's own window of a kind is made once, and asked again it shows what is named", () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.openOwn("help", { link: { kind: "topic", id: "overview" } });
  windows.openOwn("help", { link: { kind: "topic", id: "settings" } });
  assert.equal(made.length, 2);
  assert.deepEqual(made[1].launch, {
    own: "help",
    show: { link: { kind: "topic", id: "overview" } },
  });
  assert.deepEqual(made[1].sent, [["own:show", { link: { kind: "topic", id: "settings" } }]]);
  assert.equal(windows.ownKindOf(made[1]), "help");
  assert.equal(windows.ownKindOf(made[0]), undefined);
});

test("a kind the app has no window of is not made", () => {
  const { made, windows } = harness();
  windows.openOwn("settings");
  assert.equal(made.length, 0);
});

test("the app's own windows are not the workspace's", () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.hold(made[0], "w1", true);
  windows.openOwn("notes");
  made[1].emit("focus");
  assert.deepEqual(windows.windows(), [made[0]]);
  assert.deepEqual(
    windows.structure().windows.map((one) => one.id),
    ["w1"]
  );
});

test("an own window opens where it stood when it was closed", () => {
  const { made, windows, framesWritten } = harness({
    ownFrames: { notes: { x: 300, y: 200, width: 700, height: 600 } },
  });
  windows.openOwn("notes");
  assert.deepEqual(made[0].bounds, { x: 300, y: 200, width: 700, height: 600 });
  made[0].bounds = { x: 320, y: 220, width: 700, height: 600 };
  made[0].close();
  assert.deepEqual(framesWritten.at(-1), { notes: { x: 320, y: 220, width: 700, height: 600 } });
  windows.openOwn("notes");
  assert.equal(made.length, 2, "made again once closed");
});

test("closing the last window of the workspace quits, taking the app's own windows with it", async () => {
  const { app, made, windows } = harness();
  windows.makeWindow();
  windows.openOwn("help");
  made[0].close();
  await settle();
  assert.equal(app.quitCalled, 1);
  assert.equal(made[1].isDestroyed(), true);
});

// D7d: the agent service runs in the Agent window's page.
test("the Agent window can be made out of sight, and shown when asked for", () => {
  const { made, windows } = harness();
  windows.openOwn("agent", undefined, false);
  assert.equal(made[0].visible, false);
  windows.openOwn("agent", undefined, false);
  assert.equal(made.length, 1);
  windows.openOwn("agent");
  assert.equal(made[0].visible, true);
});

test("closing the Agent window puts it out of sight: the service in its page goes on", () => {
  const { made, windows } = harness();
  windows.openOwn("agent");
  made[0].close();
  assert.equal(made[0].isDestroyed(), false);
  assert.equal(made[0].visible, false);
  windows.openOwn("agent");
  assert.equal(made.length, 1, "the same window comes back");
});
