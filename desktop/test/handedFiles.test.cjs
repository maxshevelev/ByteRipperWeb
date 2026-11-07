// Files the system hands the app: from the command line, and gathered into one batch.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathsOfCommandLine, handedFilesBatch } = require("../handedFiles.cjs");

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "handed-"));
const a = path.join(folder, "a.bin");
const b = path.join(folder, "b.bin");
fs.writeFileSync(a, Buffer.alloc(16));
fs.writeFileSync(b, Buffer.alloc(16));
test.after(() => fs.rmSync(folder, { recursive: true, force: true }));

test("a packaged launch names its files after the program", () => {
  assert.deepEqual(pathsOfCommandLine(["ByteRipper.exe", a, b], folder, true), [a, b]);
});

test("a development run names them after `electron .`", () => {
  assert.deepEqual(pathsOfCommandLine(["electron", ".", a], folder, false), [a]);
});

test("switches, folders, missing paths and repeats are left out; relative paths resolve", () => {
  const argv = ["ByteRipper.exe", "--allow-file-access-from-files", folder, "gone.bin", "a.bin", a];
  assert.deepEqual(pathsOfCommandLine(argv, folder, true), [a]);
});

// Upstream: HandedFilesBatchTests.testFilesHandedBackToBackOpenTogether.
test("files handed back to back open together, each once, in the order handed", async () => {
  const opened = [];
  const batch = handedFilesBatch((paths) => opened.push(paths), 30);
  batch.add([a]);
  batch.add([b]);
  batch.add([a]);
  assert.deepEqual(opened, [], "nothing opens while the files are still coming");
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(opened, [[a, b]]);
});

// Upstream: HandedFilesBatchTests.testFilesHandedApartOpenApart.
test("files handed apart open apart, and an empty batch opens nothing", () => {
  const opened = [];
  const batch = handedFilesBatch((paths) => opened.push(paths), 30);
  batch.add([a]);
  batch.flush();
  batch.add([b]);
  batch.flush();
  assert.deepEqual(opened, [[a], [b]]);
  batch.flush();
  assert.equal(opened.length, 2);
});
