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
const { endpoint, isPipe } = require("../agent-endpoint.cjs");

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
