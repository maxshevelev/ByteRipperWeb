import type { MFSState, MFSStateBasis } from "@/firmware/me/models/firmwareFacts";
import { mfsStateBasisIsIncomplete } from "@/firmware/me/models/firmwareFacts";
import { titleText } from "@/tools/meaText";

/**
 * What the File System State was decided from, as short as it can be put: the state is the
 * row's answer, and this is what stands behind it, in brackets after it — "Initialized (EFS:
 * holds files)". Drawn in the ordinary font and colour, because it is evidence and not a
 * second answer; English in every language, as the state it stands behind is. The long
 * explanation lives in the help. The state itself is upstream's; the brackets are ours.
 */

/**
 * The evidence, as clauses joined by "; " — the deciding fact first, then the caveat a step
 * that could not be taken leaves. Empty when there is nothing to say.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAStateBasisText.swift#MEAText.fileSystemStateEvidence
 */
// help: panel.me.state-basis
export function fileSystemStateEvidence(_state: MFSState, basis: MFSStateBasis): string {
  const clauses: string[] = [];
  switch (basis.decidedBy) {
    case "reservedFiles":
      if (
        basis.reservedFiles.kind === "initializing" ||
        basis.reservedFiles.kind === "configuring"
      ) {
        clauses.push(`reserved files: ${basis.reservedFiles.indices.join(", ")}`);
      }
      break;
    case "efs":
      clauses.push("EFS: holds files");
      break;
    case "configuration":
      clauses.push(`configuration: ${basis.configuration.join(", ")}`);
      break;
    case "nothing":
      clauses.push("nothing found");
      break;
  }
  // A step that could have raised the state and was not taken: the row's tone turns to a
  // caution for it, and the clause says which step.
  if (mfsStateBasisIsIncomplete(basis)) {
    if (basis.efs.kind === "unreadable") clauses.push("EFS: unreadable");
    else if (basis.efs.kind === "filesNotNamed") clauses.push("EFS: files not named");
  }
  return clauses.join("; ");
}

/**
 * The row as one line for a copy of it: the state, then its evidence in brackets where there
 * is any.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAStateBasisText.swift#MEAText.fileSystemState
 */
export function fileSystemStateText(state: MFSState, basis: MFSStateBasis | undefined): string {
  const name = titleText(state);
  if (basis === undefined) return name;
  const evidence = fileSystemStateEvidence(state, basis);
  return evidence.length === 0 ? name : `${name} (${evidence})`;
}
