// Groq's use of the day in words, for Models › Groq and the tray's menu alike:
// what each model does in Kryakl, its requests and its sound or words against
// the free plan, and how much of the free day the busiest model has spent.

import { numberText, t } from '../i18n'
import { GROQ_FREE, isSpeechModel } from './plan'
import type { UsageView } from './usage'

/** What each model of Groq's does in Kryakl, as the usage lines name it. */
const MODEL_JOB: Record<string, () => string> = {
  'whisper-large-v3': () => t('apikeys.useDictation'),
  'whisper-large-v3-turbo': () => t('apikeys.useRecordings'),
  'openai/gpt-oss-120b': () => t('apikeys.useTexts'),
  'qwen/qwen3.8-27b': () => t('apikeys.useTalk'),
  'openai/gpt-oss-20b': () => t('apikeys.useEdit'),
}

/** 2 h 5 min, 12 min. */
function duration(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m >= 60 ? t('apikeys.hours', { h: Math.floor(m / 60), m: m % 60 }) : t('apikeys.minutes', { m })
}

/** The models used today, each named by what it does, with "requests: 120 of 2,000 · sound: 14 min of 8 h 0 min" and what Groq said was left. */
export function usageLines(usage: readonly UsageView[]): { model: string; job: string; line: string; left?: string }[] {
  return usage
    .filter(u => u.day.requests > 0)
    .map(u => {
      const speech = isSpeechModel(u.model)
      const plan = speech ? GROQ_FREE.speech : GROQ_FREE.chat
      const requests = t('apikeys.requests', { n: numberText(u.day.requests), of: numberText(u.limit ?? plan.perDay) })
      const amount = speech
        ? t('apikeys.sound', { used: duration(u.day.seconds), of: duration(GROQ_FREE.speech.secondsPerDay) })
        : t('apikeys.tokens', { used: numberText(Math.round(u.day.tokens / 1000)), of: numberText(GROQ_FREE.chat.tokensPerDay / 1000) })
      const left = u.left !== undefined ? t('apikeys.groqLeft', { n: numberText(u.left) }) : undefined
      return { model: u.model, job: MODEL_JOB[u.model]?.() ?? u.model, line: `${requests} · ${amount}`, left }
    })
}

/**
 * How much of its free day one model has spent, 0 to 1: the most of its requests (counted here, or by
 * Groq's own word, use outside Kryakl included), its sound and its words.
 */
export function dayShare(u: UsageView): number {
  const speech = isSpeechModel(u.model)
  const perDay = u.limit ?? (speech ? GROQ_FREE.speech.perDay : GROQ_FREE.chat.perDay)
  const said = u.left !== undefined && u.limit ? (u.limit - u.left) / u.limit : 0
  const amount = speech ? u.day.seconds / GROQ_FREE.speech.secondsPerDay : u.day.tokens / GROQ_FREE.chat.tokensPerDay
  return Math.min(1, Math.max(u.day.requests / perDay, said, amount))
}

/** The busiest model's share of its free day, in whole percent (0 when nothing was used). */
export function dayPercent(usage: readonly UsageView[]): number {
  const share = Math.max(0, ...usage.map(dayShare))
  // A little use reads as 1 %, never as nothing.
  return share > 0 ? Math.max(1, Math.round(share * 100)) : 0
}
