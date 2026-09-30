// Replacing the program with a newer build of itself.
//
// The page asks (File ▸ Check for Update…, after it has compared versions and
// the reader has said yes); this does the part a page cannot: fetch the
// release's setup, check it, and run it once the window has closed.
//
// What it trusts, and what it does not. It never takes a URL from the page — it
// is given a version, and asks github.com for that release itself, and only
// downloads from this repository's own release files. The setup is checked
// against the release's `SHA256SUMS`, which catches a corrupt or truncated
// download; it is not a signature, and the build is not signed (Windows
// SmartScreen may say so).
//
// Only an installed build can be replaced: a portable `.exe` unpacks to a
// temporary folder and an unpacked `.zip` was never installed, so for those the
// page opens the release's page instead.
const { app, net } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const RELEASE_BY_TAG = "https://api.github.com/repos/maxshevelev/ByteRipperWeb/releases/tags/";
const DOWNLOADS = "https://github.com/maxshevelev/ByteRipperWeb/releases/download/";

/** Whether this is an installed build, which the setup can be run over. */
function canInstall() {
  return (
    app.isPackaged &&
    !process.env.PORTABLE_EXECUTABLE_FILE &&
    fs.existsSync(path.join(path.dirname(process.execPath), "Uninstall ByteRipper.exe"))
  );
}

/** The setup to run when the app has quit, once one is downloaded and checked. */
let pending;
/** Answers the page's request when the reader keeps the window open instead. */
let cancelRequest;

class Failure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

async function fetchOk(url, what) {
  const response = await net.fetch(url, { headers: { "User-Agent": "ByteRipper" } });
  if (!response.ok) throw new Failure(what);
  return response;
}

/** The `hash  name` line of a SHA256SUMS file for `name`. */
function expectedHash(sums, name) {
  for (const line of sums.split(/\r?\n/)) {
    const found = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (found !== null && found[2] === name) return found[1].toLowerCase();
  }
  return undefined;
}

async function download(version, window) {
  let release;
  try {
    release = await (await fetchOk(`${RELEASE_BY_TAG}v${version}`, "download")).json();
  } catch {
    throw new Failure("download");
  }
  const setupName = `ByteRipper-${version}-setup.exe`;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const setup = assets.find((one) => one.name === setupName);
  const sums = assets.find((one) => one.name === "SHA256SUMS");
  if (!setup || !sums) throw new Failure("unavailable");
  for (const one of [setup, sums]) {
    if (
      typeof one.browser_download_url !== "string" ||
      !one.browser_download_url.startsWith(DOWNLOADS)
    ) {
      throw new Failure("unavailable");
    }
  }

  let expected;
  try {
    expected = expectedHash(
      await (await fetchOk(sums.browser_download_url, "download")).text(),
      setupName
    );
  } catch {
    throw new Failure("download");
  }
  if (expected === undefined) throw new Failure("checksum");

  const folder = path.join(app.getPath("temp"), "ByteRipper-update");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, setupName);
  const hash = crypto.createHash("sha256");
  try {
    const response = await fetchOk(setup.browser_download_url, "download");
    const total = Number(response.headers.get("content-length")) || setup.size || 0;
    const out = fs.createWriteStream(file);
    let received = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(value)) await new Promise((resolve) => out.once("drain", resolve));
      if (total > 0) window.setProgressBar(Math.min(1, received / total));
    }
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
  } catch {
    throw new Failure("download");
  } finally {
    window.setProgressBar(-1);
  }
  if (hash.digest("hex") !== expected) {
    fs.rmSync(folder, { recursive: true, force: true });
    throw new Failure("checksum");
  }
  return file;
}

/** The reader kept the window open: the setup is not to run at some later quit. */
function stayed() {
  pending = undefined;
  cancelRequest?.({ status: "cancelled" });
  cancelRequest = undefined;
}

/**
 * @param ipcMain Electron's
 * @param BrowserWindow Electron's
 */
function register(ipcMain, BrowserWindow) {
  ipcMain.on("update:installable", (event) => {
    event.returnValue = canInstall();
  });

  ipcMain.handle("update:install", async (event, version) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!canInstall() || !window || !/^\d+(\.\d+)*(-\d+)?$/.test(String(version))) {
      return { status: "failed", reason: "unavailable" };
    }
    try {
      pending = await download(String(version), window);
    } catch (error) {
      return { status: "failed", reason: error.reason ?? "download" };
    }
    // The window closes as its ✕ would: unsaved work is asked about on the way
    // out, and if the answer is to stay, `stayed()` answers for us. Otherwise
    // the app quits and the setup runs, and this never answers.
    return new Promise((resolve) => {
      cancelRequest = resolve;
      window.close();
    });
  });

  // Once the last window has gone. Silent, and told to start the app again — as
  // the installer's own updater does: `--updated` says this is an upgrade.
  app.on("quit", () => {
    if (pending === undefined) return;
    spawn(pending, ["/S", "--updated", "--force-run"], { detached: true, stdio: "ignore" }).unref();
  });
}

module.exports = { register, stayed };
