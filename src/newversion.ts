// A new version is said, never installed (the owner, 2026-11-19: Kryakl 0.17.4 ran a
// day after 0.18.0 was out and nothing said so). Once a day main asks GitHub for the
// newest release's number, and a newer one shows in the tray, on Home and in Settings
// with a link to its page; the person downloads and installs it by hand, as since
// 2026-10-30. Nothing about the person or this computer is sent: one GET with a plain
// client name. A switch in Settings turns it off; a run from source and a test run
// never ask.

/** GitHub's newest release that is neither a draft nor a prerelease. */
export const LATEST_URL = 'https://api.github.com/repos/ikstro/kryakl/releases/latest'
/** The page the notice opens: the newest release with its installer. */
export const DOWNLOAD_PAGE = 'https://github.com/ikstro/kryakl/releases/latest'

export const LOOK_EVERY_MS = 24 * 60 * 60_000
/** GitHub did not answer: asked again this much later. */
export const RETRY_MS = 60 * 60_000

/** What is kept between starts (version.json): the newest release seen and when GitHub was asked. */
export type VersionState = { latest: string; lookedAt: number }

/** "v0.18.0" → [0, 18, 0]; a test build's "0.17.4-dictation.2" → [0, 17, 4]; anything else, nothing. */
export function numbersOf(version: string): number[] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/** A test build: its version has a dash ("0.17.4-dictation.2"). */
export const isTestVersion = (version: string): boolean => version.includes('-')

/** Whether `latest` is a release to offer over `mine`: a higher number, or the same number while mine is a test build of it. */
export function newer(latest: string, mine: string): boolean {
  const a = numbersOf(latest)
  const b = numbersOf(mine)
  if (!a || !b || isTestVersion(latest)) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i]! > b[i]!
  }
  return isTestVersion(mine)
}

/** The version in GitHub's answer ("0.18.0"), or '' when it is not a release to offer (a draft, a prerelease, no number). */
export function latestFrom(answer: unknown): string {
  if (!answer || typeof answer !== 'object') return ''
  const r = answer as Record<string, unknown>
  if (r.draft === true || r.prerelease === true || typeof r.tag_name !== 'string') return ''
  const tag = r.tag_name.trim()
  if (isTestVersion(tag) || !numbersOf(tag)) return ''
  return tag.replace(/^v/, '')
}

/** version.json as read from the disk; anything odd is nothing seen yet. */
export function readState(raw: unknown): VersionState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const latest = typeof r.latest === 'string' && numbersOf(r.latest) && !isTestVersion(r.latest) ? r.latest : ''
  const lookedAt = typeof r.lookedAt === 'number' && Number.isFinite(r.lookedAt) && r.lookedAt > 0 ? r.lookedAt : 0
  return { latest, lookedAt }
}

/** Whether to ask GitHub now: a day after the last answer (a clock set back asks again), an hour after a failure. */
export function dueToLook(state: VersionState, failedAt: number, now: number): boolean {
  if (failedAt && now >= failedAt && now - failedAt < RETRY_MS) return false
  return !state.lookedAt || state.lookedAt > now || now - state.lookedAt >= LOOK_EVERY_MS
}

/** The version to tell the person of, '' when theirs is the newest seen. */
export function offered(state: VersionState, mine: string): string {
  return state.latest && newer(state.latest, mine) ? state.latest : ''
}
