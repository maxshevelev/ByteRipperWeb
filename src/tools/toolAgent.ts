import type { AgentArguments } from "@/core/agent/agentArguments";
import type { AgentAnswer } from "@/core/agent/agentTool";
import type { Json } from "@/core/agent/json";
import type { PaneId } from "@/state/paneId";
import type { ToolTransaction } from "@/tools/toolTransaction";

/**
 * What a tool-module says to an agent: the questions it answers from the bytes alone, the
 * comparisons of two documents, the changes it works out, where it can place a range, and what it
 * does in its open panel (`Design/PORT_AGENT.md`).
 *
 * The name, the description and every word of an answer are read by a model and stay in English
 * without the localization lookup (`Design/LOCALIZATION.md`). Words an answer borrows from the
 * panel — field labels the panel builds with it — come out in English too: the app runs every
 * query under the English override.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery
 */

/**
 * The part of a tool's host that reading needs: the document an agent named, whatever tab it is
 * in and whatever the panel there is showing. A pane's reads and its shared parse are the pane's
 * own, so a host that names the pane is all a query needs.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolHost.swift#ToolReadHost
 * @upstream-differs a pane's id: the stores that hold a pane's parse are keyed by it, and a
 * background document is a part no dock shows
 */
export interface ToolReadHost {
  /** The pane the document is in. */
  readonly pane: PaneId;
  /** What the panel's header calls the file it is working on. */
  readonly fileName: string;
  /** The content's size now, unsaved edits included. */
  readonly contentSize: number;
  /** A read, unsaved edits included. */
  read(start: number, end: number): Promise<Uint8Array>;
  /**
   * How many times the content has changed: what says whether an analysis made over it is still
   * about the bytes there now.
   */
  readonly contentVersion: number;
}

/**
 * A question a tool-module answers an agent from the bytes alone — the children of a node, a
 * node's fields, what holds an address. Declared on the module, because it needs no panel: it runs
 * against a read host for the document the agent names. The app adds the `document` argument
 * itself; a query's own schema names only its own arguments.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery.name
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery.title
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery.description
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery.properties
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery.required
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery.run
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentQuery.init
 */
export interface ToolAgentQuery {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** The properties of the argument object, not counting `document`. */
  readonly properties?: { readonly [key: string]: Json };
  readonly required?: readonly string[];
  readonly run: (host: ToolReadHost, args: AgentArguments) => Promise<AgentAnswer>;
}

/**
 * A question about two documents at once — the variables two dumps keep, set side by side by name
 * and GUID — answered from the bytes alone. Keyed comparison is the module's to do: only it knows
 * what makes an entry in one dump the same entry in another. The app adds both document arguments —
 * `document` and `against` — and hands the query a read host for each.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentComparison
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentComparison.name
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentComparison.title
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentComparison.description
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentComparison.properties
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentComparison.required
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentComparison.run
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentComparison.init
 */
export interface ToolAgentComparison {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  /** The properties of the argument object, not counting `document` and `against`. */
  readonly properties?: { readonly [key: string]: Json };
  readonly required?: readonly string[];
  readonly run: (
    host: ToolReadHost,
    against: ToolReadHost,
    args: AgentArguments
  ) => Promise<AgentAnswer>;
}

/**
 * What an edit comes to: the writes, and what the module has to say about them beyond the bytes —
 * where a component went, what it replaced, what moved.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.Change
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.Change.transaction
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.Change.undoDetail
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.Change.report
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.Change.init
 */
export interface ToolAgentChange {
  readonly transaction: ToolTransaction;
  /** Put after the undo step's name, language-neutral: a CPUID, a revision. Empty for none. */
  readonly undoDetail?: string;
  /** Members added to the answer, beside `written` and `undo`. */
  readonly report?: { readonly [key: string]: Json };
}

/**
 * A change to the file a tool-module works out for an agent — a checksum put right — with its panel
 * open or not. The module only *computes* the edit: `run` reads through a read host and returns the
 * transaction, and the app decides whether it is applied. It applies it only with the person's edit
 * switch on, only to a document in a pane, as one undo step — so a module cannot write on an
 * agent's behalf by any other door. Throw to refuse, with a sentence the model can act on.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.name
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.title
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.description
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.properties
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.required
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.undoName
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.run
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentEdit.init
 */
export interface ToolAgentEdit {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly properties?: { readonly [key: string]: Json };
  readonly required?: readonly string[];
  /**
   * What the Edit menu calls the step — `Undo <name>` — in the app's own language. Asked for outside
   * the English the agent is answered in.
   */
  readonly undoName: () => string;
  /** The change; a bare transaction is a change that is its writes and nothing more to say. */
  readonly run: (
    host: ToolReadHost,
    args: AgentArguments
  ) => Promise<ToolAgentChange | ToolTransaction>;
}

/**
 * A place in the file a tool-module can name: a node of its tree, by the id its own tools take.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentPlace
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentPlace.kind
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentPlace.id
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentPlace.name
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentPlace.range
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentPlace.init
 */
export interface ToolAgentPlace {
  /** Whose id it is — `"uefi"`, `"me"`: what tells an agent which tool takes it. */
  readonly kind: string;
  readonly id: string;
  readonly name: string;
  /** Its bytes in the file; nothing for one with no file address. */
  readonly range: { readonly start: number; readonly end: number } | undefined;
}

/**
 * How a tool-module says where ranges of the file are in its structure, for an answer that is not
 * its own — the runs a byte comparison found. Two questions. `areas`: the parts the file divides
 * into at the top — the descriptor's regions, the BIOS region's volumes — in address order. And
 * `locate`: for each range, the area it is in and the deepest node that covers it whole, or nothing
 * when the module cannot say. Where two modules both answer, the one with the higher `precedence` is
 * the finer one and wins: an ME partition inside the ME region.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentLocator
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentLocator.precedence
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentLocator.areas
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentLocator.locate
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentLocator.init
 */
export interface ToolAgentLocator {
  readonly precedence: number;
  readonly areas: (host: ToolReadHost) => Promise<ToolAgentPlace[]>;
  readonly locate: (
    host: ToolReadHost,
    ranges: readonly { readonly start: number; readonly end: number }[]
  ) => Promise<ToolAgentPlace[][]>;
}

/**
 * Something a tool-module does in its open panel at an agent's asking — choose a node in the tree,
 * say which node the reader chose. Declared on the module like a query, so the list an agent sees
 * does not change with what is open; it runs on the **live session** of that module on the pane
 * holding the document. With no session there, the app answers that the panel is not open, and the
 * agent can open it (`open_panel`) or point at the bytes instead.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction.name
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction.title
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction.description
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction.properties
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction.required
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction.changesView
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction.run
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolAgentAction.init
 */
export interface ToolAgentAction<Session = unknown> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly properties?: { readonly [key: string]: Json };
  readonly required?: readonly string[];
  /** Whether the action changes what is on screen, as opposed to reading what the panel has chosen. */
  readonly changesView: boolean;
  readonly run: (session: Session, args: AgentArguments) => Promise<AgentAnswer>;
}

/**
 * What a module hands the app for an agent. Every list is optional: a tool-module that answers no
 * questions is one an agent cannot ask.
 *
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolModule
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.agentQueries
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolModule.agentQueries
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.agentComparisons
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolModule.agentComparisons
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.agentEdits
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolModule.agentEdits
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.agentLocator
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolModule.agentLocator
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolModule.swift#ToolModule.agentActions
 * @upstream Packages/ToolModuleKit/Sources/ToolModuleKit/ToolAgent.swift#ToolModule.agentActions
 */
export interface ToolAgentSurface {
  readonly agentQueries?: readonly ToolAgentQuery[];
  readonly agentComparisons?: readonly ToolAgentComparison[];
  readonly agentEdits?: readonly ToolAgentEdit[];
  readonly agentLocator?: ToolAgentLocator;
  readonly agentActions?: readonly ToolAgentAction[];
}
