// The agent service's half in the main process (Design/PORT_AGENT.md): the endpoint an agent's
// relay connects to, and the page's way to files by path.
//
// Everything that is logic — MCP, the tools — runs in the page, where the documents and the
// parsers are. This knows no message: it listens on the endpoint while the page says the service
// is on, gives each connection an id, and copies bytes between the connection and the page.
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { endpoint, isPipe } = require("./agent-endpoint.cjs");

/** The most one read of a file by path returns. */
const MAX_READ = 16 * 1024 * 1024;
/** The most entries one listing returns. */
const MAX_ENTRIES = 5000;

/** `~/` is the home folder. */
const expand = (given) => {
  const text = String(given);
  return text === "~" || text.startsWith("~/") || text.startsWith("~\\")
    ? path.join(os.homedir(), text.slice(1))
    : text;
};

/** The relay the clients are told to launch: next to this file, outside the archive in a packaged build. */
function relayScript(app) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "relay.cjs")
    : path.join(__dirname, "relay.cjs");
}

/**
 * @param ipcMain Electron's
 * @param fromApp whether an IPC message came from the app's own page
 * @param app Electron's
 */
function register(ipcMain, fromApp, app) {
  let server;
  let address;
  let page;
  let enabled = false;
  const connections = new Map();
  let nextId = 1;

  function dropConnections() {
    for (const socket of connections.values()) socket.destroy();
    connections.clear();
  }

  function stop() {
    enabled = false;
    dropConnections();
    if (server !== undefined) {
      server.close();
      server = undefined;
    }
    if (address !== undefined && !isPipe(address)) {
      try {
        fs.unlinkSync(address);
      } catch {
        // Gone already, or never made.
      }
    }
    address = undefined;
  }

  function adopt(socket) {
    if (page === undefined || page.isDestroyed()) {
      socket.destroy();
      return;
    }
    const id = nextId++;
    connections.set(id, socket);
    page.send("agent:connection", id);
    socket.on("data", (chunk) => {
      if (!page.isDestroyed()) page.send("agent:data", id, new Uint8Array(chunk));
    });
    const gone = () => {
      if (connections.delete(id) && !page.isDestroyed()) page.send("agent:close", id);
    };
    socket.on("close", gone);
    socket.on("error", gone);
  }

  /** Whether something already answers at a socket's path — another copy of the app. */
  function answers(where) {
    return new Promise((resolve) => {
      const probe = net.connect(where);
      probe.once("connect", () => {
        probe.destroy();
        resolve(true);
      });
      probe.once("error", () => resolve(false));
    });
  }

  async function start(sender) {
    if (server !== undefined) return { ok: true, endpoint: address };
    const where = endpoint();
    if (!isPipe(where)) {
      fs.mkdirSync(path.dirname(where), { recursive: true, mode: 0o700 });
      if (fs.existsSync(where)) {
        if (await answers(where)) {
          return { ok: false, error: "Another copy of ByteRipper holds the agent endpoint." };
        }
        // A socket nobody answers on is a copy that went without cleaning up.
        fs.unlinkSync(where);
      }
    }
    return new Promise((resolve) => {
      const listening = net.createServer(adopt);
      listening.once("error", (error) =>
        resolve({ ok: false, error: String(error.message ?? error) })
      );
      listening.listen(where, () => {
        if (!isPipe(where)) {
          try {
            fs.chmodSync(where, 0o600);
          } catch {
            // The folder is the account's own already (0700).
          }
        }
        server = listening;
        address = where;
        page = sender;
        enabled = true;
        listening.on("error", () => undefined);
        sender.once("destroyed", stop);
        resolve({ ok: true, endpoint: where });
      });
    });
  }

  // The switch: the page says whether the service is on, and is told whether the endpoint opened.
  ipcMain.handle("agent:enable", async (event, on) => {
    if (!fromApp(event)) return { ok: false, error: "Not the app's page." };
    if (on === true) return start(event.sender);
    stop();
    return { ok: true };
  });

  ipcMain.on("agent:send", (event, id, bytes) => {
    if (!fromApp(event)) return;
    connections.get(id)?.write(Buffer.from(bytes));
  });
  ipcMain.on("agent:end", (event, id) => {
    if (!fromApp(event)) return;
    connections.get(id)?.end();
  });

  // What a client is configured with: the app's own executable run as Node, over the relay.
  ipcMain.handle("agent:info", (event) => {
    if (!fromApp(event)) return undefined;
    return {
      endpoint: endpoint(),
      command: process.execPath,
      script: relayScript(app),
      environment: { ELECTRON_RUN_AS_NODE: "1" },
      platform: process.platform,
    };
  });

  // Files by path: what `open_dump`, `show` and `survey` read. Only while the service is on, and
  // only for the page: a switched-off service reads nothing of the machine's.
  ipcMain.handle("agent:file", async (event, request) => {
    if (!fromApp(event)) throw new Error("Not the app's page.");
    if (!enabled) throw new Error("The agent service is off.");
    const file = expand(request.path);
    if (!path.isAbsolute(file)) throw new Error("A path must be absolute, or start with ~/.");
    switch (request.op) {
      case "stat": {
        const stat = await fs.promises.stat(file);
        return {
          path: file,
          size: stat.size,
          modified: stat.mtimeMs,
          isDirectory: stat.isDirectory(),
        };
      }
      case "list": {
        const found = [];
        const walk = async (folder) => {
          for (const entry of await fs.promises.readdir(folder, { withFileTypes: true })) {
            if (found.length >= MAX_ENTRIES) return;
            const full = path.join(folder, entry.name);
            if (entry.isDirectory()) {
              if (request.recursive === true) await walk(full);
              continue;
            }
            if (entry.isFile()) found.push(full);
          }
        };
        await walk(file);
        return { files: found, truncated: found.length >= MAX_ENTRIES };
      }
      case "read": {
        const length = Math.min(Number(request.length), MAX_READ);
        const handle = await fs.promises.open(file, "r");
        try {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await handle.read(buffer, 0, length, Number(request.offset));
          return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead);
        } finally {
          await handle.close();
        }
      }
      default:
        throw new Error(`Unknown file request: ${request.op}`);
    }
  });

  app.on("will-quit", stop);
}

module.exports = { register, expand };
