import { Fragment } from "react";
import { L } from "@/core/localization/localization";
import type { MicrocodeVendor } from "@/tools/fit/microcodeCatalogue";
import { type FITProcessorGroup, processorGroups } from "@/tools/fit/processorNames";
import { HelpPopover } from "@/ui/help/HelpPopover";
import { HelpPopoverLayout } from "@/ui/help/HelpPopoverLayout";

/**
 * The processors behind one CPUID of a microcode, where a reader of the FIT
 * panel or the microcode form asks for them: a popover off the `ⓘ` after the
 * CPUID.
 *
 * They are not rows of the tree, because they are not part of the update — only
 * what a published table of brand names says about who runs it. The shape is
 * every help popover's (`HelpPopoverLayout`): the CPUID as the title; under it,
 * what the table says of its group — the code names, the product families, the
 * cores, the stepping, the segments; then the models with the S-SPECs they were
 * sold under. A CPUID of several groups says each over its own models instead:
 * two groups may share a code name, and a head that listed both would not say
 * whose models are whose. All of it is text to select and copy, the title too.
 *
 * Ported from `Modules/FITTool/Sources/FITToolUI/FITProcessorsPopover.swift`.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITProcessorsPopover.swift#FITProcessorsPopover
 * @upstream Modules/FITTool/Sources/FITToolUI/FITProcessorsPopover.swift#FITProcessorsPopover.group
 * @upstream Modules/FITTool/Sources/FITToolUI/FITProcessorsPopover.swift#FITProcessorsPopover.show
 * @upstream Modules/FITTool/Sources/FITToolUI/FITProcessorsPopover.swift#FITProcessorsPopover.makeContent
 * @upstream-differs a React component over the shared `HelpPopover`, rendered by its owner while
 * it is open, rather than a controller presented off a rect of a text view
 */
export function FitProcessorsPopover({
  group,
  anchor,
  onClose,
}: {
  readonly group: FITProcessorGroup;
  /** The `ⓘ` the reader clicked. */
  readonly anchor: HTMLElement | null;
  readonly onClose: () => void;
}) {
  const title = L("CPUID %1$@", group.cpuid);
  const note = group.notes.length === 1 ? group.notes[0] : undefined;
  return (
    <HelpPopover anchor={anchor} label={title} onClose={onClose}>
      <HelpPopoverLayout title={title} note={note}>
        <ProcessorList group={group} />
      </HelpPopoverLayout>
    </HelpPopover>
  );
}

/**
 * The list: a model in the body's weight with its S-SPECs quieter after it, a
 * group's names in the weight of a heading with its note quieter under them,
 * and the line that says nothing is known quiet throughout.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITProcessorsPopover.swift#FITProcessorsPopover.list
 */
function ProcessorList({ group }: { readonly group: FITProcessorGroup }) {
  return (
    <div className="fit-processors">
      {group.lines.map((line, index) => (
        // The lines are the group's, rebuilt whole with it: their place is their identity.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <Fragment key={index}>
          {line.kind === "family" ? (
            <div className="fit-processors-family" data-first={index === 0 ? "" : undefined}>
              <div className="fit-processors-family-name">{line.text}</div>
              {line.detail.length === 0 ? null : (
                <div className="fit-processors-family-note">{line.detail}</div>
              )}
            </div>
          ) : (
            <div
              className="fit-processors-line"
              data-unknown={line.kind === "unknown" ? "" : undefined}
            >
              {line.text}
              {line.detail.length === 0 ? null : (
                <span className="fit-processors-detail">
                  {"   "}
                  {line.detail}
                </span>
              )}
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * The `ⓘ` that opens the popover, wherever a CPUID has one: the panel's info
 * glyph in a CPUID's weight and the colour of a link — which it is. On a
 * selected row it takes the selection's text colour (the stylesheet's), where
 * the link's blue would be lost. It is a button with no text of its own, so a
 * copy of the words around it leaves it out.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITProcessorsPopover.swift#FITProcessorsPopover.infoImage
 * @upstream Modules/FITTool/Sources/FITToolUI/FITToolViewController.swift#FITCPUIDTextView.infoMark
 */
export function ProcessorsInfoMark({ onOpen }: { readonly onOpen: (anchor: HTMLElement) => void }) {
  return (
    <button
      type="button"
      className="fit-info-mark"
      aria-label={L("Processors")}
      title={L("Show the processors with this CPUID")}
      onClick={(event) => {
        // The mark is the CPUID's, not the row's: it chooses nothing.
        event.stopPropagation();
        onOpen(event.currentTarget);
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.8a6.2 6.2 0 1 0 0 12.4 6.2 6.2 0 0 0 0-12.4ZM8 7.2v4M8 4.8v.02" />
      </svg>
    </button>
  );
}

/**
 * The processors behind a catalogue entry's CPUID, where the table of brand
 * names knows any: nothing for a CPUID it does not, and for a vendor it is not
 * about.
 *
 * @upstream Modules/FITTool/Sources/FITToolUI/FITProcessorsPopover.swift#FITProcessorsPopover.group
 */
export function catalogueProcessorGroup(
  cpuid: number | undefined,
  vendor: MicrocodeVendor
): FITProcessorGroup | undefined {
  if (vendor !== "Intel" || cpuid === undefined) return undefined;
  const [group] = processorGroups([cpuid]);
  return group === undefined || group.codeNames.length === 0 ? undefined : group;
}
