// Projects on disk (Design/DESKTOP_WINDOWS.md, D3): a `.brw` folder holding `Project.json` —
// every window of the app, front to back — and, only while there are any, the content of the
// documents it keeps in `Kept/`: each document's base and the log of its history
// (Design/PORT_WINDOW_07A3928_21A2889.md, P6). The main process writes it by path; a page never
// names a path to write, only a kept file's name under the project that is open, so the page's one
// way to the disk by path stops at that folder.
const fs = require("node:fs");
const path = require("node:path");

/** @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.fileName */
const FILE_NAME = "Project.json";
const UNTITLED = "Untitled";
const EDITS = "Edits";
/**
 * The undo journals of the documents the project keeps: one append-only log per document, which
 * its history writes as it is edited (`Design/PORT_WINDOW_07A3928_21A2889.md`, P5).
 *
 * @upstream ByteRipperApp/Workspace/ContentKeeper.swift#ContentKeeper.keptFolder
 */
const KEPT = "Kept";
/**
 * The format `Project.json` is written in: every window.
 *
 * @upstream Packages/Workspace/Sources/Workspace/Workspace.swift#Workspace.currentVersion
 */
const PROJECT_VERSION = 2;
/**
 * The oldest `Project.json` this build reads, the first a released build writes. Version 1, one
 * window's workspace, was written before projects were migrated, and is refused.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration.oldestReadable
 */
const OLDEST_PROJECT = 2;
/**
 * The steps from one version of `Project.json` to the next, by the version each reads, on the
 * file's JSON: one for every version from `OLDEST_PROJECT` up to `PROJECT_VERSION`.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration.steps
 */
const PROJECT_STEPS = {};
/**
 * The version of a window's workspace this build writes: `WORKSPACE_VERSION` in
 * `src/core/workspace/workspace.ts`, which a test keeps this level with. A window of a later one
 * makes the project a newer build's; one of an earlier is brought up by the page it opens in.
 */
const WORKSPACE_VERSION = 2;
/** @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.limit */
const RECENT_LIMIT = 10;

/**
 * Whether a folder's name says it is a project.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#URL.isByteRipperProject
 * @upstream-differs `.brw`, not upstream's `.brp`
 */
const isProjectFolderName = (name) => /\.brw$/i.test(name);

/** A project's name: its folder's, without `.brw`. */
const projectName = (folder) => path.basename(folder).replace(/\.brw$/i, "");

/** Writes `data` into `file` whole or not at all. */
function writeWhole(file, data) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, data);
  fs.renameSync(temporary, file);
}

const entries = (folder) => {
  try {
    return fs.readdirSync(folder);
  } catch {
    return [];
  }
};

/** Whether `folder` holds a project's workspace file. */
const holdsProject = (folder) => fs.existsSync(path.join(folder, FILE_NAME));

/**
 * The project a folder picked to open names: the folder itself when it holds one, or the one
 * project folder inside it; nothing otherwise.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#MainViewController.openProject
 */
function locate(picked) {
  if (holdsProject(picked)) return picked;
  const inside = entries(picked).filter(isProjectFolderName);
  return inside.length === 1 ? path.join(picked, inside[0]) : undefined;
}

/**
 * The folder a project chosen as `chosen` is kept in, made ready: that folder itself when it is a
 * project already — emptied: the person chose to replace it — or empty, missing, or named `.brw`;
 * otherwise, a folder of other things such as a job's, a `.brw` made inside it.
 *
 * @upstream ByteRipperApp/Workspace/AppDelegate+Projects.swift#AppDelegate.saveSession
 */
function prepare(chosen, fallbackName) {
  if (holdsProject(chosen)) {
    clear(chosen);
    return chosen;
  }
  const names = entries(chosen);
  if (!fs.existsSync(chosen) || names.length === 0 || isProjectFolderName(chosen)) {
    fs.mkdirSync(chosen, { recursive: true });
    return chosen;
  }
  let name = `${fallbackName}.brw`;
  for (let number = 2; names.includes(name); number++) name = `${fallbackName} ${number}.brw`;
  const inside = path.join(chosen, name);
  fs.mkdirSync(inside);
  return inside;
}

/**
 * The windows the project holds, front to back — each `{ id?, frame?, workspace }` — written by
 * this build or by an earlier one and migrated; or why there are none to read: `{ failure }`,
 * `unreadable`, `tooOld` or `newer` with the version that is.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.load
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceMigration.swift#WorkspaceMigration.migrate
 */
function load(folder) {
  const unreadable = { failure: { kind: "unreadable" } };
  let value;
  try {
    value = JSON.parse(fs.readFileSync(path.join(folder, FILE_NAME), "utf8"));
  } catch {
    return unreadable;
  }
  const version = value?.version;
  if (typeof version !== "number") return unreadable;
  if (version > PROJECT_VERSION) return { failure: { kind: "newer", version } };
  if (version < OLDEST_PROJECT) return { failure: { kind: "tooOld", version } };
  for (let from = version; from < PROJECT_VERSION; from++) {
    // A version with no step is a hole in the chain, not a file to guess at.
    const step = PROJECT_STEPS[from];
    if (step === undefined) return unreadable;
    try {
      step(value);
    } catch {
      return unreadable;
    }
    value.version = from + 1;
  }
  if (!Array.isArray(value.windows)) return unreadable;
  const windows = value.windows.filter((one) => one?.workspace !== undefined);
  // A window a newer build wrote cannot be read here, so neither can the project it is part of.
  const newest = Math.max(0, ...windows.map((one) => Number(one.workspace.version) || 0));
  if (newest > WORKSPACE_VERSION) return { failure: { kind: "newer", version: newest } };
  return { windows };
}

/**
 * The windows the project holds, or nothing when there are none it can read (`load` says why).
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.read
 */
function read(folder) {
  return load(folder).windows;
}

/** What was last written into each project, so an identical one is not written again. */
const lastWritten = new Map();

/**
 * Writes the windows into the project unless it already holds them. Indented: a person reading it
 * after a restore went wrong should be able to. Answers whether anything was written.
 *
 * @upstream Packages/Workspace/Sources/Workspace/WorkspaceFolder.swift#WorkspaceFolder.write
 */
function write(folder, windows) {
  const text = JSON.stringify({ version: PROJECT_VERSION, windows }, null, 2);
  if (lastWritten.get(folder) === text && holdsProject(folder)) return false;
  writeWhole(path.join(folder, FILE_NAME), text);
  lastWritten.set(folder, text);
  return true;
}

/**
 * A file the page keeps a document's content in, under `Kept/`: a log, a base written whole, or a
 * file's changes as runs — a name the page made, and nothing that could leave the folder.
 */
const isKeptName = (name) =>
  typeof name === "string" && /^[A-Za-z0-9_-]{1,100}\.(log|bin|edits)$/.test(name);

/** The kept file `name` names, under the project's `Kept/`. */
function logPath(folder, name) {
  if (!isKeptName(name)) throw new Error("Not a name the page makes.");
  return path.join(folder, KEPT, name);
}

/**
 * Writes `bytes` into the kept file `name` names at `at` — the end of what was written before, or a point
 * a pinned length cut it back to.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.appendRecord
 */
function writeLog(folder, name, at, bytes) {
  const file = logPath(folder, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(file, fs.existsSync(file) ? "r+" : "w");
  try {
    const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
    for (let done = 0; done < buffer.length; ) {
      done += fs.writeSync(fd, buffer, done, buffer.length - done, at + done);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.read */
function readLog(folder, name, at, count) {
  const fd = fs.openSync(logPath(folder, name), "r");
  try {
    const buffer = Buffer.alloc(count);
    for (let done = 0; done < count; ) {
      const read = fs.readSync(fd, buffer, done, count - done, at + done);
      if (read <= 0) throw new Error("The log is shorter than asked.");
      done += read;
    }
    return new Uint8Array(buffer.buffer, buffer.byteOffset, count);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Cuts the log back to `length`, as a manifest pinned it: what was written past it — after the
 * last manifest, before a crash — is not part of it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.init
 */
function truncateLog(folder, name, length) {
  const file = logPath(folder, name);
  if (fs.existsSync(file)) fs.truncateSync(file, length);
}

/**
 * Puts what was written into the log on the disk, before a manifest names it.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/UndoJournal.swift#UndoJournal.synchronize
 */
function syncLog(folder, name) {
  const file = logPath(folder, name);
  if (!fs.existsSync(file)) return;
  const fd = fs.openSync(file, "r+");
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** How long the kept file `name` is; nothing when there is none. */
function keptSize(folder, name) {
  try {
    return fs.statSync(logPath(folder, name)).size;
  } catch {
    return undefined;
  }
}

/**
 * Deletes what is kept of every document `keys` does not name: one saved, discarded or closed takes
 * its copy with it.
 */
function removeKeptExcept(folder, names) {
  for (const sub of [UNTITLED, EDITS, KEPT]) {
    const where = path.join(folder, sub);
    for (const name of entries(where)) {
      // `Untitled/` and `Edits/` are the format before the kept content's: nothing names them.
      if (sub !== KEPT || !names.has(name)) fs.rmSync(path.join(where, name), { force: true });
    }
  }
}

/** Empties a project's folder, for one written over it. */
function clear(folder) {
  for (const name of [FILE_NAME, UNTITLED, EDITS, KEPT]) {
    fs.rmSync(path.join(folder, name), { recursive: true, force: true });
  }
  lastWritten.delete(folder);
}

/**
 * The projects opened lately, newest first, kept beside the profile.
 *
 * @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore
 */
function recentStore(file) {
  const load = () => {
    try {
      const list = JSON.parse(fs.readFileSync(file(), "utf8"));
      return Array.isArray(list) ? list.filter((one) => typeof one?.path === "string") : [];
    } catch {
      return [];
    }
  };
  const save = (list) => {
    try {
      fs.mkdirSync(path.dirname(file()), { recursive: true });
      writeWhole(file(), JSON.stringify(list, null, 2));
    } catch {
      // A list that is not kept is a menu that starts empty.
    }
  };
  return {
    /** @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.recent */
    list: () => load().map((one) => ({ path: one.path, name: projectName(one.path) })),
    /** @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.record */
    record(folder) {
      save(
        [{ path: folder }, ...load().filter((one) => one.path !== folder)].slice(0, RECENT_LIMIT)
      );
    },
    /** @upstream ByteRipperApp/Workspace/RecentProjectsStore.swift#RecentProjectsStore.clear */
    clear: () => save([]),
    has: (folder) => load().some((one) => one.path === folder),
  };
}

module.exports = {
  FILE_NAME,
  PROJECT_VERSION,
  OLDEST_PROJECT,
  WORKSPACE_VERSION,
  isKeptName,
  isProjectFolderName,
  projectName,
  holdsProject,
  locate,
  prepare,
  load,
  read,
  write,
  removeKeptExcept,
  writeLog,
  readLog,
  truncateLog,
  syncLog,
  keptSize,
  clear,
  recentStore,
};
