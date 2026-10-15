import {
  type AgentAnnotation,
  type AnnotationDecoded,
  type AnnotationFile,
  type AnnotationSite,
  annotationFileName,
  annotationPath,
  type FileIdentity,
  sameFile,
} from "@/core/agent/agentAnnotation";
import { AgentArguments, AgentSchema } from "@/core/agent/agentArguments";
import { AgentPage } from "@/core/agent/agentPage";
import { baseName } from "@/core/agent/agentSurvey";
import {
  type AgentTool,
  AgentToolError,
  agentTool,
  jsonAnswer,
  READ_ONLY,
} from "@/core/agent/agentTool";
import { isObject, type Json } from "@/core/agent/json";
import { L } from "@/core/localization/localization";
import { LenovoDMIBlockCodec } from "@/firmware/lenovoDmi/lenovoDmiValue";
import {
  addAnnotation,
  allAnnotations,
  claimAnnotationId,
  fileIdentityOf,
  removeAnnotations,
} from "@/state/agent/agentAnnotationStore";
import type { AgentDesk, AgentPlace } from "@/state/agent/agentDesk";
import type { AgentDumpTools } from "@/state/agent/agentDumpTools";
import { hexText, rangeJson } from "@/state/agent/agentHostTools";
import { agentShell } from "@/state/agent/agentShell";
import { type Reopened, reopenFile } from "@/state/fileReopen";
import { readyFirmware } from "@/state/firmwareReady";
import {
  askUefiAgent,
  firmwareFor,
  firmwareNodeAt,
  reachFirmwarePaths,
} from "@/state/firmwareStore";
import { recordJump, recordStepFromNotes } from "@/state/navigationStore";
import { showNotice } from "@/state/noticeStore";
import { PANE_IDS, type SlotId, surfaceOf } from "@/state/paneId";
import { activate, selectPane, sessionOn, toolController } from "@/state/toolController";
import { beginBlockingWork } from "@/state/toolWork";
import { uefiPanelLink } from "@/state/uefiPanelLinks";
import { UEFIPartCodec } from "@/state/uefiPartCodec";
import {
  notesPanelIsUp,
  openInPane,
  type PaneId,
  paneState,
  workspaceStore,
} from "@/state/workspaceStore";
import { decodedFromWire, type WireDecoded } from "@/tools/uefi/agent/uefiAgentAnnotations";
import type { WireContentMatch } from "@/workers/protocol";

/** The UEFI Structure tool's id, which an annotation's place is shown in. */
/** @upstream ByteRipperApp/Tools/ToolRegistry.swift#ToolRegistry.uefiStructure */
const UEFI_STRUCTURE = "dev.maxik.tool.uefi-structure";

export const MAX_TITLE = 80;
export const MAX_NOTE = 600;

/**
 * `annotate`, `annotations` and `remove_annotations`: an agent's statements about places in files
 * (`Design/AGENT_PLAN.md`, "Annotations"; issue #37), and the notes the person makes beside them.
 *
 * One kind where there were two: a mark, drawn but gone with its document, and a finding, kept
 * but drawn nowhere. An annotation is kept for the whole app and for as long as it runs
 * (`agentAnnotationStore`), and a pane draws the ones for its file whenever it shows it. The
 * Annotations panel lists them.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.desk
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.init
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.tools
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.maxTitle
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.maxNote
 */
export class AgentAnnotationTools {
  readonly desk: AgentDesk;
  private readonly dumpTools: AgentDumpTools;

  constructor(desk: AgentDesk, dumpTools: AgentDumpTools) {
    this.desk = desk;
    this.dumpTools = dumpTools;
  }

  tools(): AgentTool[] {
    return [this.annotateTool(), this.annotationsTool(), this.removeTool()];
  }

  // MARK: - The person's notes

  /**
   * A note the person makes on `[start, end)` of `pane` — the dump's right-click ▸ Add
   * Annotation…: placed the way an agent's on the same bytes is, in a part through to its file.
   * Answers whether it was made: a pane with no document to hold one makes none.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.addNote
   */
  // help: menu.offset.note
  async addNote(
    title: string,
    note: string,
    pane: PaneId,
    start: number,
    end: number
  ): Promise<boolean> {
    const place = this.desk.placeOf(pane);
    if (place === undefined) return false;
    await this.annotate(
      new AgentArguments({
        title,
        note,
        document: place.id,
        offset: hexText(start),
        length: hexText(end - start),
      }),
      "person"
    );
    return true;
  }

  /**
   * The person's note on node `id` of `pane`'s tree, placed as the agent's `node` form places one.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.addNote
   */
  async addNodeNote(title: string, note: string, pane: PaneId, id: string): Promise<boolean> {
    const place = this.desk.placeOf(pane);
    if (place === undefined) return false;
    await this.annotate(
      new AgentArguments({ title, note, document: place.id, node: id }),
      "person"
    );
    return true;
  }

  // MARK: - annotate

  private annotateTool(): AgentTool {
    return agentTool({
      name: "annotate",
      title: "Annotate a place",
      description:
        "Puts an annotation on a place in a file: a short `title` (what the bytes are), an optional " +
        "`note` (why they matter, or what you found there), and the place — a `document` or a file " +
        "`path`, with `offset` and `length`, or a UEFI `node` — whole, or with `offset` and `length` " +
        "counted from the node's first byte: a `find_bytes` match with `node` is `node` and " +
        "`node_offset`. It is listed in the Annotations panel and drawn over the bytes — a dashed " +
        "outline, the note when the person rests the pointer on them — whenever the file is on screen, " +
        "now or after it is opened later; it is kept when the file closes. Use it both to show what " +
        "bytes are while you explain them and to leave a result for the person to check — with " +
        "`survey`, one on each file that matches. Whenever it is about bytes you have already " +
        "annotated — a pointer and its target, a size and the stretch it names, a checksum and what it " +
        "covers — annotate the other end first and pass its id in `related_to`: the person sees the " +
        "relation and cannot otherwise. `reveal: true` also brings the place on screen, opening the " +
        "file in a pane if it is not. In a part — a fragment panel — it goes to the file the part came " +
        "out of, at the same bytes where the part keeps the file's addresses, otherwise at the bytes " +
        "the part was decoded from; `from_part` says where it was in the part. A place in bytes that " +
        "are not the file's own — what a compressed section decompresses to, a LENV block decoded, " +
        "given as a node there or as a part of them — is kept there: the annotation answers `decoded` " +
        "(the section or block, the range in its bytes, the `codecs`), the person's double-click opens " +
        "those bytes in a fragment panel at the place, and the card shows the codecs as badges, so the " +
        "title need not name them. Annotations go with `remove_annotations` or when the person clears " +
        "them.",
      inputSchema: AgentSchema.object(
        {
          title: AgentSchema.string(
            `A few words: what the bytes are. At most ${MAX_TITLE} characters.`
          ),
          note: AgentSchema.string(
            `A sentence or two: why they matter, or what was found. At most ${MAX_NOTE} characters.`
          ),
          document: AgentSchema.string("The document it is in. Default: the focused one."),
          path: AgentSchema.string("Or the file it is in, by path, open or not."),
          offset: AgentSchema.offset(
            "The first byte: in the document, or with `node` from the node's first byte."
          ),
          length: AgentSchema.offset("How many bytes. Default 1."),
          node: AgentSchema.string(
            'Or the UEFI node it is about, e.g. "0.2.5" — inside a compressed section too.'
          ),
          related_to: AgentSchema.strings(
            'Ids of annotations this one is about, e.g. ["a1"] for the target of a pointer. Give it ' +
              "whenever there is such an annotation."
          ),
          reveal: AgentSchema.boolean("Also bring the place on screen. Default false."),
        },
        ["title"]
      ),
      annotations: { readOnly: false, destructive: false, idempotent: false },
      run: async (call) => jsonAnswer(await this.annotate(call.arguments, "agent")),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.annotate */
  async annotate(args: AgentArguments, author: "agent" | "person"): Promise<Json> {
    const title = args.string("title").trim();
    const note = (args.optionalString("note") ?? "").trim();
    const related = args.strings("related_to");
    if (title === "") throw new AgentToolError("Argument `title` must say something.");
    if ([...title].length > MAX_TITLE) {
      throw new AgentToolError(
        `Argument \`title\`: at most ${MAX_TITLE} characters; put the rest in \`note\`.`
      );
    }
    if ([...note].length > MAX_NOTE) {
      throw new AgentToolError(`Argument \`note\`: at most ${MAX_NOTE} characters.`);
    }
    const known = new Set(allAnnotations().map((one) => one.id));
    const missing = related.find((id) => !known.has(id));
    if (missing !== undefined) {
      throw new AgentToolError(
        `No annotation ${missing}. Call \`annotations\` for the ones there are.`
      );
    }
    const offset = args.optionalOffset("offset");
    const length = args.optionalOffset("length") ?? 1;
    if (length <= 0) throw new AgentToolError("Argument `length` must be at least 1.");
    let node = args.optionalString("node");
    // Without `node`, `offset` is in the document; with it, in the node.
    let range: readonly [number, number] | undefined =
      node === undefined && offset !== undefined ? [offset, offset + length] : undefined;
    const within: readonly [number, number] | undefined =
      node !== undefined && offset !== undefined ? [offset, offset + length] : undefined;
    if (node === undefined && args.has("length") && offset === undefined) {
      throw new AgentToolError("Give `offset` with `length`.");
    }
    let decoded: AnnotationDecoded | undefined;
    let site: AnnotationSite | undefined;
    let file: AnnotationFile;
    let fromPart: Json | undefined;
    let size: number | undefined;
    /** The place on screen or in the background that holds the file whole, to read its tree. */
    let root: AgentPlace | undefined;

    const path = args.optionalString("path");
    if (path !== undefined) {
      if (args.has("document")) throw new AgentToolError("Give `document` or `path`, not both.");
      const wanted = this.dumpTools.filePath(path);
      const stat = await this.dumpTools.stat(wanted).catch(() => {
        throw new AgentToolError(`There is no file at ${wanted}.`);
      });
      size = stat.size;
      const identity: FileIdentity = {
        name: baseName(stat.path),
        size: stat.size,
        modified: stat.modified,
        path: stat.path,
      };
      file = { kind: "disk", identity };
      root = this.rootPlaceOf(identity);
      // A node of a file that is open somewhere is placed by its tree.
      if (node !== undefined && root !== undefined) {
        ({ range, decoded, site } = await this.nodePlace(root, node, within));
      } else if (node !== undefined && within !== undefined) {
        throw new AgentToolError(
          `A node's bytes are placed by the file's tree: open ${identity.name} first, or give the node alone.`
        );
      }
    } else {
      const place = this.desk.placeNamed(args.optionalString("document"));
      let pane = place.onScreenOrBackground();
      const isPart = paneState(pane)?.origin !== undefined;
      if (node !== undefined) {
        ({ range, decoded, site } = await this.nodePlace(place, node, within));
        if (isPart) {
          if (decoded !== undefined) {
            throw new AgentToolError(
              `Node ${node} is in a compressed section of ${place.named}. Annotate it on the ` +
                "document that part was opened from, or open that section as a part of its own."
            );
          }
          // A part's node is named by the part's own tree: it goes as its bytes, which mean
          // something in the file.
          node = undefined;
          site = undefined;
        }
      }
      size = place.document.size;
      if (range !== undefined && range[1] > size) {
        throw new AgentToolError(
          `The range ${hexText(range[0])}–${hexText(range[1])} runs past the end of ${place.named}, ` +
            `which is ${hexText(size)} bytes long.`
        );
      }
      if (isPart) {
        const answered: { [key: string]: Json } = { document: place.id };
        if (range !== undefined) answered.range = rangeJson(range[0], range[1]);
        // A part decoded from the file — a decompressed body, a LENV block decoded — keeps the
        // place in its own bytes, where the annotation is shown.
        if (range !== undefined) {
          const found = await this.partPlace(pane, range);
          if (found !== undefined) {
            decoded = found;
            answered.decoded = true;
          }
        }
        // Out through every part to the file: byte for byte where the codec keeps the addresses,
        // otherwise the bytes the part was decoded from.
        let exact = true;
        let mapped = range;
        let reachesFile = true;
        for (let origin = paneState(pane)?.origin; origin !== undefined; ) {
          if (paneState(origin.parent) === undefined) {
            reachesFile = false;
            break;
          }
          const source = origin.sourceRange;
          if (mapped !== undefined && origin.codec.keepsOffsets && exact) {
            mapped = [source[0] + mapped[0], source[0] + mapped[1]];
          } else {
            mapped = source;
            exact = false;
          }
          pane = origin.parent;
          origin = paneState(pane)?.origin;
        }
        const top = paneState(pane);
        if (reachesFile && top !== undefined && !top.untitled) {
          // Bytes that are no bytes of the file are not drawn over the whole section they came
          // out of.
          range = exact || decoded === undefined ? mapped : undefined;
          answered.exact = exact;
          fromPart = answered;
        } else {
          // A part of something never saved stays on the part.
          pane = place.onScreenOrBackground();
          decoded = undefined;
        }
      }
      const held = paneState(pane);
      if (held === undefined) throw new AgentToolError(`${place.named} holds no bytes.`);
      if (held.untitled || held.origin !== undefined) {
        file = { kind: "document", document: new WeakRef(held.document), name: held.name };
      } else {
        const identity = fileIdentityOf(pane) as FileIdentity;
        const entry = this.desk.background.entryOf(pane);
        file = {
          kind: "disk",
          identity: entry === undefined ? identity : { ...identity, path: entry.path },
        };
        root = this.desk.placeOf(pane);
      }
      size = held.document.size;
    }
    if (range !== undefined && size !== undefined && range[1] > size) {
      throw new AgentToolError(
        `The range ${hexText(range[0])}–${hexText(range[1])} runs past the end of the file, ` +
          `which is ${hexText(size)} bytes long.`
      );
    }
    if (
      range === undefined &&
      node === undefined &&
      decoded === undefined &&
      annotationPath(file) === undefined
    ) {
      throw new AgentToolError("Give the place: `offset`, or `node`.");
    }
    // Bytes of the file inside a LENV block stored encoded are read decoded, however the place was
    // given: by a node, or — as a survey's answers give it — by its addresses.
    if (
      decoded === undefined &&
      range !== undefined &&
      root !== undefined &&
      file.kind === "disk"
    ) {
      decoded = await this.ask(root, { ask: "encodedPlace", range: [...range] }).then(
        (json) => toDecoded(decodedFromWire(json)),
        () => undefined
      );
    }
    if (site === undefined && root !== undefined && file.kind === "disk") {
      site = await this.ask(root, {
        ask: "site",
        ...(node === undefined ? {} : { node }),
        ...(range === undefined ? {} : { range: [...range] }),
        ...(decoded === undefined ? {} : { decoded: wireOf(decoded) }),
      }).then(siteFrom, () => undefined);
    }
    const annotation: AgentAnnotation = {
      id: claimAnnotationId(),
      file,
      range,
      node,
      title,
      note,
      decoded,
      relatedTo: related,
      site,
      author,
    };
    addAnnotation(annotation, notesPanelIsUp(workspaceStore.getSnapshot()));
    if (args.bool("reveal", false)) await this.show(annotation.id);
    const described = this.describe(annotation);
    if (fromPart === undefined || !isObject(described)) return described;
    return { ...described, from_part: fromPart };
  }

  /** The place that holds the file `identity` names whole: on screen first, else in the background. */
  private rootPlaceOf(identity: FileIdentity): AgentPlace | undefined {
    const places = this.desk.places().filter((place) => {
      const pane = place.pane;
      if (pane === undefined) return false;
      const own = fileIdentityOf(pane);
      if (own === undefined) return false;
      const entry = this.desk.background.entryOf(pane);
      return sameFile(entry === undefined ? own : { ...own, path: entry.path }, identity);
    });
    return places.find((place) => place.isOnScreen) ?? places[0];
  }

  /** A question of the annotations asked of `place`'s tree, where the tree is. */
  private async ask(place: AgentPlace, values: { [key: string]: Json }): Promise<Json> {
    const pane = place.onScreenOrBackground();
    await readyFirmware(pane);
    const response = await askUefiAgent(pane, {
      query: "uefi_annotation",
      values,
      answerBound: 1 << 20,
      contentVersion: place.document.contentGeneration,
    });
    if (response.error !== undefined) throw new AgentToolError(response.error);
    return response.answer as Json;
  }

  /**
   * Where node `node` of `place` is — or the stretch `within` of its bytes: in the file, or in
   * what its compressed section decompresses to.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.nodePlace
   */
  private async nodePlace(
    place: AgentPlace,
    node: string,
    within: readonly [number, number] | undefined
  ): Promise<{
    range: readonly [number, number] | undefined;
    decoded: AnnotationDecoded | undefined;
    site: AnnotationSite | undefined;
  }> {
    const answer = (await this.ask(place, {
      ask: "nodePlace",
      node,
      ...(within === undefined ? {} : { within: [...within] }),
    })) as { range: [number, number] | null; decoded: Json; site: Json };
    return {
      range: answer.range === null ? undefined : [answer.range[0], answer.range[1]],
      decoded: toDecoded(decodedFromWire(answer.decoded)),
      site: siteFrom(answer.site),
    };
  }

  /**
   * The place `range` of part `pane` is in its own bytes, when the part is bytes of a file decoded
   * — a compressed section's body, a LENV block — opened from the file's own pane.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.partPlace
   */
  private async partPlace(
    pane: PaneId,
    range: readonly [number, number]
  ): Promise<AnnotationDecoded | undefined> {
    const origin = paneState(pane)?.origin;
    if (origin === undefined) return undefined;
    const parent = this.desk.placeOf(origin.parent);
    const parentState = paneState(origin.parent);
    if (
      parent === undefined ||
      parentState?.origin !== undefined ||
      parentState?.untitled !== false
    ) {
      return undefined;
    }
    const codec = origin.codec;
    try {
      if (codec instanceof UEFIPartCodec && codec.target.space.length > 0) {
        const answer = (await this.ask(parent, {
          ask: "spacePlace",
          space: [...codec.target.space],
        })) as { holder: string; codecs: (string | null)[] } | null;
        if (answer === null) return undefined;
        const start = codec.target.range?.start ?? 0;
        return {
          holder: answer.holder,
          source: origin.sourceRange,
          space: codec.target.space,
          range: [start + range[0], start + range[1]],
          codecs: answer.codecs.map((one) => one ?? L("Decompressed", { context: "part badge" })),
          xorKey: undefined,
        };
      }
      if (codec instanceof LenovoDMIBlockCodec && codec.encodes) {
        const holder = (await this.ask(parent, {
          ask: "blockAt",
          source: [...origin.sourceRange],
        })) as string | null;
        if (holder === null) return undefined;
        return {
          holder,
          source: origin.sourceRange,
          space: undefined,
          range,
          codecs: [codec.badge.text],
          xorKey: codec.key,
        };
      }
    } catch {
      // A file whose tree does not read: the place stays the part's bytes in the file.
    }
    return undefined;
  }

  // MARK: - remove_annotations

  private removeTool(): AgentTool {
    return agentTool({
      name: "remove_annotations",
      title: "Remove annotations",
      description:
        "Removes annotations: the ones named in `ids`, or every one on a `document` or a file `path`, " +
        "or — with `all` — every one. Relations to a removed annotation go with it.",
      inputSchema: AgentSchema.object({
        ids: AgentSchema.strings('The annotations to remove, e.g. ["a2", "a3"].'),
        document: AgentSchema.string("Remove every annotation on this document's file."),
        path: AgentSchema.string("Remove every annotation on this file."),
        all: AgentSchema.boolean("Remove every annotation."),
      }),
      annotations: { readOnly: false, destructive: false, idempotent: true },
      run: async (call) => jsonAnswer(this.removeNamed(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.removeTool */
  removeNamed(args: AgentArguments): Json {
    const ids = new Set(args.strings("ids"));
    const everything = args.bool("all", false);
    const file = this.fileFilter(args);
    if (ids.size === 0 && !everything && file === undefined) {
      throw new AgentToolError(
        "Name the annotations in `ids`, a `document` or a `path`, or pass `all: true`."
      );
    }
    const removed = removeAnnotations(
      (one) => everything || ids.has(one.id) || (file?.(one) ?? false)
    );
    if (ids.size > 0 && removed.length < ids.size) {
      const gone = new Set(removed);
      return { removed, not_found: [...ids].filter((id) => !gone.has(id)).sort() };
    }
    return { removed };
  }

  // MARK: - Going to an annotation

  /**
   * The place on screen that shows the annotation's file as a whole.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.place
   */
  placeOf(annotation: AgentAnnotation): AgentPlace | undefined {
    return this.desk.places().find((place) => {
      const pane = place.pane;
      if (!place.isOnScreen || pane === undefined) return false;
      const held = paneState(pane);
      if (held === undefined || held.origin !== undefined) return false;
      if (annotation.file.kind === "document") {
        return annotation.file.document.deref() === held.document;
      }
      const identity = fileIdentityOf(pane);
      return identity !== undefined && sameFile(annotation.file.identity, identity);
    });
  }

  /**
   * Brings the annotation's file forward — the pane that has it, or a free one — and goes to its
   * place: what a double-click on its card does, and `reveal`. A step of the navigation history.
   *
   * A place the UEFI tree knows is gone to the way the UEFI Structure panel's Contents search
   * results go to a match: in the file's own bytes as a click on a row does; in decompressed or
   * decoded bytes as a double-click does — a fragment panel of them, the place selected.
   *
   * A file no pane has is opened again the way File ▸ Open Recent opens one — by the handle it was
   * opened with, or in the desktop shell by its full path (`reopenFile`). A file no longer there is
   * said to be gone, as upstream's Notes window says it, and nothing else is: a file that is there
   * but could not be opened says why. Into a free pane; with both panes holding a file the person —
   * `byPerson`, a card's double-click — is asked which one gives way, and an agent's `reveal` is
   * refused, since an agent never replaces a pane.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.show
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.go
   * @upstream ByteRipperApp/Notes/NotesWindowController.swift#NotesWindowController.show
   */
  async show(id: string, byPerson = false): Promise<void> {
    const annotation = allAnnotations().find((one) => one.id === id);
    if (annotation === undefined) return;
    // A card's double-click leaves the panel: Back in the tab goes to the panel again. An agent's
    // reveal leaves the place the person was on, whatever is up over it.
    const fromNotes = byPerson && notesPanelIsUp(workspaceStore.getSnapshot());
    let place = this.placeOf(annotation);
    if (place === undefined) {
      const name = annotationFileName(annotation.file);
      const reopened: Reopened =
        annotation.file.kind === "disk"
          ? await reopenFile(annotation.file.identity)
          : { kind: "unreachable" };
      switch (reopened.kind) {
        case "unreachable":
          showNotice("warning", [L("“%1$@” is not open.", name), L("Annotations")]);
          return;
        case "gone":
          showNotice("warning", [
            L("The file is not there"),
            L("“%1$@” has been moved or deleted since the annotation was made.", reopened.where),
          ]);
          return;
        case "failed":
          showNotice("warning", [L("Could not open file."), reopened.reason]);
          return;
        case "opened":
          break;
      }
      let slot: SlotId | undefined = PANE_IDS.find((one) => paneState(one) === undefined);
      if (slot === undefined) {
        const choose = agentShell.choosePaneToReplace;
        if (!byPerson || choose === undefined) {
          showNotice("warning", [
            L("Could not open file."),
            "Both panes of the window hold a file, and an agent does not replace one.",
          ]);
          return;
        }
        slot = await choose(name);
        if (slot === undefined) return;
      }
      openInPane(slot, reopened.file);
      place = this.desk.placeOf(slot);
      if (place === undefined) return;
    }
    const pane = place.onScreen();
    agentShell.bringForward?.(pane);
    if (annotation.range !== undefined && annotation.range[1] > place.document.size) return;
    if (fromNotes) recordStepFromNotes();
    else recordJump(pane);
    const match = matchOf(annotation);
    // A file just opened has its tree still to read, and whether the place is a node — and how to
    // open it — is the tree's to say; the block or the section the place is in may sit in
    // branches nobody has opened, and a compressed one is decompressed to open it. Seconds on a
    // large image: the window says so, in a modal the person can cancel, and the place is gone to
    // once all of it is read. Without the wait the route was chosen before the tree was there,
    // and the file opened with no panel of the place.
    if (annotation.site !== undefined || annotation.decoded !== undefined) {
      const ids = [match?.node, match?.section].filter((one) => one !== undefined);
      const held = firmwareFor(pane);
      const roots = held?.status === "ready" ? held.roots : undefined;
      if (roots === undefined || ids.some((id) => firmwareNodeAt(roots, id) === undefined)) {
        let cancelled = false;
        const work = beginBlockingWork(L("Reading UEFI…"), () => {
          cancelled = true;
        });
        try {
          await readyFirmware(pane);
          if (!cancelled && ids.length > 0) await reachFirmwarePaths(pane, ids);
        } catch {
          // A tree that cannot be read leaves the bytes to go to, below.
        } finally {
          work.finish();
        }
        if (cancelled) return;
      }
    }
    // A file the tree reads as nothing but padding is no firmware: its place is shown in the dump
    // alone.
    const isFirmware =
      firmwareFor(pane)?.roots?.some((root) => root.kind !== "padding") === true ||
      annotation.decoded !== undefined;
    if (match !== undefined && isFirmware) {
      const surface = surfaceOf(pane);
      if (sessionOn(toolController.getSnapshot(), surface).activeIdentifier !== UEFI_STRUCTURE) {
        activate(UEFI_STRUCTURE, surface);
      }
      if (sessionOn(toolController.getSnapshot(), surface).boundPane !== pane) selectPane(pane);
      const link = await uefiPanelLink(pane);
      if (link !== undefined) {
        if (annotation.decoded !== undefined) await link.open(match);
        else await link.goTo(match);
        return;
      }
    }
    const range = annotation.range;
    if (range === undefined) return;
    await agentShell.reveal?.(pane, range[0], range[1], range[1] > range[0]);
  }

  // MARK: - annotations

  private annotationsTool(): AgentTool {
    return agentTool({
      name: "annotations",
      title: "List annotations",
      description:
        "The annotations made so far, oldest first — on every file, or on a `document` or a file " +
        "`path`: id, the file's `path` (and its `document` id while it is open), `range` and/or `node`, " +
        "`decoded` for a place in decompressed or decoded bytes, `title`, `note`, `related_to`, and " +
        '`author: "person"` for one the person made by hand. Pages: `limit` is a ceiling — a page also ' +
        'stops before the answer passes the size bound and then says `truncated: "size"`; pass `next` ' +
        "back as `after` until it is null. A page asked for after the list changed is refused.",
      inputSchema: AgentSchema.object({
        document: AgentSchema.string("Only the annotations on this document's file."),
        path: AgentSchema.string("Only the annotations on this file."),
        limit: AgentSchema.limit(50, 200),
        after: AgentSchema.after,
      }),
      annotations: READ_ONLY,
      run: async (call) => jsonAnswer(this.list(call.arguments)),
    });
  }

  /** @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.list */
  list(args: AgentArguments): Json {
    const filter = this.fileFilter(args);
    const chosen = allAnnotations().filter((one) => filter?.(one) ?? true);
    const limit = args.limit(50, 200);
    const described = chosen.map((one) => this.describe(one));
    const paging = new AgentPage(
      args,
      AgentPage.fingerprint([described]),
      "The annotations changed since that page; ask again without `after`."
    );
    return paging.answer(
      { total: chosen.length },
      "annotations",
      described.slice(paging.first, paging.first + limit),
      chosen.length,
      args.answerBound
    );
  }

  /**
   * The annotations on the file a `document` or a `path` names.
   *
   * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.fileFilter
   */
  private fileFilter(args: AgentArguments): ((annotation: AgentAnnotation) => boolean) | undefined {
    const path = args.optionalString("path");
    if (path !== undefined) {
      const wanted = this.dumpTools.filePath(path);
      return (one) => one.file.kind === "disk" && one.file.identity.path === wanted;
    }
    const id = args.optionalString("document");
    if (id === undefined) return undefined;
    const place = this.desk.placeNamed(id);
    const pane = place.onScreenOrBackground();
    const identity = fileIdentityOf(pane);
    return (one) =>
      one.file.kind === "document"
        ? one.file.document.deref() === place.document
        : identity !== undefined && sameFile(one.file.identity, identity);
  }

  // MARK: - Shapes

  /** @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.describe */
  describe(annotation: AgentAnnotation): Json {
    const entry: { [key: string]: Json } = { id: annotation.id, title: annotation.title };
    const path = annotationPath(annotation.file);
    if (path !== undefined) entry.path = path;
    else entry.file = annotationFileName(annotation.file);
    const place = this.placeOf(annotation);
    if (place !== undefined) entry.document = place.id;
    if (annotation.range !== undefined) {
      entry.range = rangeJson(annotation.range[0], annotation.range[1]);
    }
    if (annotation.node !== undefined) entry.node = annotation.node;
    if (annotation.decoded !== undefined) {
      entry.decoded = {
        node: annotation.decoded.holder,
        range: rangeJson(annotation.decoded.range[0], annotation.decoded.range[1]),
        codecs: [...annotation.decoded.codecs],
      };
    }
    if (annotation.site !== undefined) entry.label = annotation.site.label;
    if (annotation.note !== "") entry.note = annotation.note;
    if (annotation.author === "person") entry.author = "person";
    if (annotation.relatedTo.length > 0) entry.related_to = [...annotation.relatedTo];
    return entry;
  }
}

/** A decoded place from the worker, its codec words filled in where the tree had none. */
function toDecoded(wire: WireDecoded | undefined): AnnotationDecoded | undefined {
  if (wire === undefined) return undefined;
  return {
    ...wire,
    codecs: wire.codecs.map((one) => one ?? L("Decompressed", { context: "part badge" })),
  };
}

const wireOf = (decoded: AnnotationDecoded): Json => ({
  holder: decoded.holder,
  source: [...decoded.source],
  space: decoded.space === undefined ? null : [...decoded.space],
  range: [...decoded.range],
  codecs: [...decoded.codecs],
  xorKey: decoded.xorKey ?? null,
});

const siteFrom = (json: Json): AnnotationSite | undefined => {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return undefined;
  const value = json as { [key: string]: Json };
  return typeof value.label === "string" && typeof value.node === "string"
    ? { label: value.label, node: value.node }
    : undefined;
};

const pathOfText = (text: string | undefined): readonly number[] | undefined =>
  text === undefined || !/^[0-9]+(\.[0-9]+)*$/.test(text) ? undefined : text.split(".").map(Number);

/**
 * The annotation's place as a Contents search match, for UEFI Structure to go to; nothing for a
 * place the tree does not name.
 *
 * @upstream ByteRipperApp/Agent/AgentAnnotationTools.swift#AgentAnnotationTools.match
 */
export function matchOf(annotation: AgentAnnotation): WireContentMatch | undefined {
  const node = pathOfText(annotation.node ?? annotation.site?.node);
  const decoded = annotation.decoded;
  const empty = new Uint8Array(0);
  if (decoded === undefined) {
    const range = annotation.range;
    if (node === undefined || range === undefined) return undefined;
    return { pattern: 0, space: [], range, node, excerpt: empty, excerptMatch: [0, 0] };
  }
  const holder = pathOfText(decoded.holder);
  if (decoded.space !== undefined) {
    return {
      pattern: 0,
      space: decoded.space,
      range: decoded.range,
      node,
      section: holder,
      excerpt: empty,
      excerptMatch: [0, 0],
    };
  }
  const range = annotation.range;
  if (range === undefined || decoded.xorKey === undefined) return undefined;
  return {
    pattern: 0,
    space: [],
    range,
    decodedXORKey: decoded.xorKey,
    node: holder,
    excerpt: empty,
    excerptMatch: [0, 0],
  };
}
