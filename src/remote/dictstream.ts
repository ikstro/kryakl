// A dictation heard by Groq while it is spoken (2026-11-23): the badge sends
// the sound (16-bit PCM at 16 kHz) as it is recorded, pieces.ts cuts it at
// pauses, and each piece goes to Groq at once, one at a time and in order, so
// the panel shows the text so far, as the engine here does (engine/stream.py).
// At the key only the tail is left to hear. The engine's rules, as for a
// phrase heard whole (remote/dictate.ts):
// - the language is settled by the first piece (asked again in the person's
//   own when heard as one they do not use), and the next pieces are told it;
// - each piece is told the person's names and the text heard before it, its
//   tail, without the ellipsis a cut piece ends in (stream.told);
// - each piece's text is cleaned of what nobody said (phantoms.ts), the pieces
//   joined with no ellipsis at a seam the sentence goes on after
//   (stream.joined), and the names put right (vocabcorrect.ts).
// A piece that fails ends the stream: `finish` throws, and the whole sound goes
// where a phrase Groq could not take goes (dictation.ts).

import { wavOf } from '../dictcapture'
import { cleanDictated, joinedPieces, openEnded, type HeardSegment } from '../phantoms'
import { correct } from '../vocabcorrect'
import type { VocabularyEntry } from '../vocabulary'
import { clipTail, GROQ_SPEECH, namesPrompt, PROMPT_TOKENS, tokensOf, type Heard, type TranscribeAsk } from './groq'
import { Pieces, RATE, type Piece } from './pieces'

export type Hears = { transcribe(ask: TranscribeAsk): Promise<Heard> }

export type StreamAsk = {
  expected: readonly string[]
  vocabulary: readonly VocabularyEntry[]
  ordinary?: ReadonlySet<string>
  /** The text heard so far, and the seconds of speech still waiting to be heard. */
  onText?: (text: string, pending: number) => void
}

export type Streamed = { text: string; language: string; cut: string[]; asked: number; pieces: number }

/** The prompt of a piece: the names, then as much of the text before it as Groq's limit leaves room for. */
export function piecePrompt(names: string, before: string, most = PROMPT_TOKENS): string {
  const used = names.split(/\s+/).filter(Boolean).reduce((n, w) => n + tokensOf(w), 0)
  const tail = clipTail(openEnded(before), most - used)
  return [names, tail].filter(Boolean).join(' ')
}

const segmentsOf = (heard: Heard): HeardSegment[] => heard.segments.map(s => ({ start: s.start, end: s.end, text: s.text, avgLogprob: s.avgLogprob, noSpeech: s.noSpeech }))

export class GroqStream {
  private readonly pieces = new Pieces()
  private readonly stop = new AbortController()
  private readonly names: string
  private readonly own: string
  private readonly only: string | undefined
  private texts: string[] = []
  private cut: string[] = []
  /** The language the next pieces are told, settled by the first; and the one the phrase is said to be in, '' when Whisper named none of the person's. */
  private language: string | undefined
  private spoken = ''
  private asked = 0
  private sent = 0
  private waiting = 0
  private chain: Promise<void> = Promise.resolve()
  private failure: unknown
  private ended = false

  constructor(
    private readonly groq: Hears,
    private readonly ask: StreamAsk,
  ) {
    this.names = namesPrompt(ask.vocabulary.map(entry => entry.word))
    this.own = ask.expected[0] ?? ''
    this.only = ask.expected.length === 1 ? this.own : undefined
  }

  get cancelled(): boolean {
    return this.stop.signal.aborted
  }

  /** More of the phrase's sound. */
  push(pcm: Int16Array): void {
    if (this.ended || this.cancelled || this.failure) return
    for (const piece of this.pieces.push(pcm)) this.queue(piece)
  }

  /** The phrase is over: the tail heard, the whole text. Throws what stopped a piece. */
  async finish(): Promise<Streamed> {
    if (!this.ended) {
      this.ended = true
      const tail = this.pieces.end()
      if (tail) this.queue(tail)
    }
    await this.chain
    if (this.cancelled) throw new DOMException('Dictation cancelled', 'AbortError')
    if (this.failure) throw this.failure
    return { text: this.text(), language: this.spoken, cut: this.cut, asked: this.asked, pieces: this.sent }
  }

  /** Esc: the piece under way is dropped, and none is sent after it. */
  cancel(): void {
    this.stop.abort()
  }

  private text(): string {
    return correct(joinedPieces(this.texts), this.ask.vocabulary, this.ask.ordinary).trim()
  }

  private queue(piece: Piece): void {
    this.waiting += piece.speech
    this.chain = this.chain.then(async () => {
      this.waiting -= piece.speech
      if (this.cancelled || this.failure) return
      try {
        await this.hear(piece)
      } catch (error) {
        if (!this.cancelled) this.failure = error
      }
    })
  }

  private async hear(piece: Piece): Promise<void> {
    const audio = wavOf(new Uint8Array(piece.pcm.buffer, piece.pcm.byteOffset, piece.pcm.byteLength))
    const seconds = piece.pcm.length / RATE
    // The text before as typed: its names spelled as the person spells them.
    const prompt = piecePrompt(this.names, this.text())
    const send = (language: string | undefined) => {
      this.asked++
      return this.groq.transcribe({
        model: GROQ_SPEECH.dictation,
        audio,
        mime: 'audio/wav',
        name: 'piece.wav',
        seconds,
        ...(language ? { language } : {}),
        ...(prompt ? { prompt } : {}),
        signal: this.stop.signal,
      })
    }
    const settled = this.language ?? this.only
    let heard = await send(settled)
    this.sent++
    if (!settled) {
      // The first piece settles the language; heard as one the person does not use, it is asked again in their own.
      if (this.own && heard.language && !this.ask.expected.includes(heard.language)) heard = await send(this.own)
      this.spoken = heard.language && this.ask.expected.includes(heard.language) ? heard.language : ''
      this.language = this.spoken || this.own || undefined
    } else if (!this.spoken && heard.language && this.ask.expected.includes(heard.language)) this.spoken = heard.language
    const clean = cleanDictated(heard.text, { segments: segmentsOf(heard), seconds: heard.seconds })
    this.cut.push(...clean.cut)
    if (clean.text) this.texts.push(clean.text)
    if (!this.cancelled) this.ask.onText?.(this.text(), Math.max(0, this.waiting))
  }
}
