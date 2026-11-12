// Compares text readers on screenshots whose text is known (2026-11-12, the
// owner: "How can we improve our OCR?"). Run with Electron, which draws the
// test pictures and decodes them:
//
//   npx esbuild scripts/ocr-bench.ts --bundle --platform=node --external:electron --external:onnxruntime-node --outfile=.cache/ocr-quality/bench.js
//   env -u ELECTRON_RUN_AS_NODE npx electron .cache/ocr-quality/bench.js
//
// Pictures and models live in .cache/ocr-quality (out of git): models/det.onnx
// (PP-OCRv5 mobile detector) and models/<eslav|english|latin>/{rec.onnx,dict.txt}
// (PP-OCRv5 mobile recognizers, Apache 2.0, from Hugging Face). Real screenshots
// may be added as real/<name>.png with real/<name>.txt holding their text.
// Writes .cache/ocr-quality/results.json and prints a table; never part of the app.

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { app, BrowserWindow, nativeImage, type NativeImage } from 'electron'
import * as ort from 'onnxruntime-node'

import { recognize } from '../src/ocr'
import { fixScripts, lineScore, mergeLine, pickLines } from '../src/ocrpick'
import { screenText, type OcrLine } from '../src/ocrtext'

const ROOT = path.resolve('.cache/ocr-quality')
const MODELS = path.join(ROOT, 'models')
const SHOTS = path.join(ROOT, 'pictures')

// ---------------------------------------------------------------- words

const list = (code: string) => new Set(fs.readFileSync(`media/layout/${code}.txt`, 'utf8').split('\n'))
const lists = ['en', 'ru', 'uk'].map(list)
const known = (word: string) => lists.some(l => l.has(word))

// ---------------------------------------------------------------- the pictures

const SCRIPT = fs.readFileSync('.cache/speech-quality/own/script.txt', 'utf8').split(/\r?\n/).filter(l => l.trim())

type Fixture = { name: string; width: number; dark: boolean; html: string; truth: string[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

function editor(name: string, dark: boolean, size: number, lines: string[]): Fixture {
  const [bg, fg, gutter] = dark ? ['#1f1f1f', '#cccccc', '#6e7681'] : ['#ffffff', '#3b3b3b', '#237893']
  const rows = lines.map((l, i) => `<div><span class="n">${i + 1}</span>${esc(l)}</div>`).join('')
  return {
    name,
    width: Math.round(size * 0.55 * 95 + 80),
    dark,
    html: `<style>body{margin:0;padding:8px 0;background:${bg};color:${fg};font:${size}px/${Math.round(size * 1.36)}px Consolas,monospace;white-space:pre}.n{display:inline-block;width:44px;text-align:right;margin-right:24px;color:${gutter}}</style>${rows}`,
    truth: lines.map((l, i) => `${i + 1} ${l}`),
  }
}

function page(name: string, dark: boolean, font: string, lines: string[], width = 900): Fixture {
  const [bg, fg] = dark ? ['#202020', '#e8e8e8'] : ['#ffffff', '#1a1a1a']
  return {
    name,
    width,
    dark,
    html: `<style>body{margin:0;padding:16px 20px;background:${bg};color:${fg};font:${font};white-space:pre}</style>${lines.map(l => `<div>${esc(l) || '&nbsp;'}</div>`).join('')}`,
    truth: lines.filter(l => l.trim()),
  }
}

const UK_PROSE = [
  'Крякл перекладає виділений текст без інтернету і читає англійською вголос.',
  'Збірка знову впала, тож після обіду подивимося логи разом.',
  'Модель на відеокарті працює швидше, ніж на процесорі, але займає 5,2 ГБ.',
  'Відкрий Settings, увімкни Translate in place і натисни Paste.',
  'Ця функція поки вимкнена за замовчуванням, її можна ввімкнути в налаштуваннях.',
  'У вихідні поїдемо за місто, якщо не буде дощу.',
]
const EN_PROSE = [
  'Kryakl translates the selected text offline and reads the English aloud.',
  "The build failed again, so let's look at the logs after lunch.",
  'Whisper turbo runs on the graphics card; Parakeet dictates on the processor.',
  'Version 0.17.1 fixes the tray panel in a screenshot and the card in a frame.',
  'Press Ctrl+Alt+S, pick a window, and read its text in a second.',
]
const UI_MIXED = [
  'Перевести и прочитать вслух          Ctrl+C twice',
  'Печатать голосом                     Right Alt',
  'Модель: Accurate (Gemma 4 E4B), 5,2 ГБ',
  'Whisper turbo · на видеокарте · 0,3 с на фразу',
  'Раскладка: EN → RU → UK',
  'Место на диске                       12,4 ГБ',
]

const FIXTURES: Fixture[] = [
  editor('editor-dark-14', true, 14, SCRIPT),
  editor('editor-light-14', false, 14, SCRIPT),
  editor('editor-dark-12', true, 12, SCRIPT.slice(0, 15)),
  page('prose-uk-light', false, '15px/22px "Segoe UI",sans-serif', UK_PROSE),
  page('prose-uk-dark-13', true, '13px/19px "Segoe UI",sans-serif', UK_PROSE),
  page('prose-en-light', false, '16px/24px Georgia,serif', EN_PROSE),
  page('ui-mixed-dark', true, '13px/30px "Segoe UI",sans-serif', UI_MIXED, 640),
]

async function draw(f: Fixture): Promise<string> {
  const file = path.join(SHOTS, `${f.name}.png`)
  const height = 40 + f.truth.length * 40
  const win = new BrowserWindow({ show: false, width: f.width, height, webPreferences: { offscreen: true } })
  const page = path.join(SHOTS, `${f.name}.html`)
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8">${f.html}`)
  // A second offscreen window's first load was seen to fail at once (ERR_FAILED): once more.
  await win.loadFile(page).catch(() => new Promise(resolve => setTimeout(resolve, 500)).then(() => win.loadFile(page)))
  await new Promise(resolve => setTimeout(resolve, 300))
  const size = await win.webContents.executeJavaScript('[document.documentElement.scrollWidth, document.body.scrollHeight + 16]')
  win.setContentSize(Math.max(f.width, size[0]), size[1])
  await new Promise(resolve => setTimeout(resolve, 300))
  const image = await win.webContents.capturePage()
  win.destroy()
  fs.writeFileSync(file, image.toPNG())
  return file
}

// ---------------------------------------------------------------- the readers

type Reader = (file: string, dark: boolean) => Promise<OcrLine[]>

const LANGS = ['ru', 'uk', 'en']

const windows: Reader = async file => pickLines((await recognize(file, LANGS)).readings, known)

/** Windows with a dark picture turned light first. */
const windowsInverted: Reader = async (file, dark) => {
  if (!dark) return windows(file, dark)
  const image = nativeImage.createFromPath(file)
  const bgra = image.toBitmap()
  for (let i = 0; i < bgra.length; i += 4) {
    bgra[i] = 255 - (bgra[i] as number)
    bgra[i + 1] = 255 - (bgra[i + 1] as number)
    bgra[i + 2] = 255 - (bgra[i + 2] as number)
  }
  const out = path.join(os.tmpdir(), `kryakl-ocr-inv-${process.pid}.png`)
  fs.writeFileSync(out, nativeImage.createFromBitmap(bgra, image.getSize()).toPNG())
  try {
    return await windows(out, dark)
  } finally {
    fs.rmSync(out, { force: true })
  }
}

// PP-OCRv5 mobile: DB detection, then CTC recognition of each box.

type Rec = { session: ort.InferenceSession; chars: string[] }

let detector: ort.InferenceSession | undefined
const recognizers = new Map<string, Rec>()

async function rec(lang: string): Promise<Rec> {
  let r = recognizers.get(lang)
  if (!r) {
    const dir = path.join(MODELS, lang)
    const chars = fs.readFileSync(path.join(dir, 'dict.txt'), 'utf8').split(/\r?\n/)
    if (chars[chars.length - 1] === '') chars.pop()
    r = { session: await ort.InferenceSession.create(path.join(dir, 'rec.onnx')), chars: ['', ...chars, ' '] }
    recognizers.set(lang, r)
  }
  return r
}

type Box = { x: number; y: number; w: number; h: number }

/** The boxes of text: the probability map over 0.3, its 4-connected parts, kept over a mean of 0.6, grown as DB's unclip does. */
async function detect(image: NativeImage): Promise<Box[]> {
  detector ??= await ort.InferenceSession.create(path.join(MODELS, 'det.onnx'))
  const { width, height } = image.getSize()
  const limit = 2560
  const scale = Math.min(1, limit / Math.max(width, height))
  const w = Math.max(32, Math.ceil((width * scale) / 32) * 32)
  const h = Math.max(32, Math.ceil((height * scale) / 32) * 32)
  const resized = image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' })
  const bgra = resized.toBitmap()
  const rw = resized.getSize().width
  const rh = resized.getSize().height
  const data = new Float32Array(3 * w * h)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const inside = x < rw && y < rh
      const p = (y * rw + x) * 4
      for (let c = 0; c < 3; c++) {
        // BGR, as Paddle reads a picture.
        const v = inside ? (bgra[p + c] as number) / 255 : 0
        data[c * w * h + y * w + x] = (v - (mean[c] as number)) / (std[c] as number)
      }
    }
  }
  const out = await detector.run({ x: new ort.Tensor('float32', data, [1, 3, h, w]) })
  const prob = (Object.values(out)[0] as ort.Tensor).data as Float32Array
  const seen = new Uint8Array(w * h)
  const boxes: Box[] = []
  const stack: number[] = []
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || (prob[start] as number) < 0.3) continue
    let minX = w
    let minY = h
    let maxX = 0
    let maxY = 0
    let sum = 0
    let n = 0
    stack.push(start)
    seen[start] = 1
    while (stack.length) {
      const i = stack.pop() as number
      const x = i % w
      const y = (i - x) / w
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      sum += prob[i] as number
      n++
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && (prob[j] as number) >= 0.3) {
          seen[j] = 1
          stack.push(j)
        }
      }
    }
    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    if (sum / n < 0.6 || Math.min(bw, bh) < 3) continue
    const grow = (bw * bh * 1.5) / (2 * (bw + bh))
    const x0 = Math.max(0, (minX - grow) / scale)
    const y0 = Math.max(0, (minY - grow) / scale)
    const x1 = Math.min(width, (maxX + 1 + grow) / scale)
    const y1 = Math.min(height, (maxY + 1 + grow) / scale)
    boxes.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
  }
  return boxes
}

async function read(image: NativeImage, box: Box, r: Rec): Promise<string> {
  const crop = image.crop({ x: Math.floor(box.x), y: Math.floor(box.y), width: Math.max(1, Math.ceil(box.w)), height: Math.max(1, Math.ceil(box.h)) })
  const { width, height } = crop.getSize()
  const H = 48
  const W = Math.max(16, Math.min(3200, Math.round((width * H) / height)))
  const bgra = crop.resize({ width: W, height: H, quality: 'best' }).toBitmap()
  const data = new Float32Array(3 * H * W)
  for (let i = 0; i < H * W; i++) {
    for (let c = 0; c < 3; c++) data[c * H * W + i] = ((bgra[i * 4 + c] as number) / 255 - 0.5) / 0.5
  }
  const out = await r.session.run({ x: new ort.Tensor('float32', data, [1, 3, H, W]) })
  const tensor = Object.values(out)[0] as ort.Tensor
  const [, steps, classes] = tensor.dims as number[]
  const probs = tensor.data as Float32Array
  let text = ''
  let last = 0
  for (let t = 0; t < (steps as number); t++) {
    let best = 0
    for (let k = 1; k < (classes as number); k++) if ((probs[t * (classes as number) + k] as number) > (probs[t * (classes as number) + best] as number)) best = k
    if (best !== 0 && best !== last) text += r.chars[best] ?? ''
    last = best
  }
  return text.trim()
}

function paddle(langs: string[]): Reader {
  return async file => {
    const image = nativeImage.createFromPath(file)
    const recs = await Promise.all(langs.map(rec))
    const lines: OcrLine[] = []
    for (const box of await detect(image)) {
      let best = ''
      let bestScore = -Infinity
      for (const r of recs) {
        const text = await read(image, box, r)
        const score = lineScore(text, known)
        if (score > bestScore) {
          best = text
          bestScore = score
        }
      }
      if (best) lines.push({ text: best, ...box })
    }
    return lines
  }
}

/** The East Slavic reader first; a line with Latin letters in it is read by the English one too, and its doubtful words (scripts mixed, look-alikes) taken from it word by word, as for Windows' engines. */
const paddleMerged: Reader = async file => {
  const image = nativeImage.createFromPath(file)
  const [eslav, english] = await Promise.all([rec('eslav'), rec('english')])
  const lines: OcrLine[] = []
  for (const box of await detect(image)) {
    let text = await read(image, box, eslav)
    if (/\p{Script=Latin}/u.test(text)) text = mergeLine(text, await read(image, box, english), known)
    if (text) lines.push({ text, ...box })
  }
  return lines
}

/** A reader's lines with their words of mixed scripts put into one. */
const fixed = (reader: Reader): Reader => async (file, dark) => (await reader(file, dark)).map(l => ({ ...l, text: fixScripts(l.text, known) }))

const READERS: [string, Reader][] = [
  ['Windows (now)', windows],
  ['Windows, dark inverted', windowsInverted],
  ['PP-OCRv5 eslav', paddle(['eslav'])],
  ['PP-OCRv5 eslav+english', paddle(['eslav', 'english'])],
  ['PP-OCRv5 eslav, English words', paddleMerged],
  ['Windows + script fix', fixed(windows)],
  ['PP-OCRv5 eslav + script fix', fixed(paddle(['eslav']))],
]

// ---------------------------------------------------------------- the score

const norm = (lines: string[]) =>
  lines
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')

function distance<T>(a: readonly T[], b: readonly T[]): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min((row[j] as number) + 1, (next[j - 1] as number) + 1, (row[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length] as number
}

function score(out: string, truth: string[]): { cer: number; wer: number; lines: number } {
  const o = norm(out.split('\n'))
  const t = norm(truth)
  const cer = distance([...o], [...t]) / [...t].length
  const wer = distance(o.split(/\s+/), t.split(/\s+/)) / t.split(/\s+/).length
  const right = new Set(o.split('\n'))
  const lines = t.split('\n').filter(l => right.has(l)).length / t.split('\n').length
  return { cer, wer, lines }
}

// ---------------------------------------------------------------- run

async function main(): Promise<void> {
  fs.mkdirSync(SHOTS, { recursive: true })
  const cases: { name: string; file: string; dark: boolean; truth: string[] }[] = []
  for (const f of FIXTURES) cases.push({ name: f.name, file: await draw(f), dark: f.dark, truth: f.truth })
  const real = path.join(ROOT, 'real')
  if (fs.existsSync(real)) {
    for (const png of fs.readdirSync(real).filter(n => n.endsWith('.png'))) {
      const truth = fs.readFileSync(path.join(real, png.replace(/\.png$/, '.txt')), 'utf8').split(/\r?\n/)
      cases.push({ name: `real-${png.replace(/\.png$/, '')}`, file: path.join(real, png), dark: /dark/.test(png), truth })
    }
  }
  const results: Record<string, Record<string, { cer: number; wer: number; lines: number; seconds: number; text: string }>> = {}
  for (const c of cases) {
    results[c.name] = {}
    for (const [name, reader] of READERS) {
      // Once to load, then timed.
      if (c === cases[0]) await reader(c.file, c.dark)
      const started = performance.now()
      const text = screenText(await reader(c.file, c.dark))
      const seconds = (performance.now() - started) / 1000
      ;(results[c.name] as Record<string, unknown>)[name] = { ...score(text, c.truth), seconds, text }
      console.log(`${c.name.padEnd(22)} ${name.padEnd(26)} chars wrong ${(score(text, c.truth).cer * 100).toFixed(1).padStart(5)} %  words wrong ${(score(text, c.truth).wer * 100).toFixed(1).padStart(5)} %  lines right ${(score(text, c.truth).lines * 100).toFixed(0).padStart(3)} %  ${seconds.toFixed(2)} s`)
    }
  }
  fs.writeFileSync(path.join(ROOT, 'results.json'), JSON.stringify(results, null, 2))
}

// Each picture's window closes after it: that is no reason to quit.
app.on('window-all-closed', () => {})
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app
  .whenReady()
  .then(main)
  .catch(error => console.error(error))
  .finally(() => app.quit())
