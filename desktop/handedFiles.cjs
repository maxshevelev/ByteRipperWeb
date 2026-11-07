// Files the system hands the app (Design/DESKTOP_WINDOWS.md): dropped on its shortcut or its
// executable, double-clicked in Explorer when the app opens that type, or chosen with Open With.
// Windows starts the app with their paths on the command line — a second launch hands its command
// line to the first and goes — and a Mac hands them one `open-file` event apiece. Which of the
// three it was cannot be told apart, and they are not treated apart.

const fs = require("node:fs");
const path = require("node:path");

/**
 * The files a command line names: every argument after the program's own that is not a switch
 * and names a file — a relative one against the folder the launch was made from. A folder, a
 * path to nothing and Chromium's own switches are left out.
 *
 * @web-only Windows hands files over on the command line, where upstream's macOS hands them as
 *   an event
 */
function pathsOfCommandLine(argv, workingDirectory, isPackaged) {
  // A packaged app is `ByteRipper.exe <files>`; a development run is `electron . <files>`.
  const args = argv.slice(isPackaged ? 1 : 2);
  const paths = [];
  for (const arg of args) {
    if (typeof arg !== "string" || arg.length === 0 || arg.startsWith("-")) continue;
    const full = path.resolve(workingDirectory ?? process.cwd(), arg);
    try {
      if (!fs.statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    if (!paths.includes(full)) paths.push(full);
  }
  return paths;
}

/** How long a file waits for the next: long enough for the events of one drop, too short to feel. */
const BATCH_DELAY_MS = 250;

/**
 * Gathers the files handed to the app in one gesture into one batch: a file is held for a moment,
 * one that follows within it joins it, and the batch opens once, when the files stop coming. A
 * file handed twice is one file.
 *
 * @upstream ByteRipperApp/Documents/HandedFilesBatch.swift#HandedFilesBatch
 * @upstream ByteRipperApp/Documents/HandedFilesBatch.swift#HandedFilesBatch.window
 * @upstream ByteRipperApp/Documents/HandedFilesBatch.swift#HandedFilesBatch.init
 */
function handedFilesBatch(open, delay = BATCH_DELAY_MS) {
  let paths = [];
  let pending;

  /** Opens what has gathered, now. */
  // @upstream ByteRipperApp/Documents/HandedFilesBatch.swift#HandedFilesBatch.flush
  function flush() {
    clearTimeout(pending);
    pending = undefined;
    if (paths.length === 0) return;
    const batch = paths;
    paths = [];
    open(batch);
  }

  return {
    /** Adds `incoming` to the batch and starts its moment again. */
    // @upstream ByteRipperApp/Documents/HandedFilesBatch.swift#HandedFilesBatch.add
    add(incoming) {
      for (const one of incoming) if (!paths.includes(one)) paths.push(one);
      clearTimeout(pending);
      pending = setTimeout(flush, delay);
    },
    flush,
  };
}

module.exports = { pathsOfCommandLine, handedFilesBatch, BATCH_DELAY_MS };
