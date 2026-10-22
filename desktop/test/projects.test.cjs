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
  projects.writeKept(old, "d-1", "untitled", new Uint8Array([1]));
  assert.equal(projects.prepare(old, "Project"), old);
  assert.equal(projects.holdsProject(old), false);
  assert.equal(projects.readKept(old, "d-1"), undefined);
  const empty = temporary();
  assert.equal(projects.prepare(empty, "Project"), empty);
  const named = path.join(temporary(), "New.brw");
  assert.equal(projects.prepare(named, "Project"), named);
  assert.equal(fs.existsSync(named), true);
});

test("kept bytes come back with their kind, and go when no window names them", () => {
  const folder = temporary();
  projects.writeKept(folder, "d-untitled", "untitled", new Uint8Array([1, 2]));
  projects.writeKept(folder, "d-edits", "edits", new Uint8Array([3]));
  assert.deepEqual(projects.readKept(folder, "d-untitled"), {
    kind: "untitled",
    bytes: new Uint8Array([1, 2]),
  });
  assert.equal(projects.readKept(folder, "d-edits").kind, "edits");
  // A document saved since: its key is a file's changes now, and only that.
  projects.writeKept(folder, "d-untitled", "edits", new Uint8Array([9]));
  assert.equal(projects.readKept(folder, "d-untitled").kind, "edits");
  projects.removeKeptExcept(folder, new Set(["d-edits"]));
  assert.equal(projects.readKept(folder, "d-untitled"), undefined);
  assert.equal(projects.readKept(folder, "d-edits").kind, "edits");
});

test("a key that could leave the folder is refused", () => {
  const folder = temporary();
  for (const key of ["../escape", "a/b", "", "..", "x".repeat(200)]) {
    assert.throws(() => projects.writeKept(folder, key, "untitled", new Uint8Array([1])));
    assert.equal(projects.readKept(folder, key), undefined);
  }
  assert.equal(fs.existsSync(path.join(path.dirname(folder), "escape.bin")), false);
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
