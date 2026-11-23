// Check my English: the person's local model (Gemma 4 E4B or 12B, the one
// that translates too; llmfiles.ts, run by llama.cpp's server) corrects their English and says the main mistake in a short
// line of their own language. The answer is forced into JSON by llama.cpp's
// json_schema; what changed is marked by worddiff.ts, never by the model.
// Each line is checked on its own, four at a time: given two paragraphs, the
// model once answered with the first alone. An answer that loses much of its
// line is not taken. Measured on 44 texts (2026-10-30): 31 of 32 mistakes
// caught, none of 11 right texts changed, 0.7 s a text on the RTX 2080 SUPER,
// about 5 s on the i9; the 12B barely better at 2 s. TranslateGemma could not
// check: it translated the instructions. Telling the note to put grammar before a typo cost a
// caught mistake ("How it works?") and wrote one note in English: not kept.

import { LLM_LANGUAGES, mapLimit, type LlmFiles, type LlmModel, type ModelState } from './llmfiles'
import { localComplete, remoteComplete, type Complete, type RemoteChoice } from './remote/complete'

const PARALLEL = 4
/** A long text on the processor may take minutes. */
const REQUEST_MS = 10 * 60_000

/** One sentence of the rule, as the note should say it, in the languages that have one. */
const EXAMPLES: Record<string, string> = {
  en: 'made → make: after "can" a verb takes its base form.',
  ru: 'made → make: после can глагол стоит в начальной форме.',
  uk: 'made → make: після can дієслово стоїть у початковій формі.',
}

/** The instructions for a learner whose own language is `native` (a code); the note is in it. */
export function checkPrompt(native: string): string {
  const own = LLM_LANGUAGES[native] ? native : 'en'
  const language = LLM_LANGUAGES[own]
  const example = EXAMPLES[own]
  return (
    `You check the English of a learner whose own language is ${language}. Correct only real mistakes: grammar, word choice, spelling, missing or wrong words, and punctuation that changes the meaning. ` +
    "Keep the learner's own words, tone and meaning wherever they are right: do not rephrase, do not make it more formal, do not improve the style. " +
    'Leave code, commands, file names, product names, links and numbers exactly as they are.\n' +
    `Answer in JSON. "corrected": the whole text with the mistakes fixed, exactly the same text when there are none. "note": in ${language}, one short sentence on the most important mistake: ` +
    `its wrong and right words as "made → make", then its rule in plain words${example ? `, for example: "${example}"` : '.'} ` +
    'The other mistakes are marked in the text already: do not list them. Mention only changes you made in "corrected". An empty string when there are no mistakes.'
  )
}

const SCHEMA = {
  type: 'object',
  properties: { corrected: { type: 'string' }, note: { type: 'string' } },
  required: ['corrected', 'note'],
  additionalProperties: false,
}

export type CheckOutcome = { corrected: string; note: string }

const same = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/** An answer that drops more words than a correction would (three, or 40 % of a long line): the model lost part of the text. */
export function lostWords(text: string, corrected: string): boolean {
  const n = wordCount(text)
  return n - wordCount(corrected) > Math.max(3, 0.4 * n)
}

export type CheckerOptions = {
  files: LlmFiles
  /** The model in use (the settings' `model`), asked at each check. */
  model: () => LlmModel
  fetch?: typeof fetch
  /** A check done: its seconds, and the seconds it waited for the model to load, when it did. */
  onTimed?: (model: LlmModel, timed: { text: number; start?: number }) => void
  /** Groq by the person's own key, when they chose it for the language models (settings.remote.llm). */
  remote?: RemoteChoice
}

export type Checker = {
  state(): ModelState
  prepare(onProgress: (state: ModelState) => void): Promise<void>
  /** The text corrected (as it was when right) and the note on its main mistake in the person's language (`native`, a code), empty when there is none. */
  check(text: string, native: string): Promise<CheckOutcome>
}

export function createChecker(o: CheckerOptions): Checker {
  const { files } = o
  const post = o.fetch ?? fetch

  async function one(complete: Complete, piece: string, native: string): Promise<CheckOutcome> {
    const text = piece.trim()
    if (!text) return { corrected: piece, note: '' }
    const { content } = await complete({
      messages: [
        { role: 'system', content: checkPrompt(native) },
        { role: 'user', content: text },
      ],
      temperature: 0,
      // The text again and a sentence; the cap stops a model that repeats itself.
      maxTokens: Math.min(4096, 64 + 3 * text.length),
      schema: { name: 'check', schema: SCHEMA },
    })
    let answer: { corrected?: unknown; note?: unknown } = {}
    try {
      answer = JSON.parse(content) as typeof answer
    } catch {
      throw new Error('The checker gave no answer')
    }
    const corrected = typeof answer.corrected === 'string' && answer.corrected.trim() ? answer.corrected.trim() : text
    // The spaces around the line stay as the person typed them.
    const kept = piece.slice(0, piece.length - piece.trimStart().length) + corrected + piece.slice(piece.trimEnd().length)
    if (same(corrected, text) || lostWords(text, corrected)) return { corrected: piece, note: '' }
    return { corrected: kept, note: typeof answer.note === 'string' ? answer.note.trim() : '' }
  }

  async function lines(complete: Complete, text: string, native: string): Promise<CheckOutcome> {
    const outs = await mapLimit(text.split('\n'), PARALLEL, line => one(complete, line, native))
    const notes = [...new Set(outs.map(out => out.note).filter(Boolean))]
    return { corrected: outs.map(out => out.corrected).join('\n'), note: notes.slice(0, 3).join(' ') }
  }

  return {
    state: () => (o.remote?.on() ? { status: 'ready', progress: 1, size: 0 } : files.state(o.model())),
    prepare: onProgress => (o.remote?.on() ? Promise.resolve() : files.prepare(o.model(), onProgress)),
    async check(text, native) {
      if (!text.trim()) return { corrected: text, note: '' }
      // By the person's own key: no model here to load or time.
      if (o.remote?.on()) return lines(remoteComplete(o.remote.chat, 'check'), text, native)
      const model = o.model()
      const target = files.target(model)
      const began = Date.now()
      return files.server.run(target, async (base, loaded) => {
        const ready = Date.now()
        const out = await lines(localComplete(post, base, files.server.apiKey, 'The checker', REQUEST_MS), text, native)
        o.onTimed?.(model, { text: (Date.now() - ready) / 1000, ...(loaded ? { start: (ready - began) / 1000 } : {}) })
        return out
      })
    },
  }
}
