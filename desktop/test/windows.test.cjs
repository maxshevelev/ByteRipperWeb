// The app's windows (Design/DESKTOP_WINDOWS.md, D1): where a new one goes, and how Exit walks them.
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { register, cascadeFrom, CASCADE } = require("../windows.cjs");

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

/** Windows that close at once, or that stay, as their page's question is answered. */
function harness() {
  const app = Object.assign(new EventEmitter(), { quit: () => app.emit("quit-called") });
  const made = [];
  const windows = register({
    BrowserWindow: { getFocusedWindow: () => undefined },
    Menu: { setApplicationMenu: () => undefined },
    screen: { getDisplayMatching: () => ({ workArea }) },
    app,
    create: (bounds) => {
      let destroyed = false;
      const window = Object.assign(new EventEmitter(), {
        bounds: bounds ?? { x: 10, y: 35, width: 1400, height: 900 },
        staysWhenClosed: false,
        closeAsked: 0,
        isDestroyed: () => destroyed,
        getBounds: () => window.bounds,
        close: () => {
          window.closeAsked++;
          if (window.staysWhenClosed) {
            windows.stayed();
            return;
          }
          destroyed = true;
          window.emit("closed");
        },
      });
      made.push(window);
      return window;
    },
  });
  return { app, made, windows };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

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

test("Exit closes every window front to back", async () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.makeWindow();
  windows.makeWindow();
  windows.closeAll();
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(
    made.map((window) => window.closeAsked),
    [1, 1, 1]
  );
  assert.equal(windows.windows().length, 0);
});

test("a window whose reader stays ends the walk, and the ones behind it stay too", async () => {
  const { made, windows } = harness();
  windows.makeWindow();
  windows.makeWindow();
  windows.makeWindow();
  // Front to back: made[2], made[1], made[0].
  made[1].staysWhenClosed = true;
  windows.closeAll();
  for (let i = 0; i < 5; i++) await settle();
  assert.deepEqual(
    made.map((window) => window.closeAsked),
    [0, 1, 1]
  );
  assert.equal(windows.windows().length, 2);
  // A later Exit walks again.
  made[1].staysWhenClosed = false;
  windows.closeAll();
  for (let i = 0; i < 5; i++) await settle();
  assert.equal(windows.windows().length, 0);
});

test("a quit asked of the app walks the windows instead of dropping them", () => {
  const { app, made, windows } = harness();
  windows.makeWindow();
  made[0].staysWhenClosed = true;
  let prevented = false;
  app.emit("before-quit", { preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.equal(made[0].closeAsked, 1);
});
