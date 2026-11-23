import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CAPTURE_HOURS, CAPTURE_MOST, CaptureStore, wavOf } from './dictcapture'

let dir = ''
let now = 1_800_000_000_000
const clock = () => now
const second = new Uint8Array(32000)
const phrase = (typed: string) => ({ mode: 'type', language: 'ru', sure: 0.9, heard: typed, typed })

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kryakl-captures-'))
  now = 1_800_000_000_000
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('dictation recorded for a report', () => {
  it('keeps nothing until it is turned on', () => {
    const store = new CaptureStore(dir, clock)
    expect(store.on).toBe(false)
    expect(store.add(phrase('привет'), second)).toBeUndefined()
    expect(store.list()).toEqual([])
    expect(fs.existsSync(path.join(dir, 'captures.json'))).toBe(false)
  })

  it('keeps a phrase with its sound, the newest first, and counts down', () => {
    const store = new CaptureStore(dir, clock)
    expect(store.start()).toBe(true)
    const a = store.add(phrase('первая'), second)!
    now += 1000
    const b = store.add({ ...phrase(''), error: 'Nothing was heard' }, new Uint8Array(16000))!
    expect(store.list().map(c => c.id)).toEqual([b.id, a.id])
    expect(a.seconds).toBe(1)
    expect(b.seconds).toBe(0.5)
    expect(store.left).toBe(CAPTURE_MOST - 2)
    const file = store.soundFile(a.id)!
    expect(fs.readFileSync(file).length).toBe(44 + second.length)
    // Read again from the disk, as after a restart.
    expect(new CaptureStore(dir, clock).list().map(c => c.typed)).toEqual(['', 'первая'])
  })

  it('turns itself off after the last phrase, and after a day', () => {
    const store = new CaptureStore(dir, clock)
    store.start()
    for (let i = 0; i < CAPTURE_MOST; i++) store.add(phrase(`фраза ${i}`), second)
    expect(store.on).toBe(false)
    expect(store.add(phrase('лишняя'), second)).toBeUndefined()
    expect(store.list()).toHaveLength(CAPTURE_MOST)
    // Full: it cannot be turned on until some go.
    expect(store.start()).toBe(false)
    store.remove(store.list()[0]!.id)
    expect(store.start()).toBe(true)
    expect(store.left).toBe(1)
    now += CAPTURE_HOURS * 3600_000 + 1
    expect(store.on).toBe(false)
    expect(store.add(phrase('через день'), second)).toBeUndefined()
  })

  it('removes one, and all, with their sounds', () => {
    const store = new CaptureStore(dir, clock)
    store.start()
    const a = store.add(phrase('одна'), second)!
    now += 5
    const b = store.add(phrase('две'), second)!
    store.remove(a.id)
    expect(store.soundFile(a.id)).toBeUndefined()
    expect(fs.existsSync(path.join(dir, `${a.id}.wav`))).toBe(false)
    expect(store.soundFile(b.id)).toBeDefined()
    store.clear()
    expect(store.list()).toEqual([])
    expect(store.on).toBe(false)
    expect(fs.readdirSync(dir).filter(f => f.endsWith('.wav'))).toEqual([])
  })

  it('names no file outside its folder', () => {
    const store = new CaptureStore(dir, clock)
    store.start()
    store.add(phrase('одна'), second)
    expect(store.soundFile('..\\..\\settings')).toBeUndefined()
    expect(store.soundFile('nope-1')).toBeUndefined()
  })

  it('drops phrases older than thirty days and sounds nobody names', () => {
    const store = new CaptureStore(dir, clock)
    store.start()
    const old = store.add(phrase('старая'), second)!
    fs.writeFileSync(path.join(dir, 'stray-9.wav'), 'x')
    now += 31 * 24 * 3600_000
    const again = new CaptureStore(dir, clock)
    expect(again.list()).toEqual([])
    expect(fs.existsSync(path.join(dir, `${old.id}.wav`))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'stray-9.wav'))).toBe(false)
  })

  it('writes a WAV header for 16 kHz mono', () => {
    const wav = wavOf(new Uint8Array([1, 0, 2, 0]))
    expect(wav.toString('latin1', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(16000)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.length).toBe(48)
  })
})
