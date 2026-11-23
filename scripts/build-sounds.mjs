// Dictation's two sounds (Voice typing › sounds): recording started, the text is typed.
// Kryakl's own, synthesized: two soft notes going up, and the same two going down, quieter.
// Short on purpose: the first is heard by the microphone that has just opened.
//   node scripts/build-sounds.mjs  →  media/dictation-start.wav, media/dictation-done.wav
import { writeFileSync } from 'node:fs'

const RATE = 44100

/** One note: a sine with a little of its octave, a 4 ms attack and a quick fall. */
function note(hz, ms, gain) {
  const n = Math.round((RATE * ms) / 1000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const attack = Math.min(1, t / 0.004)
    const fall = Math.exp(-t / (ms / 1000 / 3.2))
    out[i] = gain * attack * fall * (Math.sin(2 * Math.PI * hz * t) + 0.22 * Math.sin(4 * Math.PI * hz * t))
  }
  return out
}

function wav(parts) {
  const samples = parts.reduce((n, p) => n + p.length, 0)
  const b = Buffer.alloc(44 + samples * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples * 2, 4); b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34)
  b.write('data', 36); b.writeUInt32LE(samples * 2, 40)
  let at = 44
  for (const p of parts) for (const v of p) (b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), at), (at += 2))
  return b
}

const E5 = 659.26
const A5 = 880
writeFileSync('media/dictation-start.wav', wav([note(E5, 60, 0.3), note(A5, 90, 0.3)]))
writeFileSync('media/dictation-done.wav', wav([note(A5, 60, 0.22), note(E5, 110, 0.22)]))
console.log('media/dictation-start.wav, media/dictation-done.wav')
