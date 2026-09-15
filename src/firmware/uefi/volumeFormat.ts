/**
 * The volume header's own constants.
 *
 * A leaf module of its own, and that is not tidiness: the raw scan needs the
 * signature to look for and the volume parser needs the scan to search a
 * region, so the two import each other. A function-level cycle is fine — by the
 * time either runs, both modules are ready — but a *constant* read at module
 * load is not, and reading one through that cycle is how `FV` came back
 * undefined in a benchmark whose entry point happened to load the other side
 * first. Constants that both sides need live where neither imports the other.
 */

/**
 * `EFI_FIRMWARE_VOLUME_HEADER` and what follows from it.
 *
 * @upstream Packages/UEFIImage/Sources/UEFIImage/VolumeParser.swift#FV
 */
export const FV = {
  /**
   * `_FVH`, which sits at a fixed `0x28` from the start of the header. The
   * search is for the signature and the header is found by stepping back —
   * there is nothing at offset zero of a volume worth matching on.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/VolumeParser.swift#FV.signature
   */
  signature: 0x4856_465f,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VolumeParser.swift#FV.signatureOffset */
  signatureOffset: 0x28,
  /**
   * Up to the block map.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/VolumeParser.swift#FV.headerSize
   */
  headerSize: 0x38,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VolumeParser.swift#FV.blockMapEntrySize */
  blockMapEntrySize: 8,
  /**
   * A block map long enough to be a loop rather than a map.
   *
   * @upstream Packages/UEFIImage/Sources/UEFIImage/VolumeParser.swift#FV.maxBlockMapEntries
   */
  maxBlockMapEntries: 0x1000,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VolumeParser.swift#FV.erasePolarity */
  erasePolarity: 0x0000_0800,
  /** @upstream Packages/UEFIImage/Sources/UEFIImage/VolumeParser.swift#FV.checksumOffset */
  checksumOffset: 0x32,
} as const;
