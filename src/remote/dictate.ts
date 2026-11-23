// A dictated phrase heard by Groq's Whisper (2026-11-23), held to the rules
// the speech engine keeps for a phrase heard here, which the engine cannot
// apply as the phrase never reaches it:
// - its language is one the person uses: Whisper guesses the language itself,
//   and a phrase heard as another is asked again in the person's own (the
//   engine's `strict`; told to expect English, Whisper translates instead);
// - the person's names and terms are its prompt, and what Whisper still writes
//   its own way is put right as the engine does it (Words to spell,
//   vocabcorrect.ts: a heard form, another case, a near miss of a long name);
// - what nobody said, a video's credits or sign-off, is cut (phantoms.ts).

import { cleanDictated, type HeardSegment } from '../phantoms'
import { correct } from '../vocabcorrect'
import type { VocabularyEntry } from '../vocabulary'
import { GROQ_SPEECH, namesPrompt, type Groq, type Heard } from './groq'

export type DictateAsk = {
  audio: Uint8Array
  /** The sound's type: WebM as the badge records a phrase whole, WAV for one heard piece by piece and held for the again key. */
  mime?: 'audio/webm' | 'audio/wav'
  /** The phrase's length as recorded, for the count of what was spent. */
  seconds: number
  /** The languages the phrase may be in, the person's own first; English alone for spoken practice. */
  expected: readonly string[]
  vocabulary: readonly VocabularyEntry[]
  /** The ordinary words of the en/uk/ru lists (vocabcorrect.ts ordinaryWords), which a near miss of a name never replaces; none, nothing is guessed. */
  ordinary?: ReadonlySet<string>
  signal?: AbortSignal
}

export type Dictated = { text: string; language: string; cut: string[]; asked: number }

const segmentsOf = (heard: Heard): HeardSegment[] => heard.segments.map(s => ({ start: s.start, end: s.end, text: s.text, avgLogprob: s.avgLogprob, noSpeech: s.noSpeech }))

export async function dictateByGroq(groq: Groq, ask: DictateAsk): Promise<Dictated> {
  const own = ask.expected[0] ?? ''
  const only = ask.expected.length === 1 ? own : undefined
  const prompt = namesPrompt(ask.vocabulary.map(entry => entry.word))
  const hear = (language: string | undefined) =>
    groq.transcribe({
      model: GROQ_SPEECH.dictation,
      audio: ask.audio,
      mime: ask.mime ?? 'audio/webm',
      name: ask.mime === 'audio/wav' ? 'phrase.wav' : 'phrase.webm',
      seconds: ask.seconds,
      ...(language ? { language } : {}),
      ...(prompt ? { prompt } : {}),
      ...(ask.signal ? { signal: ask.signal } : {}),
    })
  let asked = 1
  let heard = await hear(only)
  // Heard as a language the person does not use: once more, told it is their own.
  if (!only && own && heard.language && !ask.expected.includes(heard.language)) {
    asked++
    heard = await hear(own)
  }
  const clean = cleanDictated(heard.text, { segments: segmentsOf(heard), seconds: heard.seconds })
  return { text: correct(clean.text, ask.vocabulary, ask.ordinary).trim(), language: heard.language && ask.expected.includes(heard.language) ? heard.language : '', cut: clean.cut, asked }
}
