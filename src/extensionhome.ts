// The Chrome extension's own folder. Chrome loads an unpacked extension from the folder
// it was shown once (Load unpacked) and never follows it: the program's folder is wiped
// and written again by every update, and a fresh install after an uninstall may be a
// folder of another name (Programs\altype, Programs\kryakl), so Chrome lost the extension
// (2026-11-15, the owner: "после переустановки приложения он слетает"). Kryakl therefore
// keeps a copy in %LOCALAPPDATA%\Kryakl\chrome-extension, which no install touches, and
// puts each new version there at start; the extension sees the newer manifest on the disk
// and reloads itself (extension/background.js selfUpdate). home.json marks this copy, so
// the extension can tell Kryakl where Chrome loads it from.

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** The file only Kryakl's own copy has. */
export const HOME_MARK = 'home.json'
const MANIFEST = 'manifest.json'

/** What Chrome may write into an unpacked extension's folder itself: never removed. */
const CHROME_OWN = /^_metadata(\/|$)/

/** 0.6.0 against 0.7.0, part by part as numbers: below zero when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(n => Number.parseInt(n, 10) || 0)
  const y = b.split('.').map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** A folder's files, relative, with forward slashes, each with a hash of its bytes; none when it is missing. */
export function filesOf(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (rel: string) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const name = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(name)
      else if (e.isFile()) out.set(name, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex'))
    }
  }
  walk('')
  return out
}

const versionIn = (dir: string): string => {
  try {
    const v = (JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')) as { version?: unknown }).version
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

/**
 * What to do to the home copy: the files to write (new or changed; the manifest last, as the extension reloads
 * by its version) and the ones to remove (no longer shipped). Nothing when the copy is newer than what Kryakl
 * ships (a run from an older build never takes it back), or the same.
 */
export function planCopy(
  shipped: Map<string, string>,
  home: Map<string, string>,
  versions: { shipped: string; home: string },
): { write: string[]; remove: string[] } {
  if (!shipped.has(MANIFEST) || (versions.home && compareVersions(versions.shipped, versions.home) < 0)) return { write: [], remove: [] }
  const write = [...shipped].filter(([name, hash]) => home.get(name) !== hash).map(([name]) => name)
  write.sort((a, b) => Number(a === MANIFEST) - Number(b === MANIFEST) || a.localeCompare(b))
  const remove = [...home.keys()].filter(name => !shipped.has(name) && name !== HOME_MARK && !CHROME_OWN.test(name)).sort()
  return { write, remove }
}

export type ExtensionHome = {
  /** The folder to show Chrome: the home copy, or the shipped one when the copy could not be made. */
  dir: string
  /** Files written or removed this time. */
  changed: string[]
  /** The version in `dir`. */
  version: string
}

/**
 * Brings the home copy up to the shipped extension. Each file goes in through a `.tmp` beside it and a rename,
 * so Chrome never reads half a file; the manifest goes last and only when everything else went in, so the
 * extension never reloads into a mix of two versions. A copy that cannot be made leaves the shipped folder in use.
 */
export function syncExtension(shippedDir: string, homeDir: string, warn: (message: string, error?: unknown) => void): ExtensionHome {
  try {
    const shipped = filesOf(shippedDir)
    if (!shipped.has(MANIFEST)) return { dir: shippedDir, changed: [], version: versionIn(shippedDir) }
    fs.mkdirSync(homeDir, { recursive: true })
    const plan = planCopy(shipped, filesOf(homeDir), { shipped: versionIn(shippedDir), home: versionIn(homeDir) })
    const done: string[] = []
    let failed = false
    for (const name of plan.write) {
      if (name === MANIFEST && failed) break
      try {
        const to = path.join(homeDir, name)
        fs.mkdirSync(path.dirname(to), { recursive: true })
        fs.writeFileSync(`${to}.tmp`, fs.readFileSync(path.join(shippedDir, name)))
        fs.renameSync(`${to}.tmp`, to)
        done.push(name)
      } catch (error) {
        failed = true
        warn(`extension: could not write ${name} into its own folder`, error)
      }
    }
    for (const name of plan.remove) {
      try {
        fs.rmSync(path.join(homeDir, name), { force: true })
        done.push(name)
      } catch (error) {
        warn(`extension: could not remove ${name} from its own folder`, error)
      }
    }
    const mark = path.join(homeDir, HOME_MARK)
    if (!fs.existsSync(mark)) {
      fs.writeFileSync(mark, `${JSON.stringify({ kryakl: 'Kryakl keeps this copy of its Chrome extension up to date: load it in Chrome from this folder.' }, null, 2)}\n`)
    }
    return { dir: homeDir, changed: done, version: versionIn(homeDir) }
  } catch (error) {
    warn('extension: its own folder could not be made, Chrome is shown the program’s', error)
    return { dir: shippedDir, changed: [], version: versionIn(shippedDir) }
  }
}
