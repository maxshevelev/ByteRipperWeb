// What electron-builder packs (`build.files` in package.json): every module the shell's own code
// requires by a relative path, or the packed app fails to start on the first `require`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const packed = new Set(require("../package.json").build.files);

test("every module the shell requires is packed", () => {
  const required = new Set();
  for (const name of fs.readdirSync(root).filter((one) => one.endsWith(".cjs"))) {
    if (!packed.has(name)) continue;
    const text = fs.readFileSync(path.join(root, name), "utf8");
    for (const match of text.matchAll(/require\("\.\/([^"]+\.cjs)"\)/g)) required.add(match[1]);
  }
  const missing = [...required].filter((one) => !packed.has(one));
  assert.deepEqual(missing, []);
});
