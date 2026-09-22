import type { MFSState } from "@/firmware/me/models/firmwareFacts";
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
 * The File System State's tone. The two settled states — the volume has no
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
