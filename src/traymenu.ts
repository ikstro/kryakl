// The tray's menu (2026-11-24, the owner: "нативное меню, примерно как у других Windows программ";
// it replaces Kryakl's own panel of 2026-10-30): Windows' look, drawn by Electron, light or dark
// with Kryakl's theme. A right click opens it, a left click the window. The actions people run
// often stay on the first level; the layout's switches, the words, the dictated phrases and the
// day's use of Groq each open a submenu. Made afresh at each opening from the tray's view, so it is
// pure and tested; what an item does is the caller's.

import type { MenuItemConstructorOptions } from 'electron'
import { hotkeyLabel, isAccelerator } from './hotkey'
import { t } from './i18n'
import type { Settings } from './settings'
import type { TrayCommand, TrayView } from './protocol'
import { dayPercent, usageLines } from './remote/usagetext'

/** What the menu's items do, in main. */
export type TrayMenuActions = {
  command: (command: TrayCommand) => void
  set: (patch: Partial<Settings>) => void
  copy: (at: string) => void
  keep: (word: string) => void
}

/** A phrase as one line of the menu: its first characters, its line breaks as spaces. */
const PHRASE_CHARS = 60

/**
 * Electron's menus read "&" as the mark of a key under a letter: a text of the person's
 * (a phrase, a word) keeps its "&" by doubling it.
 */
export const plain = (text: string): string => text.replace(/&/g, '&&')

function phraseLabel(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return plain(one.length > PHRASE_CHARS ? `${one.slice(0, PHRASE_CHARS - 1).trimEnd()}…` : one)
}

/**
 * The key drawn on an item's right: only a key Windows' menu can name (Ctrl+Alt+S, Print Screen, F8).
 * A double tap, a modifier alone or a mouse button it cannot, so those items show none.
 */
export function menuAccelerator(hotkey: string): string | undefined {
  return hotkey && (isAccelerator(hotkey) || hotkey === 'PrintScreen') ? hotkey : undefined
}

export function trayMenuTemplate(v: TrayView, act: TrayMenuActions): MenuItemConstructorOptions[] {
  const run = (label: string, command: TrayCommand, hotkey = ''): MenuItemConstructorOptions => {
    const accelerator = menuAccelerator(hotkey)
    return { label, click: () => act.command(command), ...(accelerator ? { accelerator, registerAccelerator: false } : {}) }
  }
  const check = (label: string, key: 'autoFix' | 'switchOn' | 'layoutBadge' | 'trayLayout', on: boolean): MenuItemConstructorOptions => ({
    label,
    type: 'checkbox',
    checked: on,
    click: () => act.set({ [key]: !on }),
  })
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const words: MenuItemConstructorOptions[] = [
    // The last word fixed by itself, kept as typed in one click; any other word is added in the window.
    v.keep.on && v.keep.word && v.keep.fixed
      ? { label: t('tray.keepThis', { word: plain(v.keep.word), fixed: plain(v.keep.fixed) }), click: () => act.keep(v.keep.word) }
      : null,
    v.speech.dictates ? run(t('tray.vocabulary'), 'vocabulary') : null,
    run(t('tray.keptList'), 'kept'),
  ].filter((i): i is MenuItemConstructorOptions => !!i)

  const groq = v.groq ? groqMenu(v.groq, act) : null

  const items: (MenuItemConstructorOptions | null)[] = [
    run(t('tray.openKryakl'), 'open'),
    v.newVersion ? run(t('tray.newVersionItem', { version: v.newVersion }), 'newVersion') : null,
    sep,
    run(t('tray.shot'), 'shot', v.keys.shot),
    run(t('tray.video'), 'video', v.keys.video),
    run(t('tray.listenCopied'), 'listenCopied', v.keys.listenCopied),
    run(t('tray.translateCopied'), 'translateCopied'),
    run(t('tray.typeToTranslate'), 'typeToTranslate', v.keys.typeToTranslate),
    run(t('tray.checkEnglish'), 'checkEnglish', v.keys.checkEnglish),
    v.speech.talks ? run(`${t('menu.talk')}…`, 'talk', v.keys.talk) : null,
    {
      label: t('tray.fromScreen'),
      submenu: [run(t('tray.listenCopied'), 'listenScreen', v.keys.snipListen), run(t('tray.translateCopied'), 'translateScreen', v.keys.snipTranslate)],
    },
    v.speech.installed ? run(v.speech.recording ? t('tray.saveNote') : t('tray.newNote'), 'note', v.speech.noteKey) : null,
    v.speech.installed ? run(t('tray.transcripts'), 'transcripts') : null,
    v.shots ? run(t('tray.shots', { n: v.shots }), 'shots') : null,
    sep,
    {
      label: t('tray.layoutMenu'),
      submenu: [
        check(t('tray.autoFix'), 'autoFix', v.autoFix),
        v.keys.switch ? check(t('tray.switchWith', { key: plain(hotkeyLabel(v.keys.switch)) }), 'switchOn', v.switchOn) : null,
        check(t('tray.layoutBadge'), 'layoutBadge', v.layoutBadge),
        check(t('tray.trayLayout'), 'trayLayout', v.trayLayout),
      ].filter((i): i is MenuItemConstructorOptions => !!i),
    },
    { label: t('tray.yourWords'), submenu: words },
    v.phrases.length
      ? {
          label: t('tray.phrases'),
          submenu: [...v.phrases.map(p => ({ label: phraseLabel(p.text), click: () => act.copy(p.at) })), sep, run(t('tray.allPhrases'), 'phrases')],
        }
      : null,
    groq,
    sep,
    { label: v.paused ? t('tray.resume') : t('tray.pause'), click: () => act.set({ paused: !v.paused }) },
    run(t('tray.settings'), 'settings'),
    run(t('tray.reportProblem'), 'report'),
    run(t('tray.quit'), 'quit'),
  ]
  return items.filter((i): i is MenuItemConstructorOptions => !!i)
}

/** "Groq today: 12 % used ›": a line per model used today, what Groq says is left, and its settings. */
function groqMenu(usage: NonNullable<TrayView['groq']>, act: TrayMenuActions): MenuItemConstructorOptions {
  const lines = usageLines(usage)
  const open = () => act.command('groq')
  const percent = dayPercent(usage)
  const rows: MenuItemConstructorOptions[] = lines.length
    ? lines.flatMap(u => [{ label: plain(`${u.job}: ${u.line}`), click: open }, ...(u.left ? [{ label: plain(`    ${u.left}`), click: open }] : [])])
    : [{ label: t('apikeys.usageNone'), enabled: false }]
  return {
    label: percent ? t('tray.groqToday', { n: percent }) : t('tray.groqUnused'),
    submenu: [...rows, { type: 'separator' }, { label: t('tray.groqSettings'), click: open }],
  }
}
