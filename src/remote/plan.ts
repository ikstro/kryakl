// Groq's free plan as Kryakl uses it (read from console.groq.com/docs/rate-limits
// on 2026-11-23): which model does what, and the plan's numbers. Pure, so the
// pages can name them too.

/** Dictation and recordings each on a model of their own, so they do not share a day's sound. */
export const GROQ_SPEECH = { dictation: 'whisper-large-v3', recordings: 'whisper-large-v3-turbo' } as const

/** A speech model's name as a person reads it: "whisper-large-v3" → "Whisper large-v3", its turbo "Whisper large-v3 turbo". */
export function speechModelName(id: string): string {
  const m = /^whisper-(.+?)(-turbo)?$/.exec(id)
  return m ? `Whisper ${m[1]}${m[2] ? ' turbo' : ''}` : id
}

export const GROQ_MODELS: readonly string[] = [GROQ_SPEECH.dictation, GROQ_SPEECH.recordings, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b']

/** The free plan's numbers, each model on its own. */
export const GROQ_FREE = {
  speech: { perMinute: 20, perDay: 2000, secondsPerHour: 7200, secondsPerDay: 28_800 },
  chat: { perMinute: 30, perDay: 1000, tokensPerMinute: 8000, tokensPerDay: 200_000 },
} as const

export const isSpeechModel = (model: string) => model.startsWith('whisper-')
