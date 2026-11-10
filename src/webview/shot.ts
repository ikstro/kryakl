// A screenshot's page, one over each monitor: the screen as it was at the press,
// the frame, what is drawn on it and the bar under it. Everything is kept in the
// picture's own pixels (shotmodel.ts); the pointer's are turned into those here.
// What leaves the page is one flat PNG, so what was blurred is gone from it.
// The Screenshots window (shots.html) runs this page too, as its editor: one
// screenshot at a time, its frame the crop, no Video side, its buttons its own.

import { t } from '../i18n'
import type { ShotAction, ToHost, ToView, TutorHost } from '../protocol'
import { micNames, micTitle, MIN_VIDEO_FRAME, VIDEO_EFFECTS, VIDEO_SOUND, type VideoEffects, type VideoSound } from '../recordmodel'
import { arrowHead, barPlace, boundsOf, boxOf, clampBox, commit, dragFrame, fontOf, handleAt, historyOf, inBox, MIN_FRAME, moved, nudge, onShape, optionsOf, redo, shapeAt, SHOT_COLORS, SHOT_STYLE, SHOT_TOOLS, snap45, squareOf, stepNumber, stepOf, strokeOf, targetAt, targetsAt, toolOfCode, undo, worthKeeping, type Box, type Handle, type History, type Measure, type Point, type Shape, type ShotStyle, type ShotTarget, type Tool } from '../shotmodel'
import { blockOf, blurred, cut, pixelated } from '../shotpixels'
import { el } from './dom'
import { lucide, type LucideName } from './lucide'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

const post = (message: ToHost) => window.tutorHost.post(message)
const part = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const canvas = part<HTMLCanvasElement>('screen')
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
const hint = part<HTMLDivElement>('hint')
const sizeLabel = part<HTMLDivElement>('size')
/** The pixels round the pointer, enlarged, while a frame or its edge is placed. */
const loupe = el('div', { class: 'loupe' })
const loupeCanvas = el('canvas')
const loupeText = el('div', { class: 'at' })
loupe.append(loupeCanvas, loupeText)
loupe.hidden = true
document.body.append(loupe)
const bar = part<HTMLDivElement>('bar')
const write = part<HTMLTextAreaElement>('write')
/** The list of microphones, over the bar. */
const micList = el('div', { class: 'pop', role: 'listbox' })
micList.hidden = true
document.body.append(micList)
/** The frozen screen, unmarked. */
const base = document.createElement('canvas')
/** A small copy of a covered part, while it is being dragged. */
const scratch = document.createElement('canvas')

/** The frame's edge and handles lie on the screen, not on a page of Kryakl's: the duck's yellow in either theme. */
const YELLOW = '#ffd60a'
// The frame's line: one solid pixel (the owner, 2026-11-10: see-through at 60 % was lost on white).
const FRAME_LINE = YELLOW
// Loaded once, ready before the first screenshot.
const shutterSound = new Audio('shutter.wav')
shutterSound.volume = 0.6
/** The shutter sounds once a frame is fixed, the first time on this screenshot (the owner, 2026-11-10: when the bar appears, not when the screen freezes). */
let shutterArmed = false
const DIM = 'rgba(0, 0, 0, 0.45)'
const LINE = 1.25
const BAR_GAP = 8
/** A covered part is worked out once for each place; a full screen of it is 33 MB. */
const MOST_BAKES = 24
/** How long Ctrl+C waits for C to be let go, so that its release does not reach the program coming back. */
const RELEASE_MS = 250
const MESSAGE_MS = 3500

const TOOL_ICONS: Record<Tool, LucideName> = { rect: 'square', ellipse: 'circle', arrow: 'arrow-up-right', line: 'slash', pen: 'pencil', marker: 'highlighter', text: 'type', step: 'hash', blur: 'droplets', pixel: 'grid-3x3' }
/** The loupe: this many of the screen's pixels across, each this many CSS pixels wide. */
const LOUPE_PIXELS = 15
const LOUPE_CELL = 8
/** An edit in the Screenshots window reaches main this long after the last change. */
const SYNC_MS = 400
const RESIZE: Record<Handle, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move' }

type Picture = { width: number; height: number; rgba: Uint8ClampedArray; windows: ShotTarget[]; bounds: Box }
type Drag =
  | { kind: 'new'; from: Point; now: Point }
  | { kind: 'frame'; handle: Handle; from: Point; start: Box; live: Box }
  | { kind: 'draw'; from: Point; shape: Shape }
  | { kind: 'move'; id: number; from: Point; start: Shape; live: Shape }

let picture: Picture | undefined
/** Opened in the Screenshots window, not over a monitor. */
const editor = document.body.classList.contains('editor')
/** The screen's pixels in one CSS pixel of the monitor the picture was taken on: how thick a line, how big a text, how coarse a blur. */
let ink = 1
/** The picture's pixels in one CSS pixel of this window: how near the pointer must come, how big the handles. Over the monitor the same as `ink`. */
let view = 1
/** Room round the picture on its canvas, in its pixels, for the handles at its edges (the Screenshots window). */
let pad = 0
/** Where the picture's corner is in the window, in CSS pixels. */
let origin: Point = { x: 0, y: 0 }
/** The pointer as it was on the screen, the screen behind it, drawn on the picture while the bar says so. */
let pointerPatch: { canvas: HTMLCanvasElement; x: number; y: number } | undefined
let cursorOn = false
/** Shift held: a square or a circle, a line at a round angle. */
let shiftHeld = false
/** Where the loupe looks, in the picture's pixels. */
let loupeAt: Point | undefined
/** The Screenshots window: the screenshot shown, what main has of it, and each one's history for as long as the window is open. */
let shownId: number | undefined
let synced: History['now'] | undefined
let syncTimer: number | undefined
const histories = new Map<number, History>()
let history: History | undefined
let selected: number | undefined
let tool: Tool | undefined
/** The tool last picked: in hand at the next screenshot, and when the bar comes back from its Video side. */
let lastTool: Tool | undefined
let style: ShotStyle = SHOT_STYLE
let drag: Drag | undefined
let hovered: ShotTarget | undefined
/** What the wheel asked for: how many steps wider than the narrowest thing under the pointer. */
let hoverUp = 0
/** The narrowest thing under the pointer: the wheel's steps count from it, and start again when it changes. */
let hoverDeepest: ShotTarget | undefined
/** A frame was begun on another monitor: this one only stays dim. */
let other = false
/** The pointer is on this monitor (before a frame): the others were told to let go of what they lit. */
let here = false
/** The frame's dashes run while it is being chosen (the owner, 2026-11-10), unless the person asked for less motion. */
const still = matchMedia('(prefers-reduced-motion: reduce)')
/** Milliseconds for the dashes to travel one CSS pixel, and how often they are drawn again meanwhile. */
const MARCH_MS = 45
const MARCH_EVERY_MS = 33
let marchTimer: number | undefined
let busy = false
let nextId = 1
let writing: { at: Point } | undefined
let barInside = false
let barOffset = { x: 0, y: 0 }
let barDrag: Point | undefined
/** Only the text in a frame is wanted: no bar, and it is read as soon as the frame is drawn. */
let quick = false
/** The bar's Video side: the frame is what will be recorded, and what is drawn stays out of sight. */
let video = false
let sound: VideoSound = VIDEO_SOUND
let effects: VideoEffects = VIDEO_EFFECTS
/** The window a click took, by its place in the page's list; it is recorded as a window while the frame is still exactly that window. */
let takenWindow: number | undefined
/** The parts a window with no child windows names under the pointer (Chrome, VS Code), as panels of the window at that place of the list. */
let parts: { window: number; boxes: ShotTarget[] } | undefined
/** Asked at most this often while the pointer moves; the last place is always asked. */
const PROBE_MS = 60
let probedAt = 0
let probeLater: number | undefined
let pointer: Point | undefined

/** What a click can take: the windows and their panels, and the parts named under the pointer before their window. */
function targetList(): ShotTarget[] {
  if (!picture) return []
  if (!parts) return picture.windows
  const list = picture.windows.slice()
  list.splice(parts.window, 0, ...parts.boxes)
  return list
}

/** The window under the pointer is asked for its parts, unless Windows lists its panels already. */
function probe(p: Point): void {
  if (!picture) return
  const chain = targetsAt(picture.windows, p)
  const win = chain[chain.length - 1]
  if (!win || win.panel) return
  const index = picture.windows.indexOf(win)
  if (picture.windows[index - 1]?.panel) return
  if (probeLater !== undefined) clearTimeout(probeLater)
  const wait = probedAt + PROBE_MS - Date.now()
  const send = () => {
    probeLater = undefined
    probedAt = Date.now()
    post({ type: 'shotProbe', window: index, x: Math.round(p.x), y: Math.round(p.y) })
  }
  if (wait <= 0) send()
  else probeLater = window.setTimeout(send, wait)
}

/** The narrowest at the pointer may have changed: the wheel starts again from it. */
function rehover(p: Point): void {
  const deepest = targetAt(targetList(), p, 0)
  if (deepest !== hoverDeepest) {
    hoverDeepest = deepest
    hoverUp = 0
  }
  lightTarget(p)
}
let messageTimer: ReturnType<typeof setTimeout> | undefined
const bakes = new Map<string, HTMLCanvasElement>()

const point = (event: MouseEvent): Point => ({ x: Math.round((event.clientX - origin.x) * view), y: Math.round((event.clientY - origin.y) * view) })
/** A place in the picture, in the window's CSS pixels. */
const cssOf = (p: Point): Point => ({ x: origin.x + p.x / view, y: origin.y + p.y / view })
const reach = () => 6 * view
const shapeReach = () => 7 * view
const fontText = (size: number) => `600 ${size}px Inter, system-ui, sans-serif`
/** Ink that stands out on a color: for a number in its circle, and the thin edge round a text. */
const inkOn = (color: string) => (color === '#ffffff' || color === '#ffd60a' ? '#111111' : '#ffffff')

const measure: Measure = shape => {
  if (shape.kind === 'step') {
    const across = stepOf(shape.style, ink)
    return { x: shape.at.x - across / 2, y: shape.at.y - across / 2, width: across, height: across }
  }
  const size = fontOf(shape.style, ink)
  const lines = shape.text.split('\n')
  ctx.save()
  ctx.font = fontText(size)
  const width = Math.max(...lines.map(line => ctx.measureText(line).width))
  ctx.restore()
  return { x: shape.at.x, y: shape.at.y, width, height: lines.length * size * LINE }
}

// ---------------------------------------------------------------- drawing

/** A covered part, worked out from the original pixels: what was under it is in no way in the result. */
function bakeOf(kind: 'blur' | 'pixel', box: Box): HTMLCanvasElement {
  const key = `${kind}:${box.x},${box.y},${box.width},${box.height}`
  const known = bakes.get(key)
  if (known) return known
  const { rgba, width } = picture as Picture
  const source = cut(rgba, width, box)
  const make = kind === 'blur' ? blurred : pixelated
  const pixels = make(source, box.width, box.height, blockOf(ink), Math.random)
  const made = document.createElement('canvas')
  made.width = box.width
  made.height = box.height
  ;(made.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(new Uint8ClampedArray(pixels), box.width, box.height), 0, 0)
  bakes.set(key, made)
  if (bakes.size > MOST_BAKES) bakes.delete(bakes.keys().next().value as string)
  return made
}

/** While a covered part is dragged: one sample of each block, never in the result. */
function drawQuick(c: CanvasRenderingContext2D, box: Box, smooth: boolean): void {
  const { rgba, width, height } = picture as Picture
  const block = blockOf(ink)
  const across = Math.max(1, Math.ceil(box.width / block))
  const down = Math.max(1, Math.ceil(box.height / block))
  const small = new ImageData(across, down)
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      const px = Math.min(width - 1, box.x + Math.floor((x + 0.5) * block))
      const py = Math.min(height - 1, box.y + Math.floor((y + 0.5) * block))
      const from = (py * width + px) * 4
      const to = (y * across + x) * 4
      small.data[to] = rgba[from] as number
      small.data[to + 1] = rgba[from + 1] as number
      small.data[to + 2] = rgba[from + 2] as number
      small.data[to + 3] = 255
    }
  }
  scratch.width = across
  scratch.height = down
  ;(scratch.getContext('2d') as CanvasRenderingContext2D).putImageData(small, 0, 0)
  c.save()
  c.beginPath()
  c.rect(box.x, box.y, box.width, box.height)
  c.clip()
  c.imageSmoothingEnabled = smooth
  c.drawImage(scratch, box.x, box.y, across * block, down * block)
  c.restore()
}

function drawShape(c: CanvasRenderingContext2D, shape: Shape, shapes: readonly Shape[], quick: boolean): void {
  const stroke = strokeOf(shape.style, ink)
  c.save()
  c.strokeStyle = shape.style.color
  c.fillStyle = shape.style.color
  c.lineWidth = stroke
  c.lineCap = 'round'
  c.lineJoin = 'round'
  if (shape.style.dashed && (shape.kind === 'rect' || shape.kind === 'ellipse' || shape.kind === 'arrow' || shape.kind === 'line')) {
    c.lineCap = 'butt'
    c.setLineDash([stroke * 3, stroke * 2.2])
  }
  switch (shape.kind) {
    case 'rect':
      c.lineJoin = 'miter'
      c.strokeRect(shape.box.x, shape.box.y, shape.box.width, shape.box.height)
      break
    case 'ellipse':
      c.beginPath()
      c.ellipse(shape.box.x + shape.box.width / 2, shape.box.y + shape.box.height / 2, shape.box.width / 2, shape.box.height / 2, 0, 0, Math.PI * 2)
      c.stroke()
      break
    case 'blur':
    case 'pixel': {
      const box = clampBox(shape.box, (picture as Picture).bounds)
      if (box.width < 1 || box.height < 1) break
      if (quick) drawQuick(c, box, shape.kind === 'blur')
      else c.drawImage(bakeOf(shape.kind, box), box.x, box.y)
      break
    }
    case 'arrow': {
      const head = arrowHead(shape.from, shape.to, stroke)
      c.beginPath()
      c.moveTo(shape.from.x, shape.from.y)
      c.lineTo(head.neck.x, head.neck.y)
      c.stroke()
      c.setLineDash([])
      c.beginPath()
      c.moveTo(shape.to.x, shape.to.y)
      c.lineTo(head.left.x, head.left.y)
      c.lineTo(head.right.x, head.right.y)
      c.closePath()
      c.fill()
      break
    }
    case 'line':
      c.beginPath()
      c.moveTo(shape.from.x, shape.from.y)
      c.lineTo(shape.to.x, shape.to.y)
      c.stroke()
      break
    case 'pen':
    case 'marker': {
      if (shape.kind === 'marker') {
        c.globalAlpha = 0.42
        c.lineWidth = stroke * 3.5
      }
      c.beginPath()
      shape.points.forEach((p, i) => (i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y)))
      c.stroke()
      break
    }
    case 'text': {
      const size = fontOf(shape.style, ink)
      c.font = fontText(size)
      c.textBaseline = 'top'
      c.strokeStyle = inkOn(shape.style.color)
      c.lineWidth = size * 0.14
      shape.text.split('\n').forEach((line, i) => {
        // Where the field being typed in had it, in the middle of its line's height.
        const y = shape.at.y + ((LINE - 1) / 2 + i * LINE) * size
        c.strokeText(line, shape.at.x, y)
        c.fillText(line, shape.at.x, y)
      })
      break
    }
    case 'step': {
      const across = stepOf(shape.style, ink)
      c.beginPath()
      c.arc(shape.at.x, shape.at.y, across / 2, 0, Math.PI * 2)
      c.fill()
      c.fillStyle = inkOn(shape.style.color)
      c.font = fontText(across * 0.55)
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(String(stepNumber(shapes, shape.id)), shape.at.x, shape.at.y + across * 0.03)
      break
    }
  }
  c.restore()
}

/** What is drawn, as far as the pointer and the screen are concerned: nothing on the Video side. */
const liveShapes = (): readonly Shape[] => (video ? [] : (history?.now.shapes ?? []))

function shapesNow(): readonly Shape[] {
  const shapes = liveShapes()
  if (drag?.kind === 'draw') return [...shapes, drag.shape]
  if (drag?.kind === 'move') {
    const { id, live } = drag
    return shapes.map(s => (s.id === id ? live : s))
  }
  return shapes
}

function frameNow(): Box | undefined {
  if (drag?.kind === 'new') return clampBox((shiftHeld ? squareOf : boxOf)(drag.from, drag.now), (picture as Picture).bounds)
  if (drag?.kind === 'frame') return drag.live
  return history?.now.frame ?? hovered
}

function drawHandles(c: CanvasRenderingContext2D, frame: Box): void {
  const half = Math.round(3.5 * view)
  const { x, y, width, height } = frame
  c.fillStyle = YELLOW
  c.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  c.lineWidth = Math.max(1, Math.round(view * 0.75))
  for (const [px, py] of [[x, y], [x + width / 2, y], [x + width, y], [x, y + height / 2], [x + width, y + height / 2], [x, y + height], [x + width / 2, y + height], [x + width, y + height]] as const) {
    c.fillRect(Math.round(px) - half, Math.round(py) - half, half * 2, half * 2)
    c.strokeRect(Math.round(px) - half, Math.round(py) - half, half * 2, half * 2)
  }
}

function paint(): void {
  if (!picture) return
  const c = ctx
  const { width, height } = picture
  const frame = other ? undefined : frameNow()
  c.setTransform(1, 0, 0, 1, 0, 0)
  if (pad) {
    c.clearRect(0, 0, canvas.width, canvas.height)
    c.translate(pad, pad)
  }
  c.drawImage(base, 0, 0)
  drawPointer(c)
  c.fillStyle = DIM
  c.beginPath()
  c.rect(0, 0, width, height)
  if (frame) c.rect(frame.x, frame.y, frame.width, frame.height)
  c.fill('evenodd')
  if (frame) {
    c.save()
    c.beginPath()
    c.rect(frame.x, frame.y, frame.width, frame.height)
    c.clip()
    const shapes = shapesNow()
    const quickId = drag?.kind === 'draw' ? drag.shape.id : drag?.kind === 'move' ? drag.id : undefined
    for (const shape of shapes) drawShape(c, shape, shapes, shape.id === quickId)
    const chosen = shapes.find(s => s.id === selected)
    if (chosen && drag?.kind !== 'draw') {
      const box = boundsOf(chosen, measure)
      const room = 4 * view
      c.strokeStyle = YELLOW
      c.lineWidth = Math.max(1, Math.round(view))
      c.setLineDash([5 * view, 4 * view])
      c.strokeRect(box.x - room, box.y - room, box.width + room * 2, box.height + room * 2)
    }
    c.restore()
    // One pixel of the screen, on a pixel: a line along the border of two pixels comes out two wide and half as bright. Just inside the frame, or a maximized window's would fall off the screen.
    c.strokeStyle = FRAME_LINE
    c.lineWidth = 1
    // Dashed while it is only being chosen (a window lit, a frame being drawn), solid once it is fixed (the owner, 2026-11-10);
    // the dashes run round it meanwhile, a frame drawn again every MARCH_EVERY_MS.
    const choosing = !history || drag?.kind === 'new'
    c.setLineDash(choosing ? [Math.round(6 * view), Math.round(4 * view)] : [])
    c.lineDashOffset = choosing && !still.matches ? -Math.round((performance.now() / MARCH_MS) * view) : 0
    c.strokeRect(Math.round(frame.x) + 0.5, Math.round(frame.y) + 0.5, Math.round(frame.width) - 1, Math.round(frame.height) - 1)
    c.setLineDash([])
    c.lineDashOffset = 0
    if (choosing && !still.matches && marchTimer === undefined) {
      marchTimer = window.setTimeout(() => {
        marchTimer = undefined
        repaint()
      }, MARCH_EVERY_MS)
    }
    if (history && drag?.kind !== 'new') drawHandles(c, frame)
  }
  placeSize(frame)
  drawLoupe()
  if (editor && history && history.now !== synced) scheduleSync()
}

function drawPointer(c: CanvasRenderingContext2D): void {
  if (cursorOn && pointerPatch) c.drawImage(pointerPatch.canvas, pointerPatch.x, pointerPatch.y)
}

/** Enlarged pixels round the pointer and a cross on the one under it, while the frame or its edge is placed: over the monitor before a frame, and while either is dragged. */
function drawLoupe(): void {
  const placing = drag?.kind === 'new' || drag?.kind === 'frame' || (!editor && !history && !other && !busy)
  if (!picture || !loupeAt || !placing || quick) {
    loupe.hidden = true
    return
  }
  const dpr = window.devicePixelRatio || 1
  const cell = Math.max(1, Math.round(LOUPE_CELL * dpr))
  const side = LOUPE_PIXELS * cell
  if (loupeCanvas.width !== side) loupeCanvas.width = loupeCanvas.height = side
  const c = loupeCanvas.getContext('2d') as CanvasRenderingContext2D
  const half = Math.floor(LOUPE_PIXELS / 2)
  const x = Math.min(picture.width - 1, Math.max(0, Math.round(loupeAt.x)))
  const y = Math.min(picture.height - 1, Math.max(0, Math.round(loupeAt.y)))
  c.imageSmoothingEnabled = false
  c.fillStyle = '#000'
  c.fillRect(0, 0, side, side)
  c.drawImage(base, x - half, y - half, LOUPE_PIXELS, LOUPE_PIXELS, 0, 0, side, side)
  c.strokeStyle = 'rgba(255, 214, 10, 0.55)'
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(half * cell + cell / 2, 0)
  c.lineTo(half * cell + cell / 2, half * cell)
  c.moveTo(half * cell + cell / 2, (half + 1) * cell)
  c.lineTo(half * cell + cell / 2, side)
  c.moveTo(0, half * cell + cell / 2)
  c.lineTo(half * cell, half * cell + cell / 2)
  c.moveTo((half + 1) * cell, half * cell + cell / 2)
  c.lineTo(side, half * cell + cell / 2)
  c.stroke()
  c.strokeStyle = YELLOW
  c.strokeRect(half * cell + 0.5, half * cell + 0.5, cell - 1, cell - 1)
  loupeText.textContent = `${x}, ${y}`
  loupe.hidden = false
  const size = LOUPE_PIXELS * LOUPE_CELL
  loupeCanvas.style.width = loupeCanvas.style.height = `${size}px`
  const at = cssOf({ x, y })
  const gap = 24
  const right = at.x + gap + size + 4 <= innerWidth
  const below = at.y + gap + size + 24 <= innerHeight
  loupe.style.transform = `translate(${Math.round(right ? at.x + gap : at.x - gap - size)}px, ${Math.round(below ? at.y + gap : at.y - gap - size - 20)}px)`
}

let paintAsked = false
function repaint(): void {
  if (paintAsked) return
  paintAsked = true
  requestAnimationFrame(() => {
    paintAsked = false
    paint()
  })
}

function placeSize(frame: Box | undefined): void {
  if (!frame || frame.width < 1) {
    sizeLabel.hidden = true
    return
  }
  sizeLabel.hidden = false
  sizeLabel.textContent = `${frame.width} × ${frame.height}`
  const at = cssOf(frame)
  const above = at.y - 24
  sizeLabel.style.transform = `translate(${Math.round(Math.max(4, at.x))}px, ${Math.round(above >= 4 ? above : at.y + 6)}px)`
}

// ---------------------------------------------------------------- the bar

function button(name: LucideName, title: string, act: () => void, options: { on?: boolean; off?: boolean; label?: string; cls?: string } = {}): HTMLButtonElement {
  const cls = ['b', options.on ? 'on' : '', options.label ? 'lab' : '', options.cls ?? ''].filter(Boolean).join(' ')
  return el('button', { class: cls, title, disabled: options.off === true, 'aria-label': title, onclick: act }, lucide(name, 's'), options.label)
}

const separator = () => el('span', { class: 'sep' })

/** Photo or Video, at the start of the bar. */
function modeSwitch(): HTMLElement {
  const side = (on: boolean, name: LucideName, label: string) =>
    el('button', { class: `seg${video === on ? ' on' : ''}`, title: `${label} · V`, 'aria-pressed': String(video === on), onclick: () => setVideo(on) }, lucide(name, 's'), label)
  return el('div', { class: 'mode', role: 'group' }, side(false, 'camera', t('shot.mode.photo')), side(true, 'video', t('shot.mode.video')))
}

const tooSmall = (frame: Box) => frame.width < MIN_VIDEO_FRAME || frame.height < MIN_VIDEO_FRAME

/** The Video side: what is heard, and the button that starts it. */
function videoRow(frame: Box): HTMLElement {
  const small = tooSmall(frame)
  return el(
    'div',
    { class: 'row' },
    modeSwitch(),
    separator(),
    button(sound.mic ? 'mic' : 'mic-off', t('shot.mic'), () => setSound({ mic: !sound.mic }), { on: sound.mic, label: t('shot.mic') }),
    button('chevron-down', t('shot.micPick'), () => void toggleMics(), { on: !micList.hidden, cls: 'chev' }),
    button(sound.system ? 'volume-2' : 'volume-x', t('shot.system'), () => setSound({ system: !sound.system }), { on: sound.system, label: t('shot.system') }),
    separator(),
    button('mouse-pointer-click', t('shot.clicks'), () => setEffects({ clicks: !effects.clicks }), { on: effects.clicks }),
    button('zoom-in', t('shot.zoom'), () => setEffects({ zoom: !effects.zoom }), { on: effects.zoom }),
    separator(),
    button('x', `${t('shot.close')} · Esc`, () => post({ type: 'shotCancel' })),
    button('circle', small ? t('shot.tooSmall', { n: MIN_VIDEO_FRAME }) : `${t('shot.start')} · Enter`, startRecording, { label: t('shot.start'), cls: 'copy start', off: small }),
  )
}

function drawBar(): void {
  if (!history) {
    bar.hidden = true
    return
  }
  bar.hidden = false
  if (video) {
    bar.replaceChildren(videoRow(history.now.frame))
    placeBar()
    return
  }
  const tools = SHOT_TOOLS.map(item => {
    const name = t(`shot.tool.${item.id}`)
    return button(TOOL_ICONS[item.id], `${name} · ${item.letter}`, () => pickTool(item.id), { on: tool === item.id })
  })
  const row = el(
    'div',
    { class: 'row' },
    ...(editor ? [] : [modeSwitch(), separator()]),
    ...tools,
    ...(pointerPatch && !editor ? [separator(), button('mouse-pointer-2', t('shot.cursor'), toggleCursor, { on: cursorOn })] : []),
    separator(),
    button('undo-2', `${t('shot.undo')} · Ctrl+Z`, stepBack, { off: history.past.length === 0 }),
    button('redo-2', `${t('shot.redo')} · Ctrl+Y`, stepForward, { off: history.future.length === 0 }),
    // The Screenshots window has its own Copy, Save, Text and Delete, for the ones picked in its list.
    ...(editor
      ? []
      : [
          separator(),
          button('images', t('shot.keepTip'), () => void keep(), { label: t('shot.keep') }),
          button('scan-text', t('shot.textTip'), () => void finish('text'), { label: t('shot.text') }),
          button('save', `${t('shot.save')} · Ctrl+S`, () => void finish('save')),
          button('x', `${t('shot.close')} · Esc`, () => post({ type: 'shotCancel' })),
          button('copy', 'Ctrl+C', () => void finish('copy'), { label: t('shot.copy'), cls: 'copy' }),
        ]),
  )
  bar.replaceChildren(row, ...optionsRow())
  placeBar()
}

function optionsRow(): HTMLElement[] {
  const kind = tool ?? history?.now.shapes.find(s => s.id === selected)?.kind
  if (!kind) return []
  const can = optionsOf(kind)
  if (!can.color && !can.size && !can.dashed) return []
  const row = el('div', { class: 'row opts' })
  if (can.color) {
    for (const color of SHOT_COLORS) {
      const swatch = el('button', { class: `sw${style.color === color ? ' on' : ''}`, title: t(`shot.color.${color.slice(1)}` as Parameters<typeof t>[0]), onclick: () => setStyle({ color }) })
      swatch.style.background = color
      row.append(swatch)
    }
  }
  if (can.size) {
    row.append(separator())
    for (const size of [0, 1, 2] as const) row.append(el('button', { class: `b${style.size === size ? ' on' : ''}`, title: t(`shot.size.${size}`), onclick: () => setStyle({ size }) }, el('span', { class: `dot s${size}` })))
  }
  if (can.dashed) {
    row.append(separator(), el('button', { class: `b${style.dashed ? ' on' : ''}`, title: t('shot.dashed'), onclick: () => setStyle({ dashed: !style.dashed }) }, el('span', { class: 'dash' })))
  }
  return [row]
}

function placeBar(): void {
  // In the Screenshots window the bar stands still above the picture.
  if (!history || bar.hidden || !picture || editor) return
  const { frame } = history.now
  const css = { x: frame.x / view, y: frame.y / view, width: frame.width / view, height: frame.height / view }
  const screen = { width: picture.width / view, height: picture.height / view }
  const spot = barPlace(css, screen, { width: bar.offsetWidth, height: bar.offsetHeight }, BAR_GAP)
  barInside = spot.inside
  bar.classList.toggle('inside', spot.inside)
  const x = spot.x + (spot.inside ? barOffset.x : 0)
  const y = spot.y + (spot.inside ? barOffset.y : 0)
  bar.style.transform = `translate(${x}px, ${y}px)`
}

function setVideo(on: boolean): void {
  if (video === on) return
  if (writing) finishWriting()
  video = on
  tool = on ? undefined : lastTool
  selected = undefined
  micList.hidden = true
  if (!history) hint.textContent = hintText()
  drawBar()
  repaint()
}

const hintText = () => t(quick ? 'shot.hintQuick' : video ? 'shot.hintVideo' : 'shot.hint')

function setSound(patch: Partial<VideoSound>): void {
  sound = { ...sound, ...patch }
  post({ type: 'shotSound', sound })
  drawBar()
}

function setEffects(patch: Partial<VideoEffects>): void {
  effects = { ...effects, ...patch }
  post({ type: 'shotEffects', effects })
  drawBar()
}

function closeMics(): void {
  if (micList.hidden) return
  micList.hidden = true
  drawBar()
}

/** Asked each time, as a microphone may have been plugged in; names alone, which a page may read without being let near the microphone. */
async function toggleMics(): Promise<void> {
  if (!micList.hidden) return closeMics()
  const names = micNames(await navigator.mediaDevices.enumerateDevices())
  const line = (name: string, label: string) =>
    el('button', { class: `pi${sound.micName === name ? ' on' : ''}`, role: 'option', title: label, onclick: () => pickMic(name) }, label)
  const gone = sound.micName && !names.includes(sound.micName) ? [line(sound.micName, t('shot.micGone', { name: micTitle(sound.micName) }))] : []
  micList.replaceChildren(line('', t('shot.micWindows')), ...names.map(name => line(name, micTitle(name))), ...gone)
  micList.hidden = false
  drawBar()
  placeMics()
}

function pickMic(micName: string): void {
  micList.hidden = true
  setSound({ micName })
}

/** Over the bar, its right edge at the arrow's; under it where the screen has no room above. */
function placeMics(): void {
  const anchor = bar.querySelector('.chev')?.getBoundingClientRect()
  if (!anchor) return
  const gap = 6
  const width = micList.offsetWidth
  const height = micList.offsetHeight
  const x = Math.max(gap, Math.min(innerWidth - width - gap, anchor.right - width))
  const y = anchor.top - height - gap >= gap ? anchor.top - height - gap : anchor.bottom + gap
  micList.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`
}

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

function startRecording(): void {
  if (!history || !picture || busy) return
  const { frame } = history.now
  if (tooSmall(frame)) return
  const taken = takenWindow === undefined ? undefined : picture.windows[takenWindow]
  busy = true
  post({ type: 'shotRecord', frame, sound, ...(taken && sameBox(taken, frame) ? { window: takenWindow } : {}) })
}

function toggleCursor(): void {
  cursorOn = !cursorOn
  post({ type: 'shotCursor', on: cursorOn })
  drawBar()
  repaint()
}

/** The arrows: the selected shape, else the frame, a pixel at a time (ten with Shift); with Ctrl the frame's right and bottom edges. */
function nudgeBy(code: string, step: number, edge: boolean): void {
  if (!history || !picture || drag || writing) return
  const dx = code === 'ArrowLeft' ? -step : code === 'ArrowRight' ? step : 0
  const dy = code === 'ArrowUp' ? -step : code === 'ArrowDown' ? step : 0
  const shape = selected === undefined || video ? undefined : history.now.shapes.find(s => s.id === selected)
  if (shape) {
    const next = moved(shape, dx, dy)
    history = commit(history, { ...history.now, shapes: history.now.shapes.map(s => (s.id === shape.id ? next : s)) })
    drawBar()
    repaint()
    return
  }
  const frame = nudge(history.now.frame, dx, dy, picture.bounds, edge)
  if (!sameBox(frame, history.now.frame)) setFrame(frame)
}

function pickTool(next: Tool): void {
  if (writing) finishWriting()
  tool = tool === next ? undefined : next
  // Put down, it is still the one to come back to.
  if (tool) {
    lastTool = tool
    post({ type: 'shotTool', tool })
  }
  selected = undefined
  drawBar()
  repaint()
}

function setStyle(patch: Partial<ShotStyle>): void {
  style = { ...style, ...patch }
  post({ type: 'shotStyle', style })
  if (writing) styleWriting()
  if (history && selected !== undefined) {
    const shape = history.now.shapes.find(s => s.id === selected)
    if (shape && shape.kind !== 'blur' && shape.kind !== 'pixel') {
      const restyled = { ...shape, style } as Shape
      history = commit(history, { ...history.now, shapes: history.now.shapes.map(s => (s.id === restyled.id ? restyled : s)) })
    }
  }
  drawBar()
  repaint()
}

function stepBack(): void {
  if (!history) return
  history = undo(history)
  afterStep()
}

function stepForward(): void {
  if (!history) return
  history = redo(history)
  afterStep()
}

function afterStep(): void {
  if (selected !== undefined && !history?.now.shapes.some(s => s.id === selected)) selected = undefined
  drawBar()
  repaint()
}

// ---------------------------------------------------------------- the frame and the shapes

function begin(frame: Box): void {
  history = historyOf({ frame, shapes: [] })
  hovered = undefined
  loupe.hidden = true
  hint.hidden = true
  post({ type: 'shotBegan' })
  if (shutterArmed && !video) {
    shutterSound.currentTime = 0
    void shutterSound.play().catch(() => undefined)
  }
  shutterArmed = false
  if (quick) {
    repaint()
    void finish('text')
    return
  }
  drawBar()
  repaint()
}

function setFrame(frame: Box): void {
  if (!history) return
  history = commit(history, { ...history.now, frame })
  drawBar()
  repaint()
}

function add(shape: Shape): void {
  if (!history) return
  history = commit(history, { ...history.now, shapes: [...history.now.shapes, shape] })
  selected = shape.id
  drawBar()
  repaint()
}

function removeSelected(): boolean {
  if (!history || selected === undefined) return false
  const id = selected
  history = commit(history, { ...history.now, shapes: history.now.shapes.filter(s => s.id !== id) })
  selected = undefined
  drawBar()
  repaint()
  return true
}

function select(id: number | undefined): void {
  if (selected === id) return
  selected = id
  drawBar()
  repaint()
}

function startDraw(chosen: Tool, p: Point): void {
  const id = nextId++
  switch (chosen) {
    case 'text':
      openWriting(p)
      return
    case 'step':
      add({ id, kind: 'step', at: p, style })
      return
    case 'rect':
    case 'ellipse':
    case 'blur':
    case 'pixel':
      drag = { kind: 'draw', from: p, shape: { id, kind: chosen, box: { x: p.x, y: p.y, width: 0, height: 0 }, style } }
      return
    case 'arrow':
    case 'line':
      drag = { kind: 'draw', from: p, shape: { id, kind: chosen, from: p, to: p, style } }
      return
    default:
      drag = { kind: 'draw', from: p, shape: { id, kind: chosen, points: [p], style } }
  }
}

/** `even`: Shift held, a square or a circle, a line at a round angle. */
function stretched(shape: Shape, from: Point, p: Point, even: boolean): Shape {
  switch (shape.kind) {
    case 'rect':
    case 'ellipse':
    case 'blur':
    case 'pixel':
      return { ...shape, box: (even ? squareOf : boxOf)(from, p) }
    case 'arrow':
    case 'line':
      return { ...shape, to: even ? snap45(from, p) : p }
    case 'pen':
    case 'marker': {
      const last = shape.points[shape.points.length - 1] as Point
      return Math.hypot(p.x - last.x, p.y - last.y) < 2 ? shape : { ...shape, points: [...shape.points, p] }
    }
    default:
      return shape
  }
}

// ---------------------------------------------------------------- writing

function styleWriting(): void {
  if (!writing) return
  const size = fontOf(style, ink) / view
  write.style.fontSize = `${size}px`
  write.style.color = style.color
  fitWriting()
}

function fitWriting(): void {
  if (!writing) return
  const size = fontOf(style, ink)
  const lines = write.value.split('\n')
  ctx.save()
  ctx.font = fontText(size)
  const width = Math.max(...lines.map(line => ctx.measureText(line).width), size * 6)
  ctx.restore()
  write.style.width = `${Math.ceil(width / view) + size / view}px`
  write.style.height = `${Math.ceil((lines.length * size * LINE) / view)}px`
}

function openWriting(p: Point): void {
  writing = { at: p }
  write.value = ''
  write.hidden = false
  const at = cssOf(p)
  write.style.transform = `translate(${at.x}px, ${at.y}px)`
  styleWriting()
  write.focus()
}

function finishWriting(): void {
  if (!writing) return
  const { at } = writing
  const text = write.value.replace(/\s+$/, '')
  writing = undefined
  write.hidden = true
  write.blur()
  const shape: Shape = { id: nextId++, kind: 'text', at, text, style }
  if (worthKeeping(shape)) add(shape)
  else repaint()
}

write.addEventListener('input', fitWriting)

// ---------------------------------------------------------------- the pointer

function pointerCursor(p: Point): string {
  if (!history) return 'crosshair'
  const { frame } = history.now
  const shapes = liveShapes()
  const handle = handleAt(frame, p, reach())
  const chosen = shapes.find(s => s.id === selected)
  if (chosen && onShape(chosen, p, shapeReach(), measure)) return 'move'
  if (handle && handle !== 'move') return RESIZE[handle]
  if (tool) return tool === 'text' ? 'text' : inBox(frame, p) ? 'crosshair' : 'default'
  if (shapeAt(shapes, p, shapeReach(), measure)) return 'move'
  return handle ? RESIZE[handle] : shapes.length === 0 ? 'crosshair' : 'default'
}

canvas.addEventListener('mousedown', event => {
  if (event.button !== 0 || !picture || other || busy) return
  // A click's own default takes the keyboard away from the label field it has just opened.
  event.preventDefault()
  const p = point(event)
  if (writing) {
    finishWriting()
    return
  }
  if (!history) {
    drag = { kind: 'new', from: p, now: p }
    return
  }
  const { frame } = history.now
  const shapes = liveShapes()
  const handle = handleAt(frame, p, reach())
  const chosen = shapes.find(s => s.id === selected)
  if (chosen && onShape(chosen, p, shapeReach(), measure)) {
    drag = { kind: 'move', id: chosen.id, from: p, start: chosen, live: chosen }
    return
  }
  if (handle && handle !== 'move') {
    drag = { kind: 'frame', handle, from: p, start: frame, live: frame }
    return
  }
  if (tool) {
    selected = undefined
    if (inBox(frame, p)) startDraw(tool, p)
    drawBar()
    repaint()
    return
  }
  const here = shapeAt(shapes, p, shapeReach(), measure)
  if (here) {
    select(here.id)
    drag = { kind: 'move', id: here.id, from: p, start: here, live: here }
    return
  }
  select(undefined)
  if (handle === 'move') drag = { kind: 'frame', handle, from: p, start: frame, live: frame }
  else if (shapes.length === 0) drag = { kind: 'new', from: p, now: p }
})

window.addEventListener('mousemove', event => {
  if (barDrag) {
    barOffset = { x: event.clientX - barDrag.x, y: event.clientY - barDrag.y }
    placeBar()
    return
  }
  if (!picture || other) return
  const p = point(event)
  shiftHeld = event.shiftKey
  loupeAt = p
  if (!drag) {
    canvas.style.cursor = pointerCursor(p)
    if (!history) {
      if (!here) {
        here = true
        post({ type: 'shotHover' })
      }
      pointer = p
      rehover(p)
      probe(p)
      // Moved over a window already lit: only the loupe follows.
      drawLoupe()
    }
    return
  }
  const d = drag
  switch (d.kind) {
    case 'new':
      d.now = p
      break
    case 'frame':
      d.live = dragFrame(d.start, d.handle, p.x - d.from.x, p.y - d.from.y, picture.bounds)
      break
    case 'draw':
      d.shape = stretched(d.shape, d.from, p, event.shiftKey)
      break
    case 'move':
      d.live = moved(d.start, p.x - d.from.x, p.y - d.from.y)
      break
  }
  repaint()
})

window.addEventListener('mouseup', event => {
  if (event.button !== 0) return
  barDrag = undefined
  if (!drag || !picture) return
  const d = drag
  drag = undefined
  switch (d.kind) {
    case 'new': {
      const box = clampBox((event.shiftKey ? squareOf : boxOf)(d.from, d.now), picture.bounds)
      const big = box.width >= MIN_FRAME && box.height >= MIN_FRAME
      if (history) big ? setFrame(box) : repaint()
      else {
        const under = big ? undefined : targetAt(targetList(), d.now, hoverUp)
        takenWindow = under && !under.panel ? picture.windows.indexOf(under) : undefined
        begin(big ? box : (under ?? picture.bounds))
      }
      break
    }
    case 'frame':
      if (d.live !== d.start) setFrame(d.live)
      else repaint()
      break
    case 'draw':
      if (worthKeeping(d.shape)) add(d.shape)
      else repaint()
      break
    case 'move':
      if (history && d.live !== d.start) {
        history = commit(history, { ...history.now, shapes: history.now.shapes.map(s => (s.id === d.id ? d.live : s)) })
        drawBar()
      }
      repaint()
      break
  }
})

/** The pointer went to another monitor before a frame: nothing stays lit here, and the loupe goes. */
function letGo(): void {
  here = false
  if (!picture || history || drag) return
  hovered = hoverDeepest = undefined
  hoverUp = 0
  pointer = loupeAt = undefined
  repaint()
  drawLoupe()
}

// Off the window altogether (another monitor's, before main's word comes): the same.
document.documentElement.addEventListener('mouseleave', () => {
  if (!editor) letGo()
})

function lightTarget(p: Point): void {
  if (!picture) return
  const under = targetAt(targetList(), p, hoverUp)
  if (under === hovered) return
  hovered = under
  repaint()
}

// Before a frame: the wheel goes from a panel to what holds it, and back.
canvas.addEventListener(
  'wheel',
  event => {
    if (!picture || history || drag || other || busy || editor) return
    const p = point(event)
    const most = targetsAt(targetList(), p).length - 1
    hoverUp = Math.max(0, Math.min(most, hoverUp + (event.deltaY < 0 ? 1 : -1)))
    lightTarget(p)
  },
  { passive: true },
)

// A click outside the list closes it, and does nothing else.
window.addEventListener(
  'mousedown',
  event => {
    const target = event.target as Element
    if (micList.hidden || micList.contains(target) || target.closest('.chev')) return
    closeMics()
    if (target === canvas) event.stopPropagation()
  },
  true,
)

micList.addEventListener('mousedown', event => event.preventDefault())

bar.addEventListener('mousedown', event => {
  // The keyboard stays where it was (a text being written), and Space never presses a button.
  event.preventDefault()
  if (barInside && !(event.target as Element).closest('button')) barDrag = { x: event.clientX - barOffset.x, y: event.clientY - barOffset.y }
})

// ---------------------------------------------------------------- the keys

window.addEventListener(
  'keydown',
  event => {
    if (!picture) return
    if (!micList.hidden && event.code === 'Escape') {
      closeMics()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (writing) {
      if (event.key === 'Escape' || (event.key === 'Enter' && event.ctrlKey)) {
        event.preventDefault()
        event.stopPropagation()
        finishWriting()
      }
      return
    }
    if (busy || other) {
      if (event.key === 'Escape' && other) post({ type: 'shotCancel' })
      return
    }
    const code = event.code
    const ctrl = event.ctrlKey
    // The Screenshots window's list takes its own keys (Ctrl+A, the arrows, Delete) while it has the keyboard.
    if (editor && (event.target as Element | null)?.closest?.('#list')) return
    let handled = true
    if (code === 'Escape') {
      if (drag) {
        drag = undefined
        repaint()
      } else if (editor) select(undefined)
      else post({ type: 'shotCancel' })
    } else if (code === 'Space') {
      takenWindow = undefined
      if (history) setFrame(picture.bounds)
      else begin(picture.bounds)
    } else if (code === 'KeyV' && !ctrl && !event.altKey && !event.metaKey && !quick && !editor) setVideo(!video)
    else if (code.startsWith('Arrow') && history && !event.altKey) nudgeBy(code, event.shiftKey ? 10 : 1, ctrl)
    else if (video) {
      if (code === 'Enter' || code === 'NumpadEnter') startRecording()
      else handled = false
    } else if (editor && ctrl && (code === 'KeyC' || code === 'KeyS' || code === 'KeyA')) handled = false
    else if (ctrl && code === 'KeyC') void finish('copy', 'KeyC')
    else if (ctrl && code === 'KeyS') void finish('save')
    else if (ctrl && code === 'KeyE' && !editor) void keep()
    else if (ctrl && code === 'KeyZ') (event.shiftKey ? stepForward : stepBack)()
    else if (ctrl && code === 'KeyY') stepForward()
    else if (code === 'Delete' || code === 'Backspace') handled = removeSelected() || !editor
    else if (!ctrl && !event.altKey && !event.metaKey && history && toolOfCode(code)) pickTool(toolOfCode(code) as Tool)
    else handled = false
    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  },
  true,
)

/** The C of Ctrl+C is down: resolves when it is let go, or soon anyway. */
function released(code: string): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer)
      window.removeEventListener('keyup', onUp, true)
      resolve()
    }
    const onUp = (event: KeyboardEvent) => {
      if (event.code === code) done()
    }
    const timer = setTimeout(done, RELEASE_MS)
    window.addEventListener('keyup', onUp, true)
  })
}

/** The frame with what is drawn on it, flat: the covered parts always worked out in full. */
function flatten(): Promise<ArrayBuffer> {
  const { frame, shapes } = (history as History).now
  return render(frame, shapes)
}

/** A part of the picture with these drawn on it, as a PNG. Drawn at once, encoded after: the picture may change meanwhile. */
async function render(frame: Box, shapes: readonly Shape[]): Promise<ArrayBuffer> {
  const out = document.createElement('canvas')
  out.width = frame.width
  out.height = frame.height
  const c = out.getContext('2d') as CanvasRenderingContext2D
  c.translate(-frame.x, -frame.y)
  c.drawImage(base, 0, 0)
  drawPointer(c)
  for (const shape of shapes) drawShape(c, shape, shapes, false)
  const blob = await new Promise<Blob>((resolve, reject) => out.toBlob(made => (made ? resolve(made) : reject(new Error('no picture'))), 'image/png'))
  return blob.arrayBuffer()
}

/** Into the Screenshots window: the frame as taken (the pointer in it when it is on), the same flat with what is drawn, and the drawings moved into its own pixels, so they stay drawings there. */
async function keep(): Promise<void> {
  if (writing) finishWriting()
  if (busy || !history || video || quick) return
  busy = true
  try {
    const { frame, shapes } = history.now
    const [png, flat] = await Promise.all([render(frame, []), flatten()])
    post({ type: 'shotKeep', png, flat, shapes: shapes.map(shape => moved(shape, -frame.x, -frame.y)), ink })
  } catch (error) {
    busy = false
    say(error instanceof Error ? error.message : String(error))
  }
}

/** `held`: the key that asked for it, down right now. */
async function finish(action: ShotAction, held?: string): Promise<void> {
  if (writing) finishWriting()
  if (busy || !history) return
  busy = true
  try {
    const png = await flatten()
    if (held) await released(held)
    post({ type: 'shotDone', action, png })
  } catch (error) {
    busy = false
    say(error instanceof Error ? error.message : String(error))
  }
}

function say(message: string): void {
  hint.textContent = message
  hint.hidden = false
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => {
    if (history) hint.hidden = true
    else hint.textContent = hintText()
  }, MESSAGE_MS)
}

// ---------------------------------------------------------------- messages

function receive(frame: Extract<ToView, { type: 'shotFrame' }>): void {
  const rgba = new Uint8ClampedArray(frame.rgba.buffer as ArrayBuffer, frame.rgba.byteOffset, frame.rgba.length)
  const bounds = { x: 0, y: 0, width: frame.width, height: frame.height }
  picture = { width: frame.width, height: frame.height, rgba, windows: frame.windows, bounds }
  ink = view = frame.width / frame.cssWidth
  pad = 0
  origin = { x: 0, y: 0 }
  pointerPatch = frame.cursor ? patchOf(frame.cursor) : undefined
  cursorOn = frame.cursorOn
  loupeAt = undefined
  here = false
  canvas.width = base.width = frame.width
  canvas.height = base.height = frame.height
  ;(base.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(rgba, frame.width, frame.height), 0, 0)
  style = frame.style
  lastTool = frame.tool || undefined
  video = frame.video
  quick = frame.quick
  sound = frame.sound
  effects = frame.effects
  takenWindow = undefined
  shutterArmed = frame.shutter
  history = undefined
  selected = undefined
  tool = frame.video || frame.quick ? undefined : lastTool
  drag = undefined
  hovered = undefined
  hoverUp = 0
  hoverDeepest = undefined
  parts = undefined
  pointer = undefined
  micList.hidden = true
  other = false
  busy = false
  barOffset = { x: 0, y: 0 }
  bakes.clear()
  hint.textContent = hintText()
  hint.hidden = false
  bar.hidden = true
  paint()
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      post({ type: 'shotShown' })
    }),
  )
}

/** The pointer's pixels, the screen behind it, as a small picture of its own. */
function patchOf(cursor: NonNullable<Extract<ToView, { type: 'shotFrame' }>['cursor']>): typeof pointerPatch {
  if (!(cursor.width > 0 && cursor.height > 0) || cursor.rgba.length !== cursor.width * cursor.height * 4) return undefined
  const made = document.createElement('canvas')
  made.width = cursor.width
  made.height = cursor.height
  const pixels = new Uint8ClampedArray(cursor.rgba.buffer as ArrayBuffer, cursor.rgba.byteOffset, cursor.rgba.length)
  ;(made.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(pixels, cursor.width, cursor.height), 0, 0)
  return { canvas: made, x: cursor.x, y: cursor.y }
}

// ---------------------------------------------------------------- the Screenshots window

/** One screenshot from main: its picture as taken, its frame and its drawings, the history it had here when it comes back unchanged. */
async function receivePicture(message: Extract<ToView, { type: 'shotsPicture' }>): Promise<void> {
  // What was being changed on the one before reaches main first; drawn now, before its picture goes.
  void flushEdit()
  if (history && shownId !== undefined) histories.set(shownId, history)
  const bitmap = await createImageBitmap(new Blob([message.png as Uint8Array<ArrayBuffer>], { type: 'image/png' }))
  const { width, height } = bitmap
  base.width = width
  base.height = height
  const b = base.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  b.drawImage(bitmap, 0, 0)
  bitmap.close()
  const rgba = b.getImageData(0, 0, width, height).data
  const bounds = { x: 0, y: 0, width, height }
  picture = { width, height, rgba, windows: [], bounds }
  ink = message.ink
  pointerPatch = undefined
  cursorOn = false
  shownId = message.id
  const now = { frame: clampBox(message.frame, bounds), shapes: message.shapes }
  const kept = histories.get(message.id)
  history = kept && JSON.stringify(kept.now) === JSON.stringify(now) ? kept : historyOf(now)
  synced = history.now
  nextId = Math.max(nextId, ...history.now.shapes.map(shape => shape.id + 1))
  style = message.style
  lastTool = message.tool || undefined
  tool = lastTool
  selected = undefined
  drag = undefined
  writing = undefined
  write.hidden = true
  loupeAt = undefined
  bakes.clear()
  hint.hidden = true
  layout()
  drawBar()
  paint()
}

/** The picture as large as the window lets it be, never past one of its pixels a pixel of this screen, in the middle of its place. */
function layout(): void {
  if (!picture) return
  const stage = part<HTMLDivElement>('stage').getBoundingClientRect()
  const margin = 20
  const dpr = window.devicePixelRatio || 1
  const fit = Math.min((stage.width - margin * 2) / picture.width, (stage.height - margin * 2) / picture.height, 1 / dpr)
  const cssWidth = Math.max(1, picture.width * fit)
  view = picture.width / cssWidth
  pad = Math.ceil(10 * view)
  canvas.width = picture.width + pad * 2
  canvas.height = picture.height + pad * 2
  const outer = { width: canvas.width / view, height: canvas.height / view }
  const left = stage.left + (stage.width - outer.width) / 2
  const top = stage.top + (stage.height - outer.height) / 2
  canvas.style.left = `${left}px`
  canvas.style.top = `${top}px`
  canvas.style.width = `${outer.width}px`
  canvas.style.height = `${outer.height}px`
  origin = { x: left + pad / view, y: top + pad / view }
}

function scheduleSync(): void {
  if (syncTimer !== undefined) clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => void flushEdit(), SYNC_MS)
}

/** What was changed reaches main now: before an action on it, another screenshot, or the list being dragged from. */
export function flushEdit(): Promise<void> {
  if (syncTimer !== undefined) clearTimeout(syncTimer)
  syncTimer = undefined
  if (writing) finishWriting()
  if (!editor || !history || shownId === undefined || history.now === synced) return Promise.resolve()
  const id = shownId
  const now = history.now
  synced = now
  const flat = render(now.frame, now.shapes)
  return flat.then(
    png => post({ type: 'shotsEdit', id, frame: now.frame, shapes: [...now.shapes], flat: png }),
    error => say(error instanceof Error ? error.message : String(error)),
  )
}

/** Nothing left to show. */
export function clearPicture(): void {
  shownId = undefined
  synced = undefined
  clear()
}

if (editor) {
  new ResizeObserver(() => {
    layout()
    paint()
  }).observe(part<HTMLDivElement>('stage'))
}

function clear(): void {
  picture = undefined
  parts = undefined
  if (probeLater !== undefined) clearTimeout(probeLater)
  probeLater = undefined
  history = undefined
  writing = undefined
  drag = undefined
  write.hidden = true
  hint.hidden = true
  bar.hidden = true
  micList.hidden = true
  sizeLabel.hidden = true
  loupe.hidden = true
  pointerPatch = undefined
  bakes.clear()
  // The screen's pixels go at once, not when the window does.
  canvas.width = canvas.height = base.width = base.height = 0
}

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const message = event.data
  switch (message.type) {
    case 'shotFrame':
      receive(message)
      break
    case 'shotClear':
      clear()
      break
    case 'shotElements':
      if (!picture || history || other) break
      parts = { window: message.window, boxes: message.boxes }
      if (pointer) rehover(pointer)
      break
    case 'shotOther':
      other = true
      hovered = undefined
      hint.hidden = true
      repaint()
      break
    case 'shotAway':
      letGo()
      break
    case 'shotResume':
      busy = false
      if (message.message) say(message.message)
      break
    case 'shotsPicture':
      if (editor) void receivePicture(message)
      break
  }
})

// Text on the canvas needs its font in memory first.
void document.fonts.load(fontText(26), 'Aя')
if (!editor) post({ type: 'shotReady' })
