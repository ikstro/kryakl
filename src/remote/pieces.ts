// A dictation heard by Groq cut into pieces at its pauses (2026-11-23), so the
// panel shows the text while the person speaks, as the engine here does it
// (engine/stream.py). Groq has no streaming recognition: each piece is one
// request. Groq bills a request as 10 s at least, so a piece holds 6 s of
// speech before a pause may end it (shorter ones would spend the free limit
// for nothing), and one with no pause is cut at 20 s at its quietest moment.
//
// Speech is found by loudness alone (a 30 ms frame's RMS), against the
// phrase's own level: a decaying peak of its loud frames, `RELATIVE_DB` under
// it, never under `FLOOR_DB`. A piece's silence before and after its speech is
// trimmed to `MARGIN_S`; a cut never falls inside a frame taken for speech.

export const RATE = 16000
/** A frame of 30 ms. */
export const FRAME = 480
const FRAME_S = FRAME / RATE
/** A pause this long may end a piece… */
export const PAUSE_S = 0.6
/** …once the piece holds this much speech. */
export const LEAST_SPEECH_S = 6
/** A piece with no such pause is cut at this length, at its quietest frame. */
export const LONGEST_S = 20
/** A tail after a piece with less speech than this is not sent: a breath or a click, over which Whisper writes "Спасибо." (2026-11-23). */
export const LEAST_TAIL_S = 0.3
const LEAST_TAIL_FRAMES = Math.round(LEAST_TAIL_S / FRAME_S)
/** Silence kept before and after a piece's speech. */
export const MARGIN_S = 0.2
/** The quietest a frame of speech can be, in dBFS. */
export const FLOOR_DB = -55
/** Speech is a frame no more than this far under the phrase's loud frames. */
export const RELATIVE_DB = 22
/** How fast the phrase's level forgets a loud moment, dB a second. */
const DECAY_DB_S = 1

const PAUSE_FRAMES = Math.round(PAUSE_S / FRAME_S)
const LEAST_FRAMES = Math.round(LEAST_SPEECH_S / FRAME_S)
const LONGEST_FRAMES = Math.round(LONGEST_S / FRAME_S)
const MARGIN_FRAMES = Math.round(MARGIN_S / FRAME_S)

export type Piece = {
  pcm: Int16Array
  /** Where it starts in the phrase, in seconds. */
  start: number
  /** Seconds of speech in it. */
  speech: number
}

/** A frame's loudness in dBFS. */
export function frameDb(samples: Int16Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += samples[i]! * samples[i]!
  const rms = Math.sqrt(sum / Math.max(1, to - from)) / 32768
  return 20 * Math.log10(rms + 1e-9)
}

/** Feeds a phrase's sound in, takes its pieces out as they are cut. */
export class Pieces {
  /** The sound not yet handed out as a piece, from `base` (samples into the phrase). */
  private buf = new Int16Array(RATE * 8)
  private len = 0
  private base = 0
  /** Per whole frame of `buf`: its loudness. Whether it is speech is asked against the phrase's level now, so noise taken for speech before the voice came is silence once it has. */
  private db: number[] = []
  private level = FLOOR_DB
  /** Pieces handed out so far. */
  handed = 0

  /** More sound; the pieces it completes, in order. */
  push(samples: Int16Array): Piece[] {
    this.append(samples)
    const out: Piece[] = []
    while (this.db.length * FRAME + FRAME <= this.len) {
      const f = this.db.length
      const db = frameDb(this.buf, f * FRAME, (f + 1) * FRAME)
      this.level = Math.max(FLOOR_DB, this.level - DECAY_DB_S * FRAME_S, db)
      this.db.push(db)
      const piece = this.cut()
      if (piece) out.push(piece)
    }
    return out
  }

  /** Whether frame `f` is speech, by the phrase's level now. */
  private on(f: number): boolean {
    return this.db[f]! >= Math.max(FLOOR_DB, this.level - RELATIVE_DB)
  }

  private firstSpeech(to = this.db.length): number {
    for (let f = 0; f < to; f++) if (this.on(f)) return f
    return -1
  }

  private lastSpeech(to = this.db.length): number {
    for (let f = to - 1; f >= 0; f--) if (this.on(f)) return f
    return -1
  }

  /** The phrase is over: what is left as a piece, none when it holds no speech (after a piece, under `LEAST_TAIL_S`). A phrase never cut is handed out whole, also when nothing in it sounded like speech: Groq decides. */
  end(): Piece | undefined {
    const frames = this.db.length
    const first = this.firstSpeech()
    if (first < 0) {
      if (this.handed || !this.len) return undefined
      return this.take(0, this.len, 0)
    }
    const speech = this.speechIn(0, frames)
    if (this.handed && speech < LEAST_TAIL_FRAMES) return undefined
    const last = this.lastSpeech()
    const from = Math.max(0, first - MARGIN_FRAMES) * FRAME
    // The samples after the last whole frame belong to the tail too.
    const to = last + 1 + MARGIN_FRAMES >= frames ? this.len : (last + 1 + MARGIN_FRAMES) * FRAME
    return this.take(from, to, speech)
  }

  /** A piece that ends now, when the latest frame ends one. */
  private cut(): Piece | undefined {
    const frames = this.db.length
    const first = this.firstSpeech()
    // Silence before the person starts stays: a phrase too faint to pass for speech still goes to Groq whole at the key.
    if (first < 0) return undefined
    let quiet = 0
    while (quiet < frames && !this.on(frames - 1 - quiet)) quiet++
    if (quiet >= PAUSE_FRAMES && this.speechIn(0, frames) >= LEAST_FRAMES) return this.split(frames - quiet + Math.floor(quiet / 2))
    if (frames - first >= LONGEST_FRAMES) {
      // No pause: the quietest frame of its second half, the latest of equals, so the piece is as long as it can be.
      let at = frames - 1
      for (let f = frames - 1; f >= first + Math.floor(LONGEST_FRAMES / 2); f--) if (this.db[f]! < this.db[at]!) at = f
      return this.split(at)
    }
    return undefined
  }

  /** The frames before `at` as a piece, trimmed to their speech; the rest stays. */
  private split(at: number): Piece | undefined {
    const first = this.firstSpeech(at)
    const last = this.lastSpeech(at)
    const piece = first >= 0 ? this.take(Math.max(0, first - MARGIN_FRAMES) * FRAME, Math.min(at, last + 1 + MARGIN_FRAMES) * FRAME, this.speechIn(0, at)) : undefined
    this.drop(at)
    return piece
  }

  private take(from: number, to: number, speechFrames: number): Piece {
    this.handed++
    return { pcm: this.buf.slice(from, to), start: (this.base + from) / RATE, speech: speechFrames * FRAME_S }
  }

  private speechIn(from: number, to: number): number {
    let n = 0
    for (let f = from; f < to; f++) if (this.on(f)) n++
    return n
  }

  /** The first `frames` frames are gone. */
  private drop(frames: number): void {
    const samples = frames * FRAME
    this.buf.copyWithin(0, samples, this.len)
    this.len -= samples
    this.base += samples
    this.db.splice(0, frames)
  }

  private append(samples: Int16Array): void {
    if (this.len + samples.length > this.buf.length) {
      const bigger = new Int16Array(Math.max(this.buf.length * 2, this.len + samples.length))
      bigger.set(this.buf.subarray(0, this.len))
      this.buf = bigger
    }
    this.buf.set(samples, this.len)
    this.len += samples.length
  }
}
