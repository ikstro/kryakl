import { describe, expect, it } from 'vitest'
import { RestWatch, type RestPart } from './restwatch'

const MINUTE = 60_000

/** Looks a minute apart: each part's share of a core over that minute, turned into the seconds it has used so far. */
function feed(watch: RestWatch, minutes: { rest?: boolean; shares: Record<string, number> }[], from = 0): (string | undefined)[] {
  const used: Record<string, number> = {}
  const parts = (): RestPart[] => Object.entries(used).map(([name, seconds]) => ({ name, seconds }))
  const out: (string | undefined)[] = []
  let at = from
  for (const name of Object.keys(minutes[0]?.shares ?? {})) used[name] = 0
  watch.sample(at, true, parts())
  for (const minute of minutes) {
    at += MINUTE
    for (const [name, share] of Object.entries(minute.shares)) used[name] = (used[name] ?? 0) + (share / 100) * 60
    out.push(watch.sample(at, minute.rest ?? true, parts()))
  }
  return out
}

describe('Kryakl watches its own rest', () => {
  it('says nothing while its processes take little', () => {
    const calm = { shares: { Browser: 1, GPU: 0.2, 'dictation.html': 0 } }
    expect(feed(new RestWatch(), [calm, calm, calm, calm, calm])).toEqual([undefined, undefined, undefined, undefined, undefined])
  })

  it('names the parts after three minutes above the limit, once', () => {
    const busy = { shares: { Browser: 2, GPU: 13, 'dictation.html': 3, 'card.html': 0.2 } }
    const said = feed(new RestWatch(), [busy, busy, busy, busy, busy])
    expect(said.slice(0, 2)).toEqual([undefined, undefined])
    expect(said[2]).toBe('rest: Kryakl took 18 % of a core for 3 min with nothing to do (GPU 13 %, dictation.html 3 %, Browser 2 %)')
    expect(said.slice(3)).toEqual([undefined, undefined])
  })

  it('starts again after a minute that was not rest', () => {
    const busy = { shares: { GPU: 13 } }
    const said = feed(new RestWatch(), [busy, busy, { rest: false, shares: { GPU: 13 } }, busy, busy, busy])
    expect(said.slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, undefined])
    expect(said[5]).toContain('GPU 13 %')
  })

  it('starts again after a calm minute', () => {
    const busy = { shares: { GPU: 13 } }
    const said = feed(new RestWatch(), [busy, busy, { shares: { GPU: 0.1 } }, busy, busy])
    expect(said).toEqual([undefined, undefined, undefined, undefined, undefined])
  })

  it('says another cause too', () => {
    const watch = new RestWatch()
    const badge = { shares: { GPU: 13, 'card.html': 0 } }
    const card = { shares: { GPU: 0, 'card.html': 9 } }
    const said = feed(watch, [badge, badge, badge, card, card, card])
    expect(said[2]).toContain('GPU 13 %')
    expect(said[5]).toContain('card.html 9 %')
  })

  it('does not count a look that came late, as after sleep', () => {
    const watch = new RestWatch()
    watch.sample(0, true, [{ name: 'GPU', seconds: 0 }])
    expect(watch.sample(MINUTE, true, [{ name: 'GPU', seconds: 10 }])).toBeUndefined()
    expect(watch.sample(2 * MINUTE, true, [{ name: 'GPU', seconds: 20 }])).toBeUndefined()
    // Eight hours asleep, then the third busy minute would be the one that speaks.
    expect(watch.sample(2 * MINUTE + 8 * 3_600_000, true, [{ name: 'GPU', seconds: 30 }])).toBeUndefined()
    expect(watch.sample(3 * MINUTE + 8 * 3_600_000, true, [{ name: 'GPU', seconds: 40 }])).toBeUndefined()
  })

  it('adds up processes of one name, and takes one made anew as it is', () => {
    const watch = new RestWatch()
    watch.sample(0, true, [{ name: 'page', seconds: 100 }, { name: 'page', seconds: 50 }])
    const parts = (n: number): RestPart[] => [{ name: 'page', seconds: 100 + 6 * n }, { name: 'page', seconds: 50 }]
    expect(watch.sample(MINUTE, true, parts(1))).toBeUndefined()
    expect(watch.sample(2 * MINUTE, true, parts(2))).toBeUndefined()
    expect(watch.sample(3 * MINUTE, true, parts(3))).toBe('rest: Kryakl took 10 % of a core for 3 min with nothing to do (page 10 %)')
    // Its process made again: fewer seconds than before is no negative share.
    expect(new RestWatch().sample(0, true, [{ name: 'page', seconds: 5 }])).toBeUndefined()
  })
})
