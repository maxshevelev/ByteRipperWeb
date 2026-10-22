// The app's windows (Design/DESKTOP_WINDOWS.md, D1): where a new one goes, and how Exit walks them.
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
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
function harness({ saved } = {}) {
  const app = Object.assign(new EventEmitter(), { quitCalled: 0, quit: () => app.quitCalled++ });
  const made = [];
  const asked = [];
  const written = [];
  let stayedHeard = 0;
  const displays = [{ workArea }];
  const windows = register({
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
    create: (bounds, launch) => {
      let destroyed = false;
      const window = Object.assign(new EventEmitter(), {
        bounds: bounds ?? { x: 10, y: 35, width: 1400, height: 900 },
        launch,
        asks: false,
        leaves: true,
        lastSnapshot: 0,
        forgot: [],
        isDestroyed: () => destroyed,
        isMinimized: () => false,
        show: () => undefined,
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
          executeJavaScript: async (code) => {
            if (code.includes("__byteripperQuit")) {
              window.lastSnapshot++;
              return { asks: window.asks };
            }
            const id = /ForgetWorkspace\?\.\("([^"]*)"\)/.exec(code)?.[1];
            if (id !== undefined) window.forgot.push(id);
            return undefined;
          },
        },
      });
      made.push(window);
      return window;
    },
  });
  return { app, made, asked, written, windows, stayed: () => stayedHeard };
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
