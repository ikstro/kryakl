import { describe, expect, test } from 'vitest'

import { CHAT_MODELS, clipPrompt, Groq, isRemoteError, languageCode, namesPrompt, REASONING_ROOM, RemoteError, stripFence, VISION_MODEL } from './groq'
import { Usage } from './usage'

const KEY = 'gsk_abcdefgh12345678'
const ask = { messages: [{ role: 'user' as const, content: 'hi' }], temperature: 0, maxTokens: 10 }

const chatBody = (content = 'ok', tokens = 7) => JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { total_tokens: tokens } })

type Impl = (url: string, init: RequestInit) => Promise<Response>

function make(impl: Impl, key: () => string | undefined = () => KEY) {
  let t = 1_000_000
  const usage = new Usage(undefined, () => t)
  const sleeps: number[] = []
  const calls: { url: string; init: RequestInit }[] = []
  const groq = new Groq({
    key,
    usage,
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return impl(url, init)
    }) as unknown as typeof fetch,
    now: () => t,
    sleep: async ms => void sleeps.push(ms),
  })
  return { groq, usage, sleeps, calls, tick: (ms: number) => (t += ms) }
}

const limit = (retry: string) => new Response('', { status: 429, headers: { 'retry-after': retry } })

describe('Groq.ask faults', () => {
  test('a 429 with a long retry-after is a limit fault carrying the wait', async () => {
    const { groq } = make(async () => limit('90'))
    const error = await groq.ask('translate', ask).catch(e => e)
    expect(isRemoteError(error)).toBe(true)
    expect(error).toBeInstanceOf(RemoteError)
    expect(error.fault).toBe('limit')
    expect(error.retryAfter).toBe(90)
  })

  test('a short retry-after is waited for once, then the request is repeated', async () => {
    let n = 0
    const { groq, sleeps, calls } = make(async () => (++n === 1 ? limit('2') : new Response(chatBody('done'), { status: 200 })))
    expect((await groq.ask('translate', ask)).content).toBe('done')
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([2200])
  })

  test('401 and 403 are key faults and are not tried on other models', async () => {
    for (const status of [401, 403]) {
      const { groq, calls } = make(async () => new Response('', { status }))
      const error = await groq.ask('check', ask).catch(e => e)
      expect(error.fault).toBe('key')
      expect(calls).toHaveLength(1)
    }
  })

  test('a network error is offline, a 500 is server, no key is nokey with no request', async () => {
    const off = make(async () => {
      throw new TypeError('fetch failed')
    })
    expect((await off.groq.ask('check', ask).catch(e => e)).fault).toBe('offline')
    const srv = make(async () => new Response('', { status: 500 }))
    expect((await srv.groq.ask('check', ask).catch(e => e)).fault).toBe('server')
    const nokey = make(async () => new Response(chatBody()), () => undefined)
    expect(nokey.groq.ready).toBe(false)
    expect((await nokey.groq.ask('check', ask).catch(e => e)).fault).toBe('nokey')
    expect(nokey.calls).toHaveLength(0)
  })

  test("the person's own abort is thrown as it was, not as a RemoteError", async () => {
    const controller = new AbortController()
    const reason = new Error('stopped by Esc')
    const { groq } = make(async () => {
      controller.abort(reason)
      throw new Error('aborted')
    })
    await expect(groq.ask('check', { ...ask, signal: controller.signal })).rejects.toBe(reason)
  })
})

describe('Groq.ask requests', () => {
  test('goes only to api.groq.com, key in Authorization, redirect error, json body', async () => {
    const { groq, calls, usage } = make(async () => new Response(chatBody('hi', 42), { status: 200 }))
    const answer = await groq.ask('translate', { ...ask, schema: { name: 's', schema: { type: 'object' } } })
    expect(answer).toMatchObject({ content: 'hi', model: CHAT_MODELS.translate[0], cut: false })
    const { url, init } = calls[0]!
    expect(new URL(url).hostname).toBe('api.groq.com')
    expect(url).toMatch(/\/chat\/completions$/)
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(init.redirect).toBe('error')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe(CHAT_MODELS.translate[0])
    expect(body.max_completion_tokens).toBe(10 + REASONING_ROOM)
    expect(body.response_format.json_schema.strict).toBe(true)
    expect(body.reasoning_effort).toBe('low')
    expect(JSON.stringify(body)).not.toContain(KEY)
    expect(usage.last(CHAT_MODELS.translate[0]!, 60_000)).toMatchObject({ requests: 1, tokens: 42 })
  })

  test('check goes to /models with redirect error and says ok, bad or offline', async () => {
    const statuses = [200, 401, 500]
    const { groq, calls } = make(async () => new Response('', { status: statuses.shift()! }))
    const seen = [await groq.check(KEY), await groq.check(KEY), await groq.check(KEY)]
    expect(seen).toEqual(['ok', 'bad', 'offline'])
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/models')
    expect(calls[0]!.init.redirect).toBe('error')
    const down = make(async () => {
      throw new Error('x')
    })
    expect(await down.groq.check(KEY)).toBe('offline')
  })

  test('a model whose limit is out gives way to the next model of the job', async () => {
    const first = CHAT_MODELS.translate[0]!
    const second = CHAT_MODELS.translate[1]!
    const tried: string[] = []
    const { groq } = make(async (_url, init) => {
      const model = JSON.parse(init.body as string).model as string
      tried.push(model)
      return model === first ? limit('60') : new Response(chatBody('from second'), { status: 200 })
    })
    expect((await groq.ask('translate', ask)).model).toBe(second)
    expect(tried).toEqual([first, second])
    tried.length = 0
    await groq.ask('translate', ask)
    expect(tried[0]).toBe(second)
    expect(groq.waitFor([first])).toBe(60_000)
    expect(groq.waitFor([first, second])).toBe(0)
  })

  test('a 413 is a limit too, so the next model may take it', async () => {
    let n = 0
    const { groq } = make(async () => (++n === 1 ? new Response('', { status: 413 }) : new Response(chatBody(), { status: 200 })))
    expect((await groq.ask('talk', ask)).model).toBe(CHAT_MODELS.talk[1])
  })

  test('with every model out, the limit error is thrown', async () => {
    const { groq } = make(async () => limit('30'))
    expect((await groq.ask('edit', ask).catch(e => e)).fault).toBe('limit')
  })
})

describe('Groq.transcribe', () => {
  test('sends a form to the transcription route, counts billed seconds and maps the answer', async () => {
    const raw = { text: ' привет ', language: 'russian', duration: 3, segments: [{ start: 0, end: 1, text: 'привет', avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.1 }], words: [{ word: 'привет', start: 0, end: 1 }, { word: '' }] }
    const { groq, calls, usage } = make(async () => new Response(JSON.stringify(raw), { status: 200 }))
    const heard = await groq.transcribe({ model: 'whisper-large-v3', audio: new Uint8Array([1, 2, 3]), mime: 'audio/webm', name: 'a.webm', seconds: 3, words: true, prompt: 'Kryakl.' })
    expect(heard.text).toBe('привет')
    expect(heard.language).toBe('ru')
    expect(heard.segments[0]).toMatchObject({ avgLogprob: -0.2, noSpeech: 0.01 })
    expect(heard.words).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(calls[0]!.init.body).toBeInstanceOf(FormData)
    expect(usage.last('whisper-large-v3', 60_000)).toMatchObject({ requests: 1, seconds: 10 })
  })

  test('empty or oversized audio is refused before any request', async () => {
    const { groq, calls } = make(async () => new Response('{}'))
    await expect(groq.transcribe({ model: 'm', audio: new Uint8Array(), mime: 'a', name: 'a', seconds: 1 })).rejects.toThrow()
    await expect(groq.transcribe({ model: 'm', audio: new Uint8Array(26 * 1024 * 1024), mime: 'a', name: 'a', seconds: 1 })).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
})

describe('prompt helpers', () => {
  test('clipPrompt stops on a word boundary within the token budget', () => {
    expect(clipPrompt('aaa bbb ccc ddd', 2)).toBe('aaa bbb')
    expect(clipPrompt('  ')).toBe('')
  })

  test('namesPrompt joins with commas and closes with a full stop once', () => {
    expect(namesPrompt(['Kryakl', ' Groq ', ''])).toBe('Kryakl, Groq.')
    expect(namesPrompt([])).toBe('')
    expect(namesPrompt(['Really?'])).toBe('Really?')
  })

  test('languageCode takes English names and two-letter codes, else empty', () => {
    expect(languageCode('Russian')).toBe('ru')
    expect(languageCode('uk')).toBe('uk')
    expect(languageCode('Klingon')).toBe('')
    expect(languageCode(undefined)).toBe('')
  })
})

describe('Groq.readImage', () => {
  test('sends the picture to the vision model and gives back its text, a fence taken off', async () => {
    const { groq, calls, usage } = make(async () => new Response(chatBody('```\nline one\n  line two\n```', 1800), { status: 200 }))
    const read = await groq.readImage({ png: new Uint8Array([1, 2, 3]) })
    expect(read).toEqual({ text: 'line one\n  line two', cut: false })
    const body = JSON.parse(String(calls[0]!.init.body))
    expect(body.model).toBe(VISION_MODEL)
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,AQID')
    expect(usage.view([VISION_MODEL])[0]).toBeDefined()
  })

  test('an answer cut by its length says so', async () => {
    const { groq } = make(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'a' }, finish_reason: 'length' }] }), { status: 200 }))
    expect((await groq.readImage({ png: new Uint8Array([1]) })).cut).toBe(true)
  })

  test('stripFence leaves a plain text as it is, but its trailing space', () => {
    expect(stripFence('  indented\nnext  \n')).toBe('  indented\nnext')
    expect(stripFence('```text\nx\n```')).toBe('x')
  })
})


describe('Groq.ask by the bench of 2026-11-23', () => {
  test('qwen is asked for no reasoning room, so its minute holds more answers', async () => {
    const { groq, calls } = make(async () => new Response(chatBody('hi'), { status: 200 }))
    await groq.ask('talk', ask)
    const body = JSON.parse(calls[0]!.init.body as string)
    expect(body.model).toBe('qwen/qwen3.8-27b')
    expect(body.max_completion_tokens).toBe(10)
  })

  test('an answer that broke its JSON goes to the next model', async () => {
    let n = 0
    const { groq, calls } = make(async () => (++n === 1 ? new Response(JSON.stringify({ error: { code: 'json_validate_failed' } }), { status: 400 }) : new Response(chatBody('done'), { status: 200 })))
    const answer = await groq.ask('translate', ask)
    expect(answer.content).toBe('done')
    expect(calls.map(c => JSON.parse(c.init.body as string).model)).toEqual([CHAT_MODELS.translate[0], CHAT_MODELS.translate[1]])
  })

  test('gpt-oss-20b neither checks nor translates', () => {
    expect(CHAT_MODELS.check).not.toContain('openai/gpt-oss-20b')
    expect(CHAT_MODELS.translate).not.toContain('openai/gpt-oss-20b')
  })
})

describe('a speech model named for a person', () => {
  test('Whisper and its turbo', async () => {
    const { GROQ_SPEECH, speechModelName } = await import('./plan')
    expect(speechModelName(GROQ_SPEECH.dictation)).toBe('Whisper large-v3')
    expect(speechModelName(GROQ_SPEECH.recordings)).toBe('Whisper large-v3 turbo')
    expect(speechModelName('other')).toBe('other')
  })
})
