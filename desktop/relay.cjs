// byteripper-mcp — what an agent's client launches to reach ByteRipper.
//
// The client speaks MCP over this process's stdin and stdout. The app speaks it on a named
// pipe (Windows) or a socket (`agent-endpoint.cjs`). This copies bytes between the two and
// does nothing else: it parses no message except when there is no app to pass it to, and
// then only to say so (Design/PORT_AGENT.md).
//
// It is run by the app's own executable as Node — `ELECTRON_RUN_AS_NODE=1 ByteRipper.exe
// relay.cjs` — so it is always the relay of the app beside it: the same build, the same
// endpoint.
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { endpoint, UNAVAILABLE_MESSAGE } = require("./agent-endpoint.cjs");

/** How long to wait for the app's endpoint after launching the app. */
const LAUNCH_WAIT_MS = 10_000;
const RETRY_MS = 250;

const address = endpoint();

/** The app's own executable, when this relay was shipped with one: the app in its folder, or what the client was told. */
function appExecutable() {
  if (process.env.BYTERIPPER_APP) return process.env.BYTERIPPER_APP;
  return /^byteripper/i.test(path.basename(process.execPath)) ? process.execPath : undefined;
}

/** Starts the app in the background, so a client launched before the app still finds it. Whether its agent service is switched on is the app's setting; if it is off, the endpoint never appears and the client is told. */
function launchApp() {
  const executable = appExecutable();
  if (executable === undefined) return false;
  const env = { ...process.env };
  // This process is the app run as Node; the app it starts must not be.
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    spawn(executable, [], { detached: true, stdio: "ignore", env }).unref();
    return true;
  } catch {
    return false;
  }
}

function tryConnect() {
  return new Promise((resolve) => {
    const socket = net.connect(address);
    socket.once("connect", () => {
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(undefined);
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const first = await tryConnect();
  if (first !== undefined) return first;
  if (!launchApp()) return undefined;
  const deadline = Date.now() + LAUNCH_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(RETRY_MS);
    const socket = await tryConnect();
    if (socket !== undefined) return socket;
  }
  return undefined;
}

/** With no app to talk to, every request is answered with the reason, so the client shows the person something they can act on instead of a timeout. */
function answerUnavailable() {
  let pending = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    pending += chunk;
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message === null || typeof message !== "object" || message.method === undefined) continue;
      if (message.id === undefined || message.id === null) continue;
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32603, message: UNAVAILABLE_MESSAGE } })}\n`
      );
    }
  });
  process.stdin.on("end", () => process.exit(0));
}

connect().then((socket) => {
  if (socket === undefined) {
    process.stderr.write(`${UNAVAILABLE_MESSAGE}\n`);
    answerUnavailable();
    return;
  }
  // The client's requests to the app. When the client closes stdin it is done with this
  // server, and so is the relay.
  process.stdin.on("data", (chunk) => socket.write(chunk));
  process.stdin.on("end", () => {
    socket.end();
    process.exit(0);
  });
  // The app's answers to the client. When the app goes — it quit, or the switch was turned
  // off — the relay ends, and the client starts it again when it next needs it, as the
  // protocol has it do for a server that exits.
  socket.on("data", (chunk) => process.stdout.write(chunk));
  socket.on("close", () => process.exit(0));
  socket.on("error", () => process.exit(0));
});
