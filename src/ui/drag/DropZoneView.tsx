import { DropTargetView } from "@/ui/drag/DropTargetView";

/**
 * The "second file" half's visual in single-file mode (§4.3): a quiet plate that
 * appears only for the drag's lifetime.
 *
 * Purely visual — it is never hit-testable, so the hex dump behind it keeps the
 * mouse; the owning container (`SingleFileDrop`) receives the drag and shows or
 * hides this plate for the drag's lifetime.
 *
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView.setDragActive
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView.setTitle
 * @upstream ByteRipperApp/DragDrop/DropBands.swift#DropZoneView.setHighlighted
 * @upstream-differs shown and hidden by being mounted rather than by `hide()`, and it holds no
 * plate of its own: the container renders it only while the half has something to offer
 */
export interface DropZoneViewProps {
  /** What the half says it will do — "Open as Second File" or "Duplicate Here". */
  readonly title: string;
  /** Whether the pointer is over this half rather than over the bands. */
  readonly highlighted?: boolean | undefined;
}

export function DropZoneView({ title, highlighted = false }: DropZoneViewProps) {
  return (
    <div className="drop-zone" aria-hidden="true">
      <DropTargetView title={title} highlighted={highlighted} />
    </div>
  );
}
