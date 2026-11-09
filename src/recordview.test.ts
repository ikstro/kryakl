import { describe, expect, test } from 'vitest'

import { haloRadius, liveRings, RING_MS, ringLook, toOutput, viewOf, ZOOM_HOLD_MS, zoomClicked, zoomKeyed, zoomOut, zoomStep, type Ring, type Zoom } from './recordview'
import type { Point } from './shotmodel'

const size = { width: 2560, height: 1440 }
const FRAME = 1000 / 30
const STRENGTH = 2

/** The clock running for `ms`, the pointer where it is. */
function run(zoom: Zoom, cursor: Point | undefined, from: number, ms: number): Zoom {
  let z = zoom
  for (let now = from + FRAME; now <= from + ms; now += FRAME) {
    z = zoomStep(z, cursor, FRAME, now, STRENGTH, size)
    const view = viewOf(z, size)
    expect(view.x).toBeGreaterThanOrEqual(0)
    expect(view.y).toBeGreaterThanOrEqual(0)
    expect(view.x + view.width).toBeLessThanOrEqual(size.width + 1e-6)
    expect(view.y + view.height).toBeLessThanOrEqual(size.height + 1e-6)
  }
  return z
}

describe('a zoom by a click', () => {
  const at = { x: 800, y: 500 }

  test('goes in softly, on the click, then out by itself', () => {
    const clicked = zoomClicked(zoomOut(size), at, 0, STRENGTH, size)
    expect(clicked.mode).toBe('click')
    // The first step barely moves: it starts softly.
    expect(zoomStep(clicked, at, FRAME, FRAME, STRENGTH, size).scale).toBeLessThan(1.1)
    const zoomed = run(clicked, at, 0, 1200)
    expect(zoomed.scale).toBeCloseTo(STRENGTH, 1)
    const view = viewOf(zoomed, size)
    expect(view.width).toBeCloseTo(1280, -1)
    expect(view.x + view.width / 2).toBeCloseTo(800, -1)
    const later = run(zoomed, at, 1200, ZOOM_HOLD_MS + 1500)
    expect(later.mode).toBe('out')
    expect(later.scale).toBeCloseTo(1, 1)
  })

  test('another click makes it stay longer', () => {
    const clicked = zoomClicked(zoomOut(size), at, 0, STRENGTH, size)
    const again = zoomClicked(clicked, { x: 900, y: 500 }, 2000, STRENGTH, size)
    expect(again.until).toBe(2000 + ZOOM_HOLD_MS)
    expect(again.target).toEqual(clicked.target)
    expect(run(again, at, 2000, ZOOM_HOLD_MS - 200).mode).toBe('click')
  })

  test('near the edge the view stays inside the picture', () => {
    const corner = zoomClicked(zoomOut(size), { x: 5, y: 5 }, 0, STRENGTH, size)
    expect(corner.target).toEqual({ x: 640, y: 360 })
    const view = viewOf(run(corner, { x: 5, y: 5 }, 0, 1500), size)
    expect(view.x).toBeCloseTo(0, 0)
    expect(view.y).toBeCloseTo(0, 0)
  })

  test('starts where it is asked, with no slide from the last place', () => {
    const before = run(zoomClicked(zoomOut(size), { x: 2000, y: 1000 }, 0, STRENGTH, size), undefined, 0, 7000)
    expect(before.scale).toBeLessThan(1.01)
    const next = zoomClicked(before, at, 7000, STRENGTH, size)
    expect(next.x).toBe(800)
    expect(next.y).toBe(500)
  })
})

describe('following the pointer', () => {
  const at = { x: 1280, y: 720 }
  const zoomed = run(zoomKeyed(zoomOut(size), at, 0, STRENGTH, size), at, 0, 2000)

  test('inside the middle of the view nothing moves', () => {
    const still = run(zoomed, { x: 1280 + 300, y: 720 + 100 }, 2000, 500)
    expect(still.target).toEqual(zoomed.target)
  })

  test('near the view\'s edge the view comes along', () => {
    const moved = run(zoomed, { x: 2000, y: 720 }, 2000, 1500)
    expect(moved.target.x).toBeCloseTo(2000 - 640 * 0.6, 3)
    expect(moved.target.y).toBe(720)
    const view = viewOf(moved, size)
    expect(2000).toBeLessThan(view.x + view.width)
  })

  test('a pointer outside what is recorded is not followed', () => {
    expect(run(zoomed, undefined, 2000, 500).target).toEqual(zoomed.target)
  })
})

describe('the key', () => {
  const at = { x: 1000, y: 800 }

  test('in at the pointer, and out on the second press', () => {
    const inside = run(zoomKeyed(zoomOut(size), at, 0, STRENGTH, size), at, 0, 1000)
    expect(inside.mode).toBe('key')
    expect(inside.scale).toBeCloseTo(STRENGTH, 1)
    const out = zoomKeyed(inside, at, 1000, STRENGTH, size)
    expect(out.mode).toBe('out')
    expect(run(out, at, 1000, 2000).scale).toBeCloseTo(1, 1)
  })

  test('stays however long; a click does not change it', () => {
    const inside = run(zoomKeyed(zoomOut(size), at, 0, STRENGTH, size), at, 0, 1000)
    const clicked = zoomClicked(inside, { x: 100, y: 100 }, 1000, STRENGTH, size)
    expect(clicked).toBe(inside)
    expect(run(clicked, at, 1000, ZOOM_HOLD_MS * 3).mode).toBe('key')
  })

  test('takes a zoom made by a click out', () => {
    const clicked = zoomClicked(zoomOut(size), at, 0, STRENGTH, size)
    expect(zoomKeyed(clicked, at, 100, STRENGTH, size).mode).toBe('out')
  })
})

describe('marks', () => {
  test('a point of the recording in the zoomed video', () => {
    const view = { x: 640, y: 360, width: 1280, height: 720 }
    expect(toOutput({ x: 640, y: 360 }, view, size)).toEqual({ x: 0, y: 0 })
    expect(toOutput({ x: 1280, y: 720 }, view, size)).toEqual({ x: 1280, y: 720 })
  })

  test('with no zoom a point stays where it is', () => {
    expect(toOutput({ x: 77, y: 33 }, viewOf(zoomOut(size), size), size)).toEqual({ x: 77, y: 33 })
  })

  test('a ring grows, fades and goes', () => {
    const ring: Ring = { x: 10, y: 10, at: 1000, right: false }
    const start = ringLook(ring, 1000, 1440)
    const later = ringLook(ring, 1000 + RING_MS / 2, 1440)
    expect(later.radius).toBeGreaterThan(start.radius)
    expect(later.alpha).toBeLessThan(start.alpha)
    expect(liveRings([ring], 1000 + RING_MS - 1)).toEqual([ring])
    expect(liveRings([ring], 1000 + RING_MS)).toEqual([])
  })

  test('marks keep their size in a small video', () => {
    expect(ringLook({ x: 0, y: 0, at: 0, right: true }, RING_MS, 200).radius).toBeGreaterThanOrEqual(16)
    expect(haloRadius(200)).toBeGreaterThanOrEqual(14)
  })
})
