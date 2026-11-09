// `npm run shots`: Kryakl's pages in offscreen windows with the real preload, fed view.ts's
// fixtures, pictured into .cache/shots/ (every page and second-level page in both themes, the
// tray panel, the dictation badge with a fake microphone). It never touches the desktop or
// the installed Kryakl, so it runs while that one runs.
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { UiLanguage } from '../../src/i18n'
import { englishHtml, textOutHtml, translationHtml } from '../../src/render'
import { splitText, translateLines, translatePairs, type Translate } from '../../src/translate'
import { wordDiff } from '../../src/worddiff'
import { appView, CAFE, menuView, talkWindowView, trayView } from './view'

import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '..', '..').replace(/\\/g, '/')
// SHOTS_LANG=uk or ru: every page in that interface language (i18n), into .cache/shots/<lang>/.
const LANG = process.env.SHOTS_LANG ?? ''
const OUT = `${ROOT}/.cache/shots${LANG ? `/${LANG}` : ''}`
mkdirSync(OUT, { recursive: true })
app.setPath('userData', `${ROOT}/.cache/shots-userdata`)
app.on('window-all-closed', () => {})

app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const log: string[] = []

function win(page: string, width: number, height: number, bg: string, query?: Record<string, string>): BrowserWindow {
  const w = new BrowserWindow({
    show: false,
    width,
    height,
    frame: false,
    backgroundColor: bg,
    webPreferences: { preload: `${ROOT}/dist/preload.js`, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false },
  })
  w.webContents.setFrameRate(30)
  const asked = { ...query, ...(LANG ? { lang: LANG } : {}) }
  void w.loadFile(`${ROOT}/media/${page}`, Object.keys(asked).length ? { query: asked } : undefined)
  return w
}

const send = (w: BrowserWindow, message: unknown) => w.webContents.send('to-view', message)
async function shot(w: BrowserWindow, name: string): Promise<void> {
  // An offscreen window resized just now may have no frame yet (UnknownVizError): a moment later it has.
  let image: Electron.NativeImage | undefined
  for (let attempt = 1; !image; attempt++) {
    try {
      image = await w.webContents.capturePage()
    } catch (error) {
      if (attempt >= 4) throw error
      w.webContents.invalidate()
      await sleep(400 * attempt)
    }
  }
  writeFileSync(`${OUT}/${name}.png`, image.toPNG())
  log.push(`${name} ${image.getSize().width}x${image.getSize().height}`)
}
const js = (w: BrowserWindow, code: string) => w.webContents.executeJavaScript(code, true)
const click = (w: BrowserWindow, selector: string) => js(w, `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return 'missing ' + ${JSON.stringify(selector)}; n.click(); return 'ok' })()`)
const esc = (w: BrowserWindow) => js(w, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 'ok'`)
/** Focuses a field as if the window were in front: an offscreen window is never active, and :focus waits for that. */
async function focus(w: BrowserWindow, selector: string): Promise<string> {
  if (!w.webContents.debugger.isAttached()) w.webContents.debugger.attach('1.3')
  await w.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true })
  return js(w, `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return 'missing ' + ${JSON.stringify(selector)}; n.focus(); return 'ok' })()`)
}

const colors = () => (nativeTheme.shouldUseDarkColors ? { bg: '#202020', surface: '#2b2b2b' } : { bg: '#f3f3f3', surface: '#fbfbfb' })

// The pages' answers from "main": copies, Chrome, the speech engine's streaming session.
/** Seconds of sound the engine has yet to recognize, as its answer to each chunk says (the amber dot past 4). */
let pending = 0
let heard = 'Привет, это проверка диктовки: бейдж показывает фразу целиком, пока её слышит движок'
ipcMain.handle('host-call', async (_e, r: { call: string; method?: string; route?: string }) => {
  log.push(`host-call ${JSON.stringify(r).slice(0, 120)}`)
  if (r.call === 'speech') {
    if (r.method === 'PUT') return { ok: true, status: 200, data: { pending, heard } }
    if (r.route?.endsWith('/finish')) return { ok: true, status: 200, data: { text: heard, language: 'ru', sure: true } }
    return { ok: true, status: 200, data: {} }
  }
  if (r.call === 'copy') return true
  if (r.call === 'openChrome') return true
  return null
})

const heights = new Map<number, number>()
ipcMain.on('to-host', (e, m: { type: string; px?: number }) => {
  log.push(`to-host ${e.sender.id} ${JSON.stringify(m).slice(0, 160)}`)
  if ((m.type === 'dictationHeight' || m.type === 'trayHeight' || m.type === 'menuHeight' || m.type === 'height') && m.px) heights.set(e.sender.id, m.px)
})

// ---------------------------------------------------------------- the card

/** A translator of a few fixed sentences, both ways, for the card's fixtures. */
const PHRASES: [string, string][] = [
  ['The weather was gloomy, so we lingered at the harbour.', 'Погода была пасмурной, поэтому мы задержались в гавани.'],
  ['Boats drifted past the lighthouse.', 'Лодки проплывали мимо маяка.'],
  ['Tomorrow we sail north.', 'Завтра мы отплываем на север.'],
]
const fake: Translate = async (sentences, from) =>
  sentences.map(s => PHRASES.find(([en, ru]) => (from === 'en' ? en : ru) === s)?.[from === 'en' ? 1 : 0] ?? s)
const CONFIG = { voice: '', rate: 1, wordHint: 'shift', rareWords: true, oneAtATime: false }
const GLOSS = { word: 'harbour', base: 'harbour', entries: [{ form: 'harbour', senses: [['noun', 'гавань, порт'], ['verb', 'укрывать, давать приют']]}] }

/** Clicks the middle of `word` in the element `selector`, as the person would (the word card, a sentence's pair). */
const clickWord = (w: BrowserWindow, selector: string, word: string) =>
  js(
    w,
    `(() => {
      const root = document.querySelector(${JSON.stringify(selector)}); if (!root) return 'missing'
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.data.indexOf(${JSON.stringify(word)}); if (i < 0) continue
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${word.length})
        const b = r.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2
        document.elementFromPoint(x, y).dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }))
        return 'ok'
      }
      return 'no word'
    })()`,
  )

async function cardShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const w = win('card.html', 440, 400, colors().surface)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(300)
  send(w, { type: 'common', words: readFileSync(`${ROOT}/media/common-en.txt`, 'utf8').split(/\r?\n/).filter(Boolean) })
  const fit = async () => {
    // Until the height stops changing: a card still being drawn says 46 px.
    let h: number | undefined
    for (let tries = 0; tries < 8; tries++) {
      await sleep(350)
      const now = heights.get(w.webContents.id)
      if (now && now === h) break
      h = now
    }
    if (h) w.setSize(440, Math.min(700, h))
    await sleep(350)
  }
  const card = (id: number, kind: string, state: unknown, level = 'fast') =>
    send(w, { type: 'card', card: { id, kind, state, target: 'English', native: 'Russian', level, autoRead: false, via: kind === 'selection' ? 'Control+C*2' : 'RightControl*2' }, config: CONFIG, pinned: false, maximized: false })

  // Listen: the English on top with Copy and the remote, the translation with its Copy.
  const english = `${PHRASES[0]![0]} ${PHRASES[1]![0]}\n\n${PHRASES[2]![0]}`
  const lines = await translateLines(splitText(english, 'Russian'), 'Russian', fake)
  card(1, 'selection', { status: 'done', html: englishHtml(lines), translation: { status: 'ready', html: translationHtml(lines) } })
  await fit()
  await shot(w, `card-${theme}-listen`)
  log.push(`listen word: ${await clickWord(w, '.body', 'harbour')}`)
  send(w, { type: 'gloss', ...GLOSS, gloss: GLOSS, saved: false })
  await sleep(300)
  await shot(w, `card-${theme}-listen-word`)

  // Translate, Russian into English: the English half is the translation, its words dotted and clickable.
  const translate = async (id: number, text: string, from: string, to: string) => {
    const pairs = await translatePairs(text, from, to, fake)
    const result = { status: 'ready', text: pairs.map(l => l.pairs.map(p => p.out).join(' ')).join('\n'), from, to, html: textOutHtml(pairs), sentences: pairs.flatMap(l => l.pairs.map(p => p.src)) }
    card(id, 'translate', { status: 'text', text, from, to, languages: ['en', 'ru', 'uk', 'de'], mine: ['ru', 'en'], result, canPaste: true })
    await fit()
  }
  await translate(2, `${PHRASES[0]![1]} ${PHRASES[1]![1]}`, 'ru', 'en')
  await shot(w, `card-${theme}-translate-ru-en`)
  log.push(`ru-en word: ${await clickWord(w, '.text-out', 'harbour')}`)
  send(w, { type: 'gloss', ...GLOSS, gloss: GLOSS, saved: true })
  await sleep(300)
  await shot(w, `card-${theme}-translate-ru-en-word`)

  // English into Russian: the field is the English half; a click in it marks the sentence's pair and opens the word.
  await translate(3, `${PHRASES[0]![0]}\n${PHRASES[1]![0]}`, 'en', 'ru')
  await shot(w, `card-${theme}-translate-en-ru`)
  log.push(`en-ru word: ${await clickWord(w, '.text-field', 'lighthouse')}`)
  send(w, { type: 'gloss', word: 'lighthouse', gloss: { word: 'lighthouse', base: 'lighthouse', entries: [{ form: 'lighthouse', senses: [['noun', 'маяк']] }] }, saved: false })
  await sleep(300)
  await shot(w, `card-${theme}-translate-en-ru-word`)

  // Typed into: the marks go at once; the new text's translation brings them back, the new words dotted too.
  log.push(`type: ${await focus(w, '.text-field')}`)
  await js(w, `(() => { const f = document.querySelector('.text-field'); const s = getSelection(); s.selectAllChildren(f); s.collapseToEnd(); document.execCommand('insertText', false, ' Tomorrow we sail north.'); return 'ok' })()`)
  await sleep(200)
  await shot(w, `card-${theme}-translate-typing`)
  await sleep(900)
  const typed = String(await js(w, `document.querySelector('.text-field').textContent`))
  const pairs = await translatePairs(typed, 'en', 'ru', fake)
  const result = { status: 'ready', text: pairs.map(l => l.pairs.map(p => p.out).join(' ')).join('\n'), from: 'en', to: 'ru', html: textOutHtml(pairs), sentences: pairs.flatMap(l => l.pairs.map(p => p.src)) }
  card(3, 'translate', { status: 'text', text: '', from: 'en', to: 'ru', languages: ['en', 'ru', 'uk', 'de'], mine: ['ru', 'en'], result, canPaste: true })
  await fit()
  log.push(`typed pair: ${await clickWord(w, '.text-field', 'sail')}`)
  await sleep(300)
  await shot(w, `card-${theme}-translate-typed`)

  // Accurate picked: its model downloading the first time, then the translation said to be its.
  const chest = 'Кнопки сундука и молнии поменять местами.'
  const level = (id: number, result: unknown) =>
    card(id, 'translate', { status: 'text', text: chest, from: 'ru', to: 'en', languages: ['en', 'ru', 'uk', 'de'], mine: ['ru', 'en'], result, canPaste: true }, 'accurate')
  level(4, { status: 'downloading', language: 'ru', progress: 0.42, size: 5155 })
  await fit()
  await shot(w, `card-${theme}-accurate-downloading`)
  level(5, { status: 'ready', text: 'Swap the chest and lightning buttons.', from: 'ru', to: 'en', html: textOutHtml([{ prefix: '', pairs: [{ src: chest, out: 'Swap the chest and lightning buttons.' }] }]), sentences: [chest] })
  await fit()
  await shot(w, `card-${theme}-accurate-done`)

  // Accurate after Fast's draft (2026-10-31): the draft at once, the model's sentences swept in one by one (sweep.ts), frames of the sweep.
  const built = 'Сборка опять упала. Кнопки сундука и молнии поменять местами. Завтра проверю на ноутбуке.'
  const srcs = ['Сборка опять упала.', chest, 'Завтра проверю на ноутбуке.']
  const drafts = ['The assembly fell again.', 'The chest buttons and lightning change places.', 'Tomorrow I will check on a laptop.']
  const finals = ['The build failed again.', 'Swap the chest and lightning buttons.', 'I’ll check it on the laptop tomorrow.']
  const improving = (done: number) => {
    const pairs = [{ prefix: '', pairs: srcs.map((src, i) => (i < done ? { src, out: finals[i]! } : { src, out: drafts[i]!, draft: true })) }]
    const result = { status: 'ready', text: pairs[0]!.pairs.map(p => p.out).join(' '), from: 'ru', to: 'en', html: textOutHtml(pairs), sentences: srcs, drafts: srcs.length - done }
    card(7, 'translate', { status: 'text', text: built, from: 'ru', to: 'en', languages: ['en', 'ru', 'uk', 'de'], mine: ['ru', 'en'], result, canPaste: true }, 'accurate')
  }
  improving(0)
  await fit()
  await shot(w, `card-${theme}-draft`)
  improving(1)
  const began = Date.now()
  for (const at of [40, 120, 200, 300, 450, 700]) {
    await sleep(Math.max(0, at - (Date.now() - began)))
    await shot(w, `sweep-${theme}-${String(Date.now() - began).padStart(4, '0')}ms`)
  }
  improving(3)
  await sleep(1200)
  await fit()
  await shot(w, `card-${theme}-draft-done`)
  // Listen: the English read at once, the translation under it a draft.
  const listenLines = await translateLines(splitText(english, 'Russian'), 'Russian', fake)
  listenLines.forEach(l => l.pairs.forEach((p, i) => i % 2 === 0 && (p.draft = true)))
  card(8, 'selection', { status: 'done', html: englishHtml(listenLines), translation: { status: 'ready', html: translationHtml(listenLines), drafts: 2 } }, 'accurate')
  await fit()
  await shot(w, `card-${theme}-listen-draft`)

  // The model too slow just now (another program on the card): Fast's translation stands, the card says so and offers the model.
  const busyPairs = [{ prefix: '', pairs: srcs.map((src, i) => ({ src, out: drafts[i]! })) }]
  const busyResult = { status: 'ready', text: drafts.join(' '), from: 'ru', to: 'en', html: textOutHtml(busyPairs), sentences: srcs, busy: 'card' }
  card(9, 'translate', { status: 'text', text: built, from: 'ru', to: 'en', languages: ['en', 'ru', 'uk', 'de'], mine: ['ru', 'en'], result: busyResult, canPaste: true }, 'accurate')
  await fit()
  await shot(w, `card-${theme}-busy`)
  const listenFast = await translateLines(splitText(english, 'Russian'), 'Russian', fake)
  card(10, 'selection', { status: 'done', html: englishHtml(listenFast), translation: { status: 'ready', html: translationHtml(listenFast), busy: 'processor' } }, 'accurate')
  await fit()
  await shot(w, `card-${theme}-listen-busy`)

  // Check my English: the owner's sentence checked, its mistakes marked and the main one said in Russian; then a right one.
  const mine = 'I want to learn English and can we made tutor option? I dictate or tupe in English and you show my my mistake.'
  const right = 'I want to learn English, and can we make a tutor option? I dictate or type in English and you show me my mistakes.'
  const check = (id: number, text: string, result: unknown) => card(id, 'check', { status: 'check', text, result, model: 'Accurate', canPaste: true })
  check(6, mine, { status: 'downloading', progress: 0.3, size: 5155 })
  await fit()
  await shot(w, `card-${theme}-check-downloading`)
  check(7, mine, { status: 'ready', text: mine, corrected: right, parts: wordDiff(mine, right), note: 'made → make: после can глагол стоит в начальной форме.' })
  await fit()
  await shot(w, `card-${theme}-check`)
  check(8, 'I agree with you.', { status: 'ready', text: 'I agree with you.', corrected: 'I agree with you.', parts: wordDiff('I agree with you.', 'I agree with you.'), note: '' })
  await fit()
  await shot(w, `card-${theme}-check-clean`)
  check(9, '', { status: 'none' })
  await fit()
  await shot(w, `card-${theme}-check-empty`)
  w.destroy()
}

async function appShots(theme: 'dark' | 'light', narrow = false): Promise<void> {
  nativeTheme.themeSource = theme
  // The usual window, and a narrow one where the sidebar keeps only its icons.
  const size = narrow ? [640, 620] : [960, 700]
  const w = win('app.html', size[0]!, size[1]!, colors().bg)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(400)
  const v = appView()
  send(w, { type: 'app', view: v })
  send(w, { type: 'appWindow', maximized: false })
  await sleep(700)
  const tag = (n: string) => `app-${theme}${narrow ? '-narrow' : ''}-${n}`
  await shot(w, tag('home'))
  // A place from the sidebar, then each second-level page of it (Esc goes back).
  const page = async (name: string, subs: string[] = [], label = name) => {
    log.push(`${label}: ${await click(w, `.side [data-nav="${name}"]`)}`)
    await sleep(500)
    await shot(w, tag(label))
    for (const sub of subs) {
      log.push(`${label}/${sub}: ${await click(w, `[data-sub="${sub}"]`)}`)
      await sleep(500)
      await shot(w, tag(`${label}-${sub}`))
      await esc(w)
      await sleep(400)
    }
  }
  const home = async () => (await click(w, '.side [data-nav="home"]'), sleep(400))
  // A list page with its field focused: the focus ring, and the field beside its button.
  const focused = async (parent: string, name: string) => {
    await page(parent)
    log.push(`${name}: ${await click(w, `[data-sub="${name}"]`)}`)
    await sleep(500)
    log.push(`${name} focus: ${await focus(w, '.pbody .field')}`)
    await sleep(300)
    await shot(w, tag(`${name}-focus`))
    await js(w, `document.activeElement?.blur(), 'ok'`)
  }
  if (narrow) {
    await page('layout', ['fixing'])
    await page('settings')
    await page('models')
  } else if (theme === 'dark') {
    // Each action with its lists and its second-level pages, reached as a person reaches them.
    await page('translate', ['translations', 'card', 'screen'])
    await page('english', ['words', 'mistakes', 'aboutYou', 'talkWindow'])
    await page('voice', ['vocabulary', 'phrases', 'notes', 'edit'])
    // Text editing on, with the person's own instruction.
    await click(w, '[data-sub="edit"]')
    send(w, { type: 'app', view: appView({ dictateEdit: true, dictateEditStyle: 'own', dictateEditOwn: 'Пиши короче, без вводных слов.' }) })
    await sleep(500)
    await shot(w, tag('voice-edit-own'))
    send(w, { type: 'app', view: v })
    await esc(w)
    await sleep(400)
    await page('recordings', ['transcripts', 'meet', 'speakers'])
    await page('shots')
    await page('layout', ['kept', 'learned', 'programs', 'layouts', 'fixing'])
    await page('settings', ['languages'])
    // The page's end: Backup and Reset.
    await click(w, '.side [data-nav="settings"]')
    await sleep(400)
    await js(w, `document.querySelector('.pbody')?.scrollTo(0, 1e6)`)
    await sleep(200)
    await shot(w, tag('settings-end'))
    // Models: this computer and the actions, each action's choice; Use recommended's changes shown before Apply.
    await page('models', ['forTranslate', 'forCheck', 'forDictate', 'forTranscribe', 'forVoice'])
    log.push(`recommend: ${await click(w, '.pbody .row .btn.primary')}`)
    await sleep(300)
    await shot(w, tag('models-recommend'))
    await page('storage')
    await js(w, `document.querySelector('.pbody')?.scrollTo(0, 1e6)`)
    await sleep(200)
    await shot(w, tag('storage-end'))
    for (const name of ['about', 'report']) await page(name)
    await focused('layout', 'kept')
    // The search, and a find opened with its line lit.
    log.push(`search: ${await js(w, `(() => { const f = document.querySelector('.find input'); f.value = 'caps'; f.dispatchEvent(new Event('input')); return 'ok' })()`)}`)
    await sleep(500)
    await shot(w, tag('search'))
    log.push(`search find: ${await click(w, '.row.found')}`)
    await sleep(300)
    await shot(w, tag('search-found'))
    await home()
    // Paused: the notice on Home.
    send(w, { type: 'app', view: appView({ paused: true }) })
    await sleep(500)
    await shot(w, tag('home-paused'))
    // Chrome holds an older copy of the extension than Kryakl's folder.
    const stale = appView()
    stale.speech = { ...stale.speech, extensionShipped: '0.2.1' }
    send(w, { type: 'app', view: stale })
    await sleep(300)
    await page('recordings', ['meet'], 'recordings-stale')
    // Who spoke when installed on the card; then the processor picked, so it offers to switch.
    const card = appView()
    card.speech = { ...card.speech, pack: { status: 'ready', parts: ['core', 'gpu', 'speakers'], nvidia: true, speakersOn: 'cuda' }, health: { ...card.speech.health!, diarization: 'ready', parts: { core: true, gpu: true, speakers: true } } }
    send(w, { type: 'app', view: card })
    await sleep(300)
    await home()
    await page('recordings', ['speakers'], 'tr-installed')
    const cpu = appView({ speakersDevice: 'cpu' })
    cpu.speech = { ...card.speech, speakers: { ...card.speech.speakers, on: 'cpu' } }
    send(w, { type: 'app', view: cpu })
    await sleep(300)
    await home()
    await page('recordings', ['speakers'], 'tr-switch')
  } else {
    await page('english')
    await page('recordings', ['meet'])
    await page('layout', ['fixing'])
    await focused('layout', 'kept')
    await page('settings')
    await page('models', ['forTranslate', 'forDictate'])
    await page('translate')
    await page('storage')
    await page('about')
  }
  if (!narrow) {
    // A move from the old Altype folder that could not finish: two parts used from there, and why.
    const left = appView()
    const old = 'C:\\Users\\you\\AppData\\Local\\Altype'
    left.storage = {
      ...left.storage!,
      parts: left.storage!.parts.map(p =>
        p.id === 'speech' ? { ...p, path: `${old}\\speech`, away: true } : p.id === 'accurate' ? { ...p, path: `${old}\\translate\\models\\5f1e2a3b-gemma-4-E4B-it-qat-q4_0.gguf`, away: true } : p,
      ),
      old: { dir: old, why: 'a file in it is in use by python.exe', moving: false },
    }
    send(w, { type: 'app', view: left })
    await sleep(300)
    await home()
    await page('storage', [], 'storage-old')
    send(w, { type: 'app', view: { ...left, storage: { ...left.storage, old: { dir: old, moving: true } } } })
    await sleep(300)
    await shot(w, tag('storage-moving'))
  }
  w.destroy()
}

/** The first-run setup: its four steps, Next pressed between them; Download starts nothing here (the host-call answers are stubs). */
async function setupShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const w = win('app.html', 960, 700, colors().bg)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(400)
  send(w, { type: 'app', view: appView({}, true) })
  await sleep(600)
  for (let step = 1; step <= 4; step++) {
    await shot(w, `setup-${theme}-${step}`)
    if (step === 1) {
      log.push(`setup list: ${await click(w, '.sel')}`)
      await sleep(250)
      await shot(w, `setup-${theme}-1-list`)
      await click(w, '.sel')
      await sleep(150)
    }
    if (step === 3) {
      await js(w, `document.querySelector('.sbody').scrollTop = 640, 'ok'`)
      await sleep(200)
      await shot(w, `setup-${theme}-3-speakers`)
      await js(w, `document.querySelector('.sbody').scrollTop = 1e5, 'ok'`)
      await sleep(200)
      await shot(w, `setup-${theme}-3-bottom`)
    }
    if (step < 4) {
      log.push(`setup next ${step}: ${await click(w, '.sfoot .btn.primary')}`)
      await sleep(500)
    }
  }
  // A snapshot while the downloads go: the engine installing, the voice half way.
  const v = appView({}, true)
  v.natural = { status: 'downloading', progress: 0.42, size: 170, dismissed: false }
  v.translatorState = { status: 'ready', progress: 1, size: 84 }
  v.speech = { ...v.speech, pack: { status: 'installing', parts: [], installing: ['core', 'gpu'], step: 'packages', progress: 0.3, nvidia: true } }
  send(w, { type: 'app', view: v })
  await sleep(500)
  await shot(w, `setup-${theme}-4-going`)
  w.destroy()
}

async function trayShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const w = win('tray.html', 360, 620, colors().bg)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(300)
  const fit = async () => {
    await sleep(400)
    const h = heights.get(w.webContents.id)
    if (h) w.setSize(360, h)
    await sleep(300)
  }
  for (const [name, view] of [
    ['ready', trayView()],
    ['paused', trayView({ paused: true })],
  ] as const) {
    send(w, { type: 'tray', view })
    send(w, { type: 'trayShown' })
    await fit()
    await shot(w, `tray-${theme}-${name}`)
  }
  // "Keep a word as typed…" opened into its field, the last fixed word in it; Enter; then with none.
  send(w, { type: 'tray', view: trayView() })
  await sleep(300)
  log.push(`tray keep: ${await click(w, '[data-id="keepWord"]')}`)
  log.push(`tray keep focus: ${await focus(w, '.keep-field')}`)
  await fit()
  await shot(w, `tray-${theme}-keep`)
  log.push(`tray keep enter: ${await js(w, `(() => { const f = document.querySelector('.keep-field'); if (!f) return 'missing'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'ok' })()`)}`)
  await sleep(300)
  await shot(w, `tray-${theme}-kept`)
  await sleep(1700)
  send(w, { type: 'tray', view: trayView({ keep: { on: true, word: '', fixed: '' } }) })
  await sleep(300)
  log.push(`tray keep empty: ${await click(w, '[data-id="keepWord"]')}`)
  log.push(`tray keep empty focus: ${await focus(w, '.keep-field')}`)
  await fit()
  await shot(w, `tray-${theme}-keep-empty`)
  w.destroy()
}

// ---------------------------------------------------------------- the menu on one key

async function menuShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const lang = (LANG || 'en') as UiLanguage
  const w = win('menu.html', 300, 420, colors().surface)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(300)
  for (const [name, view] of [
    ['ready', menuView(lang)],
    ['lit', menuView(lang, { lit: 3 })],
    ['picked', menuView(lang, { lit: 1, fired: 1 })],
    ['no-speech', menuView(lang, { speech: false })],
  ] as const) {
    send(w, { type: 'menu', view })
    await sleep(300)
    const h = heights.get(w.webContents.id)
    if (h) w.setSize(300, h)
    await sleep(300)
    await shot(w, `menu-${theme}-${name}`)
  }
  w.destroy()
}

// ---------------------------------------------------------------- a screenshot

/** A made-up desktop in physical pixels: a light window with lines of "text" on a slate ground. */
function fakeScreen(width: number, height: number, unit: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  const paint = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
    for (let py = y; py < Math.min(height, y + h); py++) {
      for (let px = x; px < Math.min(width, x + w); px++) {
        const at = (py * width + px) * 4
        rgba[at] = r
        rgba[at + 1] = g
        rgba[at + 2] = b
        rgba[at + 3] = 255
      }
    }
  }
  paint(0, 0, width, height, 70, 86, 110)
  paint(180 * unit, 90 * unit, 900 * unit, 540 * unit, 248, 248, 248)
  paint(180 * unit, 90 * unit, 900 * unit, 40 * unit, 224, 224, 224)
  for (let line = 0; line < 14; line++) paint(220 * unit, (160 + line * 30) * unit, (520 + (line * 73) % 280) * unit, 10 * unit, 60, 60, 60)
  return rgba
}

async function shotShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  // 1 and 2: a screen at 100 % and one at 200 %, the same 1280×720 CSS pixels.
  for (const unit of [1, 2]) {
    const w = win('shot.html', 1280, 720, '#000000')
    await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
    await sleep(300)
    const tag = (n: string) => `shot-${theme}-${unit}x-${n}`
    const mouse = (type: string, x: number, y: number) =>
      js(w, `(document.elementFromPoint(${x}, ${y}) ?? window).dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { clientX: ${x}, clientY: ${y}, button: 0, bubbles: true })), 'ok'`)
    const dragIt = async (x1: number, y1: number, x2: number, y2: number) => {
      await mouse('mousedown', x1, y1)
      await mouse('mousemove', (x1 + x2) / 2, (y1 + y2) / 2)
      await mouse('mousemove', x2, y2)
      await mouse('mouseup', x2, y2)
      await sleep(120)
    }
    const key = (code: string, ctrl = false) => js(w, `window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, key: ${JSON.stringify(code)}, ctrlKey: ${ctrl}, bubbles: true })), 'ok'`)
    const frame = (video = false, quick = false, tool = '') => {
      const rgba = fakeScreen(1280 * unit, 720 * unit, unit)
      w.webContents.send('to-view', { type: 'shotFrame', width: 1280 * unit, height: 720 * unit, cssWidth: 1280, rgba, windows: [{ x: 200 * unit, y: 140 * unit, width: 420 * unit, height: 470 * unit, panel: true }, { x: 640 * unit, y: 140 * unit, width: 420 * unit, height: 470 * unit, panel: true }, { x: 180 * unit, y: 90 * unit, width: 900 * unit, height: 540 * unit }], style: { color: '#e5383b', size: 1, dashed: false }, tool, video, quick, sound: { mic: false, system: true, micName: '' }, effects: { clicks: true, zoom: false, halo: false, zoomScale: 2 } })
    }
    frame()
    await sleep(500)
    // Nothing framed yet: the hint, and the window under the pointer lit.
    await shot(w, tag('hint'))
    await mouse('mousemove', 500, 300)
    await sleep(150)
    await shot(w, tag('panel'))
    await js(w, `document.querySelector('#screen').dispatchEvent(new WheelEvent('wheel', { clientX: 500, clientY: 300, deltaY: -100, bubbles: true })), 'ok'`)
    await sleep(150)
    await shot(w, tag('window'))
    // A frame; the bar under it, then every tool used once.
    await dragIt(300, 130, 980, 480)
    await sleep(200)
    await shot(w, tag('frame'))
    await key('KeyR')
    await dragIt(330, 170, 520, 260)
    await key('KeyA')
    await dragIt(700, 180, 560, 225)
    await key('KeyL')
    await click(w, '.row.opts .b:last-child')
    await sleep(60)
    await dragIt(330, 300, 620, 300)
    await click(w, '.row.opts .b:last-child')
    await sleep(60)
    await key('KeyE')
    await dragIt(660, 280, 800, 360)
    await key('KeyH')
    await dragIt(330, 335, 640, 335)
    await key('KeyF')
    await mouse('mousedown', 820, 180)
    for (const [x, y] of [[840, 170], [860, 200], [880, 170], [900, 210], [930, 180]] as const) await mouse('mousemove', x, y)
    await mouse('mouseup', 930, 180)
    await key('KeyB')
    await dragIt(340, 380, 520, 440)
    await key('KeyP')
    await dragIt(560, 380, 740, 440)
    await key('KeyN')
    for (const [x, y] of [[800, 400], [860, 400], [920, 400]] as const) {
      await mouse('mousedown', x, y)
      await mouse('mouseup', x, y)
      await sleep(40)
    }
    await key('KeyT')
    // A real click, not a made-up event: its default action is what could take the keyboard from the field.
    if (!w.webContents.debugger.isAttached()) w.webContents.debugger.attach('1.3')
    for (const type of ['mousePressed', 'mouseReleased']) await w.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: 780, y: 300, button: 'left', buttons: 1, clickCount: 1 })
    await sleep(100)
    console.log('the label field has the keyboard:', await js(w, `document.activeElement?.id === 'write'`))
    await js(w, `(() => { const f = document.querySelector('#write'); f.value = 'Подпись\\nв две строки'; f.dispatchEvent(new Event('input')); return 'ok' })()`)
    await sleep(150)
    await shot(w, tag('writing'))
    await key('Escape')
    await js(w, `(() => { const f = document.querySelector('#write'); return f.hidden })()`)
    await js(w, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })), 'ok'`)
    await sleep(200)
    await key('KeyT')
    await sleep(200)
    await shot(w, tag('tools'))
    // The bar above a frame that reaches the screen's bottom; inside a full-screen one.
    frame()
    await sleep(400)
    await dragIt(240, 300, 1100, 716)
    await sleep(200)
    await shot(w, tag('above'))
    await key('Space')
    await sleep(250)
    await key('KeyA')
    await sleep(250)
    await shot(w, tag('full'))
    // The Video side: its hint, a frame with the two sounds, both on, and a frame too small to record.
    frame(true)
    await sleep(400)
    await shot(w, tag('video-hint'))
    await dragIt(300, 130, 980, 480)
    await sleep(200)
    await shot(w, tag('video-frame'))
    await js(w, `navigator.mediaDevices.enumerateDevices = async () => [{ deviceId: 'default', kind: 'audioinput', label: 'Default - Microphone (Studio) (0c76:161e)' }, { deviceId: 'a', kind: 'audioinput', label: 'Microphone (Studio) (0c76:161e)' }, { deviceId: 'b', kind: 'audioinput', label: 'Headset Microphone (Wireless Headphones)' }], 'ok'`)
    await click(w, '.b.chev')
    await sleep(200)
    await shot(w, tag('video-mics'))
    await key('Escape')
    await sleep(120)
    await click(w, '.row .b.lab')
    await sleep(120)
    await shot(w, tag('video-both'))
    await dragIt(980, 480, 330, 150)
    await sleep(200)
    await shot(w, tag('video-small'))
    // The tool last used is in hand at once.
    frame(false, false, 'rect')
    await sleep(400)
    await dragIt(300, 130, 980, 480)
    await sleep(200)
    await shot(w, tag('last-tool'))
    // Only the text of a frame: no bar will come.
    frame(false, true)
    await sleep(400)
    await shot(w, tag('quick-hint'))
    w.webContents.send('to-view', { type: 'shotClear' })
    await sleep(100)
    log.push(`shot errors: ${await js(w, `document.querySelector('#screen').width`)}`)
    w.destroy()
  }
}

// ---------------------------------------------------------------- a recording's strip

async function recordShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const w = win('record.html', 420, 44, colors().surface)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(300)
  const tag = (n: string) => `record-${theme}-${n}`
  const fit = async () => {
    const box = (await w.webContents.executeJavaScript(`(() => { const r = document.getElementById('root').getBoundingClientRect(); return { w: Math.ceil(r.width) + 2, h: Math.ceil(r.height) + 2 } })()`)) as { w: number; h: number }
    w.setSize(box.w, box.h)
    await sleep(250)
  }
  send(w, { type: 'recordBegin', source: 'screen:0:0', size: { width: 1280, height: 720 }, sound: { mic: true, system: false, micName: '' }, countdown: 3 })
  await sleep(300)
  await fit()
  await shot(w, tag('count'))
  await sleep(3200)
  await fit()
  await shot(w, tag('rec'))
  await click(w, '.b:nth-last-child(2)')
  await sleep(150)
  await fit()
  await shot(w, tag('sure'))
  await sleep(3200)
  send(w, { type: 'recordHold', on: true })
  await sleep(300)
  await fit()
  await shot(w, tag('paused'))
  send(w, { type: 'recordDone', seconds: 42, bytes: 12.4 * 1048576, name: 'Kryakl.mp4', keyboard: true })
  await sleep(300)
  await fit()
  await shot(w, tag('done'))
  send(w, { type: 'recordDone', seconds: 754, bytes: 310 * 1048576, name: 'Kryakl.mp4', keyboard: false, note: 'The window was closed, so the recording stopped' })
  await sleep(300)
  await fit()
  await shot(w, tag('done-note'))
  w.destroy()
}

// ---------------------------------------------------------------- the talk window

async function talkShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  const w = win('talk.html', 440, 640, colors().bg)
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(300)
  send(w, { type: 'common', words: readFileSync(`${ROOT}/media/common-en.txt`, 'utf8').split(/\r?\n/).filter(Boolean) })
  const tag = (n: string) => `talk-${theme}-${n}`
  const view = async (over: Parameters<typeof talkWindowView>[0], name: string, wait = 400) => {
    send(w, { type: 'talkView', view: talkWindowView(over) })
    await sleep(wait)
    await shot(w, tag(name))
  }
  // The café talk, at its last line.
  await view({}, 'talk', 600)
  // The duck thinking of an answer, the line just said being checked.
  const asked: typeof CAFE = [...CAFE, { id: 8, who: 'me', text: 'Not really, it is my first time here.', checking: true }]
  await view({ talk: { status: 'thinking', topic: 'cafe', turns: asked } }, 'thinking')
  // Listening: the words heard so far in the dashed line, the wave.
  heard = 'I would like to try the cheesecake too, if you still have it'
  log.push(`talk mic: ${await click(w, '.mic')}`)
  await sleep(1800)
  await shot(w, tag('listening'))
  await esc(w)
  await sleep(300)
  // A long talk scrolled up: a new line shows the ↓.
  const long = [...CAFE, ...CAFE.map(t => ({ ...t, id: t.id + 7 })), ...CAFE.map(t => ({ ...t, id: t.id + 14 }))]
  await view({ talk: { status: 'idle', topic: 'cafe', turns: long } }, 'long')
  await js(w, `document.querySelector('.feed').scrollTo(0, 0), 'ok'`)
  await sleep(200)
  await view({ talk: { status: 'idle', topic: 'cafe', turns: [...long, { id: 22, who: 'duck', text: 'And one more thing: we close at nine tonight.' }] } }, 'scrolled')
  // A new talk: the topics; pinned on top.
  await view({ talk: { status: 'idle', topic: 'free', turns: [] }, onTop: true }, 'empty')
  // No speech engine yet: typing only.
  await view({ talk: { status: 'idle', topic: 'free', turns: [] }, engine: 'absent' }, 'no-engine')
  // A computer whose graphics card cannot hold the model: no talk offered.
  await view({ talk: { status: 'idle', topic: 'free', turns: [] }, needsCard: true }, 'needs-card')
  // The model on its way.
  await view({ talk: { status: 'idle', topic: 'free', turns: [] }, model: { name: 'Accurate', full: 'Gemma 4 E4B', status: 'downloading', progress: 0.37, size: 5155 } }, 'downloading')
  // The history over a narrow talk: the clock in the bar opens it; Esc closes it.
  await view({}, 'talk-again', 300)
  log.push(`talk history: ${await click(w, '.bar > .ib:first-child')}`)
  await sleep(300)
  log.push(`talk history open: ${await js(w, `document.querySelector('.talk').classList.contains('history-open')`)}`)
  await shot(w, tag('history'))
  // Clear all asks once more.
  log.push(`talk clear: ${await click(w, '.hclear')}`)
  await sleep(200)
  await shot(w, tag('history-sure'))
  await esc(w)
  await sleep(300)
  log.push(`talk history after esc: ${await js(w, `document.querySelector('.talk').classList.contains('history-open')`)}`)
  // A wide window: the history beside the talk; maximized: the talk in its column.
  w.setSize(980, 680)
  await sleep(500)
  await view({}, 'wide', 400)
  w.setSize(1400, 860)
  await sleep(500)
  await view({ maximized: true }, 'maximized', 400)
  log.push(`talk hide history: ${await click(w, '.bar > .ib:first-child')}`)
  await sleep(300)
  await shot(w, tag('maximized-alone'))
  // Back as it was for the next run: the history beside a wide talk.
  await click(w, '.bar > .ib:first-child')
  heard = 'Привет, это проверка диктовки: бейдж показывает фразу целиком, пока её слышит движок'
  w.destroy()
}

async function badgeShots(theme: 'dark' | 'light'): Promise<void> {
  nativeTheme.themeSource = theme
  // A slate desktop behind the see-through window: the pill's round corners show against it, with no square behind them.
  const w = win('dictation.html', 360, 64, '#5b6b80')
  await new Promise<void>(r => w.webContents.once('did-finish-load', () => r()))
  await sleep(300)
  const fit = async () => {
    const h = heights.get(w.webContents.id)
    if (h) w.setSize(360, Math.max(64, Math.min(180, h)))
    await sleep(250)
  }
  send(w, { type: 'dictation', command: 'start', mode: 'type', key: 'Control+Alt+D', session: 's1', expected: ['ru'] })
  await sleep(900)
  await fit()
  await shot(w, `badge-${theme}-listening`)
  // Half a second on: the dot blinks, so one of the two has it off.
  await sleep(500)
  await shot(w, `badge-${theme}-listening-blink`)
  await sleep(1700)
  await fit()
  await shot(w, `badge-${theme}-phrase`)
  // The engine behind the voice: the amber dot.
  pending = 6
  await sleep(700)
  await shot(w, `badge-${theme}-behind`)
  pending = 0
  send(w, { type: 'dictation', command: 'stop', mode: 'type', key: 'Control+Alt+D' })
  await sleep(250)
  await fit()
  await shot(w, `badge-${theme}-busy`)
  await sleep(1200)
  await fit()
  await shot(w, `badge-${theme}-done`)
  w.destroy()
}

app.whenReady().then(async () => {
  try {
    if (process.env.SHOTS !== 'shot') {
      await cardShots('dark')
      await cardShots('light')
    }
    // SHOTS=card: the card alone; SHOTS=tray: the tray panel; SHOTS=menu: the menu on one key; SHOTS=shot: a screenshot's page alone; SHOTS=daily: the card, the tray panel, the menu, the badge, the talk window and the setup.
    if (process.env.SHOTS === 'shot') {
      await shotShots('dark')
      await shotShots('light')
      await recordShots('dark')
      await recordShots('light')
    } else if (process.env.SHOTS === 'tray') {
      await trayShots('dark')
      await trayShots('light')
    } else if (process.env.SHOTS === 'menu') {
      await menuShots('dark')
      await menuShots('light')
    } else if (process.env.SHOTS === 'daily') {
      await setupShots('dark')
      await trayShots('dark')
      await trayShots('light')
      await menuShots('dark')
      await badgeShots('dark')
      await talkShots('dark')
      await talkShots('light')
    } else if (process.env.SHOTS !== 'card') {
      await shotShots('dark')
      await shotShots('light')
      await recordShots('dark')
      await recordShots('light')
      await appShots('dark')
      await appShots('light')
      await appShots('dark', true)
      await appShots('light', true)
      await setupShots('dark')
      await setupShots('light')
      await trayShots('dark')
      await trayShots('light')
      await menuShots('dark')
      await menuShots('light')
      await badgeShots('dark')
      await badgeShots('light')
      await talkShots('dark')
      await talkShots('light')
    }
  } catch (error) {
    log.push(`ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  }
  writeFileSync(`${OUT}/log.txt`, log.join('\n'))
  app.quit()
})
