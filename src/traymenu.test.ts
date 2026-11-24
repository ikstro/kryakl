import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { numberText, setUiLanguage } from './i18n'
import type { TrayView } from './protocol'
import { dayPercent, dayShare } from './remote/usagetext'
import type { UsageView } from './remote/usage'
import { menuAccelerator, plain, trayMenuTemplate, type TrayMenuActions } from './traymenu'

function view(over: Partial<TrayView> = {}): TrayView {
  return {
    keys: { shot: 'PrintScreen', video: 'Control+Shift+R', listenCopied: 'Control+C*2', typeToTranslate: '', checkEnglish: 'RightControl*2', snipListen: 'Control+Alt+S', snipTranslate: 'Control+Alt+T', switch: 'LeftControl', talk: '' },
    autoFix: true,
    switchOn: true,
    layoutBadge: false,
    trayLayout: false,
    paused: false,
    keep: { on: true, word: 'ghbdtn', fixed: 'привет' },
    speech: { installed: true, recording: false, noteKey: 'Control+Alt+N', dictates: true, talks: true },
    shots: 0,
    phrases: [{ at: '2026-11-24T05:00:00.000Z', text: 'Привет, это проверка & диктовки\nв новом бейдже, и она довольно длинная, длиннее строки меню.' }],
    newVersion: '',
    ...over,
  }
}

const spent = (requests: number, seconds = 0, tokens = 0) => ({ requests, seconds, tokens })
const none = spent(0)

function actions(): TrayMenuActions & { [k in keyof TrayMenuActions]: ReturnType<typeof vi.fn> } {
  return { command: vi.fn(), set: vi.fn(), copy: vi.fn(), keep: vi.fn() }
}

const labels = (items: MenuItemConstructorOptions[]) => items.map(i => (i.type === 'separator' ? '—' : i.label))
const item = (items: MenuItemConstructorOptions[], label: string) => items.find(i => i.label === label) as MenuItemConstructorOptions
const submenu = (i: MenuItemConstructorOptions) => i.submenu as MenuItemConstructorOptions[]
const click = (i: MenuItemConstructorOptions) => (i.click as () => void)()

afterEach(() => setUiLanguage('en'))

describe('the tray menu', () => {
  test('the actions on the first level, the rest in submenus, then Pause, Settings, Report and Quit', () => {
    setUiLanguage('en')
    expect(labels(trayMenuTemplate(view(), actions()))).toEqual([
      'Open Kryakl',
      '—',
      'Take a screenshot',
      'Record the screen',
      'Translate and read aloud',
      'Translate',
      'Type a text to translate…',
      'Type a text to check…',
      'Talk to the duck…',
      'From the screen',
      'Voice note',
      'All transcripts',
      '—',
      'Keyboard layout',
      'Your words',
      'Dictated phrases',
      '—',
      'Pause',
      'Settings',
      'Report a problem…',
      'Quit',
    ])
  })

  test('what is not there is not offered: no engine, no phrases, no Groq; a newer version and screenshots are', () => {
    setUiLanguage('en')
    const items = labels(trayMenuTemplate(view({ speech: { installed: false, recording: false, noteKey: '', dictates: false, talks: false }, phrases: [], shots: 3, newVersion: '0.20.0' }), actions()))
    expect(items).not.toContain('Voice note')
    expect(items).not.toContain('All transcripts')
    expect(items).not.toContain('Talk to the duck…')
    expect(items).not.toContain('Dictated phrases')
    expect(items.some(l => l?.startsWith('Groq'))).toBe(false)
    expect(items).toContain('Version 0.20.0 is out: download')
    expect(items).toContain('Open Screenshots (3)')
  })

  test('a key Windows can name is drawn on the right; a double tap or a modifier alone is not', () => {
    setUiLanguage('en')
    const items = trayMenuTemplate(view(), actions())
    expect(item(items, 'Take a screenshot')).toMatchObject({ accelerator: 'PrintScreen', registerAccelerator: false })
    expect(item(items, 'Record the screen').accelerator).toBe('Control+Shift+R')
    expect(item(items, 'Translate and read aloud').accelerator).toBeUndefined()
    expect(item(items, 'Type a text to check…').accelerator).toBeUndefined()
    expect(submenu(item(items, 'From the screen')).map(i => i.accelerator)).toEqual(['Control+Alt+S', 'Control+Alt+T'])
    expect(menuAccelerator('MouseBack')).toBeUndefined()
    expect(menuAccelerator('Pause')).toBeUndefined()
    expect(menuAccelerator('F8')).toBe('F8')
    expect(menuAccelerator('')).toBeUndefined()
  })

  test('the layout\'s switches are ticks that save their opposite', () => {
    setUiLanguage('en')
    const act = actions()
    const layout = submenu(item(trayMenuTemplate(view(), act), 'Keyboard layout'))
    expect(layout.map(i => [i.label, i.checked])).toEqual([
      ['Fix the layout as I type', true],
      ['Switch layouts with Left Ctrl', true],
      ['Show the layout by the cursor', false],
      ['Show the layout in the tray', false],
    ])
    click(layout[0] as MenuItemConstructorOptions)
    click(layout[2] as MenuItemConstructorOptions)
    expect(act.set.mock.calls).toEqual([[{ autoFix: false }], [{ layoutBadge: true }]])
    // No switch key: no line for it.
    expect(submenu(item(trayMenuTemplate(view({ keys: { ...view().keys, switch: '' } }), act), 'Keyboard layout'))).toHaveLength(3)
  })

  test('the last word fixed is kept as typed in one click; with none, only the lists', () => {
    setUiLanguage('en')
    const act = actions()
    const words = submenu(item(trayMenuTemplate(view(), act), 'Your words'))
    expect(labels(words)).toEqual(['Keep “ghbdtn”, not “привет”', 'Add a name or term…', 'Kept as typed'])
    click(words[0] as MenuItemConstructorOptions)
    expect(act.keep).toHaveBeenCalledWith('ghbdtn')
    expect(labels(submenu(item(trayMenuTemplate(view({ keep: { on: true, word: '', fixed: '' } }), act), 'Your words')))).toEqual(['Add a name or term…', 'Kept as typed'])
  })

  test('a phrase is one line of its first characters, its & kept; a click copies it', () => {
    setUiLanguage('en')
    const act = actions()
    const phrases = submenu(item(trayMenuTemplate(view(), act), 'Dictated phrases'))
    const first = phrases[0] as MenuItemConstructorOptions
    expect(first.label).toMatch(/^Привет, это проверка && диктовки в новом бейдже, .*…$/)
    expect(first.label?.replace('&&', '&').length).toBeLessThanOrEqual(60)
    click(first)
    expect(act.copy).toHaveBeenCalledWith('2026-11-24T05:00:00.000Z')
    expect(labels(phrases).slice(-2)).toEqual(['—', 'All phrases…'])
    expect(plain('A & B')).toBe('A && B')
  })

  test('Pause reads Resume while paused and turns it round', () => {
    setUiLanguage('en')
    const act = actions()
    click(item(trayMenuTemplate(view({ paused: true }), act), 'Resume'))
    expect(act.set).toHaveBeenCalledWith({ paused: false })
  })

  test('in Ukrainian and Russian too', () => {
    setUiLanguage('ru')
    expect(labels(trayMenuTemplate(view(), actions())).slice(0, 4)).toEqual(['Открыть Крякл', '—', 'Сделать скриншот', 'Записать экран'])
    setUiLanguage('uk')
    expect(labels(submenu(item(trayMenuTemplate(view(), actions()), 'Ваші слова')))[0]).toBe('Залишити «ghbdtn», не «привет»')
  })
})

describe('Groq in the tray menu', () => {
  const usage: UsageView[] = [
    { model: 'whisper-large-v3', day: spent(120, 840), hour: none },
    { model: 'openai/gpt-oss-120b', day: spent(250, 0, 30_000), hour: none, left: 700, limit: 1000 },
    { model: 'qwen/qwen3.8-27b', day: none, hour: none },
  ]

  test('the busiest model\'s share of its free day: requests, sound or words, and what Groq said was left', () => {
    expect(dayShare(usage[0] as UsageView)).toBeCloseTo(0.06)
    // 250 of 1000 counted here, but Groq says 300 were used, outside Kryakl too.
    expect(dayShare(usage[1] as UsageView)).toBeCloseTo(0.3)
    expect(dayPercent(usage)).toBe(30)
    expect(dayPercent([{ model: 'whisper-large-v3', day: spent(1), hour: none }])).toBe(1)
    expect(dayPercent([])).toBe(0)
  })

  test('a line per model used today, what Groq says is left, and its settings; every line opens Models › Groq', () => {
    setUiLanguage('en')
    const act = actions()
    const items = trayMenuTemplate(view({ groq: usage }), act)
    const groq = item(items, 'Groq: 30 % of today’s free limit used')
    expect(labels(items).indexOf(groq.label)).toBe(labels(items).indexOf('Dictated phrases') + 1)
    const rows = submenu(groq)
    expect(labels(rows)).toEqual([
      `Dictation: requests: 120 of ${numberText(2000)} · sound: 14 min of 8 h 0 min`,
      `Translation and checking: requests: 250 of ${numberText(1000)} · words: 30K of 200K tokens`,
      '    Groq says 700 requests are left today, use outside Kryakl included',
      '—',
      'Groq settings…',
    ])
    click(rows[0] as MenuItemConstructorOptions)
    click(rows[4] as MenuItemConstructorOptions)
    expect(act.command.mock.calls).toEqual([['groq'], ['groq']])
  })

  test('nothing used yet says so', () => {
    setUiLanguage('en')
    const groq = item(trayMenuTemplate(view({ groq: [] }), actions()), 'Groq: nothing used today')
    expect(submenu(groq)[0]).toMatchObject({ enabled: false })
  })
})
