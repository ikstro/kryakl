// The Screenshots window, in the main process: one window in the taskbar that
// holds the screenshots sent to it from the frame (media/shots.html,
// webview/shots.ts, the drawing of webview/shot.ts), while Kryakl runs. Each
// keeps its picture as taken and what is drawn on it, so a drawing stays a
// drawing; nothing goes to the disk unless the person saves, copies several or
// drags them out (then a file in Kryakl's temporary folder, kept until the quit,
// as what was copied as files may be pasted after the window is closed).

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { BrowserWindow, dialog, nativeImage, screen, type Rectangle, type WebContents } from 'electron'

import { t } from './i18n'
import type { ShotsAction, ShotsItem, ToHost, ToView } from './protocol'
import type { Box, Shape, ShotStyle, Tool } from './shotmodel'
import { clampBox, shotFileName } from './shotmodel'
import type { KeptShot } from './shotwindow'
import { handleOf } from './winclip'
import { showMinimized } from './winkbd'

/** More than this many is no longer a handful to pick from; the oldest one already saved or copied makes room. */
export const MOST_SHOTS = 50
const SIZE = { width: 1120, height: 740 }
const MIN = { width: 720, height: 480 }
/** A thumbnail's width in the picture's pixels: sharp at twice its place in the list. */
const THUMB = 320
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

type Item = {
  id: number
  at: Date
  /** The picture as taken (the pointer in it when that was on), its pixels and the screen's pixels in one CSS pixel. */
  png: Buffer
  width: number
  height: number
  ink: number
  frame: Box
  shapes: Shape[]
  /** What it looks like now, cut to its frame, drawings in. */
  flat: Buffer
  thumb: string
  /** Saved, copied or dragged out since it last changed. */
  handled: boolean
  /** Its name, the same in a save and in the temporary folder. */
  name: string
}

export type ShotsEditorOptions = {
  page: string
  preload: string
  icon: string
  query: () => Record<string, string>
  background: () => string
  /** Windows 11 draws the edge: done again on a change of theme. */
  frame: (win: BrowserWindow) => void
  bounds: () => Rectangle | null
  saveBounds: (bounds: Rectangle) => void
  style: () => ShotStyle
  saveStyle: (style: ShotStyle) => void
  tool: () => Tool | ''
  saveTool: (tool: Tool) => void
  /** One picture on the clipboard, as the frame's Copy does. */
  copyImage: (png: Buffer) => Promise<void>
  /** Several, as files. */
  copyFiles: (files: string[]) => Promise<void>
  /** Into the screenshots' folder (asked the first time): false when the person said no to picking one. */
  save: (files: { name: string; png: Buffer }[], win: BrowserWindow) => Promise<boolean>
  /** Its text, in the Translate card. */
  text: (png: Buffer) => void
  badge: (text: string) => void
  /** How many it holds changed: the tray and the Screenshots page say so. */
  changed: () => void
  quitting: () => boolean
  log: (win: BrowserWindow) => void
  say: (line: string) => void
}

export class ShotsEditor {
  private items: Item[] = []
  private win: BrowserWindow | undefined
  private ready = false
  private nextId = 1
  /** The screenshot the page shows. */
  private open: number | undefined
  private readonly temp = path.join(os.tmpdir(), 'Kryakl', 'shots')

  constructor(private readonly o: ShotsEditorOptions) {
    // What an earlier run left there.
    fs.rmSync(this.temp, { recursive: true, force: true })
  }

  get count(): number {
    return this.items.length
  }

  /** Screenshots neither saved, copied nor dragged out since they changed. */
  get unhandled(): number {
    return this.items.filter(item => !item.handled).length
  }

  /** From the frame: the newest at the top, the window in the taskbar, blinking, unless it is in front already. */
  add(shot: KeptShot): void {
    const image = nativeImage.createFromBuffer(shot.png)
    const { width, height } = image.getSize()
    if (!width || !height) return
    if (this.items.length >= MOST_SHOTS) {
      let oldest = this.items.length - 1
      while (oldest >= 0 && !(this.items[oldest] as Item).handled) oldest--
      if (oldest < 0) {
        this.o.badge(t('shots.full', { n: MOST_SHOTS }))
        return
      }
      this.items.splice(oldest, 1)
    }
    const at = new Date()
    const item: Item = {
      id: this.nextId++,
      at,
      png: shot.png,
      width,
      height,
      ink: shot.ink,
      frame: { x: 0, y: 0, width, height },
      shapes: shot.shapes,
      // Nothing drawn: the picture as it is, held once.
      flat: shot.shapes.length ? shot.flat : shot.png,
      thumb: thumbOf(shot.flat),
      handled: false,
      name: this.nameFor(at),
    }
    this.items.unshift(item)
    this.open = item.id
    this.o.say(`shots: one added, ${this.items.length} held`)
    const win = this.window()
    if (this.ready) {
      this.sendList()
      this.sendPicture(item.id)
    }
    if (!win.isVisible() && !showMinimized(handleOf(win))) win.minimize()
    if (!win.isFocused()) win.flashFrame(true)
    this.o.badge(t('shots.added', { n: this.items.length }))
    this.o.changed()
  }

  /** From the tray or the Screenshots page: the window in front. */
  show(): void {
    const win = this.window()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  /** The window's close, and Kryakl's quit: one question when anything would be lost; true when it may go. */
  async mayClose(quitting: boolean): Promise<boolean> {
    const lost = this.unhandled
    if (lost === 0) return true
    // A question on a window down in the taskbar would not be seen.
    const parent = this.win && !this.win.isDestroyed() && this.win.isVisible() && !this.win.isMinimized() ? this.win : undefined
    const question = {
      type: 'question' as const,
      buttons: [t(quitting ? 'shots.askQuit' : 'shots.askClose'), t('shots.askCancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: t('shots.title'),
      message: t('shots.askLost', { n: lost }),
      detail: t('shots.askDetail'),
    }
    const { response } = parent ? await dialog.showMessageBox(parent, question) : await dialog.showMessageBox(question)
    return response === 0
  }

  /** Everything goes from memory, and the window with it; files copied from it stay until the quit. */
  clear(): void {
    this.items = []
    this.open = undefined
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.o.changed()
  }

  /** Kryakl quits: the temporary files go. */
  dispose(): void {
    fs.rmSync(this.temp, { recursive: true, force: true })
  }

  /** The interface's language or the theme changed. */
  languageChanged(): void {
    if (!this.win || this.win.isDestroyed()) return
    this.ready = false
    void this.win.loadFile(this.o.page, { query: this.o.query() })
  }

  repaint(): void {
    if (!this.win || this.win.isDestroyed()) return
    this.win.setBackgroundColor(this.o.background())
    this.o.frame(this.win)
  }

  /** The page's messages; only the Screenshots page sends them (bridge.ts). */
  onMessage(message: ToHost, sender: WebContents): void {
    if (!this.win || this.win.isDestroyed() || sender !== this.win.webContents) return
    switch (message.type) {
      case 'shotsReady':
        this.ready = true
        this.sendList()
        if (this.open === undefined || !this.find(this.open)) this.open = this.items[0]?.id
        if (this.open !== undefined) this.sendPicture(this.open)
        return
      case 'shotsWant':
        if (!this.find(message.id)) return
        this.open = message.id
        this.sendPicture(message.id)
        return
      case 'shotsEdit':
        this.edited(message)
        return
      case 'shotsAction':
        void this.act(message.action, this.pick(message.ids))
        return
      case 'shotsDrag':
        this.drag(this.pick(message.ids), sender)
        return
      case 'shotsWindow':
        if (message.command === 'minimize') this.win.minimize()
        else if (message.command === 'maximize') this.win.isMaximized() ? this.win.unmaximize() : this.win.maximize()
        else this.win.close()
        return
      case 'shotStyle':
        this.o.saveStyle(message.style)
        return
      case 'shotTool':
        this.o.saveTool(message.tool)
        return
      default:
    }
  }

  private find(id: number): Item | undefined {
    return this.items.find(item => item.id === id)
  }

  /** The ids the page named, as screenshots still here, in the list's order. */
  private pick(ids: unknown): Item[] {
    if (!Array.isArray(ids)) return []
    const wanted = new Set(ids.filter(Number.isInteger))
    return this.items.filter(item => wanted.has(item.id))
  }

  private edited(message: Extract<ToHost, { type: 'shotsEdit' }>): void {
    const item = this.find(message.id)
    if (!item || !Array.isArray(message.shapes)) return
    const box = message.frame as Box | undefined
    if (![box?.x, box?.y, box?.width, box?.height].every(Number.isFinite)) return
    const flat = Buffer.from(new Uint8Array(message.flat))
    if (!PNG.every((byte, i) => flat[i] === byte)) return
    const frame = clampBox(message.frame, { x: 0, y: 0, width: item.width, height: item.height })
    if (frame.width < 1 || frame.height < 1) return
    item.frame = frame
    item.shapes = message.shapes
    item.flat = message.shapes.length || frame.width !== item.width || frame.height !== item.height ? flat : item.png
    item.thumb = thumbOf(flat)
    item.handled = false
    this.sendList()
  }

  private async act(action: ShotsAction, chosen: Item[]): Promise<void> {
    if (!chosen.length || !this.win || this.win.isDestroyed()) return
    try {
      if (action === 'delete') {
        const gone = new Set(chosen.map(item => item.id))
        this.items = this.items.filter(item => !gone.has(item.id))
        if (this.open !== undefined && gone.has(this.open)) this.open = this.items[0]?.id
        this.sendList()
        if (this.open !== undefined) this.sendPicture(this.open)
        this.o.changed()
        return
      }
      if (action === 'text') {
        this.o.text((chosen[0] as Item).flat)
        return
      }
      if (action === 'copy') {
        if (chosen.length === 1) await this.o.copyImage((chosen[0] as Item).flat)
        else await this.o.copyFiles(chosen.map(item => this.written(item)))
        this.o.badge(chosen.length === 1 ? t('shot.copied') : t('shots.copiedMany', { n: chosen.length }))
      } else {
        if (!(await this.o.save(chosen.map(item => ({ name: item.name, png: item.flat })), this.win))) return
        this.o.badge(chosen.length === 1 ? t('shot.saved') : t('shots.savedMany', { n: chosen.length }))
      }
      for (const item of chosen) item.handled = true
      this.sendList()
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error)
      this.o.say(`shots: ${action} failed: ${(error as NodeJS.ErrnoException).code ?? why}`)
      this.o.badge(t(action === 'copy' ? 'shot.copyFailed' : 'shot.saveFailed', { why }))
    }
  }

  /** Out of the window into a chat or a folder: Windows drags files, so each becomes one for the while. */
  private drag(chosen: Item[], sender: WebContents): void {
    if (!chosen.length) return
    try {
      const files = chosen.map(item => this.written(item))
      const icon = nativeImage.createFromBuffer((chosen[0] as Item).flat).resize({ width: 96, quality: 'good' })
      sender.startDrag({ file: files[0] as string, files, icon })
      for (const item of chosen) item.handled = true
      this.sendList()
    } catch (error) {
      this.o.say(`shots: could not drag: ${(error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))}`)
    }
  }

  private fileOf(item: Item): string {
    return path.join(this.temp, item.name)
  }

  /** Its file in the temporary folder, as it looks now. */
  private written(item: Item): string {
    const file = this.fileOf(item)
    fs.mkdirSync(this.temp, { recursive: true })
    fs.writeFileSync(file, item.flat)
    return file
  }

  /** A name no other screenshot here has: two taken in the same second get (2), (3). */
  private nameFor(at: Date): string {
    const names = new Set(this.items.map(item => item.name))
    let n = 1
    while (names.has(shotFileName(at, n))) n++
    return shotFileName(at, n)
  }

  private send(message: ToView): void {
    if (this.win && this.ready && !this.win.isDestroyed()) this.win.webContents.send('to-view', message)
  }

  private sendList(): void {
    const items: ShotsItem[] = this.items.map(item => ({ id: item.id, width: item.frame.width, height: item.frame.height, at: item.at.getTime(), handled: item.handled, thumb: item.thumb }))
    this.send({ type: 'shotsList', items, maximized: !!this.win?.isMaximized() })
  }

  private sendPicture(id: number): void {
    const item = this.find(id)
    if (!item) return
    this.send({ type: 'shotsPicture', id, png: new Uint8Array(item.png), ink: item.ink, frame: item.frame, shapes: item.shapes, style: this.o.style(), tool: this.o.tool() })
  }

  private window(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      ...this.place(),
      minWidth: MIN.width,
      minHeight: MIN.height,
      show: false,
      // The page draws its own bar; the edges still resize, and a double click on the bar maximizes.
      frame: false,
      resizable: true,
      maximizable: true,
      fullscreenable: false,
      title: t('shots.title'),
      icon: this.o.icon,
      backgroundColor: this.o.background(),
      webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
    })
    this.o.frame(win)
    win.removeMenu()
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    this.o.log(win)
    const keep = () => {
      if (!win.isDestroyed() && !win.isMinimized() && !win.isMaximized()) this.o.saveBounds(win.getBounds())
    }
    win.on('moved', keep)
    win.on('resized', keep)
    win.on('maximize', () => this.sendList())
    win.on('unmaximize', () => this.sendList())
    win.on('focus', () => win.flashFrame(false))
    // Closed, everything goes from memory, after one question when something would be lost.
    win.on('close', event => {
      if (this.o.quitting()) return
      event.preventDefault()
      void this.mayClose(false).then(go => {
        if (go) this.clear()
      })
    })
    win.on('closed', () => {
      if (this.win === win) {
        this.win = undefined
        this.ready = false
      }
    })
    this.win = win
    this.ready = false
    void win.loadFile(this.o.page, { query: this.o.query() })
    return win
  }

  /** Where it was left, while that is still on a screen; else in the middle of the pointer's screen. */
  private place(): Rectangle {
    const kept = this.o.bounds()
    if (kept) {
      const area = screen.getDisplayMatching(kept).workArea
      const seen = Math.min(kept.x + kept.width, area.x + area.width) - Math.max(kept.x, area.x) >= 160 && Math.min(kept.y + kept.height, area.y + area.height) - Math.max(kept.y, area.y) >= 80
      if (seen) return kept
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const width = Math.min(SIZE.width, area.width)
    const height = Math.min(SIZE.height, area.height)
    return { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height }
  }
}

function thumbOf(png: Buffer): string {
  const image = nativeImage.createFromBuffer(png)
  const { width } = image.getSize()
  return (width > THUMB ? image.resize({ width: THUMB, quality: 'good' }) : image).toDataURL()
}
