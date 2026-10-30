// The agent service's transport, through a real endpoint and the real relay: a fake page stands
// where the renderer is and answers each line it is handed, as AgentKit would.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { register } = require("../agent.cjs");
const { endpoint, isPipe, launchesApp } = require("../agent-endpoint.cjs");

/** An `ipcMain` that is an emitter with `handle`, and a page whose `send` is recorded. */
function harness() {
  const ipc = new EventEmitter();
  const handlers = new Map();
  ipc.handle = (channel, handler) => handlers.set(channel, handler);
  const sent = new EventEmitter();
  const page = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel, ...args) => sent.emit(channel, ...args),
  });
  const app = Object.assign(new EventEmitter(), { isPackaged: false });
  register(ipc, () => true, app);
  const event = { sender: page };
  return {
    sent,
    app,
    invoke: (channel, ...args) => handlers.get(channel)(event, ...args),
    post: (channel, ...args) => ipc.emit(channel, event, ...args),
  };
}

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "byteripper-agent-"));
const addressIn = (folder) =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\ByteRipper-test-${path.basename(folder)}`
    : path.join(folder, "agent.sock");

test("the endpoint is a named pipe on Windows and a socket elsewhere", () => {
  assert.equal(isPipe(endpoint({}, "win32")), true);
  assert.match(endpoint({ USERNAME: "bench" }, "win32"), /^\\\\\.\\pipe\\ByteRipper-agent-/);
  assert.equal(endpoint({ BYTERIPPER_AGENT_SOCKET: "/tmp/x.sock" }, "darwin"), "/tmp/x.sock");
  assert.match(
    endpoint({}, "darwin"),
    /Library[\\/]Application Support[\\/]ByteRipper[\\/]agent\.sock$/
  );
});

// Upstream: UnixSocketTests.testTheRelayStartsTheAppOnlyWhenToldTo.
test("the relay starts the app only when its client's configuration says so", () => {
  assert.equal(launchesApp({}), false);
  assert.equal(launchesApp({ BYTERIPPER_LAUNCH: "" }), false);
  assert.equal(launchesApp({ BYTERIPPER_LAUNCH: "0" }), false);
  assert.equal(launchesApp({ BYTERIPPER_LAUNCH: " False " }), false);
  assert.equal(launchesApp({ BYTERIPPER_LAUNCH: "1" }), true);
  assert.equal(launchesApp({ BYTERIPPER_LAUNCH: "yes" }), true);
});

test("a line goes from the relay to the page and the answer comes back", async () => {
  const folder = temporary();
  const where = addressIn(folder);
  process.env.BYTERIPPER_AGENT_SOCKET = where;
  const { sent, invoke, post } = harness();
  try {
    assert.deepEqual(await invoke("agent:enable", true), { ok: true, endpoint: where });

    // The page: each line the relay writes is answered with an echo of it.
    sent.on("agent:data", (id, bytes) => {
      post("agent:send", id, new Uint8Array(Buffer.from(`echo:${Buffer.from(bytes).toString()}`)));
    });

    const relay = spawn(process.execPath, [path.join(__dirname, "..", "relay.cjs")], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const answer = new Promise((resolve) =>
      relay.stdout.once("data", (chunk) => resolve(chunk.toString()))
    );
    relay.stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    assert.equal(await answer, 'echo:{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    relay.stdin.end();
    await new Promise((resolve) => relay.once("exit", resolve));
  } finally {
    await invoke("agent:enable", false);
    delete process.env.BYTERIPPER_AGENT_SOCKET;
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// Upstream's `AgentUITests.testASocketAnotherCopyHoldsIsReportedNotTaken`, the shell's half: the page
// is told why the service could not start (`agentService.test.ts`), and the endpoint stays the
// other copy's.
test("an endpoint another copy holds is reported, not taken", async () => {
  const folder = temporary();
  const where = addressIn(folder);
  process.env.BYTERIPPER_AGENT_SOCKET = where;
  const other = net.createServer();
  await new Promise((resolve) => other.listen(where, resolve));
  const { invoke } = harness();
  try {
    const outcome = await invoke("agent:enable", true);
    assert.equal(outcome.ok, false);
    if (!isPipe(where)) {
      assert.equal(outcome.error, "Another copy of ByteRipper holds the agent endpoint.");
      assert.equal(fs.existsSync(where), true, "the other copy's socket is left where it is");
    }
    // The other copy still answers there.
    await new Promise((resolve, reject) => {
      const probe = net.connect(where, () => {
        probe.destroy();
        resolve();
      });
      probe.once("error", reject);
    });
  } finally {
    await invoke("agent:enable", false);
    await new Promise((resolve) => other.close(resolve));
    delete process.env.BYTERIPPER_AGENT_SOCKET;
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("with the service off, the relay answers every request with where the switch is", async () => {
  const folder = temporary();
  process.env.BYTERIPPER_AGENT_SOCKET = addressIn(folder);
  try {
    const relay = spawn(process.execPath, [path.join(__dirname, "..", "relay.cjs")], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const answer = new Promise((resolve) =>
      relay.stdout.once("data", (chunk) => resolve(chunk.toString()))
    );
    relay.stdin.write(
      '{"jsonrpc":"2.0","id":7,"method":"tools/list"}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
    );
    const reply = JSON.parse(await answer);
    assert.equal(reply.id, 7);
    assert.equal(reply.error.code, -32603);
    assert.match(reply.error.message, /Settings ▸ Agent/);
    assert.match(reply.error.message, /Start ByteRipper when an agent connects/);
    relay.stdin.end();
    await new Promise((resolve) => relay.once("exit", resolve));
  } finally {
    delete process.env.BYTERIPPER_AGENT_SOCKET;
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("files by path are read only while the service is on", async () => {
  const folder = temporary();
  process.env.BYTERIPPER_AGENT_SOCKET = addressIn(folder);
  const { invoke } = harness();
  const file = path.join(folder, "dump.bin");
  fs.writeFileSync(file, Buffer.from([1, 2, 3, 4, 5, 6]));
  try {
    await assert.rejects(invoke("agent:file", { op: "stat", path: file }), /off/);
    await invoke("agent:enable", true);
    const stat = await invoke("agent:file", { op: "stat", path: file });
    assert.equal(stat.size, 6);
    assert.deepEqual(
      [...(await invoke("agent:file", { op: "read", path: file, offset: 2, length: 3 }))],
      [3, 4, 5]
    );
    const listing = await invoke("agent:file", { op: "list", path: folder, recursive: true });
    assert.deepEqual(listing.files, [file]);
    await assert.rejects(invoke("agent:file", { op: "stat", path: "relative.bin" }), /absolute/);
  } finally {
    await invoke("agent:enable", false);
    delete process.env.BYTERIPPER_AGENT_SOCKET;
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("the page reads a file it opened by path with the service off, and lists nothing", async () => {
  const folder = temporary();
  const { invoke } = harness();
  const file = path.join(folder, "dump.bin");
  fs.writeFileSync(file, Buffer.from([1, 2, 3, 4, 5, 6]));
  try {
    await assert.rejects(invoke("agent:file", { op: "stat", path: file }), /off/);
    const stat = await invoke("file:read", { op: "stat", path: file });
    assert.equal(stat.size, 6);
    assert.deepEqual(
      [...(await invoke("file:read", { op: "read", path: file, offset: 1, length: 2 }))],
      [2, 3]
    );
    await assert.rejects(invoke("file:read", { op: "list", path: folder }), /Unknown/);
    await assert.rejects(
      invoke("file:read", { op: "stat", path: path.join(folder, "gone.bin") }),
      /ENOENT/
    );
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// Design/DESKTOP_WINDOWS.md, D1: the endpoint is served by one window of several, and when that
// window closes the next one that has the service on takes it over.
test("the endpoint passes to the next window when the one it served closes", async () => {
  const folder = temporary();
  const where = addressIn(folder);
  process.env.BYTERIPPER_AGENT_SOCKET = where;
  const ipc = new EventEmitter();
  const handlers = new Map();
  ipc.handle = (channel, handler) => handlers.set(channel, handler);
  const page = (name) => {
    let destroyed = false;
    const one = Object.assign(new EventEmitter(), {
      name,
      sent: [],
      isDestroyed: () => destroyed,
      send: (channel) => one.sent.push(channel),
      destroy: () => {
        destroyed = true;
        one.emit("destroyed");
      },
    });
    return one;
  };
  const first = page("first");
  const second = page("second");
  register(ipc, () => true, Object.assign(new EventEmitter(), { isPackaged: false }));
  const enable = (sender, on) => handlers.get("agent:enable")({ sender }, on);
  const connectAndWait = async (to) => {
    const socket = net.connect(where);
    await new Promise((resolve) => socket.once("connect", resolve));
    for (let tries = 0; tries < 50 && !to.sent.includes("agent:connection"); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    socket.destroy();
  };
  try {
    assert.deepEqual(await enable(first, true), { ok: true, endpoint: where });
    assert.deepEqual(await enable(second, true), { ok: true, endpoint: where });
    await connectAndWait(first);
    assert.equal(first.sent.includes("agent:connection"), true);
    assert.equal(second.sent.includes("agent:connection"), false);

    first.destroy();
    await connectAndWait(second);
    assert.equal(second.sent.includes("agent:connection"), true, "the second window serves now");

    second.destroy();
    assert.equal(
      await new Promise((resolve) => {
        const probe = net.connect(where);
        probe.once("connect", () => {
          probe.destroy();
          resolve(true);
        });
        probe.once("error", () => resolve(false));
      }),
      false,
      "with no window left that wants it, the endpoint closes"
    );
  } finally {
    await enable(first, false);
    delete process.env.BYTERIPPER_AGENT_SOCKET;
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// D7d: the service runs in the Agent window's page; a window of the workspace has it made.
test("a window of the workspace turning the service on has the Agent window's page made", async () => {
  const ipc = new EventEmitter();
  const handlers = new Map();
  ipc.handle = (channel, handler) => handlers.set(channel, handler);
  const app = Object.assign(new EventEmitter(), { isPackaged: false });
  let made = 0;
  register(ipc, () => true, app, { host: () => made++, isHost: () => false });
  const answer = await handlers.get("agent:enable")({ sender: {} }, true);
  assert.deepEqual(answer, { ok: true, hosted: true });
  assert.equal(made, 1);
});

// Upstream's `AgentUITests.testTheRelayHandedOutIsTheInstalledCopyOfThisBuildsHelper`, the shell's
// half: what a client is told to run is this build's relay — not an installed copy beside the
// endpoint (upstream's `AgentRelayInstall`), but the script beside the app's own executable, run
// by it as Node, which is this build's by construction.
test("the relay handed out is this build's own, run by this build's executable", async () => {
  const { invoke } = harness();
  const info = await invoke("agent:info");
  assert.equal(info.command, process.execPath);
  assert.equal(info.script, path.join(__dirname, "..", "relay.cjs"));
  assert.equal(fs.existsSync(info.script), true, "the relay is there to run");
  assert.deepEqual(info.environment, { ELECTRON_RUN_AS_NODE: "1" });
});

test("a document's id comes from one counter for every window", () => {
  const minted = [];
  const ipc = new EventEmitter();
  ipc.handle = () => undefined;
  register(ipc, () => true, Object.assign(new EventEmitter(), { isPackaged: false }));
  for (let i = 0; i < 3; i++) {
    const event = { sender: {} };
    ipc.emit("agent:mint", event);
    minted.push(event.returnValue);
  }
  assert.deepEqual(minted, [1, 2, 3]);
});
