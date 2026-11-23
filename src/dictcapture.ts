// Dictation recorded for a problem report (Report a problem › Record dictation
// for the report; the owner, 2026-11-21). A report holds no word the person
// said, so "the marks did not come" or "this word is wrong" cannot be looked
// into from it. Turned on by the person, Kryakl keeps the next phrases they
// dictate, each one's sound and what was recognized and typed, in
// %APPDATA%\Kryakl\captures; the page lists them to hear and to remove, and a
// report made then takes those left. It turns itself off: after CAPTURE_MOST
// phrases, or CAPTURE_HOURS after it was turned on. Nothing is kept while it is
// off, and a phrase kept goes after KEEP_DAYS whatever happens.

import * as fs from 'node:fs'
import * as path from 'node:path'

/** How many phrases are kept at most; recording stops by itself at that. */
export const CAPTURE_MOST = 20
/** How long recording stays on at most. */
export const CAPTURE_HOURS = 24
const KEEP_DAYS = 30
/** The sound as the badge records it: 16-bit PCM, one channel. */
const RATE = 16000

export type Capture = {
  id: string
  /** When the phrase was finished, ms. */
  at: number
  seconds: number
  mode: string
  /** The language the engine heard, and how sure it was. */
  language: string
  sure: number
  /** The text as recognized, before text editing, translation and the typed-text rules. */
  heard: string
  /** The text as typed; empty when nothing was. */
  typed: string
  /** Why nothing was typed, or why the phrase went as said (the badge's note). */
  error?: string
  note?: string
}

export type CaptureView = { on: boolean; left: number; most: number; items: Capture[] }

type Kept = { left: number; until: number; items: Capture[] }

const ID = /^[a-z0-9]+-[0-9]+$/

/** A WAV file of 16-bit mono PCM. */
export function wavOf(pcm: Uint8Array, rate = RATE): Buffer {
  const head = Buffer.alloc(44)
  head.write('RIFF', 0)
  head.writeUInt32LE(36 + pcm.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([head, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)])
}

export class CaptureStore {
  private kept: Kept = { left: 0, until: 0, items: [] }
  private count = 0

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
  ) {
    this.load()
  }

  private get file(): string {
    return path.join(this.dir, 'captures.json')
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Kept>
      const items = (Array.isArray(raw.items) ? raw.items : []).filter(
        (c): c is Capture => !!c && typeof c.id === 'string' && ID.test(c.id) && typeof c.at === 'number' && typeof c.heard === 'string' && typeof c.typed === 'string',
      )
      this.kept = { left: Number(raw.left) > 0 ? Math.min(CAPTURE_MOST, Math.floor(Number(raw.left))) : 0, until: Number(raw.until) || 0, items }
    } catch {
      // None yet, or a file that cannot be read: nothing is kept.
    }
    this.prune()
  }

  /** Phrases past their days go, and sounds no phrase names (a crash between the two writes). */
  private prune(): void {
    const oldest = this.now() - KEEP_DAYS * 24 * 3600_000
    const before = this.kept.items.length
    for (const c of this.kept.items.filter(c => c.at < oldest)) fs.rmSync(this.wav(c.id), { force: true })
    this.kept.items = this.kept.items.filter(c => c.at >= oldest).slice(0, CAPTURE_MOST)
    const named = new Set(this.kept.items.map(c => `${c.id}.wav`))
    try {
      for (const name of fs.readdirSync(this.dir)) if (name.endsWith('.wav') && !named.has(name)) fs.rmSync(path.join(this.dir, name), { force: true })
    } catch {
      // No folder yet.
    }
    if (before !== this.kept.items.length) this.save()
  }

  private save(): void {
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.kept, null, 2), 'utf8')
  }

  private wav(id: string): string {
    return path.join(this.dir, `${id}.wav`)
  }

  /** Whether the next phrase is kept. */
  get on(): boolean {
    return this.kept.left > 0 && this.now() < this.kept.until
  }

  /** How many more phrases will be kept. */
  get left(): number {
    return this.on ? this.kept.left : 0
  }

  /** The phrases kept, the newest first. */
  list(): Capture[] {
    return [...this.kept.items]
  }

  view(): CaptureView {
    return { on: this.on, left: this.left, most: CAPTURE_MOST, items: this.list() }
  }

  /** Turned on: as many phrases as there is room for; false when the list is full (some must go first). */
  start(): boolean {
    const room = CAPTURE_MOST - this.kept.items.length
    if (room <= 0) return false
    this.kept.left = room
    this.kept.until = this.now() + CAPTURE_HOURS * 3600_000
    this.save()
    return true
  }

  stop(): void {
    if (!this.kept.left) return
    this.kept.left = 0
    this.save()
  }

  /** A phrase just dictated, with its sound (16-bit PCM at 16 kHz); nothing while recording is off. */
  add(phrase: Omit<Capture, 'id' | 'at' | 'seconds'>, pcm: Uint8Array): Capture | undefined {
    if (!this.on || !pcm.length) return undefined
    const at = this.now()
    const capture: Capture = { ...phrase, id: `${at.toString(36)}-${this.count++}`, at, seconds: Math.round((pcm.length / 2 / RATE) * 10) / 10 }
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(this.wav(capture.id), wavOf(pcm))
    this.kept.items.unshift(capture)
    this.kept.left -= 1
    this.save()
    return capture
  }

  remove(id: string): void {
    if (!this.kept.items.some(c => c.id === id)) return
    fs.rmSync(this.wav(id), { force: true })
    this.kept.items = this.kept.items.filter(c => c.id !== id)
    this.save()
  }

  /** Everything kept goes, and recording stops. */
  clear(): void {
    for (const c of this.kept.items) fs.rmSync(this.wav(c.id), { force: true })
    this.kept = { left: 0, until: 0, items: [] }
    this.save()
  }

  /** A kept phrase's sound file, or undefined when there is none by that id. */
  soundFile(id: string): string | undefined {
    if (!ID.test(id) || !this.kept.items.some(c => c.id === id)) return undefined
    const file = this.wav(id)
    return fs.existsSync(file) ? file : undefined
  }
}
