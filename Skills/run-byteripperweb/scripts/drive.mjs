#!/usr/bin/env node
// Drives ByteRipperWeb in a real browser: opens a dump, opens a tool's panel,
// pokes it, and takes screenshots. The app is what a person meets — headless
// Chrome on a socket — and not the test suite.
//
// No dependencies: node's own `fetch` and `WebSocket` speak CDP directly. The
// browser stays up between commands, so a check is a handful of invocations
// rather than one script per question.
//
//   node Skills/run-byteripperweb/scripts/drive.mjs start
//   node Skills/run-byteripperweb/scripts/drive.mjs open ~/Desktop/1.bin --tool ME --tab Tree
//   node Skills/run-byteripperweb/scripts/drive.mjs shot /tmp/panel.png
//   node Skills/run-byteripperweb/scripts/drive.mjs hover ".me-tree-head .column-resizer"
//   node Skills/run-byteripperweb/scripts/drive.mjs drag ".me-tree-head .column-resizer" 60
//   node Skills/run-byteripperweb/scripts/drive.mjs eval "getComputedStyle(document.querySelector('.me-row')).gridTemplateColumns"
//   node Skills/run-byteripperweb/scripts/drive.mjs stop

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const STATE = join(tmpdir(), "byteripperweb-run.json");
/**
 * Deletes a browser profile. A Chrome that is still shutting down keeps writing
 * to it, so this can fail with ENOTEMPTY — which does not matter: it is a temp
 * directory, and the next `start` wipes it again.
 */
const dropProfile = (profile) => {
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    // A browser still letting go of it. The OS collects the directory.
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The browser ─────────────────────────────────────────────────────────────

/** Every place a Chrome might be, in the order this machine is likely to have one. */
function chromePath(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((one) => typeof one === "string" && one.length > 0);
  for (const one of candidates) if (existsSync(one)) return one;
  const found = spawnSync("sh", ["-c", "command -v google-chrome chromium chromium-browser"], {
    encoding: "utf8",
  });
  const first = (found.stdout ?? "").split("\n").find((line) => line.trim().length > 0);
  if (first !== undefined) return first.trim();
  throw new Error("no Chrome found: pass --chrome <path> or set $CHROME");
}

function readState() {
  if (!existsSync(STATE)) throw new Error("nothing is running: run `drive.mjs start` first");
  return JSON.parse(readFileSync(STATE, "utf8"));
}

/** The page target's websocket, or a clear error. */
async function attach(state) {
  const list = await (await fetch(`http://127.0.0.1:${state.port}/json/list`)).json();
  const page = list.find((one) => one.type === "page");
  if (page === undefined) throw new Error("the browser has no page open");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return new Cdp(ws);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const m = JSON.parse(event.data);
      if (m.method !== undefined) {
        for (const fn of this.listeners.get(m.method) ?? []) fn(m.params);
        return;
      }
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      if (p === undefined) return;
      m.error !== undefined ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
    };
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  /** Evaluates in the page and returns the value. */
  async eval(expression, userGesture = false) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture,
    });
    if (r.exceptionDetails !== undefined) {
      throw new Error(`the page threw: ${r.exceptionDetails.exception?.description ?? "?"}`);
    }
    return r.result.value;
  }

  async wait(expression, what, timeout = 120_000) {
    const until = Date.now() + timeout;
    for (;;) {
      if (await this.eval(`!!(${expression})`)) return;
      if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
      await sleep(200);
    }
  }

  /** Where a selector is, in viewport coordinates. */
  box(selector) {
    return this.eval(`(() => {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (e === null) return null;
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
  }

  /**
   * Where a click target is: an element's centre, or a point given outright.
   *
   * The dump is a canvas — its bytes, its addresses and its bookmark marks are
   * pixels — so a gesture on it has no element to name. `@x,y` says where to
   * click; anything else is a selector.
   */
  async target(where) {
    const point = /^@(-?\d+),(-?\d+)$/.exec(where);
    if (point !== null) return { x: Number(point[1]), y: Number(point[2]) };
    const at = await this.box(where);
    if (at === null) throw new Error(`no element matches ${where}`);
    return at;
  }

  /**
   * A real mouse drag, in steps, so the app sees a pointer gesture rather than
   * a script calling its handlers. Chrome only opens a file chooser for a
   * gesture it believes in, and only steers a drag it sees move.
   */
  async drag(from, to) {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
    const steps = 12;
    for (let step = 1; step <= steps; step++) {
      await this.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: Math.round(from.x + ((to.x - from.x) * step) / steps),
        y: Math.round(from.y + ((to.y - from.y) * step) / steps),
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await sleep(20);
    }
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
    await sleep(150);
  }

  /**
   * A pointer that is only passing over an element, with nothing held — which
   * is what `:hover` is, and what a handle must not mistake for a gesture.
   */
  async hover(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", buttons: 0 });
    await sleep(120);
  }

  async click(x, y) {
    await this.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await this.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(150);
  }

  async key(key) {
    const codes = {
      ArrowLeft: [37, "ArrowLeft"],
      ArrowRight: [39, "ArrowRight"],
      ArrowUp: [38, "ArrowUp"],
      ArrowDown: [40, "ArrowDown"],
      Home: [36, "Home"],
      Enter: [13, "Enter"],
      Escape: [27, "Escape"],
    };
    const [keyCode, code] = codes[key] ?? [key.charCodeAt(0), `Key${key.toUpperCase()}`];
    for (const type of ["keyDown", "keyUp"]) {
      await this.send("Input.dispatchKeyEvent", {
        type,
        key,
        code,
        windowsVirtualKeyCode: keyCode,
        nativeVirtualKeyCode: keyCode,
      });
    }
    await sleep(120);
  }
}

// ── The app ─────────────────────────────────────────────────────────────────

/** The dev server's address, as `vite.config.ts` and `.env.local` describe it. */
function appUrl(unit, override) {
  if (override !== undefined) return override;
  let port = 5173;
  const env = join(unit, ".env.local");
  if (existsSync(env)) {
    const found = /^DEV_SERVER_PORT=(\d+)/m.exec(readFileSync(env, "utf8"));
    if (found !== null) port = Number(found[1]);
  }
  return `http://localhost:${port}/ByteRipperWeb/`;
}

const unitRoot = () => spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();

/** Opens a file through the app's own `<input type="file">` fallback. */
async function wireFileChooser(cdp, file, trouble) {
  // The dumps live on this machine and the app reaches them through the File
  // System Access picker, which headless Chrome cannot show. Removing that API
  // before any app code runs makes the app take the fallback every browser
  // without it takes — which a chooser interception can drive.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "delete window.showOpenFilePicker; delete window.showSaveFilePicker;",
  });
  await cdp.send("Page.setInterceptFileChooserDialog", { enabled: true });
  cdp.on("Page.fileChooserOpened", async () => {
    // The event names the frame and not the input, and the app appends that
    // input and clicks it in the same turn — so it is in the document by now.
    //
    // Asked for with `DOM.getDocument` first, every time: that call is what
    // fills the DOM agent's map, and without it the id `querySelector` hands
    // back names nothing and the file cannot be set. Retried, because the two
    // happen in one turn and the agent may not have seen the input on the first
    // pass — it is appended and removed inside the same gesture.
    //
    // Nothing here may throw: this is an event listener, and a rejection in one
    // takes the whole command down with a stack trace instead of the sentence
    // the caller needs.
    let step = "finding the input";
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const { root } = await cdp.send("DOM.getDocument", { depth: 1 });
        const { nodeId } = await cdp.send("DOM.querySelector", {
          nodeId: root.nodeId,
          selector: "input[type=file]",
        });
        if (nodeId === 0) {
          step = "finding the input: the page has no file input";
        } else {
          step = "handing the file over";
          await cdp.send("DOM.setFileInputFiles", { files: [file], nodeId });
          return;
        }
      } catch (error) {
        step = `${step}: ${error instanceof Error ? error.message : String(error)}`;
      }
      await sleep(120);
    }
    trouble.reason = step;
  });
}

/**
 * Waits for a tool panel to stop working.
 *
 * A panel reads the dump after it comes up — the ME analysis, the UEFI tree's
 * roots, the FIT table — and the app draws a `<progress>` in its notice line
 * while it does. A screenshot taken before that lands catches a half-built
 * panel, which reads as a bug in the panel rather than in the timing.
 *
 * Given a moment first, because the panel has to have started: waiting for the
 * bar to go away passes instantly in the instant before it appears. Bounded and
 * non-fatal — a panel with something still running is not a reason to fail a
 * command that has already done what it was asked.
 */
async function settle(cdp, what) {
  await sleep(1500);
  await cdp
    .wait("!document.querySelector('.tool-notice progress')", `${what} to finish reading`, 120_000)
    .catch(() => console.log(`${what} is still working; carrying on`));
}

/**
 * Picks a menu item by the text of its label, in whatever menu is open.
 *
 * The tool menu's first entry is "None", so a plain `includes` on a short name
 * matches the wrong row — `--tool ME` finds "None" before "ME Analyzer" and
 * takes the tool away instead of opening it. A word of its own wins first, and
 * only then a substring.
 */
async function chooseMenuItem(cdp, wanted) {
  const labels = (
    await cdp.eval(
      "Array.from(document.querySelectorAll('.menu-item')).map((e) => e.querySelector('.menu-label')?.textContent)"
    )
  ).map((one) => one ?? "");
  const lower = wanted.toLowerCase();
  const words = (one) => one.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  let at = labels.findIndex((one) => one.toLowerCase() === lower);
  if (at < 0) at = labels.findIndex((one) => words(one).includes(lower));
  if (at < 0) at = labels.findIndex((one) => one.toLowerCase().includes(lower));
  if (at < 0) throw new Error(`no menu item matching "${wanted}"; saw ${JSON.stringify(labels)}`);
  await cdp.eval(`Array.from(document.querySelectorAll('.menu-item'))[${at}].click()`, true);
}

// ── Commands ────────────────────────────────────────────────────────────────

function flag(args, name) {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
}

function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

const COMMANDS = {
  async start(args) {
    const port = Number(flag(args, "port") ?? 9222);
    const profile = join(tmpdir(), `byteripperweb-chrome-${port}`);
    dropProfile(profile);
    const chrome = chromePath(flag(args, "chrome"));
    const child = spawn(
      chrome,
      [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        `--window-size=${flag(args, "width") ?? 1500},${flag(args, "height") ?? 900}`,
        "--hide-scrollbars",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    for (let i = 0; i < 40; i++) {
      try {
        await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        writeFileSync(STATE, JSON.stringify({ port, profile }));
        console.log(`chrome ${chrome} listening on ${port}`);
        return;
      } catch {
        await sleep(250);
      }
    }
    throw new Error(`chrome did not come up on ${port}`);
  },

  async open(args) {
    const state = readState();
    const file = positionals(args)[0];
    if (file === undefined) throw new Error("open needs a file: `open <dump> --tool ME`");
    const cdp = await attach(state);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("DOM.enable");
    const trouble = {};
    await wireFileChooser(cdp, file.replace(/^~/, homedir()), trouble);

    await cdp.send("Page.navigate", { url: appUrl(unitRoot(), flag(args, "url")) });
    await cdp.wait("document.querySelector('.empty-state-icon')", "the landing screen");
    await cdp.eval("document.querySelector('.empty-state-icon').click()", true);
    await cdp.wait("document.querySelector('.hex-pane')", "the dump to open").catch((error) => {
      throw new Error(trouble.reason === undefined ? error.message : `the file was not handed over: ${trouble.reason}`);
    });
    await sleep(1500);
    console.log(`${file} is open`);

    const tool = flag(args, "tool");
    if (tool === undefined) return;
    await cdp.eval("document.querySelector('button[aria-label=\"Tools\"]').click()", true);
    await cdp.wait("document.querySelector('.menu-popup')", "the Tools menu");
    await chooseMenuItem(cdp, tool);
    await cdp.wait(
      "document.querySelector('.me-tab, .fit-entries, .uefi-tree, .tool-panel [role=tree]')",
      `${tool} to come up`,
      180_000
    );
    await settle(cdp, tool);

    const tab = flag(args, "tab");
    if (tab === undefined) return;
    const clicked = await cdp.eval(
      `(() => { const t = Array.from(document.querySelectorAll('.me-tab, .tool-tab, [role=tab]'))
        .find((e) => e.textContent.toLowerCase().includes(${JSON.stringify(tab.toLowerCase())}));
        if (t === undefined) return false; t.click(); return true; })()`,
      true
    );
    if (!clicked) console.log(`no tab matching "${tab}"`);
    await settle(cdp, tool);
    console.log(`${tool} is up`);
  },

  async shot(args) {
    const out = positionals(args)[0];
    if (out === undefined) throw new Error("shot needs a path");
    const cdp = await attach(readState());
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    console.log(out);
  },

  async eval(args) {
    const expression = positionals(args).join(" ");
    const cdp = await attach(readState());
    const value = await cdp.eval(expression);
    console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  },

  async drag(args) {
    const [where, dx, dy] = positionals(args);
    const cdp = await attach(readState());
    const at = await cdp.target(where);
    await cdp.drag(at, { x: at.x + Number(dx ?? 0), y: at.y + Number(dy ?? 0) });
    console.log(`dragged ${where} by ${dx ?? 0},${dy ?? 0}`);
  },

  async click(args) {
    const where = positionals(args)[0];
    const cdp = await attach(readState());
    const at = await cdp.target(where);
    await cdp.click(at.x, at.y);
    console.log(`clicked ${where}`);
  },

  async hover(args) {
    const [where, dx, dy] = positionals(args);
    const cdp = await attach(readState());
    const at = await cdp.target(where);
    await cdp.hover(at.x + Number(dx ?? 0), at.y + Number(dy ?? 0));
    console.log(`hovering ${where}`);
  },

  async keys(args) {
    const cdp = await attach(readState());
    for (const key of positionals(args)) await cdp.key(key);
    console.log(`pressed ${positionals(args).join(" ")}`);
  },

  async text() {
    const cdp = await attach(readState());
    console.log(await cdp.eval("document.body.innerText"));
  },

  async stop() {
    const state = readState();
    try {
      const list = await (await fetch(`http://127.0.0.1:${state.port}/json/list`)).json();
      const page = list.find((one) => one.type === "page");
      if (page !== undefined) {
        const cdp = new Cdp(await new Promise((resolve, reject) => {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          ws.onopen = () => resolve(ws);
          ws.onerror = reject;
        }));
        await cdp.send("Browser.close").catch(() => undefined);
      }
    } catch {
      // Already gone.
    }
    dropProfile(state.profile);
    rmSync(STATE, { force: true });
    console.log("stopped");
  },
};

const [command, ...rest] = process.argv.slice(2);
const run = COMMANDS[command];
if (run === undefined) {
  console.error(`usage: drive.mjs <${Object.keys(COMMANDS).join("|")}> [args]`);
  process.exit(2);
}
try {
  await run(rest);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
// The CDP socket is still open, and an open socket keeps node's loop alive: the
// command is done, so leave rather than wait for a reply that is not coming.
process.exit(0);
