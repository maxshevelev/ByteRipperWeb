import {
  currentProcessorTables,
  installProcessorTables,
  onProcessorTablesChange,
  type ProcessorTables,
} from "@/firmware/intelCpuid/processorTables";
import { intelCpuidRepository, type ProcessorTablesSource } from "@/state/intelCpuidRepository";
import type { Store } from "@/state/store";

/**
 * The one store of the processor tables — which processors stand behind a
 * CPUID — that every reader reads: the FIT panel's CPUID lines and their
 * popover, the microcode form's ⓘ and Extended CPUIDs, the agent's
 * `microcode_catalogue`, and the CPUID lookup that is to come. It is the page's
 * one copy (`currentProcessorTables`), seen as a store so a component
 * re-renders when newer tables land.
 *
 * Read when a reader opens (`refreshProcessorTables`), at most once a day, and
 * silently: what a fetch changes is names beside CPUIDs the panel already
 * shows, never what it can do, so there is no wait to show.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.current
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.didChange
 * @upstream-differs a store over the module's one copy, which is what a React component subscribes to
 */
export const processorTablesStore: Store<ProcessorTables> = {
  getSnapshot: currentProcessorTables,
  subscribe: onProcessorTablesChange,
  update: (produce) => installProcessorTables(produce(currentProcessorTables())),
};

/**
 * The live source: the repository at `github.com/maxshevelev/IntelCPUID`.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/IntelCPUIDRepository.swift#IntelCPUIDRepository.shared
 */
export const liveProcessorTablesSource: ProcessorTablesSource = intelCpuidRepository();

let source: ProcessorTablesSource = liveProcessorTablesSource;

/**
 * Where the tables come from — the repository. Swappable, because a test suite
 * that reaches GitHub is a suite that fails on a train: a test installs a
 * source of its own, and every reader asks that one.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.source
 */
export function processorTablesSource(): ProcessorTablesSource {
  return source;
}

/** @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.source */
export function setProcessorTablesSource(next: ProcessorTablesSource): void {
  source = next;
}

/**
 * Asks the source to bring the tables up to date: what every reader calls when
 * it opens.
 *
 * @upstream Packages/IntelCPUID/Sources/IntelCPUID/ProcessorTables.swift#ProcessorTables.refresh
 */
export function refreshProcessorTables(): Promise<void> {
  return source.refresh();
}
