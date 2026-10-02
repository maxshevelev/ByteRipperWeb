---
name: release
description: Cut a ByteRipperWeb release — set the version to the upstream release the port was last brought level with, build the single-file HTML page and the Windows build and check both, write the notes, tag, push and publish the GitHub release. Use when asked to make, cut or publish a release, or to prepare one ("сделай релиз"). Invoke as /release.
---

# Releasing ByteRipperWeb

A release is an annotated tag on `main` and a GitHub release carrying five
files:

- **`ByteRipperWeb-<version>.html`** — the whole app in one page, to keep on a
  stick or send to a bench and open from disk;
- **`ByteRipper-<version>-setup.exe`**, **`ByteRipper-<version>-portable.exe`**
  and **`ByteRipper-<version>-win.zip`** — the optional Windows build
  (`desktop/`, D15). The setup is the one that starts fast and the one the
  build's **Check for Update…** installs;
- **`SHA256SUMS`** — which that update checks the setup against. Both names
  are looked up by the installed app in the *latest* release, so they must be
  spelled exactly so.

**The hosted page moves with the release, and only with it.**
`.github/workflows/deploy-pages.yml` builds https://maxshevelev.github.io/ByteRipperWeb/
from the latest `v*` tag, so pushing the tag in step 5 is what publishes it. A
push to `main` updates only the development preview,
https://maxshevelev.github.io/ByteRipperWeb/preview/, whose landing screen says
"ByteRipper <version>-dev" — as the dev server's does. (Both are one origin, so
they share the browser's storage — settings, bookmarks, the pattern library,
the cached databases.)

There is no macOS build here — the native app in the upstream repository is
the Mac's.

**The version is upstream's, and a build of ours.** A release is numbered
`<upstream>-<n>`: `<upstream>` is the upstream release this edition was last
brought level with — `MARKETING_VERSION` in the ByteRipper clone's `project.yml`
at the port baseline (`PORT_STATE.json`) — and `<n>` counts the builds of this
edition made against it, from 1 (0.9.0-1, 0.9.0-2 …; upstream 0.9.1 starts at
0.9.1-1). A bug-fix release changes only `<n>`; a port that moves the baseline
past an upstream bump changes `<upstream>` and resets `<n>`. The landing screen
signs off with it ("ByteRipper 0.9.0-2") and compares it with the latest
release to say when a newer one is out: the number is compared part by part
(`src/core/updates/appVersion.ts`), and `-2` is *after* the bare release, not a
pre-release of it as semantic versioning would say. The tag is `v<version>`.

The mechanical parts are a script; the notes are the work.

```bash
python3 Skills/release/scripts/release.py version          # upstream's version into the package files
python3 Skills/release/scripts/release.py version --check  # or only check them
python3 Skills/release/scripts/release.py build            # release/<version>/: the page, the setup, the .exe, the .zip, SHA256SUMS
python3 Skills/release/scripts/release.py build --skip-html  # the same without the single-file page
```

## Steps

### 1. Before anything

- On `main`, clean tree, up to date with `origin/main`.
- **The port is current, or knowingly not.** Run
  `python3 Skills/port-from-byteripper/scripts/port_report.py`: a release made
  with upstream commits waiting says so in its notes, or waits for the port.
- The ByteRipper clone is fetched and contains the baseline commit — `version`
  reads `project.yml` there.

### 2. The version

```bash
python3 Skills/release/scripts/release.py version
```

Writes upstream's version at the baseline into `package.json` and
`package-lock.json`, and prints what changed. `desktop/` has no version of its
own: `desktop/electron-builder.config.cjs` hands the web's to electron-builder,
which would refuse it in `desktop/package.json` because it is not semver. If nothing changed, the version is already set.

`<n>` is read from the tags: the script takes one past the highest `v<upstream>-<n>`
already made, so a second release on the same upstream number is simply the
next build, and a version it has prepared and you have not yet tagged is kept
rather than skipped. Check that the number it printed is the one you mean.

### 3. Build and check

```bash
python3 Skills/release/scripts/release.py build
```

Runs `npm run check` and both help checks first (`--skip-checks` to leave them
out when they have just run), then:

- `npm run build:single` — one HTML file holding the script, the stylesheet,
  the four workers (as classic workers from `blob:` URLs) and every lazily
  loaded help page and catalogue. The script refuses a page that still loads a
  file of its own or lacks the version.
- `npm run dist:win` in `desktop/` — x64 setup, portable `.exe` and `.zip`, with
  upstream's icon (`desktop/make-icon.py`); the script checks the icon is in
  the executable. It is cross-built on the Mac and not signed.

Everything lands in `release/<version>/` (git-ignored) with `SHA256SUMS`.

**Open the page from disk once** before publishing — the driver does it:
`node Skills/run-byteripperweb/scripts/drive.mjs open <dump> --tool UEFI --url file://$PWD/release/<version>/ByteRipperWeb-<version>.html`.
What a page opened from disk cannot do, it says in the notes (see below).

### 4. The release notes

Written to a file in the scratchpad, never committed. Upstream's shape, which
this edition's releases keep:

- **Title:** `ByteRipperWeb <version> — <what the release is about>`, lower
  case after the dash.
- **Opening paragraph:** what the release is about, in two or three sentences,
  and which upstream release it is level with.
- **`###` sections**, the larger themes first, each a short paragraph and
  bullets with the feature in **bold** where it starts; then `### Smaller
  things` and `### Fixes` — a fix says what the user saw go wrong.
- **The footer**, verbatim: `reference/notes-footer.md`.

Read the commits since the last tag (`git describe --tags --abbrev=0`,
`git log --oneline <tag>..HEAD`), not only their subjects. Port commits name
what came from upstream; say it in the reader's words, not the port's.

### 5. Tag, push, publish

```bash
git add package.json package-lock.json
git commit      # "Set <version>, the upstream release this edition is level with"
git tag -a v<version> -m "ByteRipperWeb <version>"
git push origin main v<version>
gh release create v<version> release/<version>/ByteRipperWeb-<version>.html \
    release/<version>/ByteRipper-<version>-setup.exe \
    release/<version>/ByteRipper-<version>-portable.exe \
    release/<version>/ByteRipper-<version>-win.zip release/<version>/SHA256SUMS \
    --title "ByteRipperWeb <version> — …" --notes-file <notes.md> --latest
```

Publishing is outward-facing: confirm with the owner before `git push` and
`gh release create` unless they asked for the release outright.

### 6. Verify

```bash
gh release view v<version> --json name,tagName,isDraft,isPrerelease,assets
```

Five assets, the tag is the latest release, and the CI run on the tagged
commit is green (`gh run list --limit 3`). The *Deploy to Pages* run for the
tag has finished, and https://maxshevelev.github.io/ByteRipperWeb/ says
"ByteRipper <version>" on its landing screen. Report the release URL.
