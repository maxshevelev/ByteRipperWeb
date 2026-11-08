// A development run on a Mac (`npm start`, `npm run open`) is Electron's own Electron.app out of
// node_modules, and its Info.plist declares no document types: the Dock takes no file dropped on
// its icon, so the `open-file` that main.cjs answers never comes. This gives that Electron.app
// what upstream's app declares for any file — `public.data` as a Viewer, ranked Alternate, so it
// is offered for a file and the default of none — and has Launch Services read it again.
//
// Run before Electron starts, every time: an `npm install` puts the bundle back as it came. It
// does nothing where the type is already there, and nothing off a Mac.
//
// @web-only a packaged app declares its types in its own Info.plist; the development run borrows
// Electron's bundle, which declares none

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/** The document type the Dock and the Finder offer the app for: any file, as upstream's last. */
// @upstream ByteRipperApp/Info.plist
const ANY_FILE = "Any File";

/** The document types `plist` declares, or nothing where it declares none. */
function documentTypes(plist) {
  try {
    const json = execFileSync(
      "plutil",
      ["-extract", "CFBundleDocumentTypes", "json", "-o", "-", plist],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** Whether the bundle carries a signature, which a change to its Info.plist breaks. */
function isSigned(bundle) {
  try {
    execFileSync("codesign", ["-dv", bundle], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Adds the type to `bundle` when it lacks it; returns whether it changed anything. */
function declareAnyFile(bundle) {
  const plist = path.join(bundle, "Contents", "Info.plist");
  if (!fs.existsSync(plist)) return false;
  const types = documentTypes(plist);
  if (types?.some((one) => one.CFBundleTypeName === ANY_FILE)) return false;
  // Signed (an arm64 Electron is, ad hoc), the bundle is checked against its Info.plist: it is
  // signed again, ad hoc, after the change.
  const signed = isSigned(bundle);
  const entry = `:CFBundleDocumentTypes:${types?.length ?? 0}`;
  const commands = [
    ...(types === undefined ? ["Add :CFBundleDocumentTypes array"] : []),
    `Add ${entry} dict`,
    `Add ${entry}:CFBundleTypeName string ${ANY_FILE}`,
    `Add ${entry}:CFBundleTypeRole string Viewer`,
    `Add ${entry}:LSHandlerRank string Alternate`,
    `Add ${entry}:LSItemContentTypes array`,
    `Add ${entry}:LSItemContentTypes:0 string public.data`,
  ];
  for (const command of commands) execFileSync(PLIST_BUDDY, ["-c", command, plist]);
  if (signed) execFileSync("codesign", ["--force", "--deep", "--sign", "-", bundle]);
  // Launch Services keeps what it read of the bundle; told to read it again, the Dock takes drops.
  execFileSync(LSREGISTER, ["-f", bundle]);
  return true;
}

/** The Electron.app a development run starts, or nothing where there is none. */
function electronBundle() {
  let executable;
  try {
    executable = require("electron");
  } catch {
    return undefined;
  }
  if (typeof executable !== "string") return undefined;
  // …/Electron.app/Contents/MacOS/Electron
  return path.resolve(executable, "..", "..", "..");
}

if (require.main === module && process.platform === "darwin") {
  const bundle = electronBundle();
  try {
    if (bundle !== undefined && declareAnyFile(bundle)) {
      console.log(`${path.basename(bundle)} now takes files dropped on its Dock icon.`);
    }
  } catch (problem) {
    // The window still opens; only a drop on the Dock icon is refused, as before.
    console.warn(`Could not declare the document types of ${bundle}: ${problem.message}`);
  }
}

module.exports = { declareAnyFile, electronBundle, ANY_FILE };
