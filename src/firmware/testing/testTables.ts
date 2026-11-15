import {
  decodeProcessorTables,
  installProcessorTables,
  type ProcessorTables,
} from "@/firmware/intelCpuid/processorTables";
import names from "@/firmware/testing/IntelCPUID/IntelCPUIDBrandNames.json?raw";
import signatures from "@/firmware/testing/IntelCPUID/IntelMicrocodeSignatures.json?raw";

/**
 * The processor tables the tests read: a copy of
 * `github.com/maxshevelev/IntelCPUID`'s two files, as upstream's IntelCPUID
 * package keeps them in `Packages/IntelCPUID/Tests/Fixtures`. The app has no
 * copy of its own — it reads the repository at run time — so a test that asks
 * what a CPUID is installs these first. Refresh them from upstream's fixtures
 * when its data changes what a test asserts.
 *
 * @upstream Modules/FITTool/Tests/FITToolTests/TestTables.swift#TestTables
 * @upstream Modules/FITTool/Tests/FITToolTests/TestTables.swift#TestTables.folder
 * @upstream-differs the files are imported as text by the bundler rather than read off the source
 * tree at a path
 */
export const TEST_TABLES: ProcessorTables = decodeProcessorTables(names, signatures);

/** @upstream Modules/FITTool/Tests/FITToolTests/TestTables.swift#TestTables.tables */
export const testTables = (): ProcessorTables => TEST_TABLES;

/** @upstream Modules/FITTool/Tests/FITToolTests/TestTables.swift#TestTables.install */
export function installTestTables(): void {
  installProcessorTables(TEST_TABLES);
}
