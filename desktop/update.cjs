// Replacing the program with a newer build of itself.
//
// The page asks (File ▸ Check for Update…, after it has compared versions and
// the reader has said yes); this does the part a page cannot: fetch the
// release's setup, check it, and run it once the window has closed.
//
// What it trusts, and what it does not. It never takes a URL from the page — it
// is given a version, and builds that release's addresses itself, and only
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

/** The download the page can cancel; nothing while none is running. */
let abort;

async function fetchOk(url, what, signal) {
  const response = await net.fetch(url, { headers: { "User-Agent": "ByteRipper" }, signal });
  if (response.status === 404) throw new Failure("missing");
  if (!response.ok) throw new Failure(what);
  return response;
}

const LATEST_PAGE = "https://github.com/maxshevelev/ByteRipperWeb/releases/latest";

/**
 * The newest release's tag and page: the release page's own redirect
 * (`/releases/latest` answers 302 to `/releases/tag/<tag>`), read without
 * following it. It is a page of the site, not of the API, so it has no
 * allowance to spend and no cross-origin rule to pass — which is why this is the
 * shell's to ask and not the page's. A repository with no release redirects to
 * its list, and that is no release.
 */
function latestRelease() {
  // `net.request`, not `net.fetch`: fetch's "manual" redirect mode is refused
  // here ("Redirect was cancelled"), and the request's `redirect` event is what
  // hands over the address without going there.
  return new Promise((resolve, reject) => {
    const request = net.request({ url: LATEST_PAGE, redirect: "manual" });
    request.setHeader("User-Agent", "ByteRipper");
    request.on("redirect", (_status, _method, redirectUrl) => {
      request.abort();
      const page = new URL(redirectUrl, LATEST_PAGE).href;
      const tag = /\/releases\/tag\/([^/?#]+)$/.exec(page)?.[1];
      resolve(tag === undefined ? undefined : { tag: decodeURIComponent(tag), page });
    });
    request.on("response", (response) => {
      response.on("data", () => {});
      reject(new Failure(`answered ${response.statusCode}`));
    });
    request.on("error", reject);
    request.end();
  });
}

/** The `hash  name` line of a SHA256SUMS file for `name`. */
function expectedHash(sums, name) {
  for (const line of sums.split(/\r?\n/)) {
    const found = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line.trim());
    if (found !== null && found[2] === name) return found[1].toLowerCase();
  }
  return undefined;
}

/**
 * Fetches and checks the release's setup, telling the page how far it is:
 * `report({ phase, received?, total? })` — preparing, download, verify.
 */
async function download(version, window, report, signal) {
  report({ phase: "preparing" });
  // The release's files are at addresses its tag and its version fix, so there
  // is nothing to ask the API for — and the API's allowance (sixty requests an
  // hour for a network) is not spent on a download. A release with no such file
  // answers 404 here, which is the same "nothing to install" the listing gave.
  const setupName = `ByteRipper-${version}-setup.exe`;
  const setup = { url: `${DOWNLOADS}v${version}/${setupName}` };
  const sums = { url: `${DOWNLOADS}v${version}/SHA256SUMS` };

  let expected;
  try {
    expected = expectedHash(await (await fetchOk(sums.url, "download", signal)).text(), setupName);
  } catch (error) {
    if (error.reason === "missing") throw new Failure("unavailable");
    throw new Failure("download");
  }
  if (expected === undefined) throw new Failure("checksum");

  const folder = path.join(app.getPath("temp"), "ByteRipper-update");
  fs.rmSync(folder, { recursive: true, force: true });
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, setupName);
  const hash = crypto.createHash("sha256");
  try {
    const response = await fetchOk(setup.url, "download", signal);
    const total = Number(response.headers.get("content-length")) || 0;
    const out = fs.createWriteStream(file);
    let received = 0;
    let told = 0;
    report({ phase: "download", received, total });
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      received += value.length;
      if (!out.write(value)) await new Promise((resolve) => out.once("drain", resolve));
      // Ten times a second is as often as anyone reads it.
      if (Date.now() - told >= 100) {
        told = Date.now();
        report({ phase: "download", received, total });
        if (total > 0) window.setProgressBar(Math.min(1, received / total));
      }
    }
    report({ phase: "download", received, total });
    await new Promise((resolve, reject) => out.end((error) => (error ? reject(error) : resolve())));
  } catch {
    fs.rmSync(folder, { recursive: true, force: true });
    throw new Failure("download");
  } finally {
    window.setProgressBar(-1);
  }
  report({ phase: "verify" });
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

  ipcMain.on("update:cancel", () => abort?.abort());

  ipcMain.handle("update:latest", () => latestRelease());

  ipcMain.handle("update:install", async (event, version) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!canInstall() || !window || !/^\d+(\.\d+)*(-\d+)?$/.test(String(version))) {
      return { status: "failed", reason: "unavailable" };
    }
    const report = (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send("update:progress", progress);
    };
    abort = new AbortController();
    const signal = abort.signal;
    try {
      pending = await download(String(version), window, report, signal);
    } catch (error) {
      if (signal.aborted) return { status: "cancelled" };
      return { status: "failed", reason: error.reason ?? "download" };
    } finally {
      abort = undefined;
    }
    report({ phase: "install" });
    // The window closes as its ✕ would: unsaved work is asked about on the way
    // out, and if the answer is to stay, `stayed()` answers for us. Otherwise
    // the app quits and the setup runs, and this never answers.
    return new Promise((resolve) => {
      cancelRequest = resolve;
      window.close();
    });
  });

  // Once the last window has gone. The installer is not run silent: its own
  // window, with its own progress bar, is what says something is happening in
  // the seconds between this window closing and the new one opening — a silent
  // setup leaves nothing on the screen at all. It starts the app again when it
  // is done, and `--force-run` says so for a build that would not.
  app.on("quit", () => {
    if (pending === undefined) return;
    spawn(pending, ["--force-run"], { detached: true, stdio: "ignore" }).unref();
  });
}

module.exports = { register, stayed, latestRelease };
