// A recording of the screen, in the main process: the strip (media/record.html,
// webview/record.ts) that holds the recorder and its buttons, the thin edge round
// a recorded piece, and the file. Neither window shows in the video (Windows
// leaves them out of every capture). The page never learns a path or picks a
// source: main names what is recorded and where it goes, and writes what the page
// hands over as it comes, so a crash keeps what was recorded.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { isAnyArrayBuffer } from 'node:util/types'

import { BrowserWindow, desktopCapturer, powerMonitor, powerSaveBlocker, screen, shell, type Display, type WebContents } from 'electron'

import { frameWindow } from './dwm'
import { t } from './i18n'
import type { RecordAction, ToHost, ToView } from './protocol'
import { evenBox, type VideoEffects, type VideoSound } from './recordmodel'
import { barPlace, inBox, shotFileName, type Box } from './shotmodel'
import { handleOf } from './winclip'
import { mouseWatch, windowFrame } from './wincursor'
import { focusWindow, foreground, putOnTop, windowRect } from './winkbd'

const COUNTDOWN_S = 3
const STRIP_GAP = 8
const STRIP_START = { width: 360, height: 42 }
/** The largest a page may ask its strip to be, either way. */
const MOST_STRIP = 1200
/** The red line round a recorded piece, just outside it. */
const EDGE = 2
const GB = 1024 * 1024 * 1024
/** Less than this to start with is a recording that would soon stop. */
const START_FREE = GB
/** Below this a recording stops by itself, and the person's disk keeps some room. */
const MIN_FREE = 0.3 * GB
const FREE_EVERY_MS = 5000
/** As often as the video's frames: only while something uses the pointer. */
const CURSOR_EVERY_MS = 33
const TOP_EVERY_MS = 2000
/** The page was asked to end and has not answered: what reached the file is the recording. */
const END_WAIT_MS = 8000
const QUIT_WAIT_MS = 5000

export type RecordRequest = {
  display: Display
  /** In this monitor's own pixels. */
  frame: Box
  /** The window recorded, or a piece of the monitor (the whole of it when the frame is). */
  window?: bigint
  sound: VideoSound
}

export type RecordOptions = {
  page: string
  edge: string
  preload: string
  query: () => Record<string, string>
  folder: () => string
  /** What the next recording adds to its picture; undefined for a plain recording. */
  effects: () => VideoEffects | undefined
  background: () => string
  border: () => string
  /** What the tray and the keyboard follow changed: `active`, `rolling`. */
  changed: () => void
  copy: (file: string) => Promise<void>
  /** A word by the cursor. */
  badge: (text: string) => void
  log: (win: BrowserWindow) => void
  say: (line: string) => void
}

type State = 'idle' | 'starting' | 'rolling' | 'ending' | 'done'

async function freeBytes(folder: string): Promise<number> {
  const stats = await fs.promises.statfs(folder)
  return stats.bavail * stats.bsize
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
/** For the log, which goes into a report: a file error's code, as its message names the person's folder. */
const logged = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code ?? messageOf(error)

export class ScreenRecorder {
  private state: State = 'idle'
  private strip: BrowserWindow | undefined
  private edge: BrowserWindow | undefined
  private request: RecordRequest | undefined
  private begin: Extract<ToView, { type: 'recordBegin' }> | undefined
  private ready = false
  private shown = false
  private size = STRIP_START
  private moved = false
  private file: string | undefined
  private out: fs.WriteStream | undefined
  private nextSeq = 0
  private bytes = 0
  private rollingAt = 0
  private note: string | undefined
  private blocker: number | undefined
  private freeTimer: NodeJS.Timeout | undefined
  private topTimer: NodeJS.Timeout | undefined
  private cursorTimer: NodeJS.Timeout | undefined
  private endTimer: NodeJS.Timeout | undefined
  private byClick = false
  private keyboardFrom = 0n
  private quitDone: (() => void) | undefined

  constructor(private readonly o: RecordOptions) {
    // A piece of a monitor, or all of it: the picture's place on that monitor means nothing once the monitor has changed.
    screen.on('display-removed', (_event, display) => this.monitorChanged(display.id))
    screen.on('display-metrics-changed', (_event, display, changed) => {
      if (changed.some(metric => metric !== 'workArea')) this.monitorChanged(display.id)
    })
    powerMonitor.on('suspend', () => this.halt(t('record.slept')))
    powerMonitor.on('lock-screen', () => this.send({ type: 'recordHold', on: true }))
    powerMonitor.on('unlock-screen', () => this.send({ type: 'recordHold', on: false }))
  }

  /** Being set up, recording, or being written out. */
  get active(): boolean {
    return this.state === 'starting' || this.state === 'rolling' || this.state === 'ending'
  }

  /** The red dot's: the picture is going into the file. */
  get rolling(): boolean {
    return this.state === 'rolling'
  }

  async start(request: RecordRequest): Promise<void> {
    if (this.active) return
    this.closeStrip()
    this.state = 'starting'
    this.request = request
    this.note = undefined
    this.byClick = false
    this.nextSeq = 0
    this.bytes = 0
    this.file = undefined
    this.o.changed()
    try {
      const folder = this.o.folder()
      await fs.promises.mkdir(folder, { recursive: true })
      if ((await freeBytes(folder)) < START_FREE) throw new Error(t('record.noSpace'))
      const source = await this.sourceOf(request)
      // The key may have called it off during those looks.
      if (this.called(request)) return
      const effects = this.o.effects()
      this.begin = { type: 'recordBegin', ...source, sound: request.sound, countdown: COUNTDOWN_S, ...(effects ? { effects } : {}) }
      this.strip = this.makeStrip()
      this.edge = this.makeEdge(request)
      this.blocker = powerSaveBlocker.start('prevent-display-sleep')
      this.freeTimer = setInterval(() => void this.watchDisk(folder), FREE_EVERY_MS)
      this.topTimer = setInterval(() => this.keepOnTop(), TOP_EVERY_MS)
    } catch (error) {
      if (this.called(request)) return
      this.o.say(`record: could not start: ${logged(error)}`)
      this.o.badge(messageOf(error))
      this.closeStrip()
    }
  }

  private called(request: RecordRequest): boolean {
    return this.state !== 'starting' || this.request !== request
  }

  /** The key: ends what is recording (a countdown is called off). */
  stopByKey(): void {
    if (this.state === 'starting') void this.act('cancel')
    else this.halt()
  }

  /** The zoom key, while recording: in at the pointer, or out. */
  zoomKey(): void {
    if (this.state === 'rolling') this.send({ type: 'recordZoomKey' })
  }

  /** The page ends the recording and hands over what is left; `why` when it is not the person's doing. */
  private halt(why?: string): void {
    if (this.state !== 'starting' && this.state !== 'rolling') return
    this.note ??= why
    this.send({ type: 'recordHalt', ...(why ? { why } : {}) })
    clearTimeout(this.endTimer)
    this.endTimer = setTimeout(() => void this.ended((Date.now() - this.rollingAt) / 1000, t('record.died')), END_WAIT_MS)
  }

  /** Quitting: what is being recorded is finished first, for a few seconds at most. */
  finishForQuit(): Promise<void> {
    if (!this.active) return Promise.resolve()
    this.halt(t('record.quit'))
    return new Promise(resolve => {
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      // Not answered in time: what reached the file stays, and nothing may hold the quit back.
      const timer = setTimeout(() => {
        this.closeStrip()
        done()
      }, QUIT_WAIT_MS)
      this.quitDone = done
    })
  }

  /** The page's messages; only a recording's page sends them (bridge.ts). */
  onMessage(message: ToHost, sender: WebContents): void {
    if (!this.strip || this.strip.isDestroyed() || this.strip.webContents !== sender) return
    switch (message.type) {
      case 'recordReady':
        this.ready = true
        if (this.begin) this.send(this.begin)
        return
      case 'recordSize':
        if (!Number.isFinite(message.width) || !Number.isFinite(message.height)) return
        this.size = { width: Math.min(MOST_STRIP, Math.max(1, Math.ceil(message.width))), height: Math.min(MOST_STRIP, Math.max(1, Math.ceil(message.height))) }
        this.place()
        return
      case 'recordRolling':
        if (this.state !== 'starting') return
        this.state = 'rolling'
        this.rollingAt = Date.now()
        this.watchCursor()
        this.o.changed()
        this.o.say(`record: rolling, ${this.request?.window !== undefined ? 'a window' : 'a part of the screen'}, mic ${this.request?.sound.mic ? 'on' : 'off'}, system ${this.request?.sound.system ? 'on' : 'off'}`)
        return
      case 'recordChunk':
        this.write(message)
        return
      case 'recordEnded':
        void this.ended(message.seconds, message.trouble)
        return
      case 'recordAct':
        void this.act(message.action)
        return
      default:
    }
  }

  private write(message: Extract<ToHost, { type: 'recordChunk' }>): void {
    if (this.state !== 'rolling' && this.state !== 'ending') return
    // A piece that comes while the file is being closed must not start a second one.
    if (!this.out && this.file) return
    if (!isAnyArrayBuffer(message.data) && !ArrayBuffer.isView(message.data)) return
    if (message.seq !== this.nextSeq) {
      this.o.say(`record: a piece out of order (${message.seq}, ${this.nextSeq} expected)`)
      return
    }
    this.nextSeq++
    // The page says which kind of file it makes, and nothing else about it.
    if (!this.out) this.open(message.extension === 'webm' ? 'webm' : 'mp4')
    const data = Buffer.from(message.data)
    this.bytes += data.length
    this.out?.write(data)
  }

  /** The file is made by the first bytes: only then is it known what they are. */
  private open(extension: 'mp4' | 'webm'): void {
    const folder = this.o.folder()
    const now = new Date()
    let n = 1
    while (fs.existsSync(path.join(folder, shotFileName(now, n, extension)))) n++
    this.file = path.join(folder, shotFileName(now, n, extension))
    this.out = fs.createWriteStream(this.file, { flags: 'wx' })
    this.out.on('error', error => {
      this.o.say(`record: could not write: ${logged(error)}`)
      this.halt(t('record.writeFailed'))
    })
  }

  private closeFile(): Promise<void> {
    const out = this.out
    this.out = undefined
    if (!out || out.destroyed) return Promise.resolve()
    return new Promise(resolve => out.end(() => resolve()))
  }

  private async ended(seconds: number, trouble?: string): Promise<void> {
    if (!this.active) return
    this.state = 'ending'
    clearTimeout(this.endTimer)
    this.stopWatching()
    const note = trouble ?? this.note
    await this.closeFile()
    this.edge?.destroy()
    this.edge = undefined
    const bytes = this.file ? await fs.promises.stat(this.file).then(s => s.size, () => 0) : 0
    if (!this.file || bytes === 0) {
      if (this.file) await fs.promises.rm(this.file, { force: true }).catch(() => undefined)
      this.o.say(`record: nothing was written${note ? ` (${note})` : ''}`)
      this.o.badge(note ?? t('record.nothing'))
      this.closeStrip()
      this.finishQuit()
      return
    }
    this.state = 'done'
    this.o.changed()
    this.o.say(`record: done, ${Math.round(seconds)} s, ${(bytes / 1048576).toFixed(1)} MB${note ? `, stopped: ${note}` : ''}`)
    const keyboard = this.takeKeyboard()
    this.send({ type: 'recordDone', seconds, bytes, name: path.basename(this.file), keyboard, ...(note ? { note } : {}) })
    this.finishQuit()
  }

  private finishQuit(): void {
    this.quitDone?.()
    this.quitDone = undefined
  }

  /** After a click on Stop the keyboard comes to the strip, for its Ctrl+C and Esc; after the key it stays in the person's program. */
  private takeKeyboard(): boolean {
    if (!this.byClick || !this.strip || this.strip.isDestroyed()) return false
    this.keyboardFrom = foreground().hwnd
    this.strip.setFocusable(true)
    this.strip.show()
    this.strip.focus()
    return true
  }

  private async act(action: RecordAction): Promise<void> {
    if (action === 'stop') {
      this.byClick = true
      this.halt()
      return
    }
    if (action === 'cancel') {
      if (!this.active) return
      this.stopWatching()
      await this.closeFile()
      if (this.file) await fs.promises.rm(this.file, { force: true }).catch(error => this.o.say(`record: could not delete: ${logged(error)}`))
      this.o.say('record: called off')
      this.closeStrip()
      this.finishQuit()
      return
    }
    if (action === 'dismiss') return this.closeStrip()
    const file = this.file
    if (this.state !== 'done' || !file) return
    try {
      if (action === 'open') {
        const refused = await shell.openPath(file)
        if (refused) throw new Error(refused)
      } else if (action === 'folder') shell.showItemInFolder(file)
      else if (action === 'copy') {
        await this.o.copy(file)
        this.closeStrip()
        this.o.badge(t('record.copied'))
      } else if (action === 'delete') {
        await fs.promises.rm(file, { force: true })
        this.closeStrip()
      }
    } catch (error) {
      this.o.say(`record: ${action} failed: ${logged(error)}`)
      this.o.badge(messageOf(error))
    }
  }

  private async sourceOf(request: RecordRequest): Promise<Pick<Extract<ToView, { type: 'recordBegin' }>, 'source' | 'size' | 'crop'>> {
    if (request.window !== undefined) return { source: `window:${request.window}:0` }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    const found = sources.find(s => s.display_id === String(request.display.id))
    // Never the wrong monitor: with no exact match there is nothing to record.
    if (!found) throw new Error(t('record.noScreen'))
    const { width, height } = screen.dipToScreenRect(null, request.display.bounds)
    const whole = request.frame.x === 0 && request.frame.y === 0 && request.frame.width === width && request.frame.height === height
    return { source: found.id, size: { width, height }, ...(whole && width % 2 === 0 && height % 2 === 0 ? {} : { crop: evenBox(request.frame) }) }
  }

  private makeStrip(): BrowserWindow {
    this.ready = false
    this.shown = false
    this.moved = false
    this.size = STRIP_START
    const win = new BrowserWindow({
      ...STRIP_START,
      show: false,
      frame: false,
      thickFrame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      alwaysOnTop: true,
      backgroundColor: this.o.background(),
      webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
    })
    // Before it is ever shown: no frame of the video may hold it.
    win.setContentProtection(true)
    frameWindow(win, { corner: 'round', border: this.o.border() })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.removeMenu()
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    win.webContents.on('render-process-gone', () => {
      if (this.state === 'done') return this.closeStrip()
      // The page held the strip's buttons and its timer, so the strip goes, and the badge says what became of the file.
      void this.ended((Date.now() - this.rollingAt) / 1000, t('record.died')).then(() => {
        if (this.state !== 'done') return
        this.closeStrip()
        this.o.badge(t('record.died'))
      })
    })
    win.on('moved', () => (this.moved = true))
    win.on('close', event => {
      if (this.active) event.preventDefault()
    })
    this.o.log(win)
    void win.loadFile(this.o.page, { query: this.o.query() })
    return win
  }

  /** The strip goes under what is recorded, as the bar did; moved by the person, it stays where it was put. */
  private place(): void {
    const { strip, request } = this
    if (!strip || strip.isDestroyed() || !request) return
    if (this.moved) {
      const was = strip.getBounds()
      strip.setBounds({ x: Math.round(was.x + was.width / 2 - this.size.width / 2), y: was.y + was.height - this.size.height, ...this.size })
    } else {
      const { display } = request
      const scale = screen.dipToScreenRect(null, display.bounds).width / display.bounds.width
      const css = { x: request.frame.x / scale, y: request.frame.y / scale, width: request.frame.width / scale, height: request.frame.height / scale }
      const spot = barPlace(css, display.bounds, this.size, STRIP_GAP)
      const bounds = { x: display.bounds.x + spot.x, y: display.bounds.y + spot.y, ...this.size }
      // Twice: a window moved onto a monitor of another scaling takes its size in the old one's first.
      strip.setBounds(bounds)
      strip.setBounds(bounds)
    }
    if (!this.shown) {
      this.shown = true
      strip.showInactive()
      this.keepOnTop()
    }
  }

  private keepOnTop(): void {
    for (const win of [this.strip, this.edge]) if (win && !win.isDestroyed()) putOnTop(handleOf(win))
  }

  /** A thin line just outside a recorded piece; a window moves by itself, and a monitor needs none, and a window as large as the monitor would make the taskbar step aside. */
  private makeEdge(request: RecordRequest): BrowserWindow | undefined {
    if (request.window !== undefined) return undefined
    const { display, frame } = request
    const scale = screen.dipToScreenRect(null, display.bounds).width / display.bounds.width
    const x = Math.floor(frame.x / scale) - EDGE
    const y = Math.floor(frame.y / scale) - EDGE
    const width = Math.ceil(frame.width / scale) + EDGE * 2
    const height = Math.ceil(frame.height / scale) + EDGE * 2
    if (x <= 0 && y <= 0 && x + width >= display.bounds.width && y + height >= display.bounds.height) return undefined
    const win = new BrowserWindow({
      x: display.bounds.x + x,
      y: display.bounds.y + y,
      width,
      height,
      show: false,
      frame: false,
      thickFrame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    win.setContentProtection(true)
    win.setIgnoreMouseEvents(true)
    win.setAlwaysOnTop(true, 'screen-saver')
    win.removeMenu()
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.showInactive()
    })
    void win.loadFile(this.o.edge)
    return win
  }

  private send(message: ToView): void {
    if (this.strip && !this.strip.isDestroyed() && this.ready) this.strip.webContents.send('to-view', message)
  }

  /** Where the pointer is against what is recorded: the page draws with it, and a click there counts; the strip's own buttons do not. */
  private watchCursor(): void {
    const { request, begin } = this
    if (!request || !begin?.effects) return
    const look = mouseWatch()
    const monitor = screen.dipToScreenRect(null, request.display.bounds)
    const { crop } = begin
    const piece = crop ? { x: monitor.x + crop.x, y: monitor.y + crop.y, width: crop.width, height: crop.height } : monitor
    this.cursorTimer = setInterval(() => {
      const mouse = look()
      const area = request.window !== undefined ? windowFrame(request.window) : piece
      if (!area) return
      const inside = inBox(area, mouse)
      const counts = inside && (mouse.left || mouse.right) && !this.overStrip(mouse)
      this.send({ type: 'recordCursor', x: mouse.x - area.x, y: mouse.y - area.y, width: area.width, height: area.height, inside, left: counts && mouse.left, right: counts && mouse.right })
    }, CURSOR_EVERY_MS)
  }

  private overStrip(p: { x: number; y: number }): boolean {
    const box = this.strip && !this.strip.isDestroyed() ? windowRect(handleOf(this.strip)) : undefined
    return !!box && inBox(box, p)
  }

  private async watchDisk(folder: string): Promise<void> {
    if (this.state !== 'rolling') return
    const free = await freeBytes(folder).catch(() => Infinity)
    if (free < MIN_FREE) this.halt(t('record.diskFull'))
  }

  private monitorChanged(id: number): void {
    if (this.request?.window === undefined && this.request?.display.id === id) this.halt(t('record.monitorChanged'))
  }

  private stopWatching(): void {
    clearInterval(this.freeTimer)
    clearInterval(this.topTimer)
    clearInterval(this.cursorTimer)
    if (this.blocker !== undefined) powerSaveBlocker.stop(this.blocker)
    this.blocker = undefined
  }

  /** Everything goes back: the keyboard first, while Kryakl is still in front, as Windows requires. */
  private closeStrip(): void {
    clearTimeout(this.endTimer)
    this.stopWatching()
    void this.closeFile()
    if (this.keyboardFrom) focusWindow(this.keyboardFrom)
    this.keyboardFrom = 0n
    for (const win of [this.strip, this.edge]) if (win && !win.isDestroyed()) win.destroy()
    this.strip = undefined
    this.edge = undefined
    this.begin = undefined
    const was = this.state
    this.state = 'idle'
    if (was !== 'idle') this.o.changed()
  }
}
