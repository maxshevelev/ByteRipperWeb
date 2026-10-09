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

/**
 * Several CPUIDs as one: the header's own, then after a `+` the ones its
 * extended table adds — `B06A2 + B06A3, B06A8`. The update is filed under the
 * first, and it serves every one of them.
 *
 * @upstream Modules/FITTool/Sources/FITTool/FITDisplay.swift#FITPresenter.cpuidsText
 */
export function cpuidsText(signatures: readonly number[]): string {
  const [first, ...more] = signatures;
  if (first === undefined) return "";
  return more.length === 0
    ? cpuidText(first)
    : `${cpuidText(first)} + ${more.map(cpuidText).join(", ")}`;
}

/** A hex value, padded to a field's width where the field has one. */
export function fitHex(value: number, digits = 0): string {
  return `0x${value.toString(16).toUpperCase().padStart(digits, "0")}`;
}
