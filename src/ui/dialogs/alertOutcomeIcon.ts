import type { AlertOutcome } from "@/state/workspaceStore";
import type { TintedSymbolName } from "@/ui/theme/TintedSymbol";

/**
 * The icon an alert wears for how its operation ended: a check in a circle in
 * the theme's green for what was done, a filled octagon in its red for what was
 * refused or failed — filled, with the mark a hole in the fill, so it reads on
 * the light theme and the dark alike.
 *
 * @upstream ByteRipperApp/Window/MainViewController.swift#AlertOutcome.icon
 * @upstream-differs the symbol's name and colour, drawn by `TintedSymbol`, where
 * upstream answers the finished image
 */
export function alertOutcomeIcon(outcome: AlertOutcome): {
  readonly name: TintedSymbolName;
  readonly color: string;
} {
  return outcome === "success"
    ? { name: "checkmark.circle", color: "var(--semantic-good)" }
    : { name: "exclamationmark.octagon.fill", color: "var(--semantic-bad)" };
}
