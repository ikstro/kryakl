// The person's own keys for services outside this computer (Groq for speech
// and the language models, Hugging Face for the voices' model), all in one
// place (2026-11-23, the owner: every key entered in one place and kept safe).
// A key is encrypted for the person's Windows account before it touches the
// disk (Electron's safeStorage: DPAPI) and lives in keys.json beside the
// settings; with no encryption to be had it is not saved at all. It is read by
// the main process alone: a page learns whether one is saved and its last four
// characters, never the key; it is in no log, no problem report and no backup.
// Any program run by the same Windows account can ask Windows for it, as for a
// browser's saved passwords: the pages say so, and advise a key of Kryakl's own.

import * as fs from 'node:fs'
import * as path from 'node:path'

export type KeyService = 'groq' | 'huggingface'

export const KEY_SERVICES: readonly KeyService[] = ['groq', 'huggingface']

/** What Windows does for the store; safeStorage in the app, a stand-in in tests. */
export type Protect = {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

/** A key's last check against its service, as the pages draw it. */
export type KeyCheck = 'ok' | 'bad' | 'checking' | 'offline'

/** What a page may know of a key. */
export type KeyView = { set: boolean; tail?: string; check?: KeyCheck }

const SHAPES: Record<KeyService, RegExp> = {
  groq: /^gsk_[A-Za-z0-9]{8,190}$/,
  huggingface: /^hf_[A-Za-z0-9]{8,190}$/,
}

/** Whether `key` looks like a key of `service`; whether the service takes it is asked live. */
export function keyShape(service: KeyService, key: string): boolean {
  return SHAPES[service].test(key.trim())
}

/** The end of a key, shown so the person can tell which one is saved. */
export const tailOf = (key: string) => key.slice(-4)

export class KeyStore {
  private readonly cache = new Map<KeyService, string>()
  private loaded = false

  constructor(
    private readonly file: string,
    private readonly protect: Protect,
  ) {}

  /** Whether a key can be kept at all on this computer. */
  get usable(): boolean {
    return this.protect.available()
  }

  get(service: KeyService): string | undefined {
    this.load()
    return this.cache.get(service)
  }

  has(service: KeyService): boolean {
    return this.get(service) !== undefined
  }

  /** Saves `key`; throws when Windows gives no encryption (the key is never written in the clear). */
  set(service: KeyService, key: string): void {
    const value = key.trim()
    if (!value) return this.remove(service)
    if (!this.protect.available()) throw new Error('Windows offers no encryption for this account, so the key was not saved.')
    this.load()
    this.cache.set(service, value)
    this.write()
  }

  remove(service: KeyService): void {
    this.load()
    if (!this.cache.delete(service)) return
    this.write()
  }

  view(service: KeyService): { set: boolean; tail?: string } {
    const key = this.get(service)
    return key ? { set: true, tail: tailOf(key) } : { set: false }
  }

  private load(): void {
    if (this.loaded) return
    this.loaded = true
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      return
    }
    if (!raw || typeof raw !== 'object' || !this.protect.available()) return
    for (const service of KEY_SERVICES) {
      const stored = (raw as Record<string, unknown>)[service]
      if (typeof stored !== 'string' || !stored) continue
      try {
        const key = this.protect.decrypt(Buffer.from(stored, 'base64')).trim()
        if (key) this.cache.set(service, key)
      } catch {
        // Encrypted for another account or computer (a profile copied over): it is as if none were saved.
      }
    }
  }

  private write(): void {
    const out: Record<string, string> = {}
    for (const [service, key] of this.cache) out[service] = this.protect.encrypt(key).toString('base64')
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
    fs.renameSync(tmp, this.file)
  }
}

/**
 * A key an earlier build kept in the clear (the Groq trial's groq.json, the
 * engine's speech.json `hfToken`): taken into the store once and removed from
 * that file. Returns whether one was taken.
 */
export function adoptPlainKey(store: KeyStore, service: KeyService, file: string, field: string, whole: boolean): boolean {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return false
  }
  if (!raw || typeof raw !== 'object') return false
  const record = raw as Record<string, unknown>
  const key = typeof record[field] === 'string' ? (record[field] as string).trim() : ''
  if (!key) return false
  // Kept where it was when it cannot be encrypted here: better there than lost.
  if (!store.usable) return false
  if (!store.has(service)) store.set(service, key)
  try {
    if (whole) fs.rmSync(file, { force: true })
    else {
      record[field] = ''
      fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    }
  } catch {
    // The copy in the clear stays; the next start tries again.
  }
  return true
}
