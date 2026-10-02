/**
 * What the shown analysis has not been read with yet. The panel shows an analysis the
 * moment it has one and reads it again when `FileTable.dat` and `Huffman.dat` arrive;
 * a row that depends on one of them says "Loading…" until then rather than a value
 * the second reading may change.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAPending.swift#MEAPending
 */
export interface MEAPending {
  /**
   * A file table is wanted and has not been read with: an EFS volume's files are not
   * known, so neither is whether it holds any.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAPending.swift#MEAPending.fileTable
   */
  readonly fileTable: boolean;
  /**
   * Dictionaries are wanted and have not been read with: the Huffman modules have not
   * been checked.
   *
   * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAPending.swift#MEAPending.huffman
   */
  readonly huffman: boolean;
}

/**
 * Everything known: the analysis read every database it wanted, or the ones it could
 * not get are not coming.
 *
 * @upstream Packages/MEPresentation/Sources/MEPresentation/MEAPending.swift#MEAPending.nothing
 */
export const NOTHING_PENDING: MEAPending = { fileTable: false, huffman: false };
