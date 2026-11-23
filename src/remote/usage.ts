// How much of a service's free allowance the person has used, counted here:
// Groq says how many requests are left in its answers' headers, but nothing of
// the audio seconds, and the pages should say "143 of 2,000 phrases today"
// before a limit is hit, not after. Requests, audio seconds and tokens are
// kept per model in ten-minute buckets over the last day (Groq's day is the
// last 24 hours, its hour the last 60 minutes); remote.json beside the
// settings holds them over a restart. Numbers only, never a word of what was
// sent.

import * as fs from 'node:fs'
import * as path from 'node:path'

export type Spent = { requests: number; seconds: number; tokens: number }

/** What a page draws for one model: the last day and hour, and what the service last said was left. */
export type UsageView = { model: string; day: Spent; hour: Spent; left?: number; limit?: number }

const BUCKET_MS = 10 * 60_000
const DAY_MS = 24 * 60 * 60_000
const HOUR_MS = 60 * 60_000
const SAVE_MS = 2000

type Bucket = Spent & { at: number }
type Said = { left: number; limit: number; at: number }

const none = (): Spent => ({ requests: 0, seconds: 0, tokens: 0 })

/** Groq bills a request of speech as ten seconds at the least. */
export const billedSeconds = (seconds: number) => Math.max(10, Math.ceil(seconds))

export class Usage {
  private readonly models = new Map<string, Bucket[]>()
  private readonly said = new Map<string, Said>()
  private timer: NodeJS.Timeout | undefined

  constructor(
    private readonly file?: string,
    private readonly now: () => number = Date.now,
  ) {
    this.load()
  }

  add(model: string, spent: Partial<Spent>): void {
    const at = Math.floor(this.now() / BUCKET_MS) * BUCKET_MS
    const buckets = this.models.get(model) ?? []
    let bucket = buckets[buckets.length - 1]
    if (!bucket || bucket.at !== at) {
      bucket = { at, ...none() }
      buckets.push(bucket)
    }
    bucket.requests += spent.requests ?? 0
    bucket.seconds += spent.seconds ?? 0
    bucket.tokens += spent.tokens ?? 0
    this.models.set(model, this.pruned(buckets))
    this.saveSoon()
  }

  /** What the service's answer said of the requests left today (its headers). */
  heard(model: string, left: number | undefined, limit: number | undefined): void {
    if (left === undefined || limit === undefined || !Number.isFinite(left) || !Number.isFinite(limit)) return
    this.said.set(model, { left, limit, at: this.now() })
  }

  /** Spent on `model` in the last `ms`. */
  last(model: string, ms: number): Spent {
    const since = this.now() - ms
    const sum = none()
    for (const b of this.models.get(model) ?? []) {
      // A bucket counts while any of it is inside the window: a little early is the safe side.
      if (b.at + BUCKET_MS <= since) continue
      sum.requests += b.requests
      sum.seconds += b.seconds
      sum.tokens += b.tokens
    }
    return sum
  }

  view(models: readonly string[]): UsageView[] {
    return models.map(model => {
      const said = this.said.get(model)
      // What the service said holds for a while; then our own count is the better guess.
      const fresh = said && this.now() - said.at < HOUR_MS ? said : undefined
      return { model, day: this.last(model, DAY_MS), hour: this.last(model, HOUR_MS), ...(fresh ? { left: fresh.left, limit: fresh.limit } : {}) }
    })
  }

  /** Written now (before quitting). */
  flush(): void {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.file) return
    const out: Record<string, Bucket[]> = {}
    for (const [model, buckets] of this.models) {
      const kept = this.pruned(buckets)
      if (kept.length) out[model] = kept
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, `${JSON.stringify({ usage: out })}\n`, 'utf8')
    } catch {
      // A count that cannot be written is no reason to stop.
    }
  }

  private pruned(buckets: Bucket[]): Bucket[] {
    const since = this.now() - DAY_MS
    return buckets.filter(b => b.at + BUCKET_MS > since)
  }

  private saveSoon(): void {
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => this.flush(), SAVE_MS)
    this.timer.unref?.()
  }

  private load(): void {
    if (!this.file) return
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return
    }
    const usage = raw && typeof raw === 'object' ? (raw as { usage?: unknown }).usage : undefined
    if (!usage || typeof usage !== 'object') return
    for (const [model, list] of Object.entries(usage as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue
      const buckets: Bucket[] = []
      for (const b of list as Partial<Bucket>[]) {
        if (!b || typeof b.at !== 'number') continue
        buckets.push({ at: b.at, requests: Number(b.requests) || 0, seconds: Number(b.seconds) || 0, tokens: Number(b.tokens) || 0 })
      }
      const kept = this.pruned(buckets)
      if (kept.length) this.models.set(model, kept)
    }
  }
}
