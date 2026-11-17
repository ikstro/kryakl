import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { HOME_MARK, compareVersions, filesOf, planCopy, syncExtension } from './extensionhome'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

function tmp(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extensionhome-'))
  dirs.push(root)
  return root
}

/** An extension folder of a version, with its files. */
function shipped(root: string, version: string, files: Record<string, string> = {}): string {
  const dir = path.join(root, `shipped-${version}`)
  fs.mkdirSync(path.join(dir, '_locales', 'en'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ version }))
  fs.writeFileSync(path.join(dir, 'background.js'), `// ${version}`)
  fs.writeFileSync(path.join(dir, '_locales', 'en', 'messages.json'), '{}')
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}

const quiet = () => {}

describe('compareVersions', () => {
  test('parts compare as numbers', () => {
    expect(compareVersions('0.6.0', '0.7.0')).toBeLessThan(0)
    expect(compareVersions('0.10.0', '0.9.1')).toBeGreaterThan(0)
    expect(compareVersions('0.7', '0.7.0')).toBe(0)
  })
})

describe('planCopy', () => {
  const files = (...names: string[]) => new Map(names.map(n => [n, `hash of ${n}`]))

  test('everything goes into an empty folder, the manifest last', () => {
    const plan = planCopy(files('manifest.json', 'background.js', 'popup.js'), new Map(), { shipped: '0.7.0', home: '' })
    expect(plan.write).toEqual(['background.js', 'popup.js', 'manifest.json'])
    expect(plan.remove).toEqual([])
  })

  test('only changed files are written, a file no longer shipped is removed, the mark and Chrome’s own stay', () => {
    const home = files('manifest.json', 'background.js', 'old.js', HOME_MARK, '_metadata/computed_hashes.json')
    home.set('background.js', 'an older hash')
    const plan = planCopy(files('manifest.json', 'background.js'), home, { shipped: '0.7.0', home: '0.7.0' })
    expect(plan.write).toEqual(['background.js'])
    expect(plan.remove).toEqual(['old.js'])
  })

  test('a copy newer than the one shipped is never taken back (a run of an older build)', () => {
    expect(planCopy(files('manifest.json'), new Map([['manifest.json', 'x']]), { shipped: '0.6.0', home: '0.7.0' })).toEqual({ write: [], remove: [] })
  })
})

describe('syncExtension', () => {
  test('the first start copies the extension and marks the copy; the next finds nothing to do', () => {
    const root = tmp()
    const from = shipped(root, '0.7.0')
    const home = path.join(root, 'Kryakl', 'chrome-extension')
    const first = syncExtension(from, home, quiet)
    expect(first.dir).toBe(home)
    expect(first.version).toBe('0.7.0')
    expect(first.changed).toContain('manifest.json')
    expect(fs.existsSync(path.join(home, HOME_MARK))).toBe(true)
    expect(fs.readFileSync(path.join(home, '_locales', 'en', 'messages.json'), 'utf8')).toBe('{}')
    expect(syncExtension(from, home, quiet).changed).toEqual([])
  })

  test('a new version replaces the changed files and removes the dropped ones', () => {
    const root = tmp()
    const home = path.join(root, 'home')
    syncExtension(shipped(root, '0.7.0', { 'old.js': 'gone next time' }), home, quiet)
    const next = syncExtension(shipped(root, '0.8.0'), home, quiet)
    expect(next.version).toBe('0.8.0')
    expect(next.changed.sort()).toEqual(['background.js', 'manifest.json', 'old.js'])
    expect(fs.existsSync(path.join(home, 'old.js'))).toBe(false)
    expect(fs.readFileSync(path.join(home, 'background.js'), 'utf8')).toBe('// 0.8.0')
    expect([...filesOf(home).keys()].some(name => name.endsWith('.tmp'))).toBe(false)
  })

  test('when a file cannot go in, the manifest stays old, so the extension does not reload into two versions', () => {
    const root = tmp()
    const home = path.join(root, 'home')
    syncExtension(shipped(root, '0.7.0'), home, quiet)
    // A folder where background.js should be: the rename over it fails.
    fs.rmSync(path.join(home, 'background.js'))
    fs.mkdirSync(path.join(home, 'background.js'))
    const warned: string[] = []
    const next = syncExtension(shipped(root, '0.8.0'), home, message => warned.push(message))
    expect(next.version).toBe('0.7.0')
    expect(warned.join('\n')).toContain('background.js')
  })

  test('with no extension shipped, or no folder of its own, the shipped folder is what Chrome is shown', () => {
    const root = tmp()
    const empty = path.join(root, 'nothing')
    expect(syncExtension(empty, path.join(root, 'home'), quiet).dir).toBe(empty)
    const from = shipped(root, '0.7.0')
    // A file where the home folder should be.
    const blocked = path.join(root, 'blocked')
    fs.writeFileSync(blocked, '')
    expect(syncExtension(from, path.join(blocked, 'chrome-extension'), quiet).dir).toBe(from)
  })
})
