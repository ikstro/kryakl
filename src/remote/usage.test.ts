import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { billedSeconds, Usage } from './usage'

const made: string[] = []
afterEach(() => made.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

const MIN = 60_000
const HOUR = 60 * MIN
const T0 = Date.UTC(2026, 10, 23, 12, 0, 0)

function clock(start = T0) {
  let now = start
  return { now: () => now, advance: (ms: number) => (now += ms) }
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kryakl-usage-'))
  made.push(dir)
  return dir
}

describe('billedSeconds', () => {
  test('a request of speech is ten seconds at the least, rounded up above', () => {
    expect(billedSeconds(0.5)).toBe(10)
    expect(billedSeconds(9.9)).toBe(10)
    expect(billedSeconds(10.2)).toBe(11)
    expect(billedSeconds(61)).toBe(61)
  })
})

describe('Usage', () => {
  test('counts requests, seconds and tokens per model', () => {
    const usage = new Usage(undefined, clock().now)
    usage.add('m', { requests: 1, tokens: 100 })
    usage.add('m', { requests: 1, seconds: 12 })
    usage.add('other', { requests: 5 })
    expect(usage.last('m', HOUR)).toEqual({ requests: 2, seconds: 12, tokens: 100 })
    expect(usage.last('other', HOUR).requests).toBe(5)
    expect(usage.last('none', HOUR)).toEqual({ requests: 0, seconds: 0, tokens: 0 })
  })

  test('the hour holds less than the day as time passes', () => {
    const c = clock()
    const usage = new Usage(undefined, c.now)
    usage.add('m', { requests: 1 })
    c.advance(2 * HOUR)
    usage.add('m', { requests: 1 })
    const [view] = usage.view(['m'])
    expect(view!.hour.requests).toBe(1)
    expect(view!.day.requests).toBe(2)
  })

  test('what is older than a day is dropped', () => {
    const c = clock()
    const usage = new Usage(undefined, c.now)
    usage.add('m', { requests: 3 })
    c.advance(25 * HOUR)
    expect(usage.last('m', 48 * HOUR).requests).toBe(3)
    usage.add('m', { requests: 1 })
    expect(usage.last('m', 48 * HOUR).requests).toBe(1)
    expect(usage.view(['m'])[0]!.day.requests).toBe(1)
  })

  test('view reports the models asked, with what the service said while it is fresh', () => {
    const c = clock()
    const usage = new Usage(undefined, c.now)
    usage.heard('m', 900, 1000)
    let view = usage.view(['m', 'x'])
    expect(view.map(v => v.model)).toEqual(['m', 'x'])
    expect(view[0]).toMatchObject({ left: 900, limit: 1000 })
    expect(view[1]).not.toHaveProperty('left')
    c.advance(HOUR + 1)
    view = usage.view(['m'])
    expect(view[0]).not.toHaveProperty('left')
  })

  test('heard ignores missing or non-finite numbers', () => {
    const usage = new Usage()
    usage.heard('m', undefined, 10)
    usage.heard('m', 5, NaN)
    expect(usage.view(['m'])[0]).not.toHaveProperty('left')
  })

  test('flush and a new Usage on the same file bring the counts back', () => {
    const file = path.join(tempDir(), 'remote.json')
    const c = clock()
    const usage = new Usage(file, c.now)
    usage.add('m', { requests: 2, seconds: 30, tokens: 7 })
    usage.flush()
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).usage.m).toHaveLength(1)
    const again = new Usage(file, c.now)
    expect(again.last('m', HOUR)).toEqual({ requests: 2, seconds: 30, tokens: 7 })
  })

  test('a file with old buckets or junk loads only what is within the day', () => {
    const file = path.join(tempDir(), 'remote.json')
    const c = clock()
    fs.writeFileSync(file, JSON.stringify({ usage: { m: [{ at: T0 - 30 * HOUR, requests: 9 }, { at: T0 - MIN, requests: 1 }, null, { requests: 4 }], bad: 5 } }))
    expect(new Usage(file, c.now).last('m', 48 * HOUR).requests).toBe(1)
    fs.writeFileSync(file, '{broken')
    expect(() => new Usage(file, c.now)).not.toThrow()
  })

  test('no file: flush writes nothing and does not throw', () => {
    const usage = new Usage()
    usage.add('m', { requests: 1 })
    expect(() => usage.flush()).not.toThrow()
  })
})
