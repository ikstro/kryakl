// A screenshot's frame and what is drawn on it: geometry and history, with no
// window or canvas, so all of it is tested. Every coordinate is in the
// picture's own pixels (physical ones); the page turns the pointer's into these.

export type Point = { x: number; y: number }
export type Box = { x: number; y: number; width: number; height: number }

export const SHOT_COLORS = ['#e5383b', '#ffd60a', '#2fb344', '#2f6fed', '#111111', '#ffffff'] as const

/** The look of what is drawn: its color, one of three sizes, and a dashed outline. */
export type ShotStyle = { color: string; size: 0 | 1 | 2; dashed: boolean }

export const SHOT_STYLE: ShotStyle = { color: SHOT_COLORS[0], size: 1, dashed: false }

/** A style as kept in the settings, whatever the file holds. */
export function shotStyleOf(raw: unknown): ShotStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ShotStyle, unknown>>
  return {
    color: SHOT_COLORS.includes(r.color as (typeof SHOT_COLORS)[number]) ? (r.color as string) : SHOT_STYLE.color,
    size: r.size === 0 || r.size === 1 || r.size === 2 ? r.size : SHOT_STYLE.size,
    dashed: r.dashed === true,
  }
}

/** The tools in the bar's order, each with the physical key that picks it, in any keyboard layout. */
export const SHOT_TOOLS = [
  { id: 'rect', code: 'KeyR', letter: 'R' },
  { id: 'ellipse', code: 'KeyE', letter: 'E' },
  { id: 'arrow', code: 'KeyA', letter: 'A' },
  { id: 'line', code: 'KeyL', letter: 'L' },
  { id: 'pen', code: 'KeyF', letter: 'F' },
  { id: 'marker', code: 'KeyH', letter: 'H' },
  { id: 'text', code: 'KeyT', letter: 'T' },
  { id: 'step', code: 'KeyN', letter: 'N' },
  { id: 'blur', code: 'KeyB', letter: 'B' },
  { id: 'pixel', code: 'KeyP', letter: 'P' },
] as const

export type Tool = (typeof SHOT_TOOLS)[number]['id']

export function toolOfCode(code: string): Tool | undefined {
  return SHOT_TOOLS.find(tool => tool.code === code)?.id
}

/** A tool as kept in the settings, whatever the file holds; '' for none yet. */
export function shotToolOf(raw: unknown): Tool | '' {
  return SHOT_TOOLS.find(tool => tool.id === raw)?.id ?? ''
}

/** What a tool's second row offers: color and size, and a dashed outline; blur and pixels offer nothing. */
export function optionsOf(tool: Tool): { color: boolean; size: boolean; dashed: boolean } {
  if (tool === 'blur' || tool === 'pixel') return { color: false, size: false, dashed: false }
  return { color: true, size: true, dashed: tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'line' }
}

export type Shape =
  | { id: number; kind: 'rect' | 'ellipse' | 'blur' | 'pixel'; box: Box; style: ShotStyle }
  | { id: number; kind: 'arrow' | 'line'; from: Point; to: Point; style: ShotStyle }
  | { id: number; kind: 'pen' | 'marker'; points: Point[]; style: ShotStyle }
  | { id: number; kind: 'text'; at: Point; text: string; style: ShotStyle }
  | { id: number; kind: 'step'; at: Point; style: ShotStyle }

/** The frame and what is drawn: one step of the history. */
export type Scene = { frame: Box; shapes: readonly Shape[] }

export type History = { now: Scene; past: readonly Scene[]; future: readonly Scene[] }

/** Undo goes this many steps back. */
const MOST_STEPS = 100

export function historyOf(scene: Scene): History {
  return { now: scene, past: [], future: [] }
}

/** A new step: what was undone is gone. */
export function commit(history: History, now: Scene): History {
  if (now === history.now) return history
  return { now, past: [...history.past, history.now].slice(-MOST_STEPS), future: [] }
}

export function undo(history: History): History {
  const before = history.past[history.past.length - 1]
  if (!before) return history
  return { now: before, past: history.past.slice(0, -1), future: [history.now, ...history.future] }
}

export function redo(history: History): History {
  const after = history.future[0]
  if (!after) return history
  return { now: after, past: [...history.past, history.now], future: history.future.slice(1) }
}

// ---------------------------------------------------------------- boxes

export function boxOf(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** The part of `box` inside `bounds`; an empty box when none is. */
export function clampBox(box: Box, bounds: Box): Box {
  const x = Math.max(box.x, bounds.x)
  const y = Math.max(box.y, bounds.y)
  const right = Math.min(box.x + box.width, bounds.x + bounds.width)
  const bottom = Math.min(box.y + box.height, bounds.y + bounds.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

export function inBox(box: Box, p: Point): boolean {
  return p.x >= box.x && p.x < box.x + box.width && p.y >= box.y && p.y < box.y + box.height
}

/** What a click can take: a window, or a panel inside one. */
export type ShotTarget = Box & { panel?: boolean }

export type ChildWindow = { id: string; parent: string; box: Box }

/** Thinner than this is a splitter or a line, not a panel. */
const MIN_PANEL = 16
/** A child nearly as big as its window is the window's content (a browser's page): the whole window is what is meant. */
const WHOLE_WINDOW = 0.9

/**
 * The panels of one window, in the order a click looks for them: the deepest
 * before what holds it, the sibling on top before the one under it. Each is cut
 * to what shows of its parent. `children` come as Windows lists them, the top one first.
 */
export function panelsOf(top: string, frame: Box, children: readonly ChildWindow[]): Box[] {
  const byParent = new Map<string, ChildWindow[]>()
  for (const child of children) {
    const siblings = byParent.get(child.parent)
    if (siblings) siblings.push(child)
    else byParent.set(child.parent, [child])
  }
  const area = frame.width * frame.height
  const out: Box[] = []
  const walk = (parent: string, shown: Box): void => {
    for (const child of byParent.get(parent) ?? []) {
      const box = clampBox(child.box, shown)
      if (box.width <= 0 || box.height <= 0) continue
      walk(child.id, box)
      const sameAsParent = box.x === shown.x && box.y === shown.y && box.width === shown.width && box.height === shown.height
      if (box.width >= MIN_PANEL && box.height >= MIN_PANEL && !sameAsParent && box.width * box.height < area * WHOLE_WINDOW) out.push(box)
    }
  }
  walk(top, frame)
  return out
}

/** What can be taken at a point, the narrowest first, up to and including its window. `targets`: each window's panels before it, the top window first. */
export function targetsAt<T extends ShotTarget>(targets: readonly T[], p: Point): T[] {
  const chain: T[] = []
  for (const target of targets) {
    if (!inBox(target, p)) continue
    chain.push(target)
    if (!target.panel) break
  }
  return chain
}

/** `up` steps wider than the narrowest at the point; never wider than its window. */
export function targetAt<T extends ShotTarget>(targets: readonly T[], p: Point, up: number): T | undefined {
  const chain = targetsAt(targets, p)
  return chain[Math.min(Math.max(0, up), chain.length - 1)]
}

/** A frame's edges and corners, or its inside. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move'

/** The part of the frame under the point, within `reach` of an edge; undefined outside it. */
export function handleAt(frame: Box, p: Point, reach: number): Handle | undefined {
  const right = frame.x + frame.width
  const bottom = frame.y + frame.height
  if (p.x < frame.x - reach || p.x > right + reach || p.y < frame.y - reach || p.y > bottom + reach) return undefined
  const north = Math.abs(p.y - frame.y) <= reach
  const south = Math.abs(p.y - bottom) <= reach
  const west = Math.abs(p.x - frame.x) <= reach
  const east = Math.abs(p.x - right) <= reach
  const edge = `${north ? 'n' : south ? 's' : ''}${west ? 'w' : east ? 'e' : ''}`
  if (edge) return edge as Handle
  return inBox(frame, p) ? 'move' : undefined
}

/** Smaller than this is no frame: a click, not a drag. */
export const MIN_FRAME = 4

/** The frame after dragging `handle` by (dx, dy): moved whole inside the screen, or one edge moved, never past the opposite one. */
export function dragFrame(from: Box, handle: Handle, dx: number, dy: number, bounds: Box): Box {
  if (handle === 'move') {
    return {
      ...from,
      x: Math.min(Math.max(from.x + dx, bounds.x), bounds.x + bounds.width - from.width),
      y: Math.min(Math.max(from.y + dy, bounds.y), bounds.y + bounds.height - from.height),
    }
  }
  let left = from.x
  let top = from.y
  let right = from.x + from.width
  let bottom = from.y + from.height
  if (handle.includes('w')) left = Math.min(Math.max(left + dx, bounds.x), right - MIN_FRAME)
  if (handle.includes('e')) right = Math.max(Math.min(right + dx, bounds.x + bounds.width), left + MIN_FRAME)
  if (handle.includes('n')) top = Math.min(Math.max(top + dy, bounds.y), bottom - MIN_FRAME)
  if (handle.includes('s')) bottom = Math.max(Math.min(bottom + dy, bounds.y + bounds.height), top + MIN_FRAME)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

// ---------------------------------------------------------------- shapes

/** The stroke of a size, in the picture's pixels; `scale`: the screen's. */
export function strokeOf(style: ShotStyle, scale: number): number {
  return [2, 4, 8][style.size]! * scale
}

/** A text's height of line, in the picture's pixels. */
export function fontOf(style: ShotStyle, scale: number): number {
  return [18, 26, 40][style.size]! * scale
}

/** A number's circle, across. */
export function stepOf(style: ShotStyle, scale: number): number {
  return [26, 34, 46][style.size]! * scale
}

/** The arrow's head for a stroke: its tip is `to`, its back corners these, the shaft ending at `neck`. */
export function arrowHead(from: Point, to: Point, stroke: number): { left: Point; right: Point; neck: Point } {
  const angle = Math.atan2(to.y - from.y, to.x - from.x)
  const length = Math.min(Math.hypot(to.x - from.x, to.y - from.y), Math.max(14, stroke * 4.5))
  const spread = Math.PI / 7
  const back = (a: number) => ({ x: to.x - length * Math.cos(angle + a), y: to.y - length * Math.sin(angle + a) })
  return { left: back(-spread), right: back(spread), neck: { x: to.x - length * 0.7 * Math.cos(angle), y: to.y - length * 0.7 * Math.sin(angle) } }
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const along = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
  return Math.hypot(p.x - (a.x + along * dx), p.y - (a.y + along * dy))
}

/** How far a text or number reaches, measured by the page. */
export type Measure = (shape: Extract<Shape, { kind: 'text' | 'step' }>) => Box

/** The box around a shape, for its selection's outline. */
export function boundsOf(shape: Shape, measure: Measure): Box {
  switch (shape.kind) {
    case 'rect':
    case 'ellipse':
    case 'blur':
    case 'pixel':
      return shape.box
    case 'arrow':
    case 'line':
      return boxOf(shape.from, shape.to)
    case 'pen':
    case 'marker': {
      const xs = shape.points.map(p => p.x)
      const ys = shape.points.map(p => p.y)
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
    }
    default:
      return measure(shape)
  }
}

/** Whether the point is on the shape: on an outline or a line within `reach`, anywhere in a filled one. */
export function onShape(shape: Shape, p: Point, reach: number, measure: Measure): boolean {
  switch (shape.kind) {
    case 'blur':
    case 'pixel':
      return inBox(shape.box, p)
    case 'rect': {
      const { x, y, width, height } = shape.box
      const near = inBox({ x: x - reach, y: y - reach, width: width + 2 * reach, height: height + 2 * reach }, p)
      const within = inBox({ x: x + reach, y: y + reach, width: width - 2 * reach, height: height - 2 * reach }, p)
      return near && !within
    }
    case 'ellipse': {
      const rx = shape.box.width / 2
      const ry = shape.box.height / 2
      if (rx === 0 || ry === 0) return false
      const fx = (p.x - shape.box.x - rx) / rx
      const fy = (p.y - shape.box.y - ry) / ry
      const from = Math.abs(Math.hypot(fx, fy) - 1)
      return from * Math.min(rx, ry) <= reach
    }
    case 'arrow':
    case 'line':
      return distanceToSegment(p, shape.from, shape.to) <= reach
    case 'pen':
    case 'marker':
      return shape.points.some((point, i) => distanceToSegment(p, point, shape.points[i + 1] ?? point) <= reach)
    default:
      return inBox(measure(shape), p)
  }
}

/** The topmost shape under the point. */
export function shapeAt(shapes: readonly Shape[], p: Point, reach: number, measure: Measure): Shape | undefined {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i] as Shape
    if (onShape(shape, p, reach, measure)) return shape
  }
  return undefined
}

export function moved(shape: Shape, dx: number, dy: number): Shape {
  const by = (p: Point) => ({ x: p.x + dx, y: p.y + dy })
  switch (shape.kind) {
    case 'rect':
    case 'ellipse':
    case 'blur':
    case 'pixel':
      return { ...shape, box: { ...shape.box, x: shape.box.x + dx, y: shape.box.y + dy } }
    case 'arrow':
    case 'line':
      return { ...shape, from: by(shape.from), to: by(shape.to) }
    case 'pen':
    case 'marker':
      return { ...shape, points: shape.points.map(by) }
    default:
      return { ...shape, at: by(shape.at) }
  }
}

/** A number's place among the numbers, so removing one renumbers the rest. */
export function stepNumber(shapes: readonly Shape[], id: number): number {
  return shapes.filter(s => s.kind === 'step').findIndex(s => s.id === id) + 1
}

/** Whether a shape, just drawn, is worth keeping: a slip of the mouse is not. */
export function worthKeeping(shape: Shape): boolean {
  switch (shape.kind) {
    case 'rect':
    case 'ellipse':
    case 'blur':
    case 'pixel':
      return shape.box.width >= MIN_FRAME && shape.box.height >= MIN_FRAME
    case 'arrow':
    case 'line':
      return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) >= MIN_FRAME
    case 'pen':
    case 'marker':
      return shape.points.length > 1
    case 'text':
      return shape.text.trim() !== ''
    default:
      return true
  }
}

/** A saved picture's or video's name; `n` over one when that second has one already. */
export function shotFileName(when: Date, n = 1, extension = 'png'): string {
  const two = (value: number) => String(value).padStart(2, '0')
  const date = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}`
  const time = `${two(when.getHours())}-${two(when.getMinutes())}-${two(when.getSeconds())}`
  return `Kryakl ${date} ${time}${n > 1 ? ` (${n})` : ''}.${extension}`
}

// ---------------------------------------------------------------- the bar

/**
 * Where the bar goes (CSS pixels): under the frame, above it when there is no
 * room below, inside at its bottom when there is none above either (a frame as
 * tall as the screen); centred on the frame and kept on the screen.
 */
export function barPlace(frame: Box, screen: { width: number; height: number }, bar: { width: number; height: number }, gap: number): { x: number; y: number; inside: boolean } {
  const centred = frame.x + frame.width / 2 - bar.width / 2
  const x = Math.round(Math.max(gap, Math.min(centred, screen.width - bar.width - gap)))
  const below = frame.y + frame.height + gap
  if (below + bar.height + gap <= screen.height) return { x, y: Math.round(below), inside: false }
  const above = frame.y - gap - bar.height
  if (above >= gap) return { x, y: Math.round(above), inside: false }
  return { x, y: Math.round(Math.max(gap, Math.min(frame.y + frame.height, screen.height) - bar.height - gap * 2)), inside: true }
}
