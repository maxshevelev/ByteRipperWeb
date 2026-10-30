// byteripper-mcp — what an agent's client launches to reach ByteRipper.
// Upstream: ByteRipperRelay/main.swift.
//
// The client speaks MCP over this process's stdin and stdout. The app speaks it on a named
// pipe (Windows) or a socket (`agent-endpoint.cjs`). This copies bytes between the two and
// does nothing else. It reads a message only for its `id`: to answer for the app when there is
// no app to pass it to, and to know which requests the app had not answered yet when it went
// (Design/PORT_AGENT.md).
//
// **It outlives the app.** A client starts this process once and keeps it for the whole
// conversation, and the app may be quit and opened again in the middle of one. So when the app
// goes the relay does not: it answers the client with the reason, waits, and attaches to the
// app again when it comes back. A client that does not restart a server which exited inside a
// session — Claude Code does not — then never loses it, and the person never registers the
// server a second time.
//
// It is run by the app's own executable as Node — `ELECTRON_RUN_AS_NODE=1 ByteRipper.exe
// relay.cjs` — so it is always the relay of the app beside it: the same build, the same
// endpoint. That is why the shell keeps no installed copy of it beside the endpoint, as
// upstream does (`AgentRelayInstall`): what a client runs is the app's whole runtime, and the
// path of an installed build stays the same across its updates.
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const {
  endpoint,
  launchesApp,
  NOT_STARTED_MESSAGE,
  UNAVAILABLE_MESSAGE,
} = require("./agent-endpoint.cjs");

/** How long to wait for the app's endpoint after launching the app. */
const LAUNCH_WAIT_MS = 10_000;
/** How often to look for an endpoint that is not there yet. */
const LOOK_EVERY_MS = 250;
/** The longest answer whose `id` is read; a longer one is still passed on whole. */
const MAX_ANSWER_BYTES = 64 << 20;
/** JSON-RPC's internal error, which upstream answers with too (`MCPProtocol.ErrorCode.internalError`). */
const INTERNAL_ERROR = -32603;

const address = endpoint();

/** The app's own executable, when this relay was shipped with one: the app in its folder, or what the client was told. */
function appExecutable() {
  if (process.env.BYTERIPPER_APP) return process.env.BYTERIPPER_APP;
  return /^byteripper/i.test(path.basename(process.execPath)) ? process.execPath : undefined;
}

/**
 * Whether this relay runs from a folder that goes when the app does: the portable `.exe` unpacks
 * the app into the temporary folder and removes it when the app quits. A relay still running from
 * there would hold the executable open, so the folder could not be removed — and the portable
 * `.exe` could not unpack itself over it the next time it is opened. Such a relay ends with the
 * app, as every relay did before upstream's 5efe8b1f.
 */
function runsFromTemporaryFolder(execPath = process.execPath, temporary = os.tmpdir()) {
  // The long, resolved form of both — a temporary folder is often named through a link or in
  // its short 8.3 form — taken from the nearest folder that is there.
  const real = (where) => {
    const absolute = path.resolve(where);
    const parent = path.dirname(absolute);
    try {
      return fs.realpathSync.native(absolute);
    } catch {
      return parent === absolute ? absolute : path.join(real(parent), path.basename(absolute));
    }
  };
  const folder = real(path.dirname(execPath));
  const temp = real(temporary);
  const relative = path.relative(
    process.platform === "win32" ? temp.toLowerCase() : temp,
    process.platform === "win32" ? folder.toLowerCase() : folder
  );
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/**
 * Starts the app in the background, so a client launched before the app still finds it. Whether
 * its agent service is switched on is the app's setting; if it is off, the endpoint never appears
 * and the client is told. Only under `BYTERIPPER_LAUNCH` (`LAUNCH_KEY`), which the person asks
 * for in Settings ▸ Agent: a client restarts its server as soon as the app quits, and the person
 * who quit it saw it come straight back.
 */
function launchApp(executable) {
  const env = { ...process.env };
  // This process is the app run as Node; the app it starts must not be.
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    spawn(executable, [], { detached: true, stdio: "ignore", env }).unref();
  } catch {
    // Nothing started: the client is told there is no app, as it is when there is none to start.
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

const launches = launchesApp();

/** Why there is nothing to talk to: the service is off — or, from a relay that does not start the app, the app may simply not be open. */
const unavailableMessage = launches ? UNAVAILABLE_MESSAGE : NOT_STARTED_MESSAGE;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The app's end of the conversation, undefined while there is no app to talk to. */
let upstream;

/**
 * Whether the next look is the relay's first. The app is started **once** in the relay's life, on
 * its first look: the promise the launch switch makes is "open ByteRipper when an agent connects",
 * and a person who quits ByteRipper does not want the server that is still running to open it
 * again a moment later. Upstream's `hasLaunched` is set only when it launches, so a relay whose
 * first look found the app open starts it again once the person quits it; here the first look
 * is the only one, whatever it found, as upstream's commit and design say it is.
 */
let firstLook = true;

/**
 * Looks for the app's endpoint and attaches to it; undefined when it is not there. The first look
 * is the one that may start the app, and the only one that waits for it to come up.
 */
async function attach() {
  const mayLaunch = firstLook;
  firstLook = false;
  const socket = await tryConnect();
  if (socket !== undefined) return socket;
  const executable = appExecutable();
  if (!launches || !mayLaunch || executable === undefined) return undefined;
  launchApp(executable);
  const deadline = Date.now() + LAUNCH_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(LOOK_EVERY_MS);
    const later = await tryConnect();
    if (later !== undefined) return later;
  }
  return undefined;
}

/**
 * The requests passed to the app and not answered yet, by their `id` as JSON. When the app goes,
 * each is answered with the reason: the app will never answer it, and a client would otherwise
 * wait out its own timeout.
 */
const pending = new Map();

/** A line's message, or undefined for a line that is not a JSON object. */
function messageOf(line) {
  try {
    const message = JSON.parse(line);
    return message !== null && typeof message === "object" && !Array.isArray(message)
      ? message
      : undefined;
  } catch {
    return undefined;
  }
}

/** The `id` of a request — a message with a method and an id — or undefined for a notification, an answer, or a line that is not JSON. */
function requestID(line) {
  const message = messageOf(line);
  if (message === undefined || message.method === undefined) return undefined;
  return message.id === undefined || message.id === null ? undefined : message.id;
}

/** The `id` an answer from the app carries: a message with an id and no method. */
function answeredID(line) {
  const message = messageOf(line);
  if (message === undefined || message.method !== undefined) return undefined;
  return message.id === undefined || message.id === null ? undefined : message.id;
}

/** Writes to the client; a client that has gone ends the relay, since the conversation is over. */
function writeToClient(data) {
  try {
    process.stdout.write(data);
  } catch {
    process.exit(0);
  }
}

/** The answer to one request when there is no app to pass it to: the reason, so the client shows the person something they can act on instead of a timeout. */
function answerUnavailable(id) {
  writeToClient(
    `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: INTERNAL_ERROR, message: unavailableMessage } })}\n`
  );
}

/** Splits a stream into its lines, keeping the unfinished one; one longer than `limit` is dropped, unread, up to its newline. */
function lineReader(onLine, limit = Infinity) {
  let held = Buffer.alloc(0);
  let skipping = false;
  return (chunk) => {
    let data = held.length === 0 ? chunk : Buffer.concat([held, chunk]);
    let newline = data.indexOf(0x0a);
    while (newline >= 0) {
      if (!skipping) onLine(data.subarray(0, newline));
      skipping = false;
      data = data.subarray(newline + 1);
      newline = data.indexOf(0x0a);
    }
    if (data.length > limit) {
      skipping = true;
      data = Buffer.alloc(0);
    }
    held = Buffer.from(data);
  };
}

/** Whether a relay that lost its app keeps waiting for it to come back, or ends with it. */
const outlivesTheApp = !runsFromTemporaryFolder();

/** Takes a socket as the app's end: its answers go to the client, and when it goes, the relay waits for the app again. */
function adopt(socket) {
  upstream = socket;
  // The answers go on as the bytes they came in; the lines are read only for their ids, to
  // strike them off `pending`.
  const answers = lineReader((line) => {
    const id = answeredID(line.toString("utf8"));
    if (id !== undefined) pending.delete(JSON.stringify(id));
  }, MAX_ANSWER_BYTES);
  socket.on("data", (chunk) => {
    answers(chunk);
    writeToClient(chunk);
  });
  socket.on("error", () => socket.destroy());
  socket.once("close", () => {
    // The app quit, or was switched off. The client is still there, and so are the requests the
    // app took and will now never answer.
    if (upstream === socket) upstream = undefined;
    const unanswered = [...pending.values()];
    pending.clear();
    for (const id of unanswered) answerUnavailable(id);
    if (!outlivesTheApp) {
      process.stdout.end(() => process.exit(0));
      return;
    }
    follow();
  });
}

/** Waits for the app to come back — for as long as the client keeps this relay. */
async function follow() {
  while (upstream === undefined) {
    const socket = await attach();
    if (socket !== undefined) {
      adopt(socket);
      return;
    }
    await sleep(LOOK_EVERY_MS);
  }
}

/** The client's requests. Attached, they go to the app as they are; detached, the client is told why. */
function serveClient() {
  const requests = lineReader((bytes) => {
    const line = bytes.toString("utf8");
    if (line.trim().length === 0) return;
    const id = requestID(line);
    if (upstream === undefined) {
      if (id !== undefined) answerUnavailable(id);
      return;
    }
    // On the list before it is written: if the app goes now, the socket's close answers it.
    if (id !== undefined) pending.set(JSON.stringify(id), id);
    upstream.write(Buffer.concat([bytes, Buffer.from("\n")]));
  });
  process.stdin.on("data", requests);
  // The client is done with this server, and so is the relay.
  process.stdin.on("end", () => {
    upstream?.end();
    process.exit(0);
  });
}

if (require.main === module) {
  // The first look happens before the client's first request is read: an `initialize` answered
  // with an error is a server a client may not come back to, and an app that is merely starting
  // is worth the wait. stdin holds the client's lines until it is read.
  process.stdout.on("error", () => process.exit(0));
  attach().then((socket) => {
    if (socket === undefined) {
      process.stderr.write(`${unavailableMessage}\n`);
      follow();
    } else {
      adopt(socket);
    }
    serveClient();
  });
}

module.exports = { runsFromTemporaryFolder, lineReader };
