// What the relay promises a client, and the reason the promise is worth a test: **it outlives the
// app it talks to** (upstream's `ByteRipperTests/AgentRelayTests.swift`, 5efe8b1f, d2461188,
// eb35f9ef). A client starts the relay once and keeps it for the whole conversation, and the app
// may be quit and opened again in the middle of one. So: the process stays, it answers with the
// reason while there is no app, it attaches to an app that appears, and it attaches again after
// that app goes and comes back. Driven against a stand-in app over an endpoint of the test's own.
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { NOT_STARTED_MESSAGE } = require("../agent-endpoint.cjs");
const { runsFromTemporaryFolder } = require("../relay.cjs");

const RELAY = path.join(__dirname, "..", "relay.cjs");

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "byteripper-relay-"));
const addressIn = (folder) =>
  process.platform === "win32"
    ? `\\\\.\\pipe\\ByteRipper-test-${path.basename(folder)}`
    : path.join(folder, "agent.sock");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for something the relay brings about, and says what did not happen when it does not. */
async function waitUntil(why, condition, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (!condition() && Date.now() < deadline) await sleep(20);
  assert.ok(condition(), why);
}

/** The relay, run as a client runs it, with the client's side of its stdin and stdout. */
function startRelay(where, environment = {}) {
  const relay = spawn(process.execPath, [RELAY], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      BYTERIPPER_AGENT_SOCKET: where,
      // Never the launch switch unless a test asks: the relay must not open an app.
      BYTERIPPER_LAUNCH: "0",
      ...environment,
    },
    stdio: ["pipe", "pipe", "ignore"],
  });
  relay.stdin.on("error", () => undefined);
  let exited = false;
  relay.once("exit", () => {
    exited = true;
  });
  const lines = [];
  let held = "";
  relay.stdout.setEncoding("utf8");
  relay.stdout.on("data", (chunk) => {
    held += chunk;
    let newline = held.indexOf("\n");
    while (newline >= 0) {
      lines.push(JSON.parse(held.slice(0, newline)));
      held = held.slice(newline + 1);
      newline = held.indexOf("\n");
    }
  });
  return {
    send: (id) => relay.stdin.write(`{"jsonrpc":"2.0","id":${id},"method":"tools/list"}\n`),
    /** The next line the relay writes, or undefined when it writes none in time. */
    async answer(timeout = 10_000) {
      await waitUntil("the relay answers", () => lines.length > 0, timeout).catch(() => undefined);
      return lines.shift();
    },
    get isRunning() {
      return !exited;
    },
    async stop() {
      relay.stdin.end();
      if (!exited) await new Promise((resolve) => relay.once("exit", resolve));
    },
  };
}

const reason = (answer) => answer?.error?.message;

/**
 * A stand-in for the app: it listens where the app would, collects what arrives, answers when
 * told to, and can quit — which closes the connection the relay is attached to, as the app's exit
 * closes its own. It stops listening before it hangs up, as `agent.cjs`'s `stop()` does, and
 * closes at once a connection taken after it quit (eb35f9ef).
 */
async function fakeApp(where) {
  let connection;
  let received = "";
  let hasQuit = false;
  const server = net.createServer((socket) => {
    if (hasQuit) {
      socket.destroy();
      return;
    }
    connection = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      received += chunk;
    });
    socket.on("error", () => undefined);
  });
  await new Promise((resolve) => server.listen(where, resolve));
  return {
    get isConnected() {
      return connection !== undefined;
    },
    get received() {
      return received;
    },
    answer: (text) => connection?.write(text),
    async quit() {
      hasQuit = true;
      await new Promise((resolve) => {
        server.close(resolve);
        connection?.destroy();
      });
      connection = undefined;
    },
  };
}

// @upstream ByteRipperTests/AgentRelayTests.swift#AgentRelayTests.testWithNoAppEveryRequestIsAnsweredWithTheReason
test("with no app every request is answered with the reason, and the relay stays", async () => {
  const folder = temporary();
  const relay = startRelay(addressIn(folder));
  try {
    relay.send(1);
    assert.equal(reason(await relay.answer()), NOT_STARTED_MESSAGE);
    relay.send(2);
    assert.equal(reason(await relay.answer()), NOT_STARTED_MESSAGE);
    assert.equal(relay.isRunning, true, "the relay stays for the client");
  } finally {
    await relay.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// @upstream ByteRipperTests/AgentRelayTests.swift#AgentRelayTests.testTheRelayAttachesToAnAppThatComesAndGoes
test("the relay attaches to an app that comes and goes", async () => {
  const folder = temporary();
  const where = addressIn(folder);
  const relay = startRelay(where);
  try {
    relay.send(1);
    assert.equal(reason(await relay.answer()), NOT_STARTED_MESSAGE);

    const app = await fakeApp(where);
    await waitUntil("the relay attaches to the app that appeared", () => app.isConnected);
    relay.send(2);
    await waitUntil("the request reached the app the relay attached to", () =>
      app.received.includes('"id":2')
    );
    app.answer('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}\n');
    assert.deepEqual(
      (await relay.answer())?.result,
      { tools: [] },
      "the app's answer reached the client"
    );

    // The app quits, and the client is told — not left waiting.
    await app.quit();
    let told;
    const gone = Date.now() + 10_000;
    while (told !== NOT_STARTED_MESSAGE && Date.now() < gone) {
      relay.send(3);
      told = reason(await relay.answer(2_000));
    }
    assert.equal(
      told,
      NOT_STARTED_MESSAGE,
      "with the app gone the client is told, not left waiting"
    );
    assert.equal(relay.isRunning, true, "the relay is still the client's server");

    // It comes back, and so does the conversation.
    const again = await fakeApp(where);
    await waitUntil("the relay attaches to the app that came back", () => again.isConnected);
    relay.send(4);
    await waitUntil("and the request reaches it", () => again.received.includes('"id":4'));
    await again.quit();
  } finally {
    await relay.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// @upstream ByteRipperTests/AgentRelayTests.swift#AgentRelayTests.testARequestInFlightWhenTheAppQuitsIsAnswered
test("a request in flight when the app quits is answered with the reason", async () => {
  const folder = temporary();
  const where = addressIn(folder);
  const app = await fakeApp(where);
  const relay = startRelay(where);
  try {
    await waitUntil("the relay attaches to the app", () => app.isConnected);
    relay.send(7);
    await waitUntil("the request reached the app", () => app.received.includes('"id":7'));

    await app.quit();
    const answer = await relay.answer();
    assert.equal(answer?.id, 7, "the request the app took is the one answered");
    assert.equal(reason(answer), NOT_STARTED_MESSAGE);
  } finally {
    await relay.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

/** An "app" that records each start in a file, for a relay told to start it (`BYTERIPPER_APP`). */
function recordingLauncher(folder) {
  const record = path.join(folder, "launches");
  const launcher = path.join(folder, "launch-app");
  fs.writeFileSync(launcher, `#!/bin/sh\necho launched >> "${record}"\n`, { mode: 0o755 });
  return {
    launcher,
    get launches() {
      return fs.existsSync(record)
        ? fs.readFileSync(record, "utf8").split("\n").filter(Boolean).length
        : 0;
    },
  };
}

// 5efe8b1f: "The app is still launched at most once, on the relay's first look". The first look
// starts the app, and the relay attaches when it comes up.
test("the relay's first look starts the app, and the relay attaches when it comes up", {
  skip: process.platform === "win32" && "a shell script stands in for the app",
}, async () => {
  const folder = temporary();
  const where = addressIn(folder);
  const started = recordingLauncher(folder);
  const relay = startRelay(where, { BYTERIPPER_LAUNCH: "1", BYTERIPPER_APP: started.launcher });
  let app;
  try {
    await waitUntil("the relay starts the app", () => started.launches === 1);
    app = await fakeApp(where);
    await waitUntil("the relay attaches to the app it started", () => app.isConnected);
    relay.send(1);
    await waitUntil("the request reaches it", () => app.received.includes('"id":1'));
    assert.equal(started.launches, 1);
  } finally {
    await app?.quit();
    await relay.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// @upstream-differs upstream's relay sets `hasLaunched` only when it starts the app, so one whose
// first look found the app open starts it again once the person quits it; the first look is the
// only one here, whatever it found.
test("an app the person quits is not started again by the relay", {
  skip: process.platform === "win32" && "a shell script stands in for the app",
}, async () => {
  const folder = temporary();
  const where = addressIn(folder);
  const started = recordingLauncher(folder);
  const app = await fakeApp(where);
  const relay = startRelay(where, { BYTERIPPER_LAUNCH: "1", BYTERIPPER_APP: started.launcher });
  try {
    await waitUntil("the relay attaches to the open app", () => app.isConnected);
    await app.quit();
    relay.send(1);
    assert.equal(reason(await relay.answer())?.includes("not running"), true);
    await sleep(1_000);
    assert.equal(started.launches, 0, "the person quit it; the relay does not open it again");
  } finally {
    await relay.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

// The portable `.exe` unpacks the app into the temporary folder and removes it when the app quits;
// a relay running from there ends with the app instead of holding the folder open.
test("a relay running from the temporary folder is known as one", () => {
  const temp = os.tmpdir();
  assert.equal(runsFromTemporaryFolder(path.join(temp, "2kq9x", "ByteRipper.exe"), temp), true);
  assert.equal(
    runsFromTemporaryFolder(path.join(temp, "ByteRipper.exe"), path.join(temp, "x")),
    false
  );
  assert.equal(runsFromTemporaryFolder(process.execPath, path.join(temp, "elsewhere")), false);
});

test("a relay running from the temporary folder ends with the app", async () => {
  const folder = temporary();
  const where = addressIn(folder);
  const app = await fakeApp(where);
  // The relay's runtime seen as a portable build's: its folder inside the temporary folder.
  const above = path.dirname(path.dirname(process.execPath));
  const relay = startRelay(where, { TMPDIR: above, TEMP: above, TMP: above });
  try {
    await waitUntil("the relay attaches to the app", () => app.isConnected);
    await app.quit();
    await waitUntil("the relay ends with the app", () => !relay.isRunning);
  } finally {
    await relay.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
