import { describe, expect, test, vi } from 'vitest'

import { localComplete, remoteComplete } from './complete'
import type { ChatAsk, RemoteChat } from './groq'

const messages = [{ role: 'user' as const, content: 'hi' }]
const schema = { name: 'n', schema: { type: 'object' } }

const okResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('localComplete', () => {
  test('posts to the local server with its key, thinking off, and reads the answer', async () => {
    const post = vi.fn(async () => okResponse({ choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] }))
    const complete = localComplete(post as unknown as typeof fetch, 'http://127.0.0.1:9', 'secret', 'Model', 1000)
    const answer = await complete({ messages, temperature: 0.2, maxTokens: 50 })
    expect(answer).toEqual({ content: 'hello', cut: false })
    const [url, init] = post.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:9/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer secret')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ messages, temperature: 0.2, max_tokens: 50, chat_template_kwargs: { enable_thinking: false } })
    expect(body).not.toHaveProperty('response_format')
  })

  test('a schema becomes response_format json_schema, local fields are added, length means cut', async () => {
    const post = vi.fn(async () => okResponse({ choices: [{ message: { content: '{}' }, finish_reason: 'length' }] }))
    const complete = localComplete(post as unknown as typeof fetch, 'http://x', 'k', 'Model', 1000)
    const answer = await complete({ messages, temperature: 0, maxTokens: 5, schema, local: { cache_prompt: false } })
    expect(answer.cut).toBe(true)
    const body = JSON.parse((post.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'n', schema: { type: 'object' } } })
    expect(body.cache_prompt).toBe(false)
  })

  test('a bad status throws naming the job; a strange body gives empty content', async () => {
    const bad = localComplete((async () => new Response('', { status: 503 })) as unknown as typeof fetch, 'http://x', 'k', 'Checker', 1000)
    await expect(bad({ messages, temperature: 0, maxTokens: 1 })).rejects.toThrow('Checker answered 503')
    const odd = localComplete((async () => okResponse({})) as unknown as typeof fetch, 'http://x', 'k', 'Checker', 1000)
    expect(await odd({ messages, temperature: 0, maxTokens: 1 })).toEqual({ content: '', cut: false })
  })
})

describe('remoteComplete', () => {
  test('passes the ask to Groq as it is (the client adds the reasoning room), the schema and the job', async () => {
    const seen: { job: string; ask: ChatAsk }[] = []
    const chat: RemoteChat = {
      async ask(job, ask) {
        seen.push({ job, ask })
        return { content: 'x', model: 'm', cut: true }
      },
    }
    const controller = new AbortController()
    const answer = await remoteComplete(chat, 'check', 5000)({ messages, temperature: 0.1, maxTokens: 100, schema, signal: controller.signal, local: { cache_prompt: true } })
    expect(answer).toEqual({ content: 'x', cut: true })
    expect(seen[0]!.job).toBe('check')
    expect(seen[0]!.ask).toMatchObject({ messages, temperature: 0.1, maxTokens: 100, schema, timeoutMs: 5000 })
    expect(seen[0]!.ask.signal).toBe(controller.signal)
    expect(JSON.stringify(seen[0]!.ask)).not.toContain('cache_prompt')
  })

  test('without schema or signal neither is sent', async () => {
    let got: ChatAsk | undefined
    const chat: RemoteChat = { ask: async (_job, a) => ((got = a), { content: '', model: 'm', cut: false }) }
    await remoteComplete(chat, 'talk')({ messages, temperature: 0, maxTokens: 1 })
    expect(got).not.toHaveProperty('schema')
    expect(got).not.toHaveProperty('signal')
    expect(got!.timeoutMs).toBe(30_000)
  })
})
