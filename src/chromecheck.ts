// What stands between Chrome and Kryakl's extension, read from Chrome's own files of each
// profile (nothing written, nothing sent). The engine hears only the copy that runs; this
// says why a copy does not (2026-11-15, the owner's Chrome: in one profile Developer mode
// was off, which since Chrome 134 turns every unpacked extension off, and a copy from
// before the fixed id stayed beside; in another that old copy held Alt+Shift+M, so the
// working copy had no key). Chrome lists an unpacked extension in the profile's Secure
// Preferences (older Chrome: Preferences): its id, its folder, whether it is off; the
// keys in Preferences' `extensions.commands`, "windows:Alt+Shift+M" → which extension.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { EXTENSION_ID } from './chrome'

/** What to set right in one profile, in the order the person does it. */
export type ChromeIssue =
  /** Developer mode is off: Chrome turns the extension off. */
  | 'devModeOff'
  /** A copy from before the fixed id (0.4.0): Kryakl takes nothing from it; it goes. */
  | 'oldCopy'
  /** Only an old copy is there: Kryakl's must be loaded. */
  | 'notLoaded'
  /** Chrome loads it from a folder that is gone (a reinstall into another folder). */
  | 'folderGone'
  /** Loaded from the program's folder, not Kryakl's own: the next update may lose it. */
  | 'notHome'
  /** Turned off on its card. */
  | 'turnedOff'
  /** Its key is taken by another extension (often the old copy). */
  | 'keyTaken'
  /** No key is set for it. */
  | 'noKey'

export type ChromeProfileCheck = {
  /** The profile's folder ("Default", "Profile 5"): Chrome is opened in it. */
  dir: string
  /** Its name in Chrome. */
  name: string
  /** The key that records ("Alt+Shift+M"), empty when none. */
  key: string
  issues: ChromeIssue[]
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {})
const parse = (text: string): Json => {
  try {
    return obj(JSON.parse(text))
  } catch {
    return {}
  }
}

/** A folder Kryakl's extension is loaded from: the program's (app.asar.unpacked\extension) or Kryakl's own. */
const KRYAKL_FOLDER = /[\\/](app\.asar\.unpacked[\\/]extension|Kryakl[\\/]chrome-extension)[\\/]?$/i
const samePath = (a: string, b: string) => path.win32.normalize(a).replace(/[\\/]+$/, '').toLowerCase() === path.win32.normalize(b).replace(/[\\/]+$/, '').toLowerCase()

/** An extension's off state: a list of reasons (Chrome 131 on) or a bit mask (older); `state` 0 in the oldest. */
function isOff(entry: Json): boolean {
  const reasons = entry.disable_reasons
  if (Array.isArray(reasons)) return reasons.length > 0
  if (typeof reasons === 'number') return reasons > 0
  return entry.state === 0
}

/**
 * One profile, from the text of its Secure Preferences and Preferences; null when no copy of Kryakl's extension
 * is in it (old or new). `home` is Kryakl's own folder for the extension; `exists` says whether a folder is there.
 */
export function checkProfile(p: { dir: string; name: string; secure: string; prefs: string; home: string; exists: (dir: string) => boolean }): ChromeProfileCheck | null {
  const secure = parse(p.secure)
  const prefs = parse(p.prefs)
  const settings = { ...obj(obj(prefs.extensions).settings), ...obj(obj(secure.extensions).settings) }
  const copies = Object.entries(settings)
    .map(([id, value]) => ({ id, entry: obj(value) }))
    .filter(({ id, entry }) => id === EXTENSION_ID || (entry.location === 4 && typeof entry.path === 'string' && KRYAKL_FOLDER.test(entry.path)))
  if (!copies.length) return null
  const ours = copies.find(c => c.id === EXTENSION_ID)
  const old = copies.some(c => c.id !== EXTENSION_ID)
  const ui = { ...obj(obj(prefs.extensions).ui), ...obj(obj(secure.extensions).ui) }
  const commands = { ...obj(obj(prefs.extensions).commands), ...obj(obj(secure.extensions).commands) }
  let key = ''
  let alt = ''
  for (const [shortcut, value] of Object.entries(commands)) {
    const c = obj(value)
    const name = shortcut.replace(/^[a-z]+:/, '')
    if (c.extension === EXTENSION_ID && c.command_name === 'toggle-recording') key = name
    if (name === 'Alt+Shift+M' && typeof c.extension === 'string') alt = c.extension
  }
  const issues: ChromeIssue[] = []
  if (ui.developer_mode !== true) issues.push('devModeOff')
  if (old) issues.push('oldCopy')
  if (!ours) issues.push('notLoaded')
  else {
    const where = typeof ours.entry.path === 'string' ? ours.entry.path : ''
    if (where && !p.exists(where)) issues.push('folderGone')
    else if (where && p.exists(p.home) && !samePath(where, p.home)) issues.push('notHome')
    if (isOff(ours.entry)) issues.push('turnedOff')
    if (!key) issues.push(alt && alt !== EXTENSION_ID ? 'keyTaken' : 'noKey')
  }
  return { dir: p.dir, name: p.name, key, issues }
}

/** A profile's folder name as Chrome writes it: never a path. */
const PROFILE_DIR = /^(Default|Profile \d+)$/

/** Every Chrome profile with a copy of Kryakl's extension; none when Chrome is not here. */
export function checkChrome(userData: string, home: string): ChromeProfileCheck[] {
  const read = (file: string) => {
    try {
      return fs.readFileSync(file, 'utf8')
    } catch {
      return ''
    }
  }
  let dirs: string[]
  try {
    dirs = fs.readdirSync(userData).filter(name => PROFILE_DIR.test(name))
  } catch {
    return []
  }
  const names = obj(obj(obj(parse(read(path.join(userData, 'Local State'))).profile).info_cache))
  const out: ChromeProfileCheck[] = []
  for (const dir of dirs) {
    const name = obj(names[dir]).name
    const found = checkProfile({
      dir,
      name: typeof name === 'string' && name ? name : dir,
      secure: read(path.join(userData, dir, 'Secure Preferences')),
      prefs: read(path.join(userData, dir, 'Preferences')),
      home,
      exists: folder => fs.existsSync(folder),
    })
    if (found) out.push(found)
  }
  return out
}

/** For a problem report: how many profiles and which issues, never a profile's name. */
export function chromeSummary(checks: ChromeProfileCheck[]): string {
  if (!checks.length) return 'no profile with the extension'
  const counts = new Map<string, number>()
  for (const c of checks) for (const i of c.issues) counts.set(i, (counts.get(i) ?? 0) + 1)
  const issues = [...counts].map(([i, n]) => `${i}×${n}`).join(', ')
  return `${checks.length} profile(s) with the extension; ${issues || 'nothing to fix'}`
}
