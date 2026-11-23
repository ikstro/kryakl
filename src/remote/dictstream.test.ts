import { describe, expect, it, vi } from 'vitest'

import { GroqStream, piecePrompt, type Hears } from './dictstream'
import { clipTail, PROMPT_TOKENS, RemoteError, tokensOf, type Heard, type TranscribeAsk } from './groq'
import { RATE } from './pieces'

/** A stretch of speech (a tone) or of silence, as the badge sends it. */
const tone = (seconds: number) => Int16Array.from({ length: Math.round(seconds * RATE) }, (_, i) => Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * 220 * i) / RATE)))
const silence = (seconds: number) => new Int16Array(Math.round(seconds * RATE))

function heard(text: string, language = 'ru'): Heard {
  return { text, language, seconds: 7, segments: [{ start: 0, end: 7, text, avgLogprob: -0.2, noSpeech: 0.01, compression: 1.2 }], words: [] }
}

/** Groq that answers each request with the next text, and keeps what it was asked. */
function groqOf(answers: (Heard | Error)[]): Hears & { asks: TranscribeAsk[] } {
  const asks: TranscribeAsk[] = []
  return {
    asks,
    transcribe: vi.fn(async (ask: TranscribeAsk) => {
      asks.push(ask)
      const next = answers.shift()
      if (!next) throw new Error('asked once too often')
      if (next instanceof Error) throw next
      return next
    }),
  }
}

/** Two pieces' worth of sound and a tail: 7 s, a pause, 7 s, a pause, 2 s. */
function speak(stream: GroqStream): void {
  for (const part of [tone(7), silence(0.8), tone(7), silence(0.8), tone(2)]) for (let i = 0; i < part.length; i += 4000) stream.push(part.subarray(i, i + 4000))
}

const ASK = { expected: ['ru', 'en'], vocabulary: [{ word: 'Kryakl', heard: ['крякл'] }] }

describe('the prompt of a piece', () => {
  it('is the names, then the end of the text before it, without the ellipsis a cut piece ends in', () => {
    expect(piecePrompt('Kryakl.', 'В какой-то момент...')).toBe('Kryakl. В какой-то момент')
    expect(piecePrompt('', 'Привет.')).toBe('Привет.')
    expect(piecePrompt('Kryakl.', '')).toBe('Kryakl.')
  })

  it('keeps within Groq\'s limit, the latest words kept', () => {
    const before = Array.from({ length: 300 }, (_, i) => `слово${i}`).join(' ')
    const prompt = piecePrompt('Kryakl.', before)
    expect(prompt.split(' ').reduce((n, w) => n + tokensOf(w), 0)).toBeLessThanOrEqual(PROMPT_TOKENS)
    expect(prompt.endsWith('слово299')).toBe(true)
    expect(prompt.startsWith('Kryakl. ')).toBe(true)
    expect(clipTail('a bb ccc', 2)).toBe('bb ccc')
  })
})

describe('a dictation heard by Groq piece by piece', () => {
  it('sends each piece at its pause and shows the text so far', async () => {
    const groq = groqOf([heard('В какой-то момент...'), heard('я увидел крякл.'), heard('Всё.')])
    const shown: string[] = []
    const stream = new GroqStream(groq, { ...ASK, onText: text => void shown.push(text) })
    speak(stream)
    const out = await stream.finish()
    expect(out).toMatchObject({ text: 'В какой-то момент я увидел Kryakl. Всё.', language: 'ru', pieces: 3, asked: 3 })
    // The text so far after each piece: the seam's ellipsis gone, the name put right.
    expect(shown).toEqual(['В какой-то момент...', 'В какой-то момент я увидел Kryakl.', 'В какой-то момент я увидел Kryakl. Всё.'])
    expect(groq.asks.map(a => a.mime)).toEqual(['audio/wav', 'audio/wav', 'audio/wav'])
    // Each piece told the names and the text before it; the first settles the language for the rest.
    expect(groq.asks.map(a => a.prompt)).toEqual(['Kryakl.', 'Kryakl. В какой-то момент', 'Kryakl. В какой-то момент я увидел Kryakl.'])
    expect(groq.asks.map(a => a.language)).toEqual([undefined, 'ru', 'ru'])
  })

  it('asks the first piece again in the person\'s own language when heard as another', async () => {
    const groq = groqOf([heard('At some point', 'de'), heard('В какой-то момент'), heard('я увидел'), heard('всё')])
    const stream = new GroqStream(groq, ASK)
    speak(stream)
    const out = await stream.finish()
    expect(groq.asks.map(a => a.language)).toEqual([undefined, 'ru', 'ru', 'ru'])
    expect(out).toMatchObject({ language: 'ru', asked: 4, pieces: 3 })
  })

  it('tells English alone to every piece of spoken practice', async () => {
    const groq = groqOf([heard('I has', 'en'), heard('a dog', 'en'), heard('yes', 'en')])
    const stream = new GroqStream(groq, { expected: ['en'], vocabulary: [] })
    speak(stream)
    await stream.finish()
    expect(groq.asks.map(a => a.language)).toEqual(['en', 'en', 'en'])
  })

  it('cleans each piece of what nobody said', async () => {
    const groq = groqOf([heard('Привет. Субтитры сделал DimaTorzok'), heard('пока'), heard('Продолжение следует...')])
    const stream = new GroqStream(groq, ASK)
    speak(stream)
    const out = await stream.finish()
    expect(out.text).toBe('Привет. пока')
    expect(out.cut).toEqual(['credit', 'sign-off'])
  })

  it('makes a short phrase one request at the key', async () => {
    const groq = groqOf([heard('Привет.')])
    const stream = new GroqStream(groq, ASK)
    stream.push(tone(3))
    expect(groq.asks).toHaveLength(0)
    const out = await stream.finish()
    expect(out).toMatchObject({ text: 'Привет.', pieces: 1 })
    expect(groq.asks[0]!.seconds).toBeCloseTo(3, 0)
  })

  it('stops at a piece that failed, sends none after it, and says why at the key', async () => {
    const fault = new RemoteError('offline', 'no connection')
    const groq = groqOf([heard('В какой-то момент'), fault, heard('never asked')])
    const stream = new GroqStream(groq, ASK)
    speak(stream)
    await expect(stream.finish()).rejects.toBe(fault)
    expect(groq.asks).toHaveLength(2)
  })

  it('drops the piece under way on Esc, and none is sent after it', async () => {
    let signal: AbortSignal | undefined
    const groq: Hears = {
      transcribe: vi.fn((ask: TranscribeAsk) => {
        signal = ask.signal
        return new Promise<Heard>((_, reject) => ask.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
      }),
    }
    const stream = new GroqStream(groq, ASK)
    speak(stream)
    await Promise.resolve()
    stream.cancel()
    expect(signal?.aborted).toBe(true)
    await expect(stream.finish()).rejects.toMatchObject({ name: 'AbortError' })
    expect(groq.transcribe).toHaveBeenCalledTimes(1)
    expect(stream.cancelled).toBe(true)
  })
})
