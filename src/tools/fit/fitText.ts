import { microcodeCpuid } from "@/firmware/uefi/microcodeParser";
/**
 * The spellings the FIT panel shares between its list and its detail.
 *
 * A leaf module, so the detail and the display can both reach it without
 * reaching each other: the display builds details, and a detail that reached
 * back for the display's text would make the two a cycle.
 */

/**
 * The CPUID as a bench writes it: hex digits, no leading zero, no `0x` —
 * `806EA`, not `0x000806EA`. It is what gets written on a sticky note and typed
 * into a search box, so it is the one number here that is not spelled as hex.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.cpuid
 */
export function cpuidText(signature: number): string {
  return microcodeCpuid(signature);
}

/** A hex value, padded to a field's width where the field has one. */
export function fitHex(value: number, digits = 0): string {
  return `0x${value.toString(16).toUpperCase().padStart(digits, "0")}`;
}
