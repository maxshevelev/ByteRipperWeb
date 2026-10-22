// Projects on disk (Design/DESKTOP_WINDOWS.md, D3): the folder, what it holds, and the fence a
// page's key cannot get past.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const projects = require("../projects.cjs");

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "byteripper-projects-"));
const workspace = (name) => ({ version: 1, tab: { panes: [], name } });

test("a project holds every window, front to back, and is read back as it was written", () => {
  const folder = path.join(temporary(), "Job.brw");
  fs.mkdirSync(folder);
  const windows = [
    { id: "w-front", frame: { x: 1, y: 2, width: 3, height: 4 }, workspace: workspace("front") },
    { id: "w-back", workspace: workspace("back") },
  ];
  assert.equal(projects.write(folder, windows), true);
  assert.equal(projects.write(folder, windows), false, "an identical project is not written again");
  assert.deepEqual(projects.read(folder), windows);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, "Project.json"), "utf8")).version, 2);
});

test("a project written when it held one window comes back as that window", () => {
  const folder = temporary();
  fs.writeFileSync(path.join(folder, "Project.json"), JSON.stringify(workspace("one")));
  assert.deepEqual(projects.read(folder), [{ workspace: workspace("one") }]);
});

test("a folder with no project, or one of another version, reads as nothing", () => {
  const folder = temporary();
  assert.equal(projects.read(folder), undefined);
  fs.writeFileSync(path.join(folder, "Project.json"), JSON.stringify({ version: 9, windows: [] }));
  assert.equal(projects.read(folder), undefined);
});

// Upstream: ProjectTests — Open Project… takes a project folder, or a folder holding exactly one.
test("a folder picked to open is the project, or the one project inside it", () => {
  const job = temporary();
  const inside = path.join(job, "A.brw");
  fs.mkdirSync(inside);
  projects.write(inside, []);
  assert.equal(projects.locate(inside), inside);
  assert.equal(projects.locate(job), inside);
  fs.mkdirSync(path.join(job, "B.brw"));
  assert.equal(projects.locate(job), undefined, "two project folders name none");
});

test("a project saved into a job's folder gets a .brw of its own there", () => {
  const job = temporary();
  fs.writeFileSync(path.join(job, "bios.bin"), "x");
  const folder = projects.prepare(job, "Project");
  assert.equal(folder, path.join(job, "Project.brw"));
  fs.writeFileSync(path.join(folder, "marker"), "");
  assert.equal(projects.prepare(job, "Project"), path.join(job, "Project 2.brw"));
});

test("a project saved over another replaces it; an empty or .brw folder is used as it is", () => {
  const old = temporary();
  projects.write(old, [{ workspace: workspace("old") }]);
  projects.writeLog(old, "d-1.bin", 0, new Uint8Array([1]));
  assert.equal(projects.prepare(old, "Project"), old);
  assert.equal(projects.holdsProject(old), false);
  assert.equal(fs.existsSync(path.join(old, "Kept", "d-1.bin")), false);
  const empty = temporary();
  assert.equal(projects.prepare(empty, "Project"), empty);
  const named = path.join(temporary(), "New.brw");
  assert.equal(projects.prepare(named, "Project"), named);
  assert.equal(fs.existsSync(named), true);
});

test("a name that could leave the folder is refused", () => {
  const folder = temporary();
  for (const name of ["../escape.log", "a/b.log", "", "..", `${"x".repeat(200)}.log`, "d.json"]) {
    assert.throws(() => projects.writeLog(folder, name, 0, new Uint8Array([1])));
  }
  assert.equal(fs.existsSync(path.join(path.dirname(folder), "escape.log")), false);
});

// Upstream: RecentProjectsStoreTests.
test("the recent projects are newest first, ten at most, and Clear Menu empties them", () => {
  const file = path.join(temporary(), "Recent.json");
  const recent = projects.recentStore(() => file);
  for (let i = 0; i < 12; i++) recent.record(`/jobs/${i}.brw`);
  recent.record("/jobs/3.brw");
  const list = recent.list();
  assert.equal(list.length, 10);
  assert.deepEqual(list[0], { path: "/jobs/3.brw", name: "3" });
  assert.equal(list[1].path, "/jobs/11.brw");
  assert.equal(recent.has("/jobs/3.brw"), true);
  recent.clear();
  assert.deepEqual(recent.list(), []);
});

test("a kept document's files are written where they are told, read back, cut back and fenced in", () => {
  const folder = temporary();
  projects.writeLog(folder, "d1.log", 0, Uint8Array.of(1, 2, 3, 4));
  projects.writeLog(folder, "d1.log", 4, Uint8Array.of(5, 6));
  assert.deepEqual([...projects.readLog(folder, "d1.log", 2, 4)], [3, 4, 5, 6]);
  projects.syncLog(folder, "d1.log");

  // A pinned length cuts off what came after it, and appending goes on from there.
  projects.truncateLog(folder, "d1.log", 3);
  projects.writeLog(folder, "d1.log", 3, Uint8Array.of(9));
  assert.deepEqual([...projects.readLog(folder, "d1.log", 0, 4)], [1, 2, 3, 9]);
  assert.throws(() => projects.readLog(folder, "d1.log", 2, 8), "past the end is not read");

  assert.throws(() => projects.writeLog(folder, "../escape.log", 0, Uint8Array.of(1)));
  assert.throws(() => projects.writeLog(folder, "d1.json", 0, Uint8Array.of(1)));
  assert.equal(fs.existsSync(path.join(folder, "Kept", "d1.log")), true);

  // A file no window names any more goes; so does what the format before this one kept.
  projects.writeLog(folder, "d2.bin", 0, Uint8Array.of(7));
  fs.mkdirSync(path.join(folder, "Edits"));
  fs.writeFileSync(path.join(folder, "Edits", "d2.bin"), "old");
  projects.removeKeptExcept(folder, new Set(["d2.bin"]));
  assert.deepEqual(fs.readdirSync(path.join(folder, "Kept")), ["d2.bin"]);
  assert.deepEqual(fs.readdirSync(path.join(folder, "Edits")), []);
});
