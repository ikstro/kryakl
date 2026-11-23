// One request to a language model, whichever runs it: llama.cpp's server here
// (the local model, llama.ts) or Groq by the person's own key (groq.ts). The
// four jobs (translate, check, talk, edit) write their instructions and read
// the answer once; only how it is sent differs.

import type { ChatMessage, RemoteChat, RemoteJob } from './groq'

export type Ask = {
  messages: ChatMessage[]
  temperature: number
  maxTokens: number
  /** The answer forced into this JSON (every property required, no others). */
  schema?: { name: string; schema: Record<string, unknown> }
  signal?: AbortSignal
  /** Fields only llama.cpp knows (cache_prompt). */
  local?: Record<string, unknown>
}

export type Answer = { content: string; cut: boolean }
export type Complete = (ask: Ask) => Promise<Answer>

/** The local model, through the server running at `base` (its key `apiKey`); `what` names the job in an error. */
export function localComplete(post: typeof fetch, base: string, apiKey: string, what: string, timeoutMs: number): Complete {
  return async ask => {
    const late = AbortSignal.timeout(timeoutMs)
    const response = await post(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        messages: ask.messages,
        temperature: ask.temperature,
        max_tokens: ask.maxTokens,
        chat_template_kwargs: { enable_thinking: false },
        ...(ask.schema ? { response_format: { type: 'json_schema', json_schema: { name: ask.schema.name, schema: ask.schema.schema } } } : {}),
        ...ask.local,
      }),
      signal: ask.signal ? AbortSignal.any([ask.signal, late]) : late,
    })
    if (!response.ok) throw new Error(`${what} answered ${response.status}`)
    const data = (await response.json()) as { choices?: { message?: { content?: unknown }; finish_reason?: unknown }[] }
    const choice = data.choices?.[0]
    return { content: typeof choice?.message?.content === 'string' ? choice.message.content : '', cut: choice?.finish_reason === 'length' }
  }
}

/** Groq, by the person's own key, for `job` (its models, groq.ts CHAT_MODELS). */
export function remoteComplete(chat: RemoteChat, job: RemoteJob, timeoutMs = 30_000): Complete {
  return async ask => {
    const answer = await chat.ask(job, {
      messages: ask.messages,
      temperature: ask.temperature,
      // The client adds room for a model that reasons first (groq.ts REASONING_ROOM).
      maxTokens: ask.maxTokens,
      ...(ask.schema ? { schema: ask.schema } : {}),
      ...(ask.signal ? { signal: ask.signal } : {}),
      timeoutMs,
    })
    return { content: answer.content, cut: answer.cut }
  }
}

/** Whether a job goes to Groq now, and the client it goes through. */
export type RemoteChoice = { on: () => boolean; chat: RemoteChat }
