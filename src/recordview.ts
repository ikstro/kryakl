// What a recording does to its picture, with no window or canvas in it: where the
// view is when it zooms, and what a click leaves on the screen. All in the pixels
// of what is recorded (the window, the monitor or the piece of it), so it is tested.

import type { Box, Point } from './shotmodel'

export type Size = { width: number; height: number }

/** How long a zoom made by a click stays after the last click. */
export const ZOOM_HOLD_MS = 2500
/** The middle of the view the pointer may wander in before the view follows it. */
const DEAD_ZONE = 0.6
/** How quickly the view moves: settled in about 0.7 s, starting and ending softly. */
const SPRING = 8
/** A slower clock (a busy computer) must not make the view jump. */
const LONGEST_STEP_MS = 200
/** As good as not zoomed: the next zoom starts from where it is asked, with no slide across the screen. */
const AS_GOOD_AS_OUT = 1.01

export type Zoom = {
  /** `click` ends by itself, `key` when the key is pressed again. */
  mode: 'out' | 'click' | 'key'
  until: number
  /** Where the view is heading, its middle. */
  target: Point
  /** Where it is now, and how fast each moves. */
  x: number
  y: number
  scale: number
  vx: number
  vy: number
  vs: number
}

export function zoomOut(size: Size): Zoom {
  const x = size.width / 2
  const y = size.height / 2
  return { mode: 'out', until: 0, target: { x, y }, x, y, scale: 1, vx: 0, vy: 0, vs: 0 }
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/** The middle of a view that stays inside what is recorded. */
function keepInside(p: Point, strength: number, size: Size): Point {
  const halfW = size.width / strength / 2
  const halfH = size.height / strength / 2
  return { x: clamp(p.x, halfW, size.width - halfW), y: clamp(p.y, halfH, size.height - halfH) }
}

function zoomInto(zoom: Zoom, mode: 'click' | 'key', at: Point, now: number, strength: number, size: Size): Zoom {
  const target = keepInside(at, strength, size)
  const fresh = zoom.scale < AS_GOOD_AS_OUT
  return { ...zoom, mode, target, until: now + ZOOM_HOLD_MS, ...(fresh ? { x: target.x, y: target.y, vx: 0, vy: 0 } : {}) }
}

/** A click: zooms in on it when out; when zoomed by a click, it stays longer. A zoom held by the key is left alone. */
export function zoomClicked(zoom: Zoom, at: Point, now: number, strength: number, size: Size): Zoom {
  if (zoom.mode === 'key') return zoom
  if (zoom.mode === 'click') return { ...zoom, until: now + ZOOM_HOLD_MS }
  return zoomInto(zoom, 'click', at, now, strength, size)
}

/** The key: in at the pointer, or out however it came in. */
export function zoomKeyed(zoom: Zoom, at: Point, now: number, strength: number, size: Size): Zoom {
  return zoom.mode === 'out' ? zoomInto(zoom, 'key', at, now, strength, size) : { ...zoom, mode: 'out' }
}

/** The target moves only as far as keeps the pointer inside the dead zone. */
function followed(target: Point, cursor: Point, strength: number, size: Size): Point {
  const zoneW = (size.width / strength / 2) * DEAD_ZONE
  const zoneH = (size.height / strength / 2) * DEAD_ZONE
  return keepInside({ x: clamp(target.x, cursor.x - zoneW, cursor.x + zoneW), y: clamp(target.y, cursor.y - zoneH, cursor.y + zoneH) }, strength, size)
}

/** A critically damped spring, solved exactly, so that any length of step is stable: it starts and stops softly and never overshoots. */
function spring(value: number, speed: number, target: number, seconds: number): [number, number] {
  const off = value - target
  const decay = Math.exp(-SPRING * seconds)
  const part = (speed + SPRING * off) * seconds
  return [target + (off + part) * decay, (speed - SPRING * part) * decay]
}

/** One step of the clock; `cursor` undefined while the pointer is outside what is recorded. */
export function zoomStep(zoom: Zoom, cursor: Point | undefined, stepMs: number, now: number, strength: number, size: Size): Zoom {
  const mode = zoom.mode === 'click' && now >= zoom.until ? 'out' : zoom.mode
  const target = mode !== 'out' && cursor ? followed(zoom.target, cursor, strength, size) : zoom.target
  const seconds = clamp(stepMs, 0, LONGEST_STEP_MS) / 1000
  const [x, vx] = spring(zoom.x, zoom.vx, target.x, seconds)
  const [y, vy] = spring(zoom.y, zoom.vy, target.y, seconds)
  const [scale, vs] = spring(zoom.scale, zoom.vs, mode === 'out' ? 1 : strength, seconds)
  return { ...zoom, mode, target, x, y, scale: Math.max(1, scale), vx, vy, vs }
}

/** The part of what is recorded that fills the video now. */
export function viewOf(zoom: Zoom, size: Size): Box {
  const scale = Math.max(1, zoom.scale)
  const width = size.width / scale
  const height = size.height / scale
  return { x: clamp(zoom.x - width / 2, 0, size.width - width), y: clamp(zoom.y - height / 2, 0, size.height - height), width, height }
}

/** A point of what is recorded, in the finished video. */
export function toOutput(p: Point, view: Box, size: Size): Point {
  return { x: ((p.x - view.x) * size.width) / view.width, y: ((p.y - view.y) * size.height) / view.height }
}

// ---------------------------------------------------------------- what a click leaves

export const RING_MS = 400

export type Ring = Point & { at: number; right: boolean }

export function liveRings(rings: readonly Ring[], now: number): Ring[] {
  return rings.filter(ring => now - ring.at < RING_MS)
}

/** A ring grows out of the click and fades: its size follows the video's, so it looks the same at 720p and 1440p. */
export function ringLook(ring: Ring, now: number, videoHeight: number): { radius: number; alpha: number; line: number } {
  const age = clamp((now - ring.at) / RING_MS, 0, 1)
  const grown = 1 - (1 - age) * (1 - age)
  return { radius: Math.max(16, videoHeight * 0.026) * (0.3 + 0.7 * grown), alpha: 1 - age, line: Math.max(2.5, videoHeight * 0.0028) }
}

/** The soft circle that shows where the pointer is. */
export function haloRadius(videoHeight: number): number {
  return Math.max(14, videoHeight * 0.022)
}
