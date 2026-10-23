// The session host's disk (Design/FILE_SESSIONS.md, S7): what the host may name, and what it
// writes there.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const hostDisk = require("../hostDisk.cjs");

const profile = () => fs.mkdtempSync(path.join(os.tmpdir(), "byteripper-host-"));
const noProject = () => undefined;

test("a workspace's kept file is written under the profile and read back", () => {
  const userData = profile();
  const folder = { kind: "session", workspace: "w-1" };
  const ask = (request) => hostDisk.answer({ folder, ...request }, userData, noProject);
  ask({ op: "write", name: "d-1.log", at: 0, bytes: Uint8Array.of(1, 2, 3) });
  ask({ op: "write", name: "d-1.log", at: 3, bytes: Uint8Array.of(4) });
  assert.equal(ask({ op: "size", name: "d-1.log" }), 4);
  assert.deepEqual([...ask({ op: "read", name: "d-1.log", at: 1, count: 3 })], [2, 3, 4]);
  assert.ok(
    fs.existsSync(path.join(userData, "Workspace", "Windows", "kept-w-1", "Kept", "d-1.log"))
  );
  ask({ op: "removeExcept", names: [] });
  assert.equal(ask({ op: "size", name: "d-1.log" }), undefined);
});

test("nothing outside the folders it names is reached", () => {
  const userData = profile();
  const ask = (request) => () => hostDisk.answer(request, userData, noProject);
  assert.throws(ask({ folder: { kind: "session", workspace: "../x" }, op: "size", name: "a.log" }));
  assert.throws(
    ask({ folder: { kind: "session", workspace: "w" }, op: "read", name: "../a.log", count: 1 })
  );
  assert.throws(ask({ folder: { kind: "project", project: "/tmp" }, op: "size", name: "a.log" }));
  assert.throws(ask({ folder: { kind: "project", project: "/tmp" }, op: "remove" }));
});

test("the open project's kept files are its own", () => {
  const userData = profile();
  const project = path.join(profile(), "Job.brw");
  const ask = (request) =>
    hostDisk.answer({ folder: { kind: "project", project }, ...request }, userData, () => project);
  ask({ op: "write", name: "d-2.bin", at: 0, bytes: Uint8Array.of(9) });
  assert.ok(fs.existsSync(path.join(project, "Kept", "d-2.bin")));
});

test("the switch turned off forgets every workspace's kept folder but a newer build's", () => {
  const userData = profile();
  const write = (workspace) =>
    hostDisk.answer(
      {
        folder: { kind: "session", workspace },
        op: "write",
        name: "d-1.log",
        at: 0,
        bytes: Uint8Array.of(1),
      },
      userData,
      noProject
    );
  write("w-1");
  write("w-2");
  write("w-newer");
  hostDisk.answer(
    { folder: { kind: "session", workspace: "all" }, op: "removeAll", except: "w-newer" },
    userData,
    noProject
  );
  assert.deepEqual(fs.readdirSync(path.join(userData, "Workspace", "Windows")), ["kept-w-newer"]);
  hostDisk.answer(
    { folder: { kind: "session", workspace: "all" }, op: "removeAll" },
    userData,
    noProject
  );
  assert.deepEqual(fs.readdirSync(path.join(userData, "Workspace", "Windows")), []);
});
