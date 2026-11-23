import { describe, expect, it } from 'vitest'

import { FRAME, frameDb, LONGEST_S, MARGIN_S, Pieces, RATE, type Piece } from './pieces'

type Part = { speech?: number; silence?: number; level?: number; noise?: number }

/** A phrase of tones (speech, at `level` of full scale) and silences (zeros, or noise at `noise`). */
function phrase(parts: Part[]): Int16Array {
  const total = parts.reduce((n, p) => n + Math.round((p.speech ?? p.silence ?? 0) * RATE), 0)
  const out = new Int16Array(total)
  let at = 0
  let seed = 7
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1
  for (const p of parts) {
    const n = Math.round((p.speech ?? p.silence ?? 0) * RATE)
    for (let i = 0; i < n; i++) {
      const v = p.speech !== undefined ? (p.level ?? 0.3) * Math.sin((2 * Math.PI * 220 * (at + i)) / RATE) : (p.noise ?? 0) * random()
      out[at + i] = Math.round(v * 32767)
    }
    at += n
  }
  return out
}

/** Fed as the badge sends it, a quarter of a second at a time. */
function feed(sound: Int16Array): { pieces: Piece[]; tail: Piece | undefined } {
  const p = new Pieces()
  const pieces: Piece[] = []
  for (let i = 0; i < sound.length; i += 4000) pieces.push(...p.push(sound.subarray(i, i + 4000)))
  return { pieces, tail: p.end() }
}

const end = (piece: Piece) => piece.start + piece.pcm.length / RATE

describe('a phrase cut into pieces for Groq', () => {
  it('measures a frame in dBFS', () => {
    const full = phrase([{ speech: 0.03, level: 1 }])
    expect(frameDb(full, 0, FRAME)).toBeCloseTo(-3, 0)
    expect(frameDb(new Int16Array(FRAME), 0, FRAME)).toBeLessThan(-150)
  })

  it('keeps a phrase under 6 s of speech whole, for one request at the key', () => {
    const { pieces, tail } = feed(phrase([{ silence: 1 }, { speech: 2 }, { silence: 0.8 }, { speech: 2.5 }, { silence: 1 }]))
    expect(pieces).toEqual([])
    expect(tail!.speech).toBeCloseTo(4.5, 0)
    // The silence before and after it trimmed to the margin, never into the speech.
    expect(tail!.start).toBeGreaterThan(1 - MARGIN_S - 0.05)
    expect(tail!.start).toBeLessThanOrEqual(1)
    expect(end(tail!)).toBeGreaterThanOrEqual(6.3)
    expect(end(tail!)).toBeLessThan(6.3 + MARGIN_S + 0.05)
  })

  it('cuts at the first pause once a piece holds 6 s of speech, not before', () => {
    // 4 s, a pause, 3 s, a pause, 2 s: the first pause comes with 4 s of speech, the second with 7.
    const { pieces, tail } = feed(phrase([{ speech: 4 }, { silence: 0.8 }, { speech: 3 }, { silence: 0.8 }, { speech: 2 }]))
    expect(pieces).toHaveLength(1)
    const first = pieces[0]!
    expect(first.speech).toBeCloseTo(7, 0)
    // It ends in the pause after the speech, 7.8 s in: the speech whole, the pause not.
    expect(end(first)).toBeGreaterThanOrEqual(7.8)
    expect(end(first)).toBeLessThan(7.8 + MARGIN_S + 0.05)
    expect(tail!.speech).toBeCloseTo(2, 0)
    expect(tail!.start).toBeGreaterThan(8.6 - MARGIN_S - 0.05)
    expect(tail!.start).toBeLessThanOrEqual(8.6)
  })

  it('sends no tail after a piece with under 0.3 s of speech: a breath Whisper would write "Спасибо." over', () => {
    const breath = feed(phrase([{ speech: 7 }, { silence: 0.8 }, { speech: 0.15 }, { silence: 0.5 }]))
    expect(breath.pieces).toHaveLength(1)
    expect(breath.tail).toBeUndefined()
    const word = feed(phrase([{ speech: 7 }, { silence: 0.8 }, { speech: 0.5 }, { silence: 0.5 }]))
    expect(word.tail!.speech).toBeCloseTo(0.5, 1)
  })

  it('takes a pause shorter than 0.6 s for no pause', () => {
    const { pieces } = feed(phrase([{ speech: 7 }, { silence: 0.4 }, { speech: 3 }, { silence: 1 }]))
    expect(pieces).toHaveLength(1)
    expect(pieces[0]!.speech).toBeCloseTo(10, 0)
  })

  it('cuts a piece with no pause at 20 s, at its quietest moment', () => {
    // A quieter stretch (no pause: a word said softly) at 14 s.
    const { pieces, tail } = feed(phrase([{ speech: 14 }, { speech: 0.3, level: 0.05 }, { speech: 10 }]))
    expect(pieces).toHaveLength(1)
    const first = pieces[0]!
    expect(first.start).toBe(0)
    expect(end(first)).toBeGreaterThanOrEqual(14)
    expect(end(first)).toBeLessThanOrEqual(14.3)
    expect(end(first)).toBeLessThanOrEqual(LONGEST_S)
    expect(tail!.start).toBeCloseTo(end(first), 5)
  })

  it('cuts again and again in a long phrase, each piece within 20 s', () => {
    const sound = phrase(Array.from({ length: 8 }, () => [{ speech: 4 }, { silence: 0.7 }] as Part[]).flat().slice(0, -1))
    const { pieces, tail } = feed(sound)
    // Two stretches of 4 s make the 6 s of a piece: four pieces, the last one at the key.
    expect(pieces).toHaveLength(3)
    expect(tail!.speech).toBeCloseTo(8, 0)
    for (const piece of pieces) expect(piece.pcm.length / RATE).toBeLessThanOrEqual(LONGEST_S)
    for (let i = 1; i < pieces.length; i++) expect(pieces[i]!.start).toBeGreaterThanOrEqual(end(pieces[i - 1]!))
  })

  it('trims the silence before the person starts, however long', () => {
    const { pieces, tail } = feed(phrase([{ silence: 25 }, { speech: 3 }]))
    expect(pieces).toEqual([])
    expect(tail!.start).toBeGreaterThan(25 - MARGIN_S - 0.05)
    expect(tail!.pcm.length / RATE).toBeLessThan(3 + MARGIN_S + 0.05)
  })

  it('hands a phrase with nothing like speech in it whole, as today; a silent tail after pieces never', () => {
    const quiet = feed(phrase([{ silence: 3, noise: 0.0005 }]))
    expect(quiet.pieces).toEqual([])
    expect(quiet.tail!.pcm.length).toBe(3 * RATE)
    const faint = new Pieces()
    faint.push(new Int16Array(1000))
    expect(faint.end()!.pcm.length).toBe(1000)
    const after = feed(phrase([{ speech: 7 }, { silence: 3 }]))
    expect(after.pieces).toHaveLength(1)
    expect(after.tail).toBeUndefined()
  })

  it('finds the pauses against the phrase\'s own level, over a fan', () => {
    // Speech at 30 % of full scale over noise 25 dB under it.
    const { pieces } = feed(phrase([{ speech: 7, level: 0.3 }, { silence: 0.8, noise: 0.017 }, { speech: 2, level: 0.3 }]))
    expect(pieces).toHaveLength(1)
    expect(end(pieces[0]!)).toBeLessThan(7 + MARGIN_S + 0.4)
  })
})
