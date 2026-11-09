// A screenshot, in the main process: one window over each monitor, showing that
// monitor as it was at the press (media/shot.html, webview/shot.ts), the frame
// and the tools drawn on it. Made at the first press, hidden between uses with
// no picture in them, and gone after five idle minutes or when the monitors
// change. What the finished picture becomes is main.ts's.

import { BrowserWindow, screen, type Display, type WebContents } from 'electron'

import type { ShotAction, ToHost, ToView } from './protocol'
import type { VideoEffects, VideoSound } from './recordmodel'
import { MIN_VIDEO_FRAME, videoSoundOf } from './recordmodel'
import type { RecordRequest } from './recordwindow'
import type { ShotWindow } from './shot-worker'
import type { Box, ShotStyle, ShotTarget, Tool } from './shotmodel'
import { clampBox } from './shotmodel'
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

/** What is left to do once a picture is handed over: go (and then something), or stay on the screen, saying why. */
export type ShotOutcome = { close: true; after?: () => void } | { close: false; message?: string }

export type ShotOptions = {
  page: string
  preload: string
  worker: string
  query: () => Record<string, string>
  style: () => ShotStyle
  saveStyle: (style: ShotStyle) => void
  tool: () => Tool | ''
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
  done: (action: ShotAction, png: Buffer, win: BrowserWindow) => Promise<ShotOutcome>
  quitting: () => boolean
  log: (win: BrowserWindow) => void
  say: (line: string) => void
}

type Frame = Extract<ToView, { type: 'shotFrame' }>
/** `hwnds` beside the page's list of windows: the page only ever names a place in it. `size`: the monitor in its own pixels. */
type Pane = { display: Display; win: BrowserWindow; ready: boolean; shown: boolean; frame?: Frame; hwnds: string[]; size: Box }

export class ShotOverlay {
  private panes = new Map<number, Pane>()
  private state: 'idle' | 'opening' | 'open' = 'idle'
  private before = 0n
  private idle: NodeJS.Timeout | undefined
  private allShown: (() => void) | undefined
  private finishing = false

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

  /** `video`: on the bar's Video side from the start; `quick`: a frame for its text alone, read the moment it is drawn. */
  async open(mode: 'shot' | 'video' | 'quick' = 'shot'): Promise<void> {
    if (this.state !== 'idle') return
    this.state = 'opening'
    if (this.idle) clearTimeout(this.idle)
    this.o.keys(true)
    this.before = foreground().hwnd
    const began = Date.now()
    try {
      if (this.o.putAway()) await new Promise(resolve => setTimeout(resolve, HIDDEN_MS))
      const displays = screen.getAllDisplays()
      const rects = displays.map(display => ({ id: display.id, ...screen.dipToScreenRect(null, display.bounds) }))
      const shot = await captureScreens(this.o.worker, rects)
      const took = Date.now() - began
      if ((this.state as string) === 'idle') return
      const panes = displays.map(display => this.pane(display))
      const shownOne = new Promise<void>(resolve => {
        this.allShown = resolve
      })
      for (const pane of panes) {
        const monitor = shot.monitors.find(m => m.id === pane.display.id)
        if (!monitor) throw new Error('a monitor was not captured')
        // Twice: a window moved onto a monitor of another scaling takes its size in the old one's first.
        pane.win.setBounds(pane.display.bounds)
        pane.win.setBounds(pane.display.bounds)
        pane.win.setOpacity(0)
        pane.win.showInactive()
        pane.shown = false
        const { boxes, hwnds } = windowsOn(shot.windows, monitor)
        pane.hwnds = hwnds
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
        }
        this.sendFrame(pane)
      }
      await Promise.race([shownOne, new Promise(resolve => setTimeout(resolve, SHOW_WAIT_MS))])
      if ((this.state as string) === 'idle') return
      this.state = 'open'
      this.reveal(panes)
      this.o.say(`shot: open, ${panes.length} monitor(s), captured in ${took} ms, shown in ${Date.now() - began} ms`)
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

  /** The window in front before comes back while Kryakl is still in front, which Windows requires; the picture goes from the pages. */
  close(): void {
    if (this.state === 'idle') return
    this.state = 'idle'
    this.finishing = false
    this.allShown = undefined
    if (this.before) focusWindow(this.before)
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
      case 'shotDone':
        void this.finish(message.action, Buffer.from(new Uint8Array(message.png)), pane)
        return
      default:
    }
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
      if (!PNG.every((byte, i) => png[i] === byte)) throw new Error('the page sent no picture')
      outcome = await this.o.done(action, png, pane.win)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.o.say(`shot: ${action} failed: ${message}`)
      outcome = { close: false, message }
    }
    this.finishing = false
    if (outcome.close) {
      this.close()
      outcome.after?.()
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
    const pane: Pane = { display, win, ready: false, shown: false, hwnds: [], size: { x: 0, y: 0, width: 0, height: 0 } }
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
