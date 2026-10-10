import {
  type MFSState,
  type MFSStateBasis,
  mfsStateBasisIsIncomplete,
} from "@/firmware/me/models/firmwareFacts";
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

/**
 * The State basis row's tone: a caution when the basis is incomplete, so the row that says why the
 * state cannot be relied on is not passed over; plain otherwise.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEATones.swift#MEATones.stateBasis
 */
export function stateBasis(basis: MFSStateBasis): ToolValueTone {
  return mfsStateBasisIsIncomplete(basis) ? "caution" : "standard";
}
