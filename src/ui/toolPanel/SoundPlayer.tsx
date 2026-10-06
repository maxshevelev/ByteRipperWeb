import { type ReactElement, useEffect, useRef, useState } from "react";
import { L } from "@/core/localization/localization";
import { soundClock } from "@/ui/toolPanel/soundClock";

/**
 * The player under a sound's details: play and pause, stop, a position bar and the time
 * played against the whole. The sound is played from the bytes in the dump as they were
 * when the row was selected, by the browser, and stops when another row is selected or
 * the panel is closed.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/SoundPlayerView.swift#SoundPlayerView
 * @upstream-differs an `<audio>` element behind the controls, where upstream drives an
 * `NSSound`; the controls are the same four
 */
// help: panel.uefi.sound-player
export function SoundPlayer({ bytes }: { readonly bytes: Uint8Array }): ReactElement {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(0);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type: "audio/wav" }));
    const element = new Audio(url);
    audio.current = element;
    setPlaying(false);
    setPosition(0);
    setLength(0);
    const sync = () => {
      setPosition(element.currentTime);
      setLength(Number.isFinite(element.duration) ? element.duration : 0);
    };
    const ended = () => {
      element.currentTime = 0;
      setPlaying(false);
      sync();
    };
    element.addEventListener("timeupdate", sync);
    element.addEventListener("loadedmetadata", sync);
    element.addEventListener("ended", ended);
    return () => {
      element.pause();
      element.removeEventListener("timeupdate", sync);
      element.removeEventListener("loadedmetadata", sync);
      element.removeEventListener("ended", ended);
      audio.current = null;
      URL.revokeObjectURL(url);
    };
  }, [bytes]);

  const toggle = () => {
    const element = audio.current;
    if (element === null) return;
    if (element.paused) {
      void element.play().then(
        () => setPlaying(true),
        () => setPlaying(false)
      );
    } else {
      element.pause();
      setPlaying(false);
    }
  };
  const stop = () => {
    const element = audio.current;
    if (element === null) return;
    element.pause();
    element.currentTime = 0;
    setPlaying(false);
    setPosition(0);
  };

  return (
    <div className="tool-detail-sound">
      <button type="button" onClick={toggle}>
        {playing ? L("Pause") : L("Play")}
      </button>
      <button type="button" onClick={stop}>
        {L("Stop")}
      </button>
      <input
        type="range"
        min={0}
        max={length > 0 ? length : 1}
        step="any"
        value={Math.min(position, length > 0 ? length : 1)}
        aria-label={L("Playback position")}
        title={L("Drag to move through the sound")}
        onChange={(event) => {
          const element = audio.current;
          const at = Number(event.currentTarget.value);
          if (element !== null) element.currentTime = at;
          setPosition(at);
        }}
      />
      <span className="tool-detail-sound-time">
        {soundClock(position)} / {soundClock(length)}
      </span>
    </div>
  );
}
