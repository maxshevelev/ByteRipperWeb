import {
  type MFSState,
  type MFSStateBasis,
  mfsStateBasisIsIncomplete,
} from "@/firmware/me/models/firmwareFacts";
import type {
  BootGuardProfile,
  HardwareBinding,
  ManufacturingLock,
  ManufacturingState,
} from "@/firmware/me/models/manufacturingFacts";
import type { ToolValueTone } from "@/tools/toolValueTone";

/**
 * The tone for each ME fact that carries a status rather than just a value.
 *
 * Shared rather than written where it is drawn: the Summary tab's row and the
 * tree's detail row describe the same fact, and a reader comparing the two
 * should not find two colours — nor one panel that says "Configured" in green
 * and another that says it in the ordinary label colour.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones
 */

/**
 * The File System State's tone, before what it rests on is known. The two settled states — the volume has no
 * files yet (`unconfigured`) and it is fully set up (`configured`) — read as
 * green; a volume mid-lifecycle (`initialized`) is brown; a failed decode
 * (`error`) is red.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones.fileSystemState
 */
export function fileSystemState(state: MFSState): ToolValueTone {
  switch (state) {
    case "unconfigured":
    case "configured":
      return "good";
    case "initialized":
      return "caution";
    case "error":
      return "bad";
  }
}

/**
 * The File System State's tone once what it rests on is known. A state a step that could not be
 * taken left standing — an EFS partition that could not be read, whose files would have made it
 * Initialized — is not a settled one, and green would say it is: it reads as a caution at best,
 * and keeps red where the state itself is an error.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones.fileSystemState
 */
export function fileSystemStateWithBasis(
  state: MFSState,
  basis: MFSStateBasis | undefined
): ToolValueTone {
  const own = fileSystemState(state);
  if (basis === undefined || !mfsStateBasisIsIncomplete(basis)) return own;
  return own === "bad" ? "bad" : "caution";
}

// The State basis row has no tone of its own any more: it is drawn in brackets on the state's
// row, in the ordinary font and colour, and the caution for a step that could not be taken sits on
// the state itself (`fileSystemStateWithBasis`).

/**
 * The Manufacturing row's tone. A machine that will **not** close Manufacturing boots on and
 * can still be worked on, which is the state a bench wants to see: green. One that **will**
 * close on its next boot is committing itself — the same tone the File System State draws for
 * `Initialized`. The flag set with an open descriptor reads the same way.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones.manufacturingState
 */
export function manufacturingStateTone(state: ManufacturingState): ToolValueTone {
  switch (state) {
    case "willNotClose":
      return "good";
    case "willClose":
    case "unexpectedCombination":
      return "caution";
    default:
      return "standard";
  }
}

/**
 * The Manufacturing Lock row's tone: **Locked** is the machine's End of Manufacturing having
 * run, the committed state; **Not locked** is a board that has not been through it, green. A
 * byte the reading does not know is an ordinary value.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones.manufacturingLock
 */
export function manufacturingLockTone(lock: ManufacturingLock): ToolValueTone {
  return lock.kind === "locked" ? "caution" : lock.kind === "open" ? "good" : "standard";
}

/**
 * The RPMC Hardware Binding row's tone: **Disabled** — the SPI part can be replaced — is green;
 * **Enabled** is the caution of a committed state. A byte the tool's class does not name, and
 * an image that does not record one, are ordinary values.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones.hardwareBinding
 */
export function hardwareBindingTone(binding: HardwareBinding): ToolValueTone {
  return binding.kind === "disabled" ? "good" : binding.kind === "enabled" ? "caution" : "standard";
}

/**
 * The Boot Guard row's tone. Profile 0 — `No_FVME`, the boot chain verifies and measures
 * nothing — is green; every other profile is a state the board has been committed to, the
 * caution. What a level means for an edit is the help's to explain, not the colour's.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones.bootGuardProfile
 */
export function bootGuardProfileTone(profile: BootGuardProfile): ToolValueTone {
  return profile === "0" ? "good" : "caution";
}
