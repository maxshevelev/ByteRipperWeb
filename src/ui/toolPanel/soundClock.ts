/**
 * A playback time as the player writes it: minutes and seconds, `0:05`, `12:34`.
 *
 * @upstream Modules/UEFITool/Sources/UEFIToolUI/SoundPlayerView.swift#SoundPlayerView.clock
 */
export function soundClock(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
