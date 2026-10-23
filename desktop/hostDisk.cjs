/**
 * The session host's disk in the shell (Design/FILE_SESSIONS.md, S7): the kept content of the
 * workspace and of the open project, written by this process for a host that runs in a
 * `SharedWorker`, where no preload reaches. A window's page asks for a port as it starts and hands
 * it to the host; the port outlives the window it came through.
 *
 * The host names a folder by what it is, never by a path: the workspace's kept folder of a window
 * (`kept-<id>`, under the profile), or the project the app has open, by the path the shell itself
 * opened it at.
 */
const fs = require("node:fs");
const path = require("node:path");
const projects = require("./projects.cjs");

const isFolderName = (name) => typeof name === "string" && /^kept-[A-Za-z0-9_-]{1,100}$/.test(name);

/**
 * The folder a request names, as projects.cjs writes one: its `Kept/` beneath.
 *
 * @param {{ kind: "session", workspace: string } | { kind: "project", project: string }} ref
 */
function folderOf(ref, userData, currentProject) {
  if (ref?.kind === "session") {
    const name = `kept-${ref.workspace}`;
    if (!isFolderName(name)) throw new Error("Not a workspace's kept folder.");
    return path.join(userData, "Workspace", "Windows", name);
  }
  if (ref?.kind === "project") {
    const open = currentProject();
    if (open === undefined || open !== ref.project) throw new Error("That project is not open.");
    return open;
  }
  throw new Error("Not a kept folder.");
}

/** Answers one request of the host. */
function answer(request, userData, currentProject) {
  const folder = folderOf(request.folder, userData, currentProject);
  const at = Number(request.at ?? 0);
  if (!Number.isSafeInteger(at) || at < 0) throw new Error("Not a place in a kept file.");
  switch (request.op) {
    case "write":
      if (!(request.bytes instanceof Uint8Array)) throw new Error("Not bytes.");
      return projects.writeLog(folder, request.name, at, request.bytes);
    case "read": {
      const count = Number(request.count);
      if (!Number.isSafeInteger(count) || count < 0 || count > 64 << 20) {
        throw new Error("Not a length to read.");
      }
      return projects.readLog(folder, request.name, at, count);
    }
    case "truncate":
      return projects.truncateLog(folder, request.name, at);
    case "sync":
      return projects.syncLog(folder, request.name);
    case "size":
      return projects.keptSize(folder, request.name);
    case "removeExcept": {
      const names = new Set((request.names ?? []).filter(projects.isKeptName));
      return projects.removeKeptExcept(folder, names);
    }
    case "remove":
      if (request.folder?.kind !== "session") throw new Error("Only a workspace's folder goes.");
      fs.rmSync(folder, { recursive: true, force: true });
      return undefined;
    case "removeAll": {
      // All but a newer build's session, which is that build's to keep.
      const windows = path.join(userData, "Workspace", "Windows");
      const keep = typeof request.except === "string" ? `kept-${request.except}` : undefined;
      for (const name of fs.existsSync(windows) ? fs.readdirSync(windows) : []) {
        if (name !== keep) fs.rmSync(path.join(windows, name), { recursive: true, force: true });
      }
      return undefined;
    }
    default:
      throw new Error(`Unknown kept request: ${request.op}`);
  }
}

/**
 * A port for the host: what it sends is answered here, one request at a time in the order it came.
 *
 * @param {import("electron").MessagePortMain} port
 */
function serve(port, userData, currentProject) {
  let queue = Promise.resolve();
  port.on("message", ({ data }) => {
    queue = queue.then(() => {
      try {
        const value = answer(data, userData, currentProject);
        port.postMessage({ id: data.id, value });
      } catch (error) {
        port.postMessage({
          id: data.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });
  port.start();
}

module.exports = { serve, folderOf, answer };
