// How loud a stretch of sound looks in the wave and the level bars, 0…1, on a decibel scale:
// the microphone comes unprocessed (recorder.ts microphone), so a voice is often at −40…−25 dB,
// which a straight scale drew as a flat line. −55 dB (a quiet room) is nothing, −15 dB is full.

const FLOOR_DB = -55
const FULL_DB = -15

/** `meanSquare`: the mean of the samples' squares over the stretch. */
export function loudnessOf(meanSquare: number): number {
  if (!(meanSquare > 0)) return 0
  const db = 10 * Math.log10(meanSquare)
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (FULL_DB - FLOOR_DB)))
}
