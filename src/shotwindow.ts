// A screenshot, in the main process: one window over each monitor, showing that
// monitor as it was at the press (media/shot.html, webview/shot.ts), the frame
// and the tools drawn on it. Made at the first press, hidden between uses with
// no picture in them, and gone after five idle minutes or when the monitors
// change. What the finished picture becomes is main.ts's.

import { Worker } from 'node:worker_threads'

import { BrowserWindow, screen, type Display, type WebContents } from 'electron'

import type { ShotAction, ToHost, ToView } from './protocol'
import type { VideoEffects, VideoSound } from './recordmodel'
import { MIN_VIDEO_FRAME, videoSoundOf } from './recordmodel'
import type { RecordRequest } from './recordwindow'
import type { ShotWindow } from './shot-worker'
import type { Box, Shape, ShotStyle, ShotTarget, Tool } from './shotmodel'
import { clampBox, elementsOf, withoutWindows } from './shotmodel'
import type { ElementBox } from './uia'
import { captureScreens } from './winshot'
import { handleOf } from './winclip'
import { mayTakeKeyboard } from './wincursor'
import { focusWindow, foreground, putOnTop } from './winkbd'

/** Something of Kryakl's was put away: Windows needs this long to take it off the screen. */
const HIDDEN_MS = 60
/** A window that does not say it has drawn is shown anyway. */
const SHOW_WAIT_MS = 1500
const IDLE_MS = 5 * 60 * 1000
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** A frame for the Screenshots window: its picture as taken, the same with what is drawn, the drawings in its own pixels, and the screen's pixels in one CSS pixel. */
export type KeptShot = { png: Buffer; flat: Buffer; shapes: Shape[]; ink: number }

const isPng = (bytes: Buffer) => PNG.every((byte, i) => bytes[i] === byte)

/**
 * What is left to do once a picture is handed over: go (and then something), or stay on the screen, saying why.
 * `refocus: false`: the program in front before is not given the keyboard back as the frame goes, as a window of
 * Kryakl's (Save As) comes next; `after` gives it back once done.
 */
export type ShotOutcome = { close: true; after?: (giveBack: () => void) => void; refocus?: false } | { close: false; message?: string }

export type ShotOptions = {
  page: string
  preload: string
  worker: string
  /** The thread that asks a window for its parts (elements-worker.ts). */
  elements: string
  query: () => Record<string, string>
  style: () => ShotStyle
  saveStyle: (style: ShotStyle) => void
  tool: () => Tool | ''
  /** The shutter sounds as the frame is fixed and its bar appears. */
  shutter: () => boolean
  /** The pointer stays on the picture, as last chosen in the bar. */
  cursor: () => boolean
  saveCursor: (on: boolean) => void
  /** The frame goes into the Screenshots window: the overlay is gone by now. */
  keep: (shot: KeptShot) => void
  saveTool: (tool: Tool) => void
  /** What the bar's Video side records, as last chosen. */
  sound: () => VideoSound
  saveSound: (sound: VideoSound) => void
  effects: () => VideoEffects
  saveEffects: (effects: VideoEffects) => void
  /** The frame is to be recorded: the overlay is gone by now. */
  record: (request: RecordRequest) => void
  /** The keyboard thread keeps quiet, or no longer. */
  keys: (on: boolean) => void
  /** Puts away what would be in the picture and is not the person's (the card, the menu); true when something was on the screen. */
  putAway: () => boolean
  /** The screen is copied: what had to be in the picture and would cover the frame (the tray's panel) may go now. */
  captured: () => void
  done: (action: ShotAction, png: Buffer, win: BrowserWindow) => Promise<ShotOutcome>
  quitting: () => boolean
  log: (win: BrowserWindow) => void
  say: (line: string) => void
}

type Frame = Extract<ToView, { type: 'shotFrame' }>
/** `hwnds` beside the page's list of windows: the page only ever names a place in it. `size`: the monitor in its own pixels. */
type Pane = { display: Display; win: BrowserWindow; ready: boolean; shown: boolean; frame?: Frame; hwnds: string[]; size: Box; windows: ShotTarget[]; origin: { x: number; y: number } }
/** A question for the parts' thread: the pane and the window it is about. */
type Probe = { pane: Pane; window: number; hwnd: string; x: number; y: number }

export class ShotOverlay {
  private panes = new Map<number, Pane>()
  private state: 'idle' | 'opening' | 'open' = 'idle'
  private before = 0n
  private idle: NodeJS.Timeout | undefined
  private allShown: (() => void) | undefined
  private finishing = false
  /** The parts' thread, made at the first question; one question at a time, the latest waiting. */
  private elements: Worker | undefined
  private asking: Probe | undefined
  private next: Probe | undefined
  private asked = { count: 0, slowest: 0, most: 0 }

  constructor(private readonly o: ShotOptions) {
    screen.on('display-added', () => this.reset())
    screen.on('display-removed', () => this.reset())
    // Not for the work area alone: a window over the whole monitor makes the taskbar step aside, which would close it at once.
    screen.on('display-metrics-changed', (_event, _display, changed) => {
      if (changed.some(metric => metric !== 'workArea')) this.reset()
    })
  }

  /** Open or opening: a screenshot looks like a program on the full screen, and nothing should react to that. */
  get isOpen(): boolean {
    return this.state !== 'idle'
  }

  /**
   * `video`: on the bar's Video side from the start; `quick`: a frame for its text alone, read the moment it is drawn.
   * A screenshot asked for while the frame is open takes the frame itself, its bar and drawings, into a new one
   * over it (2026-11-11, the owner: a picture of Kryakl's own frame); the first goes, and the program in front before stays the one to return to.
   */
  async open(mode: 'shot' | 'video' | 'quick' = 'shot'): Promise<void> {
    const over = this.state === 'open' && mode === 'shot' && !this.finishing
    if (this.state !== 'idle' && !over) return
    this.state = 'opening'
    if (this.idle) clearTimeout(this.idle)
    if (over) {
      this.next = undefined
      this.allShown = undefined
    } else {
      this.o.keys(true)
      this.before = foreground().hwnd
    }
    const began = Date.now()
    try {
      if (!over && this.o.putAway()) await new Promise(resolve => setTimeout(resolve, HIDDEN_MS))
      const displays = screen.getAllDisplays()
      const rects = displays.map(display => ({ id: display.id, ...screen.dipToScreenRect(null, display.bounds) }))
      const shot = await captureScreens(this.o.worker, rects)
      this.o.captured()
      // The frame's own windows are in the picture, not windows to light: over every other one, they would take every click.
      if (over) shot.windows = withoutWindows(shot.windows, new Set([...this.panes.values()].filter(p => !p.win.isDestroyed()).map(p => String(handleOf(p.win)))))
      const took = Date.now() - began
      if ((this.state as string) === 'idle') return
      const panes = displays.map(display => this.pane(display))
      const shownOne = new Promise<void>(resolve => {
        this.allShown = resolve
      })
      const shutter = mode !== 'video' && this.o.shutter()
      for (const pane of panes) {
        const monitor = shot.monitors.find(m => m.id === pane.display.id)
        if (!monitor) throw new Error('a monitor was not captured')
        // Twice: a window moved onto a monitor of another scaling takes its size in the old one's first.
        pane.win.setBounds(pane.display.bounds)
        pane.win.setBounds(pane.display.bounds)
        // A frame taken over the last one keeps its windows on the screen: the new picture replaces the old in them, with no blink.
        if (!over || !pane.win.isVisible()) {
          pane.win.setOpacity(0)
          pane.win.showInactive()
        }
        pane.shown = false
        const { boxes, hwnds } = windowsOn(shot.windows, monitor)
        pane.hwnds = hwnds
        pane.windows = boxes
        pane.origin = { x: monitor.x, y: monitor.y }
        pane.size = { x: 0, y: 0, width: monitor.width, height: monitor.height }
        pane.frame = {
          type: 'shotFrame',
          width: monitor.width,
          height: monitor.height,
          cssWidth: pane.display.bounds.width,
          rgba: new Uint8Array(monitor.rgba),
          windows: boxes,
          style: this.o.style(),
          tool: this.o.tool(),
          video: mode === 'video',
          quick: mode === 'quick',
          sound: this.o.sound(),
          effects: this.o.effects(),
          // The page sounds it on the monitor where the frame is fixed.
          shutter,
          ...(monitor.cursor && mode === 'shot' ? { cursor: { ...monitor.cursor, rgba: new Uint8Array(monitor.cursor.rgba) } } : {}),
          cursorOn: this.o.cursor(),
        }
        this.sendFrame(pane)
      }
      await Promise.race([shownOne, new Promise(resolve => setTimeout(resolve, SHOW_WAIT_MS))])
      if ((this.state as string) === 'idle') return
      this.state = 'open'
      this.reveal(panes)
      this.o.say(`shot: ${over ? 'again over the frame' : 'open'}, ${panes.length} monitor(s), captured in ${took} ms, shown in ${Date.now() - began} ms`)
    } catch (error) {
      this.o.say(`shot: could not open: ${error instanceof Error ? error.message : String(error)}`)
      this.close()
    }
  }

  /** The frozen screen appears all at once, the keyboard on the monitor with the pointer. */
  private reveal(panes: Pane[]): void {
    for (const pane of panes) {
      pane.win.setOpacity(1)
      putOnTop(handleOf(pane.win))
    }
    const under = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const pane = this.panes.get(under.id) ?? panes[0]
    if (!pane) return
    // Print Screen comes through the keyboard thread: without this Esc, Space and the rest go to the program under the frame until the first click.
    mayTakeKeyboard()
    pane.win.show()
    pane.win.focus()
    if (foreground().hwnd !== handleOf(pane.win)) this.o.say('shot: the keyboard stayed with the program in front')
  }

  private sendFrame(pane: Pane): void {
    if (!pane.ready || !pane.frame || pane.win.isDestroyed()) return
    pane.win.webContents.send('to-view', pane.frame)
    pane.frame = undefined
  }

  /** The window in front before comes back while Kryakl is still in front, which Windows requires (unless a window of Kryakl's comes next, `refocus` false); the picture goes from the pages. */
  close(refocus = true): void {
    if (this.state === 'idle') return
    this.state = 'idle'
    this.finishing = false
    this.allShown = undefined
    this.next = undefined
    if (this.asked.count) this.o.say(`shot: parts asked ${this.asked.count} times, ${this.asked.slowest} ms at the slowest, ${this.asked.most} at most`)
    this.asked = { count: 0, slowest: 0, most: 0 }
    if (refocus && this.before) focusWindow(this.before)
    for (const pane of this.panes.values()) {
      if (pane.win.isDestroyed()) continue
      pane.frame = undefined
      pane.win.hide()
      pane.win.webContents.send('to-view', { type: 'shotClear' } satisfies ToView)
    }
    this.o.keys(false)
    this.idle = setTimeout(() => this.destroy(), IDLE_MS)
  }

  /** The page's messages; only a screenshot's page sends them (bridge.ts). */
  onMessage(message: ToHost, sender: WebContents): void {
    const pane = [...this.panes.values()].find(p => !p.win.isDestroyed() && p.win.webContents === sender)
    if (!pane) return
    switch (message.type) {
      case 'shotReady':
        pane.ready = true
        this.sendFrame(pane)
        return
      case 'shotShown':
        pane.shown = true
        if ([...this.panes.values()].every(p => p.shown)) this.allShown?.()
        return
      case 'shotBegan':
        for (const other of this.panes.values()) if (other !== pane && !other.win.isDestroyed()) other.win.webContents.send('to-view', { type: 'shotOther' } satisfies ToView)
        return
      case 'shotHover':
        // One monitor lights a window at a time (2026-11-10: the last one lit stayed on the monitor the pointer left).
        for (const other of this.panes.values()) if (other !== pane && !other.win.isDestroyed()) other.win.webContents.send('to-view', { type: 'shotAway' } satisfies ToView)
        return
      case 'shotCancel':
        this.close()
        return
      case 'shotStyle':
        this.o.saveStyle(message.style)
        return
      case 'shotEffects':
        this.o.saveEffects(message.effects)
        return
      case 'shotTool':
        this.o.saveTool(message.tool)
        return
      case 'shotSound':
        this.o.saveSound(message.sound)
        return
      case 'shotRecord':
        this.startRecording(message, pane)
        return
      case 'shotProbe':
        this.probe(message, pane)
        return
      case 'shotCursor':
        this.o.saveCursor(message.on === true)
        return
      case 'shotKeep': {
        if (this.state !== 'open' || this.finishing) return
        const png = Buffer.from(new Uint8Array(message.png))
        const flat = Buffer.from(new Uint8Array(message.flat))
        if (!isPng(png) || !isPng(flat) || !Array.isArray(message.shapes) || !(message.ink > 0)) return
        this.close()
        this.o.keep({ png, flat, shapes: message.shapes, ink: message.ink })
        return
      }
      case 'shotDone':
        void this.finish(message.action, Buffer.from(new Uint8Array(message.png)), pane)
        return
      default:
    }
  }

  /** A window with no child windows to list (Chrome, VS Code) is asked for the parts it names; its handle never leaves main. */
  private probe(message: Extract<ToHost, { type: 'shotProbe' }>, pane: Pane): void {
    if (this.state !== 'open' || this.finishing) return
    if (![message.window, message.x, message.y].every(Number.isInteger)) return
    const hwnd = pane.hwnds[message.window]
    if (!hwnd) return
    const ask = { pane, window: message.window, hwnd, x: message.x, y: message.y }
    if (this.asking) this.next = ask
    else this.ask(ask)
  }

  private ask(probe: Probe): void {
    if (!this.elements) {
      this.elements = new Worker(this.o.elements)
      this.elements.on('message', (reply: { boxes: ElementBox[]; ms: number }) => this.answered(reply))
      this.elements.on('error', error => {
        this.o.say(`shot: the parts' thread failed: ${error.message}`)
        this.elements = undefined
        this.asking = undefined
      })
    }
    this.asking = probe
    this.elements.postMessage({ id: 0, hwnd: probe.hwnd, x: probe.pane.origin.x + probe.x, y: probe.pane.origin.y + probe.y })
  }

  private answered(reply: { boxes: ElementBox[]; ms: number }): void {
    const probe = this.asking
    this.asking = undefined
    const next = this.next
    this.next = undefined
    if (next) this.ask(next)
    if (!probe || this.state !== 'open' || probe.pane.win.isDestroyed()) return
    const window = probe.pane.windows[probe.window]
    if (!window) return
    const { x, y } = probe.pane.origin
    const boxes = elementsOf(window, reply.boxes.map(b => ({ ...b, x: b.x - x, y: b.y - y })))
    this.asked = { count: this.asked.count + 1, slowest: Math.max(this.asked.slowest, reply.ms), most: Math.max(this.asked.most, boxes.length) }
    probe.pane.win.webContents.send('to-view', { type: 'shotElements', window: probe.window, boxes } satisfies ToView)
  }

  /** The frame becomes a recording: the frozen screen goes first, so that what is recorded is the live one. */
  private startRecording(message: Extract<ToHost, { type: 'shotRecord' }>, pane: Pane): void {
    if (this.state !== 'open' || this.finishing) return
    const box = message.frame as Box | undefined
    if (![box?.x, box?.y, box?.width, box?.height].every(Number.isFinite)) return
    const frame = clampBox(message.frame, pane.size)
    if (frame.width < MIN_VIDEO_FRAME || frame.height < MIN_VIDEO_FRAME) return
    if (message.window !== undefined && !Number.isInteger(message.window)) return
    const hwnd = message.window === undefined ? undefined : pane.hwnds[message.window]
    const { display } = pane
    this.close()
    this.o.record({ display, frame, sound: videoSoundOf(message.sound), ...(hwnd ? { window: BigInt(hwnd) } : {}) })
  }

  private async finish(action: ShotAction, png: Buffer, pane: Pane): Promise<void> {
    if (this.state !== 'open' || this.finishing) return
    this.finishing = true
    let outcome: ShotOutcome
    try {
      if (!isPng(png)) throw new Error('the page sent no picture')
      outcome = await this.o.done(action, png, pane.win)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.o.say(`shot: ${action} failed: ${message}`)
      outcome = { close: false, message }
    }
    this.finishing = false
    if (outcome.close) {
      const before = this.before
      this.close(outcome.refocus !== false)
      outcome.after?.(() => before && focusWindow(before))
    } else if (!pane.win.isDestroyed()) {
      pane.win.webContents.send('to-view', { type: 'shotResume', ...(outcome.message ? { message: outcome.message } : {}) } satisfies ToView)
    }
  }

  /** The interface's language changed, or the monitors did: the windows are made again at the next press. */
  reset(): void {
    this.close()
    this.destroy()
  }

  languageChanged(): void {
    this.reset()
  }

  private destroy(): void {
    if (this.state !== 'idle') return
    if (this.idle) clearTimeout(this.idle)
    for (const pane of this.panes.values()) if (!pane.win.isDestroyed()) pane.win.destroy()
    void this.elements?.terminate()
    this.elements = undefined
    this.asking = undefined
    this.panes.clear()
  }

  private pane(display: Display): Pane {
    const found = this.panes.get(display.id)
    if (found && !found.win.isDestroyed()) {
      found.display = display
      return found
    }
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      thickFrame: false,
      roundedCorners: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      backgroundColor: '#000000',
      webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.removeMenu()
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', event => event.preventDefault())
    this.o.log(win)
    // A page that died cannot answer Esc: the frame goes, and the next press makes this window anew.
    win.webContents.on('render-process-gone', () => {
      this.panes.delete(display.id)
      this.close()
      if (!win.isDestroyed()) win.destroy()
    })
    // Alt+F4 is Esc here: the window is kept for the next press.
    win.on('close', event => {
      if (this.o.quitting()) return
      event.preventDefault()
      this.close()
    })
    void win.loadFile(this.o.page, { query: this.o.query() })
    const pane: Pane = { display, win, ready: false, shown: false, hwnds: [], size: { x: 0, y: 0, width: 0, height: 0 }, windows: [], origin: { x: 0, y: 0 } }
    this.panes.set(display.id, pane)
    return pane
  }
}

/** The windows and panels that show on this monitor, in its own pixels, and their handles beside them ('' for a panel, recorded as a piece of the screen). */
function windowsOn(windows: readonly ShotWindow[], monitor: Box): { boxes: ShotTarget[]; hwnds: string[] } {
  const here = { x: 0, y: 0, width: monitor.width, height: monitor.height }
  const boxes: ShotTarget[] = []
  const hwnds: string[] = []
  for (const w of windows) {
    const box = clampBox({ x: w.x - monitor.x, y: w.y - monitor.y, width: w.width, height: w.height }, here)
    if (box.width <= 0 || box.height <= 0) continue
    boxes.push(w.panel ? { ...box, panel: true } : box)
    hwnds.push(w.hwnd ?? '')
  }
  return { boxes, hwnds }
}
