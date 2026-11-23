// Dictate: a key, in any program, starts recording in the badge (a small
// window at the bottom of the screen being typed in, where the person last
// dropped it, that never takes the focus, so the program keeps it); the same
// key again stops. Then, by the key:
//   type     the text is typed where the cursor is (through the clipboard,
//            which is put back as it was), put right first by the local model
//            when text editing is on (dictedit.ts),
//   english  the same, translated into English first by Kryakl's translator,
//   note     the recording goes into the knowledge base as a .md file
//            (through the engine's library), and a balloon says where.
// Esc while recording throws it away. Typed phrases go into the log
// (dictationlog.ts), so the again key can type the last one once more.
// The text is typed by the person's rules (dicttext.ts: ё, the full stop of one
// sentence, the space after), a sound may mark the start and the typed text,
// and while the person records dictation for a problem report, the phrase's
// sound and texts are kept for it (dictcapture.ts).

import * as fs from 'node:fs'
import * as path from 'node:path'

import { BrowserWindow, globalShortcut, screen, shell } from 'electron'

import { openable } from './bridge'
import type { Capture } from './dictcapture'
import type { DictationLog } from './dictationlog'
import { calmWhenHidden } from './calm'
import { frameWindow } from './dwm'
import { t } from './i18n'
import { log } from './log'
import { badgeOffset, flightPoint, placeBadge, type Rect } from './placement'
import type { DictationMode, ToHost, ToView } from './protocol'
import { wavOf } from './dictcapture'
import { isRemoteError } from './remote/groq'
import type { Settings } from './settings'
import type { SpeechHost } from './speechhost'
import { handleOf } from './winclip'
import { foreground, putOnTop, sightOf, windowRect, type Sight } from './winkbd'

/** The badge is as wide as this; as tall as its page, from one line of words to about six (then they scroll). */
const BADGE = { width: 360, min: 64, max: 180 }
/** How soon after it shows, then how often while it is up, the badge asks whether Windows shows it too. */
const LOOK_MS = { first: 500, every: 2000 }
/** How long a phrase waits at most for the card to be made ready for its model (main.ts cardForDictation); the sound is recorded meanwhile. */
export const ROOM_WAIT_MS = 1500
const NOTE_WAIT_MS = 5 * 60_000
/** How long the badge says something of a phrase it typed (Fast translated it). */
const NOTE_SHOWN_MS = 3000
/** How long the badge takes to fly into the tray, as the page's shrinking (dictation.css), and how often it moves meanwhile. */
const FLIGHT_MS = 260
const FLIGHT_STEP_MS = 16
/** The most languages the engine weighs a phrase against. */
const MOST_EXPECTED = 8

export type DictationOptions = {
  page: string
  /** What the page's address carries: Windows' frame, the interface's language (main.ts pageQuery). */
  query: () => Record<string, string>
  preload: string
  speech: SpeechHost
  /**
   * Phrases heard by the person's own Groq key (remote/dictate.ts), notes never:
   * whether it is on now, and the phrase's sound (WebM) heard there. A fault
   * throws: the phrase then goes to the speech engine here when it is installed
   * and running, else it is held for the again key.
   */
  remote?: {
    on: () => boolean
    hear: (audio: Uint8Array, mime: string, seconds: number, expected: string[], signal: AbortSignal) => Promise<{ text: string; language: string }>
    /** The phrase heard while it is spoken, piece by piece at its pauses (remote/dictstream.ts); `onText`, the text so far and the speech still waiting. */
    stream: (expected: string[], onText: (text: string, pending: number) => void) => RemoteStream
  }
  /** Types the text in the program in front, the clipboard kept. */
  paste: (text: string) => Promise<void>
  /** The text in English; `from` is the language the engine heard. */
  /** The phrase in English; `note`, said in the badge after it is typed (Fast translated it, the model too slow just now). */
  toEnglish: (text: string, from: string) => Promise<{ text: string; note?: string }>
  /** The phrase as text editing leaves it; `note`, said in the badge after it is typed (typed as said, and why). Off, it comes back as it was. */
  edit: (text: string, signal: AbortSignal) => Promise<{ text: string; note?: string }>
  /** Whether a phrase goes through text editing now. */
  editing: () => boolean
  /** The phrase as the person has it typed (ё, the full stop of one sentence); `language` is the text's. */
  polish: (text: string, language: string) => string
  /** Whether a space follows a typed phrase. */
  space: () => boolean
  /** Whether a sound marks the recording's start and the typed text. */
  sound: () => boolean
  /** Whether this phrase is kept for a problem report, and the phrase kept with its sound (16-bit PCM at 16 kHz). */
  capturing: () => boolean
  captured: (phrase: Omit<Capture, 'id' | 'at' | 'seconds'>, pcm: Uint8Array) => void
  /** A phrase is starting: the card made ready for its speech model (and the model for text editing warmed); `remote`, heard by Groq, needs no card. Waited for, `ROOM_WAIT_MS` at most. */
  warm: (remote: boolean) => Promise<void>
  /** Practice: a phrase spoken in English, shown checked (Check my English) instead of typed. */
  check: (text: string) => void
  /** The languages the person uses (their own, English, the others they named): a phrase is taken as one of them, never another. */
  expected: () => string[]
  /** The language of a text by its letters and words (translate.ts), when Whisper was unsure. */
  languageOf: (text: string) => string
  balloon: (title: string, content: string, click?: () => void) => void
  /** The engine is not installed yet: Dictate's page offers it. */
  needsEngine: () => void
  /** The app window on Report a problem: the engine would not start. */
  report: () => void
  /** The app window on a transcript: a note that stayed in Transcripts. */
  openTranscript: (id: string) => void
  onChange: () => void
  /** The phrases typed lately. */
  log: DictationLog
  /** A phrase went into the log, or the log was cleared: the Dictate page shows the latest. */
  logged: () => void
  /** Whether the badge shows while a phrase is dictated; it still comes up to say what went wrong. */
  panel: () => boolean
  /** The middle of the tray icon, where a badge folded away flies. */
  trayPoint: () => { x: number; y: number }
  /** Where the person last dropped the badge, from the bottom centre of the work area; and keeping a new place. */
  offset: () => Settings['dictationBadge']
  moved: (offset: Settings['dictationBadge']) => void
}

/** What keeps the person from seeing a badge Windows calls shown; empty when nothing does. */
function troubleOf(sight: Sight): string {
  return [sight.topmost ? '' : 'not on top', sight.cloaked ? `cloaked ${sight.cloaked}` : '', sight.above.length ? `under ${sight.above.join(', ')}` : ''].filter(Boolean).join('; ')
}

/** A phrase going to Groq while it is spoken: its sound in, the whole text out at the key; a fault throws from `finish`. */
export type RemoteStream = { push(pcm: Int16Array): void; finish(): Promise<{ text: string; language: string }>; cancel(): void }

/**
 * Whether a phrase going to Groq gets this computer's preview while it is spoken (2026-11-23, the owner: the panel
 * shows the words here, Groq's text is what is typed): only with the engine running and the processor's dictation
 * model downloaded already (SpeechHost `previewModel`), so the preview downloads nothing and never takes the card.
 */
export function previewHere(remote: boolean, speech: Pick<SpeechHost, 'installed' | 'ready'> & { previewModel?: string | undefined }): boolean {
  return remote && speech.installed && speech.ready && !!speech.previewModel
}

/** 16-bit PCM at 16 kHz, a second's bytes. */
const PCM_BYTES_S = 32000

type Transcript = { title: string; note?: string; noteError?: string }
type Row = { status: string; error: string }

export class Dictation {
  state: 'idle' | 'recording' | 'working' = 'idle'
  mode: DictationMode = 'type'
  private badge: BrowserWindow | undefined
  private badgeReady = false
  private waiting: ToView[] = []
  /** The engine is being asked for a session: a second press now would come before the badge starts. */
  private opening = false
  /** The height the badge's page asked for: its bottom edge stays where it is when it changes. */
  private height = BADGE.min
  private looking: NodeJS.Timeout | undefined
  /** What Windows was last found doing to the badge, as logged; empty while it shows it on top. */
  private trouble = ''
  /** Windows cloaked the badge: a new one is made before the next phrase. */
  private stale: false | string = false
  /** Ends the edit under way: the phrase was thrown away. */
  private editStop: AbortController | undefined
  /** The badge is out of sight for this phrase, folded away or not wanted: the recording goes on in it all the same. */
  private tucked = false
  /** The screen this phrase started on: a badge brought back comes up there. */
  private area: Rect = { x: 0, y: 0, width: 0, height: 0 }
  /** The person is moving the badge: a new height waits for the drop. */
  private dragging = false
  /** The height the page last asked for, kept while the badge cannot take it. */
  private asked: number = BADGE.min
  private flight: NodeJS.Timeout | undefined
  /** This phrase's sound, handed over by the badge when the person records dictation for a report; and what was heard of it. */
  private kept: Uint8Array | undefined
  private hearing = { heard: '', language: '', sure: 0 }
  /** This phrase goes to Groq (decided at its start), and when its recording began. */
  private byRemote = false
  private began = 0
  /** Ends the request to Groq under way: Esc. */
  private remoteStop: AbortController | undefined
  /** A phrase Groq could not take and nothing here could hear: the again key sends it once more. */
  private unsent: { mode: DictationMode; audio: Uint8Array; mime: string; seconds: number } | undefined
  /** This phrase going to Groq while it is spoken, and its whole sound as recorded (for the engine here, should Groq fail). */
  private stream: RemoteStream | undefined
  private pcm: Uint8Array[] = []
  /** This phrase's sound is kept for a report: Groq's phrase is held here, not handed over by the badge. */
  private keeping = false
  /** The engine's session showing a phrase going to Groq while it is spoken: thrown away at the key, never finished. */
  private preview: string | undefined

  constructor(private readonly o: DictationOptions) {}

  /** Whether the next phrase (not a note) goes to Groq. */
  get remoteOn(): boolean {
    return !!this.o.remote?.on()
  }

  /** A Dictate key: the first press starts, the next one (any of the three) stops. */
  press(mode: DictationMode, key: string): void {
    if (this.opening) return
    if (this.state === 'idle') void this.start(mode, key)
    else if (this.state === 'recording') this.stop()
  }

  private async start(mode: DictationMode, key: string): Promise<void> {
    // Groq hears it: no engine here is needed; the badge sends the sound here as it records, heard piece by piece at its pauses.
    const remote = mode !== 'note' && this.remoteOn
    if (!remote) {
      if (!this.o.speech.installed) return this.o.needsEngine()
      if (!this.o.speech.ready) {
        // Given up after its restarts, it will not come by waiting: the notice says so and opens the report.
        if (this.o.speech.down) this.o.balloon(t('app.name'), t('dict.engineDown'), this.o.report)
        else this.o.balloon(t('app.name'), t('dict.engineStarting'))
        return
      }
    }
    this.byRemote = remote
    this.unsent = undefined
    this.mode = mode
    this.kept = undefined
    this.hearing = { heard: '', language: '', sure: 0 }
    this.stream?.cancel()
    this.stream = undefined
    this.pcm = []
    this.dropPreview()
    const room = mode === 'type' || mode === 'english' ? this.o.warm(remote).catch(() => undefined) : undefined
    // The screen to show on is the one with the window the text goes into, taken now, while it is in front.
    this.area = this.workArea()
    this.set('recording')
    this.began = Date.now()
    const expected = this.expected(mode)
    let session: string | undefined
    if (mode !== 'note' && !remote) {
      // Heard while it is spoken (the engine loads its model meanwhile); an engine without sessions gets the phrase whole.
      this.opening = true
      try {
        // The card made ready first (Kryakl's resting language model let go of), so the engine finds it free; the badge records meanwhile.
        if (room) await Promise.race([room, new Promise(resolve => setTimeout(resolve, ROOM_WAIT_MS))])
        const r = await this.o.speech.call<{ id: string }>('POST', '/dictate/sessions', { expected, strict: true })
        if (r.ok) session = r.data.id
        else void this.o.speech.call('POST', '/dictate/prepare')
      } finally {
        this.opening = false
      }
    } else if (previewHere(remote, this.o.speech)) {
      // Groq types it; meanwhile the engine here shows the words, on the processor's plan alone (the card left alone).
      this.opening = true
      try {
        const r = await this.o.speech.call<{ id: string }>('POST', '/dictate/sessions', { expected, strict: true, device: 'cpu' })
        if (r.ok) session = this.preview = r.data.id
      } finally {
        this.opening = false
      }
    }
    if (this.state !== 'recording') return this.dropPreview()
    if (this.stale) this.renew()
    const badge = this.window()
    this.height = this.asked = BADGE.min
    this.tucked = !this.o.panel()
    if (this.tucked) log('badge: not shown, as the setting says')
    else this.present(badge, remote ? `by Groq, preview ${session ? 'yes' : 'no'}` : `session ${session ? 'yes' : 'no'}`)
    // Kept for a report only when the person turned that on, and only a phrase that is typed (never a note or practice).
    const keep = (!!session || remote) && (mode === 'type' || mode === 'english') && this.o.capturing()
    this.keeping = keep
    if (remote && this.o.remote) this.stream = this.o.remote.stream(expected, (heard, pending) => this.send({ type: 'dictationHeard', heard, pending }))
    this.send({ type: 'dictation', command: 'start', mode, key, ...(session ? { session } : {}), expected, keep, sound: this.o.sound(), ...(remote ? { remote: true } : {}) })
    globalShortcut.register('Escape', () => this.cancel())
  }

  /** The badge at the person's place on this phrase's screen, on top. */
  private present(badge: BrowserWindow, why: string): void {
    clearInterval(this.flight)
    const area = this.area
    const place = placeBadge(this.o.offset(), { width: BADGE.width, height: this.height }, area)
    badge.setBounds(place)
    badge.showInactive()
    // Shown again, a window keeps its old place in Windows' stack, and Windows may have put it under ordinary windows meanwhile.
    const before = this.sight(badge)
    this.raise(badge)
    const was = before ? troubleOf(before) : ''
    log(`badge: shown at ${JSON.stringify(badge.getBounds())} (asked ${JSON.stringify(place)}, area ${JSON.stringify(area)}, offset ${JSON.stringify(this.o.offset())}), visible ${badge.isVisible()}, ${why}${was ? `; was ${was}, raised` : ''}`)
    this.look(LOOK_MS.first)
  }

  /** The person folded the badge away: it flies into the tray's red dot, the recording going on; the next phrase shows it again. */
  private tuck(fly: boolean): void {
    const b = this.badge
    if (this.state === 'idle' || this.tucked || !b || b.isDestroyed()) return
    this.tucked = true
    if (!fly) return b.hide()
    const from = b.getBounds()
    const tray = this.o.trayPoint()
    // The panel shrinks into its bottom right corner: that corner lands on the icon.
    const to = { x: tray.x - from.width, y: tray.y - from.height }
    const began = Date.now()
    clearInterval(this.flight)
    this.flight = setInterval(() => {
      if (b.isDestroyed()) return clearInterval(this.flight)
      const progress = (Date.now() - began) / FLIGHT_MS
      if (progress >= 1) return b.hide()
      const at = flightPoint(from, to, progress)
      b.setPosition(at.x, at.y)
    }, FLIGHT_STEP_MS)
  }

  /** A badge out of sight comes up to say something the person has to know. */
  private reveal(): void {
    if (!this.tucked) return
    this.tucked = false
    this.height = this.asked
    if (this.badge && !this.badge.isDestroyed()) this.present(this.badge, 'brought back')
  }

  private stop(): void {
    this.set('working')
    // Esc stays: while the text is finished, it throws the phrase away (a note is saved regardless).
    if (this.mode === 'note') globalShortcut.unregister('Escape')
    this.send({ type: 'dictation', command: 'stop', mode: this.mode, key: '' })
  }

  cancel(): void {
    if (this.state !== 'recording' && !(this.state === 'working' && this.mode !== 'note')) return
    globalShortcut.unregister('Escape')
    this.editStop?.abort()
    this.remoteStop?.abort()
    this.stream?.cancel()
    this.stream = undefined
    this.pcm = []
    this.dropPreview()
    // Thrown away: its sound is not kept either.
    this.kept = undefined
    this.send({ type: 'dictation', command: 'cancel', mode: this.mode, key: '' })
  }

  /** The badge's messages; true when the message was the badge's. */
  onMessage(message: ToHost): boolean {
    switch (message.type) {
      case 'dictationReady':
        this.badgeReady = true
        for (const m of this.waiting.splice(0)) this.send(m)
        return true
      case 'dictationAudio':
        void this.typePhrase(message.mode, message.audio)
        return true
      case 'dictationText':
        void this.typeHeard(message.mode, message.text, message.language, message.sure)
        return true
      case 'dictationNote':
        void this.awaitNote(message.id)
        return true
      case 'dictationKept':
        if (this.state === 'working') this.kept = message.pcm
        return true
      case 'dictationPcm':
        this.heardPcm(message.pcm, message.last)
        return true
      case 'dictationHeight':
        this.fit(message.px)
        return true
      case 'dictationTuck':
        this.tuck(message.fly)
        return true
      case 'dictationCancelled':
        this.over()
        this.badge?.hide()
        return true
      case 'dictationFailed':
        this.fail(message.message)
        return true
      default:
        return false
    }
  }

  private async typePhrase(mode: DictationMode, audio: Uint8Array): Promise<void> {
    if (this.byRemote && this.o.remote) return this.hearRemote(mode, audio, 'audio/webm', (Date.now() - this.began) / 1000)
    return this.hearHere(mode, audio)
  }

  /** The sound of a phrase going to Groq, as the badge records it; the tail at the key. */
  private heardPcm(pcm: Uint8Array, last: boolean): void {
    const stream = this.stream
    if (!stream || !this.byRemote || this.state === 'idle') return
    // Its own copy, whole samples: the message's bytes may sit at any offset of their buffer.
    const bytes = pcm.slice(0, pcm.byteLength - (pcm.byteLength % 2))
    this.pcm.push(bytes)
    stream.push(new Int16Array(bytes.buffer, 0, bytes.byteLength / 2))
    if (!last) return
    // The preview has done its work: Groq's text is what is typed, and the engine is free should Groq fail.
    this.dropPreview()
    void this.finishStream(this.mode, stream)
  }

  /** The engine's preview session thrown away (never finished: its text is never typed). */
  private dropPreview(): void {
    const id = this.preview
    this.preview = undefined
    if (id) void this.o.speech.call('DELETE', `/dictate/sessions/${id}`)
  }

  /** The whole sound recorded of this phrase, 16-bit PCM at 16 kHz. */
  private wholePcm(): Uint8Array {
    const all = new Uint8Array(this.pcm.reduce((n, c) => n + c.byteLength, 0))
    let at = 0
    for (const c of this.pcm) (all.set(c, at), (at += c.byteLength))
    return all
  }

  /**
   * The key: Groq hears the tail, and the phrase is typed. A piece Groq could not take is never a lost
   * phrase: the whole sound goes to the engine here when it runs, else it waits for the again key.
   */
  private async finishStream(mode: DictationMode, stream: RemoteStream): Promise<void> {
    const pcm = this.wholePcm()
    this.pcm = []
    if (this.keeping) this.kept = pcm
    const stop = new AbortController()
    this.remoteStop = stop
    let heard: { text: string; language: string }
    try {
      heard = await stream.finish()
    } catch (error) {
      if (stop.signal.aborted || this.state !== 'working' || this.stream !== stream) return
      this.stream = undefined
      return this.remoteFailed(mode, error, pcm, 'pcm16', pcm.byteLength / PCM_BYTES_S)
    } finally {
      if (this.remoteStop === stop) this.remoteStop = undefined
    }
    if (stop.signal.aborted || this.stream !== stream) return
    this.stream = undefined
    await this.typeHeard(mode, heard.text, heard.language, heard.language ? 1 : 0)
  }

  /** Groq could not hear the phrase: the engine here hears it when it runs, and the badge says why after it is typed; else the again key sends it once more. */
  private async remoteFailed(mode: DictationMode, error: unknown, audio: Uint8Array, format: 'webm' | 'pcm16', seconds: number): Promise<void> {
    const why = isRemoteError(error) ? t(`remote.${error.fault}`) : error instanceof Error ? error.message : String(error)
    log(`dictation: Groq did not hear the phrase (${isRemoteError(error) ? error.fault : error instanceof Error ? error.name : 'error'})`)
    if (this.o.speech.installed && this.o.speech.ready) return this.hearHere(mode, audio, t('dict.remoteHere'), format)
    this.unsent = format === 'pcm16' ? { mode, audio: new Uint8Array(wavOf(audio)), mime: 'audio/wav', seconds } : { mode, audio, mime: 'audio/webm', seconds }
    return this.fail(`${why} ${t('dict.remoteAgain')}`)
  }

  /**
   * Groq hears the phrase. A fault (no connection, the limit, the key) is never a
   * lost phrase: the engine here hears it when it runs, and the badge says why
   * after it is typed; else it waits for the again key.
   */
  private async hearRemote(mode: DictationMode, audio: Uint8Array, mime: string, seconds: number): Promise<void> {
    const stop = new AbortController()
    this.remoteStop = stop
    let heard: { text: string; language: string }
    try {
      heard = await this.o.remote!.hear(audio, mime, seconds, this.expected(mode), stop.signal)
    } catch (error) {
      if (stop.signal.aborted || this.state !== 'working') return
      // Held as a WAV (a phrase heard piece by piece), it goes to the engine here as that.
      if (mime === 'audio/webm') return this.remoteFailed(mode, error, audio, 'webm', seconds)
      return this.remoteFailed(mode, error, audio.subarray(44), 'pcm16', seconds)
    } finally {
      if (this.remoteStop === stop) this.remoteStop = undefined
    }
    // Whisper's own guess of the language stands as sure: it is one of the person's (remote/dictate.ts).
    await this.typeHeard(mode, heard.text, heard.language, heard.language ? 1 : 0)
  }

  private async hearHere(mode: DictationMode, audio: Uint8Array, note?: string, format: 'webm' | 'pcm16' = 'webm'): Promise<void> {
    const expected = this.expected(mode).map(encodeURIComponent).join(',')
    // strict: a phrase is never taken for a language the person does not use.
    const r = await this.o.speech.call<{ text: string; language: string; sure?: number }>('POST', `/dictate?language=auto&expected=${expected}&strict=1${format === 'pcm16' ? '&format=pcm16' : ''}`, audio)
    if (!r.ok) return this.fail(r.error)
    // An engine before 0.2 says nothing of how sure it is: its language is taken as it is.
    await this.typeHeard(mode, r.data.text, r.data.language, r.data.sure ?? 1, note)
  }

  /** The languages a phrase may be in: the person's, or English alone for practice (so a mistake is not heard as another language). */
  private expected(mode: DictationMode): string[] {
    return mode === 'check' ? ['en'] : this.o.expected().slice(0, MOST_EXPECTED)
  }

  /** A recognized phrase typed where the cursor is; in English first for the English key; checked in the card for practice. */
  private async typeHeard(mode: DictationMode, heard: string, language: string, sure: number, said?: string): Promise<void> {
    if (this.state !== 'working') return
    let text = heard.trim()
    let note: string | undefined = said
    this.hearing = { heard, language, sure }
    if (!text) return this.fail('Nothing was heard')
    if (mode === 'check') {
      this.badge?.hide()
      this.over()
      return this.o.check(text)
    }
    // Whisper unsure, or a model that does not say (Parakeet): the language by the text's letters and words.
    const spoken = language && sure >= 0.5 ? language : this.o.languageOf(text)
    try {
      if (this.o.editing()) {
        const stop = new AbortController()
        this.editStop = stop
        this.send({ type: 'dictationEditing' })
        const edited = await this.o.edit(text, stop.signal)
        text = edited.text
        note = edited.note ?? note
        this.editStop = undefined
        // Esc while it was edited: the phrase is gone (the badge says so in a moment).
        if (stop.signal.aborted) return
      }
      if (mode === 'english' && spoken !== 'en') {
        const english = await this.o.toEnglish(text, spoken)
        text = english.text
        note = english.note ?? note
      }
    } catch (error) {
      return this.fail(`Could not translate: ${error instanceof Error ? error.message : String(error)}`)
    }
    // What was said is shown beside the phrase only when editing changed its words, not for the rules below.
    const reworded = text !== heard.trim()
    // The person's rules for the typed text: ё, the full stop of one sentence.
    text = this.o.polish(text, mode === 'english' ? 'en' : spoken)
    // Said in the badge a moment after it is typed; else the badge goes at once.
    if (note) {
      this.reveal()
      this.send({ type: 'dictationDone', text, note })
    } else this.badge?.hide()
    this.over()
    // A space after it (unless the person wants none), so the next phrase or word goes on without one typed by hand.
    await this.o.paste(this.o.space() ? `${text} ` : text)
    this.chime()
    if (note) this.hideSoon(NOTE_SHOWN_MS)
    this.o.log.add(mode === 'english' ? { mode, text, heard } : { mode: 'type', text, ...(reworded ? { heard } : {}) })
    this.o.logged()
    this.keep(mode, text, note ? { note } : {})
  }

  /** The sound that says the text is typed (or the note saved), for a person not looking at the screen. */
  private chime(): void {
    if (this.o.sound()) this.send({ type: 'dictationSound', sound: 'done' })
  }

  /** This phrase goes to the phrases recorded for a report, when the badge handed over its sound. */
  private keep(mode: DictationMode, typed: string, more: { note?: string; error?: string }): void {
    const pcm = this.kept
    this.kept = undefined
    if (!pcm) return
    try {
      this.o.captured({ mode, ...this.hearing, typed, ...more }, pcm)
    } catch (error) {
      log(`capture: the phrase was not kept: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** The again key: the last phrase typed once more where the cursor is (not logged again). */
  typeAgain(): void {
    if (this.state !== 'idle' || this.opening) return
    // A phrase Groq could not take goes to it once more, typed where the cursor is now.
    const unsent = this.unsent
    if (unsent && this.o.remote) {
      this.unsent = undefined
      this.mode = unsent.mode
      this.byRemote = true
      this.area = this.workArea()
      this.set('working')
      void this.hearRemote(unsent.mode, unsent.audio, unsent.mime, unsent.seconds)
      return
    }
    const last = this.o.log.last()
    if (!last) return this.o.balloon('Kryakl', 'Nothing dictated yet')
    this.o.paste(this.o.space() ? `${last.text} ` : last.text).catch(error => console.warn('Kryakl: could not type the phrase again', error))
  }

  clearLog(): void {
    this.o.log.clear()
    this.o.logged()
  }

  private async awaitNote(id: string): Promise<void> {
    const until = Date.now() + NOTE_WAIT_MS
    while (Date.now() < until) {
      const r = await this.o.speech.call<{ row: Row; transcript: Transcript | null }>('GET', `/transcripts/${id}`)
      if (r.ok && r.data.row.status === 'done' && r.data.transcript) {
        const t = r.data.transcript
        this.over()
        if (t.note) {
          const file = t.note
          this.send({ type: 'dictationDone', text: path.basename(file, '.md') })
          this.chime()
          this.o.balloon('Note saved', `${path.basename(file)}\nClick to open it.`, () => {
            if (openable(file, p => fs.statSync(p).isDirectory())) void shell.openPath(file)
          })
        } else {
          this.send({ type: 'dictationDone', text: t.title })
          this.o.balloon('The note is in Transcripts', t.noteError ?? 'No knowledge base folder is chosen yet: choose one on the Dictate page.', () => this.o.openTranscript(id))
        }
        this.hideSoon(2200)
        return
      }
      if (r.ok && r.data.row.status === 'failed') return this.fail(r.data.row.error || 'Could not transcribe the note')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    this.over()
    this.badge?.hide()
  }

  private fail(message: string): void {
    // A phrase that came to nothing is what a report most needs.
    this.keep(this.mode, '', { error: message })
    this.over()
    this.reveal()
    this.send({ type: 'dictationError', message })
    this.hideSoon(3500)
  }

  private over(): void {
    globalShortcut.unregister('Escape')
    this.dropPreview()
    this.set('idle')
    this.rest()
  }

  /**
   * A badge out of sight with no phrase under way shows nothing: its page is never throttled, so whatever
   * moves on it ("typing…"'s spinner) would be drawn until Kryakl quits. calm.ts pauses a hidden window's
   * animations; this empties the page besides, so nothing is left to move.
   */
  private rest(): void {
    const b = this.badge
    if (!b || b.isDestroyed() || !this.badgeReady || this.state !== 'idle' || b.isVisible()) return
    b.webContents.send('to-view', { type: 'dictationRest' } satisfies ToView)
  }

  private hideSoon(ms: number): void {
    setTimeout(() => {
      if (this.state === 'idle') this.badge?.hide()
    }, ms)
  }

  private set(state: Dictation['state']): void {
    this.state = state
    this.o.onChange()
  }

  private send(message: ToView): void {
    const badge = this.window()
    if (this.badgeReady) badge.webContents.send('to-view', message)
    else this.waiting.push(message)
  }

  private window(): BrowserWindow {
    if (this.badge && !this.badge.isDestroyed()) return this.badge
    const b = new BrowserWindow({
      width: BADGE.width,
      height: BADGE.min,
      show: false,
      frame: false,
      resizable: false,
      // All of it is a drag region (dictation.css): the person puts it where it bothers least.
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // The program being typed in keeps the focus, so the text lands there.
      focusable: false,
      title: 'Kryakl dictation',
      // The page draws the pill itself (its 16 px corners and 1 px edge, dictation.css): the window around it is
      // see-through, on Windows 10 and 11 alike, as DWM's own round corner is fixed at about 8 px.
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
    })
    // No edge of Windows 11's around it either: a square ghost behind the pill's round corners.
    frameWindow(b, { corner: 'square', border: 'none' })
    // Its page is never throttled (it records while folded away), and it is hidden after each phrase with the
    // "typing…" spinner still on it: unpaused, that spinner turned until Kryakl quit (calm.ts).
    calmWhenHidden(b)
    b.setAlwaysOnTop(true, 'pop-up-menu')
    b.removeMenu()
    b.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    b.webContents.on('will-navigate', event => event.preventDefault())
    // Both come only for a drag by the person, 'moved' once, when it ends (never for setBounds or a flight).
    b.on('will-move', () => {
      this.dragging = true
    })
    b.on('moved', () => {
      this.dragging = false
      this.dropped()
      this.fit(this.asked)
    })
    b.on('closed', () => {
      // A badge made again (renew) is not this one.
      if (this.badge !== b) return
      this.badge = undefined
      this.badgeReady = false
    })
    b.on('hide', () => {
      clearTimeout(this.looking)
      clearInterval(this.flight)
      log(`badge: hidden, state ${this.state}`)
      this.rest()
    })
    b.on('unresponsive', () => log('badge: the page does not answer'))
    b.webContents.on('render-process-gone', (_event, details) => log(`badge: the page's process is gone: ${details.reason}`))
    b.webContents.on('did-fail-load', (_event, code, description) => log(`badge: the page did not load: ${code} ${description}`))
    b.webContents.on('console-message', m => log(`badge page: ${m.message} (${m.sourceId}:${m.lineNumber})`))
    void b.loadFile(this.o.page, { query: this.o.query() })
    log(`badge: window made, page ${this.o.page}`)
    this.badge = b
    return b
  }

  /** On top of every window, those kept on top too, the focus left where it is. */
  private raise(b: BrowserWindow): void {
    try {
      putOnTop(handleOf(b))
    } catch (error) {
      console.warn('Kryakl: Windows did not put the badge on top', error)
    }
  }

  /** Windows' own view of the badge; undefined when it does not say. */
  private sight(b: BrowserWindow): Sight | undefined {
    try {
      return sightOf(handleOf(b))
    } catch (error) {
      console.warn('Kryakl: could not ask Windows about the badge', error)
      return undefined
    }
  }

  /**
   * Electron may call the badge shown while the person sees nothing (2026-10-29:
   * every phrase logged "visible"; caught live, the badge lay under VS Code and
   * Chrome, its "on top" flag still set). So, while it is up, Windows' own
   * view: is it still on top, is it cloaked, does a window lie over it. A
   * change goes into the log once; off top or under a window it is raised at
   * once; a cloaked badge (another virtual desktop) records this phrase still,
   * so it is made again before the next one.
   */
  private look(after: number): void {
    clearTimeout(this.looking)
    this.looking = setTimeout(() => {
      const b = this.badge
      if (!b || b.isDestroyed() || !b.isVisible()) return
      const sight = this.sight(b)
      if (!sight) return
      const trouble = troubleOf(sight)
      if (trouble !== this.trouble) log(trouble ? `badge: Windows has it ${trouble}` : 'badge: Windows has it on top again')
      this.trouble = trouble
      if (sight.cloaked) this.stale = 'as Windows cloaked the last one'
      if (trouble) this.raise(b)
      this.look(LOOK_MS.every)
    }, after)
  }

  /** A new badge in place of one Windows cloaked (made now, it is on the desktop in use), or of one in the interface's old language. */
  private renew(): void {
    const why = this.stale
    this.stale = false
    this.badge?.destroy()
    this.badge = undefined
    this.badgeReady = false
    log(`badge: made again, ${why}`)
  }

  /** The interface's language changed: the next phrase gets a badge made in it. */
  languageChanged(): void {
    if (this.badge) this.stale = 'in the new language'
  }

  /**
   * The work area of the screen holding the window in front (the one the text
   * goes into); with no window there, or one Windows gives no size, the
   * screen under the pointer.
   */
  private workArea(): Rect {
    try {
      const rect = windowRect(foreground().hwnd)
      if (rect) return screen.getDisplayMatching(screen.screenToDipRect(null, rect)).workArea
    } catch (error) {
      console.warn('Kryakl: could not find the window in front', error)
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  }

  /** The page's new height, the bottom edge kept, inside the work area. */
  private fit(px: number): void {
    const b = this.badge
    if (!b || b.isDestroyed() || !Number.isFinite(px)) return
    const height = Math.round(Math.min(BADGE.max, Math.max(BADGE.min, px)))
    this.asked = height
    if (height === this.height || this.dragging || this.tucked) return
    this.height = height
    const now = b.getBounds()
    const area = screen.getDisplayMatching(now).workArea
    const y = Math.max(area.y, now.y + now.height - height)
    b.setBounds({ x: now.x, y, width: BADGE.width, height })
    log(`badge: page ${px} px → ${JSON.stringify(b.getBounds())} from ${JSON.stringify(now)}, visible ${b.isVisible()}`)
  }

  /** The person dropped the badge: the place is kept from that screen's bottom centre, for every screen. */
  private dropped(): void {
    const b = this.badge
    if (!b || b.isDestroyed()) return
    const bounds = b.getBounds()
    this.o.moved(badgeOffset(bounds, screen.getDisplayMatching(bounds).workArea))
  }

  dispose(): void {
    clearTimeout(this.looking)
    clearInterval(this.flight)
    this.badge?.destroy()
  }
}
