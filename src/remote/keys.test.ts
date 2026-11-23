import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { adoptPlainKey, KeyStore, keyShape, tailOf, type Protect } from './keys'

const made: string[] = []
afterEach(() => made.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kryakl-keys-'))
  made.push(dir)
  return dir
}

const fake = (available = true): Protect => ({
  available: () => available,
  encrypt: text => Buffer.from(Buffer.from(text, 'utf8').reverse()),
  decrypt: data => Buffer.from(data).reverse().toString('utf8'),
})

const GROQ = 'gsk_abcdefgh1234WXYZ'
const HF = 'hf_abcdefgh1234QRST'

describe('KeyStore', () => {
  test('a key set comes back by get and has, and survives a new store on the same file', () => {
    const file = path.join(tempDir(), 'keys.json')
    const store = new KeyStore(file, fake())
    expect(store.has('groq')).toBe(false)
    store.set('groq', GROQ)
    store.set('huggingface', HF)
    expect(store.get('groq')).toBe(GROQ)
    expect(store.has('groq')).toBe(true)
    const again = new KeyStore(file, fake())
    expect(again.get('groq')).toBe(GROQ)
    expect(again.get('huggingface')).toBe(HF)
  })

  test('the file on disk never holds the key in the clear', () => {
    const file = path.join(tempDir(), 'keys.json')
    new KeyStore(file, fake()).set('groq', GROQ)
    const text = fs.readFileSync(file, 'utf8')
    expect(text).not.toContain(GROQ)
    expect(text).not.toContain(GROQ.slice(-8))
    expect(text).not.toContain('gsk_')
  })

  test('a key is trimmed, and an empty one removes the saved key', () => {
    const store = new KeyStore(path.join(tempDir(), 'keys.json'), fake())
    store.set('groq', `  ${GROQ}\n`)
    expect(store.get('groq')).toBe(GROQ)
    store.set('groq', '   ')
    expect(store.has('groq')).toBe(false)
  })

  test('remove forgets the key on disk too and leaves the other service alone', () => {
    const file = path.join(tempDir(), 'keys.json')
    const store = new KeyStore(file, fake())
    store.set('groq', GROQ)
    store.set('huggingface', HF)
    store.remove('groq')
    const again = new KeyStore(file, fake())
    expect(again.has('groq')).toBe(false)
    expect(again.get('huggingface')).toBe(HF)
  })

  test('view says set and the last four characters, never the key', () => {
    const store = new KeyStore(path.join(tempDir(), 'keys.json'), fake())
    expect(store.view('groq')).toEqual({ set: false })
    store.set('groq', GROQ)
    const view = store.view('groq')
    expect(view).toEqual({ set: true, tail: 'WXYZ' })
    expect(JSON.stringify(view)).not.toContain(GROQ)
    expect(tailOf(GROQ)).toBe('WXYZ')
  })

  test('without encryption it is not usable, set throws and nothing is written', () => {
    const file = path.join(tempDir(), 'keys.json')
    const store = new KeyStore(file, fake(false))
    expect(store.usable).toBe(false)
    expect(() => store.set('groq', GROQ)).toThrow()
    expect(fs.existsSync(file)).toBe(false)
    expect(store.has('groq')).toBe(false)
  })

  test('a key encrypted for another account reads as not saved', () => {
    const file = path.join(tempDir(), 'keys.json')
    new KeyStore(file, fake()).set('groq', GROQ)
    const strange: Protect = {
      available: () => true,
      encrypt: t => Buffer.from(t),
      decrypt: () => {
        throw new Error('not yours')
      },
    }
    expect(new KeyStore(file, strange).has('groq')).toBe(false)
  })

  test('a broken keys file reads as empty and is replaced on the next set', () => {
    const file = path.join(tempDir(), 'keys.json')
    fs.writeFileSync(file, '{not json')
    const store = new KeyStore(file, fake())
    expect(store.has('groq')).toBe(false)
    store.set('groq', GROQ)
    expect(new KeyStore(file, fake()).get('groq')).toBe(GROQ)
  })
})

describe('keyShape', () => {
  test('accepts a key of the service and rejects junk', () => {
    expect(keyShape('groq', GROQ)).toBe(true)
    expect(keyShape('groq', `  ${GROQ}  `)).toBe(true)
    expect(keyShape('huggingface', HF)).toBe(true)
    expect(keyShape('groq', HF)).toBe(false)
    expect(keyShape('huggingface', GROQ)).toBe(false)
    expect(keyShape('groq', '')).toBe(false)
    expect(keyShape('groq', 'gsk_short')).toBe(false)
    expect(keyShape('groq', 'gsk_abcdefgh 1234')).toBe(false)
    expect(keyShape('groq', 'hello world')).toBe(false)
  })
})

describe('adoptPlainKey', () => {
  test('takes the key into the store and removes the file when whole', () => {
    const dir = tempDir()
    const file = path.join(dir, 'groq.json')
    fs.writeFileSync(file, JSON.stringify({ apiKey: GROQ, prompt: 'x' }))
    const store = new KeyStore(path.join(dir, 'keys.json'), fake())
    expect(adoptPlainKey(store, 'groq', file, 'apiKey', true)).toBe(true)
    expect(store.get('groq')).toBe(GROQ)
    expect(fs.existsSync(file)).toBe(false)
  })

  test('not whole: the field is blanked and the rest of the file stays', () => {
    const dir = tempDir()
    const file = path.join(dir, 'groq.json')
    fs.writeFileSync(file, JSON.stringify({ apiKey: GROQ, prompt: 'keep me' }))
    const store = new KeyStore(path.join(dir, 'keys.json'), fake())
    expect(adoptPlainKey(store, 'groq', file, 'apiKey', false)).toBe(true)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ apiKey: '', prompt: 'keep me' })
    expect(fs.readFileSync(file, 'utf8')).not.toContain(GROQ)
  })

  test('a key already in the store is not replaced, yet the plain copy goes', () => {
    const dir = tempDir()
    const file = path.join(dir, 'groq.json')
    fs.writeFileSync(file, JSON.stringify({ apiKey: 'gsk_oldoldold0000' }))
    const store = new KeyStore(path.join(dir, 'keys.json'), fake())
    store.set('groq', GROQ)
    expect(adoptPlainKey(store, 'groq', file, 'apiKey', true)).toBe(true)
    expect(store.get('groq')).toBe(GROQ)
    expect(fs.existsSync(file)).toBe(false)
  })

  test('without encryption the plain key stays where it is', () => {
    const dir = tempDir()
    const file = path.join(dir, 'groq.json')
    fs.writeFileSync(file, JSON.stringify({ apiKey: GROQ }))
    const store = new KeyStore(path.join(dir, 'keys.json'), fake(false))
    expect(adoptPlainKey(store, 'groq', file, 'apiKey', true)).toBe(false)
    expect(fs.existsSync(file)).toBe(true)
  })

  test('a missing file, a broken file or an empty field gives false', () => {
    const dir = tempDir()
    const store = new KeyStore(path.join(dir, 'keys.json'), fake())
    expect(adoptPlainKey(store, 'groq', path.join(dir, 'none.json'), 'apiKey', true)).toBe(false)
    const broken = path.join(dir, 'broken.json')
    fs.writeFileSync(broken, '{oops')
    expect(adoptPlainKey(store, 'groq', broken, 'apiKey', true)).toBe(false)
    const empty = path.join(dir, 'empty.json')
    fs.writeFileSync(empty, JSON.stringify({ apiKey: '  ' }))
    expect(adoptPlainKey(store, 'groq', empty, 'apiKey', true)).toBe(false)
    expect(fs.existsSync(empty)).toBe(true)
  })
})
