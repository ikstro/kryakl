// Groq with the person's own key (2026-11-23, the owner: a choice for everyone
// between models on this computer and models by their own free key). One
// client for everything Kryakl asks of it: speech into text (Whisper), and the
// language models that translate, check English, talk and edit a dictated
// phrase. Only the main process calls it; the key goes in the Authorization
// header to api.groq.com alone, and a redirect is an error, so it is never
// handed to another host.
//
// The free plan (console.groq.com/docs/rate-limits, read 2026-11-23), per
// account, each model on its own:
//   whisper-large-v3, whisper-large-v3-turbo: 20 requests a minute, 2,000 a
//     day, 7,200 seconds of sound an hour, 28,800 a day; a request counts as
//     10 s at the least; 25 MB a file.
//   openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.8-27b: 30 requests a
//     minute, 1,000 a day, 8,000 tokens a minute, 200,000 a day.
// A paid key has more of each, which Kryakl learns from the answers; nothing
// here stops a request by the free numbers, they are what the pages show.
// A language model whose day or minute is out gives way to the next one for
// the job (`CHAT_MODELS`): the three have their limits apart.

import { LLM_LANGUAGES } from '../llmfiles'
import { billedSeconds, type Usage } from './usage'

export const GROQ_HOST = 'api.groq.com'
const BASE = `https://${GROQ_HOST}/openai/v1`

export { GROQ_FREE, GROQ_MODELS, GROQ_SPEECH } from './plan'

export type RemoteJob = 'translate' | 'check' | 'talk' | 'edit'

/** The language models for each job, the first one first; the next takes over when a limit is hit. */
// Measured 2026-11-23 against Gemma 4 E4B (docs/llm-quality.md): gpt-oss-120b
// translated best and checked as safely (no right text changed, 29 of 32
// caught against Gemma's 31); qwen wrote the most natural words but failed
// strict JSON on 6 of 42 translations; gpt-oss-20b changed meanings and wrote
// its notes in English, so it neither checks nor translates.
export const CHAT_MODELS: Readonly<Record<RemoteJob, readonly string[]>> = {
  translate: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
  check: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b'],
  talk: ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  edit: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
}

/**
 * The answer's room a model that reasons first spends on that. Only gpt-oss:
 * Groq counts the tokens asked for against the minute's (qwen's is 1,000), so
 * room qwen never uses left it two requests a minute.
 */
export const REASONING_ROOM = 512

/** The model that reads a screenshot's text (the only vision model of the free plan, 2026-11-23). */
export const VISION_MODEL = 'qwen/qwen3.8-27b'
/** The answer's tokens at most: the free minute has 1,000 (a request asking 4,000 was refused). */
const VISION_TOKENS = 900
const READ_PROMPT =
  'Transcribe all text in this screenshot exactly as it appears, line by line, top to bottom. Keep each screen line on its own line, keep indents, keep the original language and spelling, do not translate, do not fix mistakes, do not add anything. Output only the text.'

/** The text without a markdown fence a model may put round it. */
export function stripFence(text: string): string {
  const fenced = /^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return (fenced ? fenced[1]! : text).replace(/\s+$/, '')
}

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024
/** Groq's own limit on the prompt's tokens. */
export const PROMPT_TOKENS = 224
/** A limit that lifts this soon is waited for; a longer one moves the job on (the next model, or this computer). */
const SHORT_WAIT_S = 12

export type RemoteFault = 'key' | 'limit' | 'offline' | 'timeout' | 'server' | 'nokey' | 'format'

/** Why Groq did not do the job; `retryAfter`: the seconds Groq said to wait, for a limit. */
export class RemoteError extends Error {
  constructor(
    readonly fault: RemoteFault,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message)
    this.name = 'RemoteError'
  }
}

export const isRemoteError = (error: unknown): error is RemoteError => error instanceof RemoteError

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatAsk = {
  messages: ChatMessage[]
  temperature: number
  maxTokens: number
  /** The answer forced into this JSON (every property required, no others). */
  schema?: { name: string; schema: Record<string, unknown> }
  signal?: AbortSignal
  timeoutMs?: number
}

export type ChatAnswer = { content: string; model: string; cut: boolean }

/** What the language-model jobs need of a remote service. */
export type RemoteChat = {
  ask(job: RemoteJob, ask: ChatAsk): Promise<ChatAnswer>
}

export type Segment = { start: number; end: number; text: string; avgLogprob: number; noSpeech: number; compression: number }
export type Word = { word: string; start: number; end: number }
export type Heard = { text: string; language: string; seconds: number; segments: Segment[]; words: Word[] }

export type TranscribeAsk = {
  model: string
  audio: Uint8Array
  /** The file's type and name as Groq should take it ("audio/webm", "audio.webm"). */
  mime: string
  name: string
  /** The sound's length, for the count of what was spent (Groq's own, when it says). */
  seconds: number
  language?: string
  prompt?: string
  words?: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

export type GroqOptions = {
  key: () => string | undefined
  usage: Usage
  fetch?: typeof fetch
  say?: (message: string) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * The prompt cut so it stays inside Groq's token limit, on a word's boundary.
 * Cyrillic runs about three letters a token, Latin a little more, so three is
 * the safe side: a long list is cut a little early, never past the limit.
 */
export function clipPrompt(prompt: string, most = PROMPT_TOKENS): string {
  let used = 0
  const kept: string[] = []
  for (const word of prompt.split(/\s+/)) {
    if (!word) continue
    const cost = tokensOf(word)
    if (used + cost > most) break
    used += cost
    kept.push(word)
  }
  return kept.join(' ')
}

/** A word's tokens as clipPrompt counts them. */
export const tokensOf = (word: string): number => Math.max(1, Math.ceil(word.length / 3))

/** The end of a text within `most` tokens, on a word's boundary: the words just said, as the next piece of a dictation is told them. */
export function clipTail(text: string, most: number): string {
  let used = 0
  const kept: string[] = []
  const words = text.split(/\s+/).filter(Boolean)
  for (let i = words.length - 1; i >= 0; i--) {
    const cost = tokensOf(words[i]!)
    if (used + cost > most) break
    used += cost
    kept.push(words[i]!)
  }
  return kept.reverse().join(' ')
}

/**
 * The person's names and terms as Whisper's prompt: the spellings, comma
 * separated, closed with a full stop. A bare list as the only text before a
 * phrase taught Whisper to leave its sentence marks out (2026-11-14, measured
 * on the local turbo: end marks right in 31 → 56 of 56 with the stop).
 */
export function namesPrompt(names: readonly string[]): string {
  const list = clipPrompt(names.map(n => n.trim()).filter(Boolean).join(', '), PROMPT_TOKENS - 1).replace(/,$/, '')
  if (!list) return ''
  return /[.?!…]$/.test(list) ? list : `${list}.`
}

const LANGUAGE_CODES: ReadonlyMap<string, string> = new Map(Object.entries(LLM_LANGUAGES).map(([code, name]) => [name.toLowerCase(), code.split('-')[0]!]))

/** Whisper names a language in English ("russian"); Kryakl's code for it, '' when it is none of Kryakl's. */
export function languageCode(name: unknown): string {
  if (typeof name !== 'string' || !name) return ''
  const low = name.trim().toLowerCase()
  if (/^[a-z]{2}$/.test(low)) return low
  return LANGUAGE_CODES.get(low) ?? ''
}

const num = (value: unknown, otherwise = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : otherwise)

function header(response: Response, name: string): number | undefined {
  const raw = response.headers.get(name)
  if (raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

/** Whether a model reasons before it answers, and how that is kept short (console.groq.com/docs/reasoning). */
function reasoning(model: string): Record<string, unknown> {
  // Qwen answers with no reasoning at all; gpt-oss cannot, so the least of it, kept out of the answer.
  if (model.startsWith('qwen/')) return { reasoning_effort: 'none' }
  if (model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low', include_reasoning: false }
  return {}
}

export class Groq implements RemoteChat {
  private readonly request: typeof fetch
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  /** A model whose limit is out, and until when. */
  private readonly out = new Map<string, number>()

  constructor(private readonly o: GroqOptions) {
    this.request = o.fetch ?? fetch
    this.now = o.now ?? Date.now
    this.sleep = o.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  /** Whether a key is saved. */
  get ready(): boolean {
    return !!this.o.key()
  }

  /** When the first of `models` is free again (ms from now), 0 when one is free now. */
  waitFor(models: readonly string[]): number {
    const now = this.now()
    let soonest = Infinity
    for (const model of models) {
      const until = this.out.get(model) ?? 0
      if (until <= now) return 0
      soonest = Math.min(soonest, until - now)
    }
    return Number.isFinite(soonest) ? soonest : 0
  }

  /** Asks Groq whether it takes `key`: its model list answers before anything of the person's is sent. */
  async check(key: string, timeoutMs = 10_000): Promise<'ok' | 'bad' | 'offline'> {
    try {
      const response = await this.request(`${BASE}/models`, { headers: { authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
      if (response.ok) return 'ok'
      return response.status === 401 || response.status === 403 ? 'bad' : 'offline'
    } catch {
      return 'offline'
    }
  }

  /** Speech into text: the words, the language Whisper heard, and each segment with how sure it was. */
  async transcribe(ask: TranscribeAsk): Promise<Heard> {
    if (!ask.audio.byteLength) throw new Error('No sound was recorded.')
    if (ask.audio.byteLength > MAX_AUDIO_BYTES) throw new Error('The recording is too long for one request to Groq.')
    const body = () => {
      const form = new FormData()
      form.append('file', new Blob([ask.audio.slice()], { type: ask.mime }), ask.name)
      form.append('model', ask.model)
      form.append('temperature', '0')
      form.append('response_format', 'verbose_json')
      form.append('timestamp_granularities[]', 'segment')
      if (ask.words) form.append('timestamp_granularities[]', 'word')
      if (ask.language) form.append('language', ask.language)
      if (ask.prompt) form.append('prompt', ask.prompt)
      return form
    }
    const response = await this.send(ask.model, '/audio/transcriptions', body, ask.signal, ask.timeoutMs ?? 20_000, true)
    const raw = (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined
    const text = typeof raw?.text === 'string' ? raw.text.trim() : ''
    const seconds = num(raw?.duration, ask.seconds)
    this.o.usage.add(ask.model, { requests: 1, seconds: billedSeconds(seconds) })
    const segments: Segment[] = Array.isArray(raw?.segments)
      ? (raw.segments as Record<string, unknown>[]).map(s => ({
          start: num(s.start),
          end: num(s.end),
          text: typeof s.text === 'string' ? s.text : '',
          avgLogprob: num(s.avg_logprob),
          noSpeech: num(s.no_speech_prob),
          compression: num(s.compression_ratio),
        }))
      : []
    const words: Word[] = Array.isArray(raw?.words)
      ? (raw.words as Record<string, unknown>[]).map(w => ({ word: typeof w.word === 'string' ? w.word : '', start: num(w.start), end: num(w.end) })).filter(w => w.word)
      : []
    return { text, language: languageCode(raw?.language) || ask.language || '', seconds, segments, words }
  }

  /** A language model's answer for `job`, by the first of its models with room. */
  async ask(job: RemoteJob, ask: ChatAsk): Promise<ChatAnswer> {
    const models = CHAT_MODELS[job]
    let last: unknown
    const now = this.now()
    // Those known to be out wait their turn at the end: one may be free again before the others are tried.
    const order = [...models.filter(m => (this.out.get(m) ?? 0) <= now), ...models.filter(m => (this.out.get(m) ?? 0) > now)]
    for (const model of order) {
      if ((this.out.get(model) ?? 0) > this.now() && last) continue
      try {
        return await this.chat(model, ask)
      } catch (error) {
        // A limit on this model: the next one has its own; an answer that broke its JSON may not break there. Anything else would fail there too.
        if (!isRemoteError(error) || (error.fault !== 'limit' && error.fault !== 'format')) throw error
        last = error
      }
    }
    throw last
  }

  /**
   * A screenshot's text read by Groq's vision model, its lines as on the
   * screen. Measured 2026-11-23 on 8 pictures (docs/ocr-quality.md): 1.6 % of
   * words wrong against Windows' 30 %. The free plan's minute takes about three
   * pictures (7,000 tokens in, 1,000 out), so a long answer is `cut` and the
   * caller reads the picture with Windows instead.
   */
  async readImage(ask: { png: Uint8Array; signal?: AbortSignal; timeoutMs?: number }): Promise<{ text: string; cut: boolean }> {
    const model = VISION_MODEL
    const url = `data:image/png;base64,${Buffer.from(ask.png).toString('base64')}`
    const body = () =>
      JSON.stringify({
        model,
        temperature: 0,
        max_completion_tokens: VISION_TOKENS,
        ...reasoning(model),
        messages: [{ role: 'user', content: [{ type: 'text', text: READ_PROMPT }, { type: 'image_url', image_url: { url } }] }],
      })
    const response = await this.send(model, '/chat/completions', body, ask.signal, ask.timeoutMs ?? 20_000, false)
    const data = (await response.json().catch(() => undefined)) as
      | { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { total_tokens?: unknown } }
      | undefined
    this.o.usage.add(model, { requests: 1, tokens: num(data?.usage?.total_tokens) })
    const choice = data?.choices?.[0]
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : ''
    return { text: stripFence(text), cut: choice?.finish_reason === 'length' }
  }

  private async chat(model: string, ask: ChatAsk): Promise<ChatAnswer> {
    const body = () =>
      JSON.stringify({
        model,
        messages: ask.messages,
        temperature: ask.temperature,
        max_completion_tokens: ask.maxTokens + (model.startsWith('openai/gpt-oss') ? REASONING_ROOM : 0),
        ...reasoning(model),
        ...(ask.schema ? { response_format: { type: 'json_schema', json_schema: { name: ask.schema.name, strict: true, schema: ask.schema.schema } } } : {}),
      })
    const response = await this.send(model, '/chat/completions', body, ask.signal, ask.timeoutMs ?? 30_000, false)
    const data = (await response.json().catch(() => undefined)) as
      | { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[]; usage?: { total_tokens?: unknown } }
      | undefined
    this.o.usage.add(model, { requests: 1, tokens: num(data?.usage?.total_tokens) })
    const choice = data?.choices?.[0]
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : ''
    return { content, model, cut: choice?.finish_reason === 'length' }
  }

  /** One request, a short limit waited for once; the faults named. */
  private async send(model: string, route: string, body: () => BodyInit, signal: AbortSignal | undefined, timeoutMs: number, form: boolean, again = true): Promise<Response> {
    const key = this.o.key()
    if (!key) throw new RemoteError('nokey', 'No Groq key is saved.')
    const late = AbortSignal.timeout(timeoutMs)
    let response: Response
    try {
      response = await this.request(`${BASE}${route}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, ...(form ? {} : { 'content-type': 'application/json' }) },
        body: body(),
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, late]) : late,
      })
    } catch (error) {
      // The person's own stop (Esc, a new phrase) is theirs to hear of, as it was thrown.
      if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : error
      if (late.aborted) throw new RemoteError('timeout', 'Groq did not answer in time.')
      throw new RemoteError('offline', 'No connection to Groq.')
    }
    this.o.usage.heard(model, header(response, 'x-ratelimit-remaining-requests'), header(response, 'x-ratelimit-limit-requests'))
    if (response.ok) {
      this.out.delete(model)
      return response
    }
    if (response.status === 401 || response.status === 403) throw new RemoteError('key', 'Groq did not accept the saved key.')
    if (response.status === 429) {
      const wait = header(response, 'retry-after') ?? 60
      if (again && wait <= SHORT_WAIT_S && !signal?.aborted) {
        await this.sleep(Math.ceil(wait * 1000) + 200)
        return this.send(model, route, body, signal, timeoutMs, form, false)
      }
      this.out.set(model, this.now() + wait * 1000)
      this.o.say?.(`groq: ${model} has no room for ${Math.round(wait)} s`)
      throw new RemoteError('limit', 'Groq has no requests left just now.', wait)
    }
    // A request too large for the model's minute is a limit of its own kind: the next model may take it.
    if (response.status === 413) throw new RemoteError('limit', 'The text is too long for one request to Groq.', 0)
    // The model's answer broke the JSON asked of it (qwen, 6 translations of 42 on 2026-11-23): the next model is asked.
    if (response.status === 400 && (await response.text().catch(() => '')).includes('json_validate_failed')) throw new RemoteError('format', 'Groq’s model gave an answer in the wrong form.')
    throw new RemoteError('server', `Groq answered ${response.status}.`)
  }
}
