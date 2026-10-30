import { DropTargetView } from "@/ui/drag/DropTargetView";
import type { DropEdge } from "@/ui/drag/dragDrop";

/**
 * The "second file" half's visual in single-file mode (§4.3): a quiet plate that
 * is up for the drag's lifetime, lit while the pointer is over this half.
 *
 * Purely visual — it is never hit-testable, so the hex dump behind it keeps the
 * mouse; the owning container (`SingleFileDrop`) receives the drag and shows or
 * hides this plate for the drag's lifetime.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView.setDragActive
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView.setTitle
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView.setHighlighted
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView.setAdjoiningEdge
 * @upstream-differs shown and hidden by being mounted rather than by `hide()`: the container
 * renders it only while the half has something to offer
 */
export interface DropZoneViewProps {
  /** What the half says it will do — "Open for Comparison" or "Duplicate Here". */
  readonly title: string;
  /** Whether the pointer is over this half rather than over the bands. */
  readonly highlighted?: boolean | undefined;
  /** The edge this half shares with the bands beside it, which takes half the padding. */
  readonly adjoiningEdge?: DropEdge | undefined;
}

export function DropZoneView({ title, highlighted = false, adjoiningEdge }: DropZoneViewProps) {
  return (
    <div className="drop-zone" aria-hidden="true">
      <DropTargetView
        title={title}
        highlighted={highlighted}
        inset={{ adjoining: adjoiningEdge }}
      />
    </div>
  );
}
