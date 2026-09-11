---
name: port-from-byteripper
description: Find what changed in the macOS ByteRipper repository since this project was last brought level with it, and work out what of it belongs in the web edition. Use when asked to sync with ByteRipper, port upstream changes, check what is new upstream, or update the port baseline.
---

# Porting changes from ByteRipper

ByteRipper (macOS, Swift) is the reference implementation; this repository is
its web edition. Upstream keeps moving, and this skill is how the movement gets
here without anyone re-reading a year of commits.

The rule this skill follows: **it reports and proposes; it never rewrites code
on its own.** A run produces a report and, after you act on it, a diff to
review — the same rule ByteRipper's own skills follow.

## What you need

A ByteRipper clone the script can read. It looks in this order:

1. `--repo <path>`
2. `$BYTERIPPER_REPO`
3. `../ByteRipper` beside this repository

The clone must contain the baseline commit recorded in `PORT_STATE.json`, so
`git fetch` it first if it is stale.

## Running it

```bash
python3 Skills/port-from-byteripper/scripts/port_report.py
```

That prints a Markdown report: the upstream commits since the baseline, grouped
by Swift module and mapped onto the files of this repository, plus two lists
that matter as much as the first — paths that are deliberately **not
applicable**, and paths that are **unmapped** and therefore a decision nobody
has taken yet.

`--json` gives the same thing machine-readably. `--head <ref>` compares against
something other than upstream `HEAD`.

## Working through a report

For each module the report names:

1. **Read the upstream diff.** `git -C ../ByteRipper show <sha> -- <path>`. The
   commit message is usually the design rationale; ByteRipper's commits are
   written to be read.
2. **Decide what the change actually is.** Three kinds turn up, and they are
   treated differently:
   - *Behaviour* — a bug fix in a parser, a corrected checksum rule, a changed
     navigation semantic. **This ports.** It is the reason the skill exists.
   - *AppKit* — a drawing change, a view-controller reshuffle, a layout fix.
     Read it for the intent, port the intent, ignore the mechanism. A canvas
     renderer does not take an `NSView` patch.
   - *Platform* — sandbox, entitlements, signing, file-type registration, tabs
     and window management. Not applicable; if the path is not already covered
     by `notApplicable` in the map, add it there with a reason.
3. **Port it**, in this repository's own idiom. TypeScript that reads like the
   TypeScript around it, not Swift transliterated.
4. **Port the tests with it.** Upstream's unit tests are the cheapest possible
   verification that a port is faithful; a ported parser with upstream's test
   cases behind it is a ported parser you can trust.

Handle the two lists at the end of the report:

- **Unmapped paths** — add an entry to `reference/module-map.json`, either under
  `modules` with the web files it corresponds to, or under `notApplicable` with
  a reason. Leaving it unmapped means it resurfaces every run, which is the
  intended pressure.
- **Not applicable** — skim it once. It is there so that a genuinely relevant
  change cannot hide behind a rule written months ago.

## Recording the new baseline

Only after the work is done and reviewed:

```bash
python3 Skills/port-from-byteripper/scripts/port_report.py --set-base <sha>
```

This rewrites `PORT_STATE.json` and nothing else. Do not advance the baseline
past commits you decided not to port without saying so — put the reason in the
commit message that moves it, so the next reader knows the gap was a decision
rather than an oversight.

## The map

`reference/module-map.json` is the map from upstream paths to this repository's
files, and it doubles as the honest picture of how far the port has got: every
module carries a `status` of `planned`, `in-progress` or `ported`. Keep it
current as part of doing the work, not as a chore afterwards — a stale map makes
every future run lie.

`reference/` also holds the contract documents this project ports against.
`Design/ANALYSIS.md` in the repository root records which upstream features are
in scope at all, and a change to a feature marked *Dropped* there needs no port —
but if upstream's change makes that verdict look wrong, say so rather than
silently skipping it.
