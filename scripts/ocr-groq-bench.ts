// Draws test pictures with known text and reads them with Windows' reader the way
// the app does (2026-11-23), for comparing with Groq's vision model. Run with Electron:
//
//   npx esbuild scripts/ocr-groq-bench.ts --bundle --platform=node --external:electron --outfile=.cache/ocr-quality/groq-draw.js
//   env -u ELECTRON_RUN_AS_NODE npx electron .cache/ocr-quality/groq-draw.js
//
// Writes .cache/ocr-quality/groq/<name>.png, <name>.txt (the truth) and windows/<name>.txt,
// windows.json (seconds). scripts/ocr-groq-score.mjs scores them. Never part of the app.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { app, BrowserWindow } from 'electron'

import { recognize } from '../src/ocr'
import { pickLines } from '../src/ocrpick'
import { screenText } from '../src/ocrtext'

const ROOT = path.resolve('.cache/ocr-quality/groq')
const list = (code: string) => new Set(fs.readFileSync(`media/layout/${code}.txt`, 'utf8').split('\n'))
const lists = ['en', 'ru', 'uk'].map(list)
const known = (word: string) => lists.some(l => l.has(word))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

type Fixture = { name: string; width: number; zoom: number; html: string; truth: string[] }

const CODE = [
  'import { app, BrowserWindow } from "electron"',
  'import * as path from "node:path"',
  '',
  'const WIDTH = 440',
  'const HEIGHT = 640',
  '',
  'type Turn = { id: number; who: "me" | "duck"; text: string }',
  '',
  'export function lastTurns(turns: Turn[], n = 20): Turn[] {',
  '  if (turns.length <= n) return turns',
  '  return turns.slice(turns.length - n)',
  '}',
  '',
  '// Подсчёт слов в реплике, без знаков препинания',
  'function countWords(text: string): number {',
  '  return text.split(/\\s+/).filter(w => /[\\p{L}\\d]/u.test(w)).length',
  '}',
  '',
  'async function main(): Promise<void> {',
  '  await app.whenReady()',
  '  const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false })',
  '  await win.loadFile(path.join(__dirname, "talk.html"))',
  '  win.once("ready-to-show", () => win.show())',
  '  console.log(`window ${win.id} is ready, ${countWords("hello big world")} words`)',
  '}',
  '',
  'main().catch(error => {',
  '  console.error("fatal:", error?.message ?? error)',
  '  process.exitCode = 1',
  '})',
]

const EN = [
  'Kryakl translates the selected text offline and reads the English aloud.',
  "The build failed again, so let's look at the logs after lunch.",
  'Whisper turbo runs on the graphics card; Parakeet dictates on the processor.',
  'Version 0.17.1 fixes the tray panel in a screenshot and the card in a frame.',
  'Press Ctrl+Alt+S, pick a window, and read its text in a second.',
  'A model that does not fit the card stays on the processor, at 3 to 4 words a second.',
]
const RU = [
  'Крякл переводит выделенный текст без интернета и читает английский вслух.',
  'Сборка опять упала, так что логи посмотрим после обеда вместе.',
  'Модель на видеокарте работает быстрее, чем на процессоре, но занимает 5,2 ГБ.',
  'Открой Настройки, включи «Заменить переводом» и нажми Вставить.',
  'Эта функция пока выключена по умолчанию, её можно включить в настройках.',
  'В выходные поедем за город, если не будет дождя; ёжик и щёлк — с ё.',
]
const UK = [
  'Крякл перекладає виділений текст без інтернету і читає англійською вголос.',
  'Збірка знову впала, тож після обіду подивимося логи разом.',
  'Модель на відеокарті працює швидше, ніж на процесорі, але займає 5,2 ГБ.',
  'Відкрий Settings, увімкни Translate in place і натисни Paste.',
  'Ґанок, їжак, єдність та п’ять розмов — усі ці слова з особливими літерами.',
  'Це не працює, якщо слово пишеться з апострофом: м’який, об’єм, пір’я.',
]
const UI = [
  'Перевести и прочитать вслух          Ctrl+C twice',
  'Печатать голосом                     Right Alt',
  'Модель: Accurate (Gemma 4 E4B), 5,2 ГБ',
  'Whisper turbo · на видеокарте · 0,3 с на фразу',
  'Раскладка: EN → RU → UK',
  'Место на диске                       12,4 ГБ',
  'Check my English · Проверить мой английский',
  'Pause · Пауза          Quit · Выход',
]
const TABLE = [
  ['Model', 'Размер', 'Where', 'Time, s'],
  ['Whisper turbo', '1,6 ГБ', 'видеокарта', '0.22'],
  ['Parakeet', '670 МБ', 'processor', '0.30'],
  ['Gemma 4 E4B', '5,2 ГБ', 'видеокарта', '0.71'],
  ['Gemma 4 12B', '7,0 ГБ', 'CUDA', '6.00'],
  ['Fast (Firefox)', '35 МБ', 'процессор', '0.05'],
]
const CHAT: [string, string][] = [
  ['Anna', 'Hey, did the build pass this morning?'],
  ['Олег', 'Нет, упал на тестах. Посмотришь pull request?'],
  ['Anna', 'Sure, give me ten minutes. Which branch?'],
  ['Олег', 'feature/dictation-fix, там два коммита'],
  ['Anna', 'Got it. Also, обед в 13:30?'],
  ['Олег', 'Да, пойдём. Закажу столик на двоих'],
]

const style = (bg: string, fg: string, font: string, pad = '16px 20px') => `<style>body{margin:0;padding:${pad};background:${bg};color:${fg};font:${font}}div.l{white-space:pre}</style>`
const lines = (ls: string[]) => ls.map(l => `<div class="l">${esc(l) || '&nbsp;'}</div>`).join('')

function editor(name: string, zoom: number): Fixture {
  const rows = CODE.map((l, i) => `<div><span class="n">${i + 1}</span>${esc(l)}</div>`).join('')
  return {
    name,
    width: 820,
    zoom,
    html: `<style>body{margin:0;padding:8px 0;background:#1f1f1f;color:#cccccc;font:14px/19px Consolas,monospace;white-space:pre}.n{display:inline-block;width:44px;text-align:right;margin-right:24px;color:#6e7681}</style>${rows}`,
    truth: CODE.map((l, i) => `${i + 1} ${l}`),
  }
}

const prose = (name: string, ls: string[], zoom = 1): Fixture => ({ name, width: 900, zoom, html: style('#ffffff', '#1a1a1a', '15px/24px "Segoe UI",sans-serif') + lines(ls), truth: ls })

const FIXTURES: Fixture[] = [
  editor('editor-dark', 1),
  editor('editor-dark-150', 1.5),
  prose('prose-en', EN),
  prose('prose-ru', RU),
  prose('prose-uk', UK),
  {
    name: 'ui-mixed-11px',
    width: 520,
    zoom: 1,
    html: style('#202020', '#e8e8e8', '11px/28px "Segoe UI",sans-serif') + lines(UI),
    truth: UI,
  },
  {
    name: 'table',
    width: 620,
    zoom: 1,
    html: `<style>body{margin:0;padding:16px;background:#fff;color:#111;font:12px "Segoe UI",sans-serif}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px 18px;text-align:left}th{background:#eee}</style><table>${TABLE.map((r, i) => `<tr>${r.map(c => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table>`,
    truth: TABLE.map(r => r.join(' ')),
  },
  {
    name: 'chat',
    width: 560,
    zoom: 1,
    html: `<style>body{margin:0;padding:14px;background:#17212b;font:13px "Segoe UI",sans-serif}.m{background:#2b5278;color:#fff;border-radius:10px;padding:6px 12px;margin:8px 0;width:max-content;max-width:480px}.m b{display:block;color:#8ab4f8;font-size:12px}</style>${CHAT.map(([w, t]) => `<div class="m"><b>${esc(w)}</b>${esc(t)}</div>`).join('')}`,
    truth: CHAT.flatMap(([w, t]) => [w, t]),
  },
]

async function draw(f: Fixture): Promise<string> {
  const file = path.join(ROOT, `${f.name}.png`)
  const html = path.join(ROOT, `${f.name}.html`)
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body style="zoom:${f.zoom}">${f.html.replace('</style>', '</style>')}`)
  const win = new BrowserWindow({ show: false, width: f.width, height: 600, webPreferences: { offscreen: true } })
  await win.loadFile(html).catch(() => new Promise(r => setTimeout(r, 500)).then(() => win.loadFile(html)))
  await new Promise(r => setTimeout(r, 300))
  const size = await win.webContents.executeJavaScript('[document.documentElement.scrollWidth, document.documentElement.scrollHeight]')
  win.setContentSize(Math.max(f.width, size[0]), size[1])
  await new Promise(r => setTimeout(r, 300))
  const image = await win.webContents.capturePage()
  win.destroy()
  fs.writeFileSync(file, image.toPNG())
  return file
}

async function main(): Promise<void> {
  fs.mkdirSync(path.join(ROOT, 'windows'), { recursive: true })
  const times: Record<string, number> = {}
  let first = true
  for (const f of FIXTURES) {
    const file = await draw(f)
    fs.writeFileSync(path.join(ROOT, `${f.name}.txt`), f.truth.join('\n'))
    if (first) {
      await recognize(file, ['ru', 'uk', 'en'])
      first = false
    }
    const started = performance.now()
    const text = screenText(pickLines((await recognize(file, ['ru', 'uk', 'en'])).readings, known))
    times[f.name] = (performance.now() - started) / 1000
    fs.writeFileSync(path.join(ROOT, 'windows', `${f.name}.txt`), text)
    console.log(f.name, times[f.name]?.toFixed(2))
  }
  fs.writeFileSync(path.join(ROOT, 'windows.json'), JSON.stringify(times, null, 2))
}

app.on('window-all-closed', () => {})
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app
  .whenReady()
  .then(main)
  .catch(error => console.error(error))
  .finally(() => app.quit())
