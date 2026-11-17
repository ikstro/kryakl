import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { EXTENSION_ID } from './chrome'
import { checkChrome, checkProfile, chromeSummary } from './chromecheck'

// As Chrome 157 wrote the owner's two profiles on 2026-11-15 (names and other extensions left out).
const OLD_ID = 'befdpnolmjfeoiahokmehjoblkofigii'
const PROGRAM = 'C:\\Users\\me\\AppData\\Local\\Programs\\altype\\resources\\app.asar.unpacked\\extension'
const HOME = 'C:\\Users\\me\\AppData\\Local\\Kryakl\\chrome-extension'
const copy = (where: string, extra = {}) => ({ path: where, location: 4, disable_reasons: [], ...extra })
const secure = (settings: object, ui?: object) => JSON.stringify({ extensions: { settings, ...(ui ? { ui } : {}) } })
const prefs = (commands: object = {}) => JSON.stringify({ extensions: { commands } })
const here = (...dirs: string[]) => (dir: string) => dirs.includes(dir)

const profile = (s: string, p: string, exists = here(PROGRAM, HOME)) => checkProfile({ dir: 'Default', name: 'Me', secure: s, prefs: p, home: HOME, exists })

describe('checkProfile', () => {
  test('the main profile: Developer mode off and only the copy from before the fixed id', () => {
    const got = profile(secure({ [OLD_ID]: copy(PROGRAM) }), prefs())
    expect(got?.issues).toEqual(['devModeOff', 'oldCopy', 'notLoaded'])
  })

  test('the work profile: both copies, the old one holding Alt+Shift+M, loaded from the program’s folder', () => {
    const got = profile(
      secure({ [OLD_ID]: copy(PROGRAM), [EXTENSION_ID]: copy(PROGRAM) }, { developer_mode: true }),
      prefs({ 'windows:Alt+Shift+M': { command_name: 'toggle-recording', extension: OLD_ID, global: false } }),
    )
    expect(got?.issues).toEqual(['oldCopy', 'notHome', 'keyTaken'])
    expect(got?.key).toBe('')
  })

  test('loaded from Kryakl’s own folder with its key: nothing to fix', () => {
    const got = profile(
      secure({ [EXTENSION_ID]: copy(HOME) }, { developer_mode: true }),
      prefs({ 'windows:Alt+Shift+M': { command_name: 'toggle-recording', extension: EXTENSION_ID } }),
    )
    expect(got).toEqual({ dir: 'Default', name: 'Me', key: 'Alt+Shift+M', issues: [] })
  })

  test('a key the person set instead is the key; none at all says so', () => {
    const own = profile(secure({ [EXTENSION_ID]: copy(HOME) }, { developer_mode: true }), prefs({ 'windows:Ctrl+Shift+8': { command_name: 'toggle-recording', extension: EXTENSION_ID } }))
    expect(own?.key).toBe('Ctrl+Shift+8')
    expect(profile(secure({ [EXTENSION_ID]: copy(HOME) }, { developer_mode: true }), prefs())?.issues).toEqual(['noKey'])
  })

  test('a folder gone after a reinstall elsewhere, and a copy turned off on its card', () => {
    const gone = profile(secure({ [EXTENSION_ID]: copy(PROGRAM) }, { developer_mode: true }), prefs(), here(HOME))
    expect(gone?.issues).toEqual(['folderGone', 'noKey'])
    const off = profile(secure({ [EXTENSION_ID]: copy(HOME, { disable_reasons: [1] }) }, { developer_mode: true }), prefs())
    expect(off?.issues).toEqual(['turnedOff', 'noKey'])
  })

  test('before Kryakl made its own folder, the program’s folder is no fault', () => {
    expect(profile(secure({ [EXTENSION_ID]: copy(PROGRAM) }, { developer_mode: true }), prefs(), here(PROGRAM))?.issues).toEqual(['noKey'])
  })

  test('a profile without Kryakl’s extension, or a file Chrome left half written, is no profile of ours', () => {
    expect(profile(secure({ abc: copy('C:\\dev\\other') }), prefs())).toBeNull()
    expect(profile('{"exten', '')).toBeNull()
  })
})

describe('checkChrome', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true })
  })

  test('reads every profile and names it as Chrome does; a profile without the extension is left out', () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'chromecheck-'))
    dirs.push(userData)
    const write = (dir: string, s: string, p: string) => {
      fs.mkdirSync(path.join(userData, dir))
      fs.writeFileSync(path.join(userData, dir, 'Secure Preferences'), s)
      fs.writeFileSync(path.join(userData, dir, 'Preferences'), p)
    }
    write('Default', secure({ [OLD_ID]: copy(PROGRAM) }), prefs())
    write('Profile 5', secure({ [EXTENSION_ID]: copy(HOME) }, { developer_mode: true }), prefs())
    write('Profile 4', secure({}), prefs())
    fs.writeFileSync(path.join(userData, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Me' }, 'Profile 5': { name: 'Work' } } } }))
    const got = checkChrome(userData, HOME)
    expect(got.map(c => [c.dir, c.name])).toEqual([
      ['Default', 'Me'],
      ['Profile 5', 'Work'],
    ])
    expect(chromeSummary(got)).toBe('2 profile(s) with the extension; devModeOff×1, oldCopy×1, notLoaded×1, folderGone×1, noKey×1')
    expect(chromeSummary(got)).not.toMatch(/Me|Work/)
  })

  test('no Chrome here: nothing', () => {
    expect(checkChrome(path.join(os.tmpdir(), 'no-such-chrome'), HOME)).toEqual([])
  })
})
