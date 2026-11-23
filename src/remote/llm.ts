// Accurate translation by Groq, with the person's own key (2026-11-23). Groq's
// free plan allows 30 requests a minute a model, so a text is not sent a
// sentence a request as the local model takes it: its sentences go together,
// numbered, as many as fit `BATCH_CHARS`, and the answer is forced into the
// same numbers (a strict JSON schema). A sentence the answer leaves out is
// asked once more alone with the others left out; still missing, it stays
// untranslated (the draft stands for it). Every fault is a RemoteError, which
// main.ts takes as "give up, Fast's translation stands".

import { LLM_LANGUAGES } from '../llmfiles'
import { translatePrompt, type LlmTranslator } from '../llmtranslator'
import type { Translate } from '../translate'
import type { RemoteChat } from './groq'

/** The letters of the sentences one request carries: about 1,500 tokens there and as many back, a fifth of a minute's 8,000. */
export const BATCH_CHARS = 3000
const TIMEOUT_MS = 45_000

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { i: { type: 'integer' }, text: { type: 'string' } },
        required: ['i', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
}

/** The sentences, by their places, cut into requests of at most `chars` letters (a longer sentence goes alone). */
export function batches(indices: readonly number[], sentences: readonly string[], chars = BATCH_CHARS): number[][] {
  const out: number[][] = []
  let now: number[] = []
  let size = 0
  for (const i of indices) {
    const length = sentences[i]?.length ?? 0
    if (now.length && size + length > chars) {
      out.push(now)
      now = []
      size = 0
    }
    now.push(i)
    size += length
  }
  if (now.length) out.push(now)
  return out
}

/** The instructions for a numbered batch: the one-sentence rules, and the numbers kept. */
export function batchPrompt(from: string, to: string): string {
  return (
    translatePrompt(from, to).replace('Reply with the translation only, nothing before or after it. ', '') +
    ' You get numbered sentences of one text in JSON. Translate each one on its own, in the context of the others, and answer in JSON with the same numbers: one item for each sentence, its translation only.'
  )
}

/** The answer's translations by their numbers; an item with no text or a number not asked is left out. */
export function readBatch(content: string, asked: readonly number[]): Map<number, string> {
  const out = new Map<number, string>()
  let data: { items?: unknown } = {}
  try {
    data = JSON.parse(content) as typeof data
  } catch {
    return out
  }
  if (!Array.isArray(data.items)) return out
  const wanted = new Set(asked)
  for (const item of data.items as { i?: unknown; text?: unknown }[]) {
    if (typeof item?.i !== 'number' || typeof item.text !== 'string' || !wanted.has(item.i)) continue
    const text = item.text.trim()
    if (text) out.set(item.i, text)
  }
  return out
}

export function createRemoteTranslator(chat: RemoteChat): LlmTranslator {
  async function ask(sentences: readonly string[], asked: readonly number[], from: string, to: string): Promise<Map<number, string>> {
    const answer = await chat.ask('translate', {
      messages: [
        { role: 'system', content: batchPrompt(from, to) },
        { role: 'user', content: JSON.stringify({ items: asked.map(i => ({ i, text: sentences[i]!.trim() })) }) },
      ],
      temperature: 0,
      // The translations and their numbers; the client adds room for a model that reasons first.
      maxTokens: Math.min(8192, 64 + asked.reduce((n, i) => n + 2 * (sentences[i]?.length ?? 0), 0)),
      schema: { name: 'translation', schema: SCHEMA },
      timeoutMs: TIMEOUT_MS,
    })
    return readBatch(answer.content, asked)
  }

  const translate: Translate = async (sentences, from, to, progress) => {
    const unknown = [from, to].find(code => !LLM_LANGUAGES[code])
    if (unknown) throw new Error(`Groq's model does not translate this language (${unknown})`)
    const out: (string | undefined)[] = sentences.map(s => (s.trim() ? undefined : s))
    const todo = sentences.flatMap((s, i) => (s.trim() ? [i] : []))
    // The batches one after another: the free plan's minute is shared, and the first is shown while the next goes.
    for (const batch of batches(todo, sentences)) {
      const got = await ask(sentences, batch, from, to)
      const missing = batch.filter(i => !got.has(i))
      if (missing.length) for (const [i, text] of await ask(sentences, missing, from, to)) got.set(i, text)
      for (const i of batch) {
        out[i] = got.get(i)
        progress?.(i, out[i], false)
      }
    }
    return out
  }

  return {
    direct: true,
    state: native => (LLM_LANGUAGES[native] ? { status: 'ready', progress: 1, size: 0 } : { status: 'unsupported', progress: 0, size: 0 }),
    prepare: native => (LLM_LANGUAGES[native] ? Promise.resolve() : Promise.reject(new Error("Groq's model does not translate this language"))),
    translate,
    // No local slowness to give up on: Groq's own faults end the job (RemoteError).
    hurried: () => translate,
    dispose: () => undefined,
  }
}
