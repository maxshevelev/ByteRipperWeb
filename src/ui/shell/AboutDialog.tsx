import appIcon from "@/assets/appIcon.png";
import { L } from "@/core/localization/localization";
import { aboutStore, hideAbout } from "@/state/aboutStore";
import { useStore } from "@/state/useStore";
import { Dialog } from "@/ui/dialogs/Dialog";
import { runningVersion } from "@/ui/shell/appVersion";

/**
 * One project whose data the app ships or fetches.
 *
 * @upstream ByteRipperApp/App/AboutCredits.swift#AboutCredits.Project
 */
interface Project {
  readonly name: string;
  readonly author: string;
  readonly repository: string;
  readonly profile: string;
  /** What the app actually takes from the project. */
  readonly taken: string;
}

/** @upstream ByteRipperApp/App/AboutCredits.swift#AboutCredits.projects */
const projects = (): readonly Project[] => [
  {
    name: "UEFITool",
    author: "LongSoft",
    repository: "https://github.com/LongSoft/UEFITool",
    profile: "https://github.com/LongSoft",
    taken: L(
      "The UEFI Structure tool's item types, NVRAM GUID constants and GUID-name catalogue (common/guids.csv)."
    ),
  },
  {
    name: "MEAnalyzer",
    author: "platomav",
    repository: "https://github.com/platomav/MEAnalyzer",
    profile: "https://github.com/platomav",
    taken: L(
      "The ME Analyzer tool's reading of Intel ME/CSME firmware, and the databases it checks a dump against (MEA.dat, Huffman.dat), fetched as the project publishes them."
    ),
  },
  {
    name: "CPUMicrocodes",
    author: "platomav",
    repository: "https://github.com/platomav/CPUMicrocodes",
    profile: "https://github.com/platomav",
    taken: L("The catalogue of CPU microcodes the FIT tool's picker offers."),
  },
];

/** A link out of the app: the desktop build opens it in the system's browser. */
function Out({ href, children }: { readonly href: string; readonly children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/**
 * Help ▸ About ByteRipper: the app's icon, its name and version, where the
 * names it shows come from — which open-source projects contributed data, and
 * who makes them — and the copyright line. What upstream's standard About panel
 * says, in the same order.
 *
 * The version is this build's own: upstream's release plus this edition's build
 * number (`0.8.5-2`), which is what a bug report should quote.
 *
 * @upstream ByteRipperApp/App/AppDelegate.swift#AppDelegate.showAbout
 * @upstream ByteRipperApp/App/AboutCredits.swift#AboutCredits
 * @upstream ByteRipperApp/App/AboutCredits.swift#AboutCredits.text
 * @upstream ByteRipperApp/App/MainMenu.swift#MainMenu.build
 * @upstream-differs a dialog in the Help menu, where upstream's is the application menu's; no build number in brackets, since a page has no bundle build
 */
export function AboutDialog() {
  const { open } = useStore(aboutStore);
  return (
    <Dialog
      open={open}
      title={L("About ByteRipper")}
      onClose={hideAbout}
      className="about-dialog"
      closeButton
    >
      <div className="dialog-body about">
        <img className="about-icon" src={appIcon} alt="" width={96} height={96} />
        <p className="about-name">ByteRipper</p>
        <p className="about-version">{L("Version %1$@", runningVersion()?.text ?? "")}</p>
        <div className="about-credits">
          <p className="about-credits-heading">{L("Data sources")}</p>
          {projects().map((project) => (
            <div key={project.name} className="about-project">
              <p className="about-project-name">
                <Out href={project.repository}>{project.name}</Out>{" "}
                <span className="about-by">{L("by", { context: "credits" })}</span>{" "}
                <Out href={project.profile}>{project.author}</Out>
              </p>
              <p className="about-taken">{project.taken}</p>
              <p className="about-address">
                <Out href={project.repository}>{project.repository.replace("https://", "")}</Out>
              </p>
            </div>
          ))}
        </div>
        <p className="about-copyright">Copyright © 2026</p>
      </div>
    </Dialog>
  );
}
