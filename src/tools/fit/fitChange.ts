import { L } from "@/core/localization/localization";
import type { ToolContext } from "@/tools/toolModule";

/**
 * A change to the microcodes, in the three shapes the panel makes one: a
 * microcode put in (by its CPUID, wherever it fits), put in the place of a
 * row, or taken out.
 */
export type MicrocodeChange =
  | { readonly kind: "addOrReplace" }
  | { readonly kind: "replaceAt" }
  | { readonly kind: "remove" };

/**
 * What the change comes to, as the pure plan-and-write step answers it: the
 * reason nothing was written, or the sentence and the kind of what was — and
 * nothing at all for a plan that was abandoned or superseded.
 */
export interface MicrocodeChangeResult {
  readonly problem: string | undefined;
  readonly summary: string | undefined;
  readonly kind: "added" | "replaced" | "removed" | undefined;
}

/**
 * The words of a change's two modals: the title of the one that stands over
 * the window while it is worked out, and the title of the one that says it
 * could not be. The title of the one that says it was done depends on what it
 * came to, and is `microcodeDoneTitle`'s.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.addMicrocode
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.replaceMicrocode
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.removeMicrocode
 */
export function microcodeChangeWords(change: MicrocodeChange): {
  readonly sheetTitle: string;
  readonly couldNot: string;
} {
  switch (change.kind) {
    case "addOrReplace":
      return {
        sheetTitle: L("Adding a microcode"),
        couldNot: L("Could not add the microcode"),
      };
    case "replaceAt":
      return {
        sheetTitle: L("Replacing a microcode"),
        couldNot: L("Could not replace the microcode"),
      };
    case "remove":
      return {
        sheetTitle: L("Removing a microcode"),
        couldNot: L("Could not remove the microcode"),
      };
  }
}

/** The title of the modal that says a change was done, by what it came to. */
export function microcodeDoneTitle(kind: "added" | "replaced" | "removed"): string {
  switch (kind) {
    case "added":
      return L("Microcode added");
    case "replaced":
      return L("Microcode replaced");
    case "removed":
      return L("Microcode removed");
  }
}

/**
 * A change to the microcodes, start to finish: a modal over the window for as
 * long as the change is worked out, and another for how it ended — what was
 * done, or why it was not. The panel's own line says nothing of it: a strip
 * beside the dump is where a result goes unread, and the window is held still
 * for the work anyway, so the modal is where the reader is looking.
 *
 * Cancelling drops the plan; nothing is written until it is complete, and
 * nothing is said of one that was dropped.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.modify
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.refuse
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolModule.swift#FITToolSession.apply
 * @upstream-differs no phase of reading the file: the image is parsed before the
 * panel offers a change, and "That image has not been read yet." is the answer
 * to one asked too early; no beep, which a page may not sound; and no refusal
 * of a read-only file, which the web does not open
 */
export async function changeMicrocode(
  host: Pick<ToolContext, "beginBlockingWork" | "reportResult">,
  change: MicrocodeChange,
  perform: (cancelled: () => boolean) => Promise<MicrocodeChangeResult>
): Promise<void> {
  const words = microcodeChangeWords(change);
  let abandoned = false;
  // Cancel is the modal's: it drops the plan, and ends the modal by finishing.
  const work = host.beginBlockingWork(words.sheetTitle, () => {
    abandoned = true;
    work.finish();
  });
  work.rename(L("Working out where it goes…"));
  const done = await perform(() => abandoned);
  work.finish();
  if (abandoned) return;
  if (done.problem !== undefined) {
    host.reportResult(words.couldNot, done.problem, true);
  } else if (done.summary !== undefined && done.kind !== undefined) {
    host.reportResult(
      microcodeDoneTitle(done.kind),
      `${done.summary} ${L("Undo takes it back.")}`,
      false
    );
  }
}
