import {
  decodeSearchPatternEntry,
  encodeSearchPatternEntry,
  entriesSayTheSame,
  isSameSearch,
  type SearchPatternEntry,
} from "@/core/search/searchPatternEntry";
import { decodeDocument, encodeDocument, type SyncDocument } from "@/core/sync/syncDocument";
import {
  decodeCollection,
  encodeCollection,
  type SyncedCollection,
  type SyncItemRules,
} from "@/core/sync/syncedCollection";
import {
  type MergeOptions,
  type MergeOutcome,
  mergeCollections,
  resolveMerge,
  type SyncConflict,
  type SyncResolution,
} from "@/core/sync/syncMerge";

/**
 * The kept patterns, as a collection several machines keep in step.
 *
 * Nothing about carrying favourites between machines is about *patterns*: the
 * library is one use of the synced-collection machinery rather than a thing of
 * its own.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/PatternLibrary.swift#PatternLibrary
 */
export type PatternLibrary = SyncedCollection<SearchPatternEntry>;

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/PatternLibrary.swift#LibraryConflict */
export type LibraryConflict = SyncConflict<SearchPatternEntry>;

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/PatternLibrary.swift#LibraryResolution */
export type LibraryResolution = SyncResolution;

/**
 * What this machine keeps: its library, and the state it last agreed with each
 * of the other machines' files.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/PatternLibrary.swift#FavoritesDocument
 */
export type FavoritesDocument = SyncDocument<SearchPatternEntry>;

/**
 * What the merge is told about a pattern. §11 keeps one search once, whatever it
 * is called — so two entries that ask the same thing of a file are the same
 * thing said twice, and one of them has to go.
 *
 * The encoding travels as its raw name (`hex`, `utf16LE`, …), which both
 * editions spell the same way.
 *
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/PatternLibrary.swift#SearchPatternEntry.isDuplicate
 * @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/PatternLibrary.swift#SearchEncoding
 */
export const PATTERN_LIBRARY_RULES: SyncItemRules<SearchPatternEntry> = {
  sameContent: entriesSayTheSame,
  isDuplicate: isSameSearch,
  encode: encodeSearchPatternEntry,
  decode: decodeSearchPatternEntry,
};

/** The library file's text. */
export function encodePatternLibrary(library: PatternLibrary): string {
  return encodeCollection(library, PATTERN_LIBRARY_RULES);
}

/** A library read back from its file; throws for text that is not one. */
export function decodePatternLibrary(contents: string): PatternLibrary {
  return decodeCollection(contents, PATTERN_LIBRARY_RULES);
}

/** @upstream Packages/ByteRipperCore/Sources/ByteRipperCore/PatternLibrary.swift#LibraryMerge */
export function mergePatternLibraries(
  base: PatternLibrary | undefined,
  ours: PatternLibrary,
  theirs: PatternLibrary,
  options: MergeOptions = {}
): MergeOutcome<SearchPatternEntry> {
  return mergeCollections(base, ours, theirs, PATTERN_LIBRARY_RULES, options);
}

export function resolvePatternLibrary(
  outcome: MergeOutcome<SearchPatternEntry>,
  answers: ReadonlyMap<string, LibraryResolution>,
  now?: number
): PatternLibrary {
  return resolveMerge(outcome, answers, now);
}

export function encodeFavoritesDocument(document: FavoritesDocument): string {
  return encodeDocument(document, PATTERN_LIBRARY_RULES);
}

export function decodeFavoritesDocument(contents: string): FavoritesDocument {
  return decodeDocument(contents, PATTERN_LIBRARY_RULES);
}
