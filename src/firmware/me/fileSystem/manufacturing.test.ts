import { describe, expect, it } from "vitest";
import {
  decideManufacturing,
  ManufacturingFileID,
  manufacturingLock,
} from "@/firmware/me/fileSystem/manufacturing";

/**
 * Whether an image closes Manufacturing on the first boot of a board. Two mechanisms
 * decide it, and the descriptor's is the one at work in a serial image: the flag
 * `CsePlugin:EomNvar` is an explicit order only MFIT sets, so a flag of 0 says nothing by
 * itself.
 */

const decide = ({
  image,
  live,
  descriptorOpen,
  hasSwitch = true,
  liveFilesResolved = true,
}: {
  image?: number;
  live?: number;
  descriptorOpen?: boolean;
  hasSwitch?: boolean;
  liveFilesResolved?: boolean;
}) =>
  decideManufacturing({
    imageEOMConfig: image,
    liveEOMConfig: live,
    descriptorOpen,
    hasSwitch,
    liveFilesResolved,
  });

describe("the Manufacturing verdict", () => {
  // A serial image: the flag is clear, the descriptor carries the factory rights, and the
  // platform closes Manufacturing on its first boot. A clear flag is not "nothing will
  // happen".
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testAFactoryRightsImageClosesWithoutTheFlag
  it("closes a factory-rights image without the flag", () => {
    const { state, basis } = decide({ image: 0x00, descriptorOpen: false });
    expect(state).toBe("willClose");
    expect(basis.flag).toBe(false);
    expect(basis.flexible).toBe(0);
    expect(basis.page).toBe("imageConfiguration");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testAGenerationWithoutTheFlagIsDecidedByTheDescriptor
  it("is decided by the descriptor on a generation without the flag", () => {
    expect(decide({ descriptorOpen: false }).state).toBe("willClose");
  });

  // A service image: the flag is clear *and* the descriptor is open — the one state in
  // which nothing closes Manufacturing.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testAnOpenDescriptorWithAClearFlagClosesNothing
  it("closes nothing with an open descriptor and a clear flag", () => {
    const { state, basis } = decide({ image: 0x00, descriptorOpen: true });
    expect(state).toBe("willNotClose");
    expect(basis.flag).toBe(false);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testASetFlagClosesEvenWithAFactoryDescriptor
  it("closes with the flag set, whatever the descriptor", () => {
    const { state, basis } = decide({ image: 0x01, descriptorOpen: false });
    expect(state).toBe("willClose");
    expect(basis.flag).toBe(true);
  });

  // An image built by MFIT with the flag set and never booted: the image's own page is
  // the answer.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testTheImagePageIsTheFlagSourceWhenTheFileSystemIsEmpty
  it("reads the flag from the image's page when the file system is empty", () => {
    const { state, basis } = decide({ image: 0x01 });
    expect(state).toBe("willClose");
    expect(basis.page).toBe("imageConfiguration");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testTheLivePageIsTheFallbackForTheFlag
  it("falls back on the live page for the flag", () => {
    const { state, basis } = decide({ live: 0x01, descriptorOpen: false });
    expect(state).toBe("willClose");
    expect(basis.page).toBe("liveMFS");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testTheImagePageOutranksTheLiveOne
  it("puts the image's page above the live one", () => {
    const { state, basis } = decide({ image: 0x01, live: 0x00, descriptorOpen: false });
    expect(state).toBe("willClose");
    expect(basis.flag).toBe(true);
    expect(basis.page).toBe("imageConfiguration");
  });

  // The flag set with the descriptor open is the combination MFIT refuses to build.
  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testTheFlagWithAnOpenDescriptorIsItsOwnVerdict
  it("gives the flag with an open descriptor a verdict of its own", () => {
    const { state, basis } = decide({ image: 0x01, descriptorOpen: true });
    expect(state).toBe("unexpectedCombination");
    expect(basis.descriptorOpen).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testTheFlexibleSettingIsReadFromTheUpperBits
  it("reads the flexible setting from the upper bits", () => {
    expect(decide({ image: 0x03 }).basis.flexible).toBe(1);
    expect(decide({ image: 0x05 }).basis.flexible).toBe(2);
    expect(decide({ image: 0x07 }).basis.flexible).toBe(3);
    expect(decide({ image: 0x07 }).basis.flag).toBe(true);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testAFirmwareWithoutTheMachinery
  it("claims nothing for a firmware without the machinery", () => {
    expect(
      decide({ descriptorOpen: false, hasSwitch: false, liveFilesResolved: false }).state
    ).toBe("noSwitch");
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testNoDescriptorAndNoFlagIsUnknown
  it("is unknown with no descriptor and no flag", () => {
    const { state, basis } = decide({ image: 0x00 });
    expect(state).toBe("unknown");
    expect(basis.flag).toBe(false);
    expect(basis.descriptorOpen).toBeUndefined();
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#ManufacturingTests.testTheFileIDsAreTheFTBLKeys
  it("keys the records by the FTBL File IDs", () => {
    expect(ManufacturingFileID.eom).toBe(0x1002_0000);
    expect(ManufacturingFileID.eomConfig).toBe(0x1001_ee00);
    expect(ManufacturingFileID.manufLock).toBe(0x1002_0100);
  });

  // @upstream Packages/MEFirmware/Tests/MEFirmwareTests/ManufacturingTests.swift#BootGuardReaderTests.testTheBoardsLockByteIsReadAsAState
  it("reads the board's lock byte as a state", () => {
    expect(manufacturingLock(0)).toEqual({ kind: "open" });
    expect(manufacturingLock(1)).toEqual({ kind: "locked" });
    expect(manufacturingLock(2)).toEqual({ kind: "other", byte: 2 });
    expect(manufacturingLock(0xff)).toEqual({ kind: "other", byte: 0xff });
  });
});
