import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { friendlySize } from "@/core/text/byteSize";
import { hexAddress } from "@/core/text/hexText";
import type { FirmwareAnalysis, Issue } from "@/firmware/me/models/firmwareAnalysis";
import { releaseText, versionText } from "@/firmware/me/models/firmwareFacts";
import { analyzePaneMe, firmwareStore, parsePaneFirmware } from "@/state/firmwareStore";
import {
  cancelMEDatabase,
  loadMEDatabase,
  meDatabaseMessage,
  meDatabaseStore,
} from "@/state/meDatabaseStore";
import { useStore } from "@/state/useStore";
import { clearZones, publishZones } from "@/state/zoneStore";
import type { ToolContext, ToolModule } from "@/tools/toolModule";
import { openContextMenu } from "@/ui/shell/ContextMenu";

/**
 * ME Analyzer: what the Intel Management Engine region in this image is.
 *
 * The panel is two halves, and the split is the point. Everything *structural* —
 * the partition table, the layout table, the boot partitions, the manifest, the
 * signature — is read from the image alone, so it is on screen before any
 * network is touched. Everything about *identity* — the family, the variant, the
 * catalogued firmware — needs the database, and the panel says so rather than
 * showing an empty row that looks like an answer.
 *
 * Ported from `Packages/MEFirmware` and upstream's own `MEATool`.
 */

/** One labelled fact, or nothing when the analysis could not determine it. */
interface Row {
  readonly label: string;
  readonly value: string | undefined;
  /** A value that reads as a problem — an invalid signature, a wrong checksum. */
  readonly bad?: boolean;
  /** A value that is definitely right, which is worth saying for a check. */
  readonly good?: boolean;
}

function MeToolView({ context }: { readonly context: ToolContext }) {
  const pane = context.pane;
  const firmware = useStore(firmwareStore).panes[pane];
  const database = useStore(meDatabaseStore);
  const [analysis, setAnalysis] = useState<FirmwareAnalysis | undefined>(undefined);
  const [regionOffset, setRegionOffset] = useState(0);
  const [reading, setReading] = useState(true);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  useEffect(() => {
    void parsePaneFirmware(pane);
    return () => clearZones(pane);
  }, [pane]);

  // The analysis is redone when the image changes and when the database lands:
  // the second is what turns "structure only" into an identity, and it must not
  // wait for the user to press anything.
  const roots = firmware?.roots;
  const status = firmware?.status;
  const databaseText = database.text;
  useEffect(() => {
    if (status !== "ready" || roots === undefined) return;
    let current = true;
    setReading(true);
    void analyzePaneMe(pane, databaseText).then((found) => {
      if (!current) return;
      setAnalysis(found?.analysis);
      setRegionOffset(found?.regionOffset ?? 0);
      setProblem(found?.problem);
      setReading(false);
    });
    return () => {
      current = false;
    };
  }, [roots, status, pane, databaseText]);

  // The region itself, and the partitions in it, drawn in the minimap's gutter.
  useEffect(() => {
    if (analysis === undefined) {
      clearZones(pane);
      return;
    }
    publishZones(pane, {
      zones: [
        {
          id: "me.region",
          name: "ME region",
          start: regionOffset,
          end: regionOffset + analysis.sizeBytes,
        },
        ...analysis.regions
          .filter((one) => !Number.isNaN(one.size) && one.size > 0)
          .map((one, index) => ({
            id: `me.partition.${index}`,
            name: one.name.length > 0 ? one.name : "(erased)",
            start: one.offset,
            end: one.offset + one.size,
          })),
      ],
      focus: undefined,
    });
  }, [analysis, regionOffset, pane]);

  const reveal = useCallback((start: number, end: number) => context.reveal(start, end), [context]);

  const rows: Row[] = useMemo(() => {
    if (analysis === undefined) return [];
    const version = analysis.version;
    const meu =
      version.meMajor === undefined
        ? undefined
        : `${version.meMajor}.${version.meMinor}.${version.meHotfix}.${version.meBuild}`;
    return [
      { label: "Family", value: familyText(analysis) },
      { label: "Variant", value: emptyToNothing(analysis.variant) },
      { label: "Version", value: versionText(version) },
      { label: "MEU version", value: meu },
      { label: "Security version", value: analysis.securityVersion },
      { label: "Release", value: releaseText(analysis.release) },
      { label: "Type", value: typeText(analysis) },
      { label: "Chipset stepping", value: analysis.chipsetStepping },
      { label: "Power-down mitigation", value: analysis.powerDownMitigation },
      { label: "Database name", value: analysis.databaseName },
      {
        label: "RSA signature",
        value:
          analysis.rsaSignatureValid === undefined
            ? "Not checkable"
            : analysis.rsaSignatureValid
              ? "Valid"
              : "Invalid",
        bad: analysis.rsaSignatureValid === false,
        good: analysis.rsaSignatureValid === true,
      },
      {
        label: "Flash Image Tool",
        value: analysis.fptHeaderFIT === undefined ? undefined : versionText(analysis.fptHeaderFIT),
      },
      { label: "Region size", value: friendlySize(analysis.sizeBytes) },
    ];
  }, [analysis]);

  if (reading) return <div className="tool-empty">Reading the ME region…</div>;
  if (analysis === undefined) {
    return (
      <div className="tool-empty">{problem ?? "Nothing in this file looks like an ME region."}</div>
    );
  }

  const message = meDatabaseMessage(database);

  return (
    <div className="me-tool">
      <div className="me-body">
        <dl className="me-facts">
          {rows.map((row) =>
            row.value === undefined ? null : (
              <Fragment key={row.label}>
                <dt>{row.label}</dt>
                <dd data-problem={row.bad ? "" : undefined} data-good={row.good ? "" : undefined}>
                  {row.value}
                </dd>
              </Fragment>
            )
          )}
        </dl>

        {analysis.manifest === undefined ? null : (
          <Section title="Manifest">
            <dl className="me-facts">
              <dt>Tag</dt>
              <dd>
                <button
                  type="button"
                  className="me-offset"
                  onClick={() =>
                    reveal(analysis.manifest?.offset ?? 0, (analysis.manifest?.offset ?? 0) + 0x80)
                  }
                >
                  {analysis.manifest.tag} at {hexAddress(analysis.manifest.offset)}
                </button>
              </dd>
              <dt>Format</dt>
              <dd>{analysis.manifest.format.toUpperCase()}</dd>
              <dt>Built</dt>
              <dd>
                {`${analysis.manifest.year}-` +
                  `${String(analysis.manifest.month).padStart(2, "0")}-` +
                  `${String(analysis.manifest.day).padStart(2, "0")}`}
              </dd>
              <dt>Signed</dt>
              <dd>{analysis.manifest.debugSigned ? "Debug" : "Production"}</dd>
            </dl>
          </Section>
        )}

        {analysis.codePartition === undefined ? null : (
          <Section
            title={`Partition ${analysis.codePartition.name} · ${analysis.codePartition.modules.length} modules`}
          >
            <table className="panel-table me-table">
              <thead>
                <tr>
                  <th scope="col">Module</th>
                  <th scope="col">Offset</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {analysis.codePartition.modules.map((module) => (
                  <tr
                    key={`${module.name}:${module.offset}`}
                    onClick={() => reveal(module.offset, module.offset + Math.max(1, module.size))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      reveal(module.offset, module.offset + Math.max(1, module.size));
                    }}
                    tabIndex={-1}
                  >
                    <td>
                      {module.name}
                      {module.isHuffman ? <span className="me-badge">Huffman</span> : null}
                    </td>
                    <td className="me-mono">{hexAddress(module.offset)}</td>
                    <td className="me-mono">{friendlySize(module.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {analysis.regions.length === 0 ? null : (
          <Section title={`Partition table · ${analysis.regions.length} rows`}>
            <table className="panel-table me-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Offset</th>
                  <th scope="col">Size</th>
                </tr>
              </thead>
              <tbody>
                {analysis.regions.map((one) => (
                  <tr
                    key={one.index}
                    onClick={() => reveal(one.offset, one.offset + Math.max(1, one.size))}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      reveal(one.offset, one.offset + Math.max(1, one.size));
                    }}
                    onContextMenu={(event) =>
                      openContextMenu(event, [
                        {
                          label: "Go to Partition",
                          onSelect: () => reveal(one.offset, one.offset + Math.max(1, one.size)),
                        },
                        {
                          label: "Copy Name",
                          onSelect: () => void navigator.clipboard.writeText(one.name),
                        },
                      ])
                    }
                    tabIndex={-1}
                  >
                    <td>{one.name.length > 0 ? one.name : <em>(erased)</em>}</td>
                    <td className="me-mono">{hexAddress(one.offset)}</td>
                    <td className="me-mono">{friendlySize(one.size)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        {analysis.cseLayoutTable === undefined ? null : (
          <Section title={`CSE Layout Table 1.${analysis.cseLayoutTable.version & 0x0f}`}>
            <dl className="me-facts">
              <dt>Redundancy</dt>
              <dd>{analysis.cseLayoutTable.redundancy ? "Yes" : "No"}</dd>
              {analysis.cseLayoutTable.checksumValid === undefined ? null : (
                <>
                  <dt>Checksum</dt>
                  <dd data-problem={analysis.cseLayoutTable.checksumValid ? undefined : ""}>
                    {analysis.cseLayoutTable.checksumValid ? "Valid" : "Invalid"}
                  </dd>
                </>
              )}
            </dl>
          </Section>
        )}

        {analysis.issues.length === 0 ? null : (
          <ul className="me-issues">
            {analysis.issues.map((issue) => (
              <li key={issueKey(issue)} data-severity={issue.severity}>
                {issue.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="me-status">
        <button
          type="button"
          className="toolbar-button is-quiet"
          onClick={() => (database.status === "loading" ? cancelMEDatabase() : loadMEDatabase())}
          title={
            database.fetchedAt === undefined
              ? "Download the firmware database from ME Analyzer"
              : `Fetched ${new Date(database.fetchedAt).toLocaleString()}`
          }
        >
          {database.status === "loading"
            ? "Downloading database… cancel"
            : database.status === "ready"
              ? "Database in hand"
              : database.status === "failed"
                ? "Try the database again"
                : "Identify this firmware"}
        </button>
        {message === undefined ? null : (
          <span className="me-database-problem" data-kind={database.failure?.kind} title={message}>
            {database.failure?.kind === "rateLimited" ? "Rate-limited" : "Offline"}
          </span>
        )}
      </footer>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="me-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/**
 * The family in the words a bench uses. "Unknown" is a real answer here and is
 * shown as one: it means the database does not list this key, which is a fact
 * about the firmware, not a failure of the reading.
 */
function familyText(analysis: FirmwareAnalysis): string {
  switch (analysis.family) {
    case "me":
      return "Management Engine";
    case "csme":
      return "Converged Security Management Engine";
    case "txe":
      return "Trusted Execution Engine";
    case "cstxe":
      return "Converged Security Trusted Execution Engine";
    case "sps":
      return "Server Platform Services";
    case "cssps":
      return "Converged Security Server Platform Services";
    case "gsc":
      return "Graphics System Controller";
    case "pmc":
      return "Power Management Controller";
    case "pchc":
      return "Platform Controller Hub Configuration";
    case "phy":
      return "USB Type-C Physical";
    case "orom":
      return "Option ROM";
    case "unknown":
      return "Unknown";
  }
}

function typeText(analysis: FirmwareAnalysis): string | undefined {
  switch (analysis.type) {
    case "region":
      return "Region";
    case "extracted":
      return "Extracted";
    case "update":
      return "Update";
    case "stock":
      return "Stock";
    case "unknown":
      // The independent families do not sit on this axis at all, and a word
      // here would be a claim about nothing.
      return undefined;
  }
}

const emptyToNothing = (value: string) => (value.length === 0 ? undefined : value);

const issueKey = (issue: Issue) => `${issue.id}:${issue.message}`;

export const meTool: ToolModule = {
  id: "me-analyzer",
  title: "ME Analyzer",
  summary: "The Intel Management Engine region: what it is, and whether it adds up.",
  View: MeToolView,
};
