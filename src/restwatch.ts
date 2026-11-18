// Kryakl watches its own rest. With nothing to do (no window shown, nothing recording, no phrase) its own
// processes take about nothing; on 2026-11-18 a hidden dictation badge that went on drawing took 10–19 % of a
// core for hours and nobody knew until a reviewer read the processor time. So once a minute main hands over
// what each of its processes has used so far, and after three minutes at rest above the limit one line goes
// into kryakl.log, naming the parts that took it: seen in the next problem report, whatever the cause.
// It only says; it stops nothing. Pure, so it is tested without Electron.

/** Of one core, in percent, that Kryakl's own processes may take together at rest. */
export const REST_MOST = 5
/** Minutes in a row above it before it is said. */
export const REST_RUN = 3
/** A part is named from this share on. */
const NAMED_FROM = 1
/** A sample that came this much later than a minute (the computer slept) starts the count again. */
const LATE_MS = 150_000

/** One of Kryakl's processes: what it is ("GPU", "dictation.html") and the processor seconds it has used since it started. */
export interface RestPart {
  name: string
  seconds: number
}

export class RestWatch {
  private last: { at: number; used: Map<string, number> } | undefined
  /** Each minute of the run above the limit: every part's share of a core. */
  private run: Map<string, number>[] = []
  /** What was said already, by the parts named: once a start for each. */
  private readonly said = new Set<string>()

  /**
   * A look a minute after the last. `atRest`: nothing of Kryakl's was shown, recorded or dictated since the last
   * look. Returns the line for the log when the rest has been broken long enough, once for the same parts.
   */
  sample(at: number, atRest: boolean, parts: RestPart[]): string | undefined {
    const used = new Map<string, number>()
    for (const p of parts) used.set(p.name, (used.get(p.name) ?? 0) + p.seconds)
    const last = this.last
    this.last = { at, used }
    if (!last || !atRest || at - last.at > LATE_MS || at <= last.at) {
      this.run = []
      return undefined
    }
    const seconds = (at - last.at) / 1000
    const shares = new Map<string, number>()
    let together = 0
    for (const [name, now] of used) {
      // A process made since the last look counts from nothing; one made again under the same name never below it.
      const share = Math.max(0, (100 * (now - (last.used.get(name) ?? 0))) / seconds)
      shares.set(name, share)
      together += share
    }
    if (together <= REST_MOST) {
      this.run = []
      return undefined
    }
    this.run.push(shares)
    if (this.run.length < REST_RUN) return undefined
    const minutes = this.run.slice(-REST_RUN)
    const mean = new Map<string, number>()
    for (const minute of minutes) for (const [name, share] of minute) mean.set(name, (mean.get(name) ?? 0) + share / REST_RUN)
    const named = [...mean].filter(([, share]) => share >= NAMED_FROM).sort((a, b) => b[1] - a[1])
    const key = named.map(([name]) => name).join('+')
    if (this.said.has(key)) return undefined
    this.said.add(key)
    const all = [...mean.values()].reduce((sum, share) => sum + share, 0)
    return `rest: Kryakl took ${Math.round(all)} % of a core for ${REST_RUN} min with nothing to do (${named.map(([name, share]) => `${name} ${Math.round(share)} %`).join(', ') || 'no part alone'})`
  }
}
