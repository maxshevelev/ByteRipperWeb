import { hexAddress } from "@/core/text/hexText";
import {
  expressionHexText,
  isSum,
  type OffsetExpression,
  parseOffsetExpression,
} from "@/core/text/offsetExpression";

/**
 * The last addresses and sums typed where an address or a length is asked
 * for, most recent first (§10.1, issue #9). One list for the whole app: an
 * address worked out for a cut is as likely to be wanted in Select Block as in
 * the form it was typed in.
 *
 * An entry is text a field can be given back: a plain address in the form the
 * app writes one (`0x0007AF00`), or a sum exactly as it was typed
 * (`0x1FE000 + 40`) — kept as typed so it can be read again and corrected,
 * which is the reason to keep it at all.
 *
 * Upstream keeps it in `UserDefaults`; the browser's counterpart is
 * `localStorage`, which every tab and every window of the app shares, as
 * upstream's list is the app's. It can throw outright in a private window — so
 * a failure to read it is an empty list, and a failure to write it forgets the
 * entry rather than failing the command that made it.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressHistoryStore
 */

/** The two calls this needs of `localStorage`, so a test can hand over its own. */
export interface AddressHistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressHistoryStore.userDefaultsKey
 * @upstream-differs a key of this application's own: Go To's history was kept with the tab's bookmarks, and is adopted from there (`adoptAddressHistory`)
 */
export const ADDRESS_HISTORY_STORAGE_KEY = "byteripper.addressHistory";

/** @upstream ByteRipperApp/Controls/AddressField.swift#AddressHistoryStore.limit */
export const ADDRESS_HISTORY_LIMIT = 10;

let storage: AddressHistoryStorage | undefined;

/**
 * Points the store at another storage: a test's memory one.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressHistoryStore.defaults
 */
export function setAddressHistoryStorage(next: AddressHistoryStorage | undefined): void {
  storage = next;
}

const entries = (): AddressHistoryStorage => storage ?? localStorage;

/**
 * The recorded entries, most recent first.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressHistoryStore.recent
 */
export function recentAddressEntries(): readonly string[] {
  try {
    const stored = entries().getItem(ADDRESS_HISTORY_STORAGE_KEY);
    if (stored === null) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Records an address: moves it to the front, dropping any older entry for the
 * same address, and caps the list at the limit.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressHistoryStore.record
 */
export function recordAddress(offset: number | bigint): void {
  recordEntry(`0x${addressDigits(offset)}`);
}

/**
 * Records what a field held when it was acted on: a sum as it was typed, a lone
 * number as the address it names — so one address typed two ways is one entry.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressHistoryStore.record
 */
export function recordAddressExpression(expression: OffsetExpression, typedAs: string): void {
  if (!isSum(expression)) {
    recordAddress(expression.value);
    return;
  }
  recordEntry(typedAs.trim());
}

/**
 * Takes over the addresses Go To kept with a tab's bookmarks before the list
 * was the app's, once: only while the app's list is still empty.
 *
 * @web-only the earlier web history lived in the workspace's IndexedDB record, as rows
 */
export function adoptAddressHistory(rows: readonly number[]): void {
  if (rows.length === 0 || recentAddressEntries().length > 0) return;
  writeEntries(rows.slice(0, ADDRESS_HISTORY_LIMIT).map((row) => `0x${hexAddress(row)}`));
}

function recordEntry(entry: string): void {
  // One entry per sum however it was spaced or cased: `0x1FE000+40` and
  // `0x1fe000 + 0x28` are the same sum, and the latest typing stands.
  const key = sameness(entry);
  const kept = recentAddressEntries().filter((other) => sameness(other) !== key);
  writeEntries([entry, ...kept].slice(0, ADDRESS_HISTORY_LIMIT));
}

function writeEntries(list: readonly string[]): void {
  try {
    entries().setItem(ADDRESS_HISTORY_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // A storage that refuses the write forgets the entry; the command stands.
  }
}

/**
 * What two entries are compared by: their terms in hex, in order.
 *
 * @upstream ByteRipperApp/Controls/AddressField.swift#AddressHistoryStore.sameness
 */
function sameness(entry: string): string {
  const parsed = parseOffsetExpression(entry);
  return parsed.ok ? expressionHexText(parsed.expression) : entry;
}

/** At least eight upper-case digits, as the offset column writes an address. */
function addressDigits(offset: number | bigint): string {
  return typeof offset === "number"
    ? hexAddress(offset)
    : offset.toString(16).toUpperCase().padStart(8, "0");
}
