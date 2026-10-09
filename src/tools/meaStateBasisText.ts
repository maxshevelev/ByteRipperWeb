import { L } from "@/core/localization/localization";
import {
  type MFSState,
  type MFSStateBasis,
  mfsStateBasisIsIncomplete,
} from "@/firmware/me/models/firmwareFacts";
import { hex, titleText } from "@/tools/meaText";

/**
 * What the File System State was decided from, in one paragraph — the Firmware
 * row's detail in the panels. The state is upstream's; the paragraph is ours, so a
 * state left standing by a step that could not be taken is not read as one the
 * flash shows (`MFSStateBasis`).
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAStateBasisText.swift#MEAText.fileSystemStateBasis
 */
// help: panel.me.state-basis
export function fileSystemStateBasisText(state: MFSState, basis: MFSStateBasis): string {
  const name = titleText(state);
  const sentences: string[] = [];
  switch (basis.decidedBy) {
    case "reservedFiles":
      sentences.push(L("%1$@, from the reserved MFS files present.", name));
      break;
    case "efs":
      sentences.push(
        L(
          "%1$@, because the EFS volume holds file content: the engine has run and written its files.",
          name
        )
      );
      break;
    case "configuration":
      sentences.push(
        L(
          "%1$@, from the configuration found (%2$@), not from files the engine wrote.",
          name,
          basis.configuration.join(", ")
        )
      );
      break;
    case "nothing":
      sentences.push(
        L("%1$@: no reserved MFS file, no EFS content and no configuration partition.", name)
      );
      break;
  }
  if (mfsStateBasisIsIncomplete(basis)) {
    if (basis.efs.kind === "unreadable") {
      sentences.push(
        L(
          "The EFS partition at %1$@ could not be read, so whether it holds files — which would make the state Initialized — is unknown. Check its system page before relying on this state.",
          hex(Math.max(0, basis.efs.offset))
        )
      );
    } else if (basis.efs.kind === "filesNotNamed") {
      sentences.push(
        L(
          "The EFS volume's files cannot be told without the firmware database's file table, so whether it holds files — which would make the state Initialized — is unknown."
        )
      );
    }
  }
  if (basis.reservedFiles.kind === "notRead" && basis.decidedBy !== "efs") {
    sentences.push(
      L(
        "This volume does not name its reserved files by index, so only the EFS and the configuration decide."
      )
    );
  }
  return sentences.join(" ");
}
