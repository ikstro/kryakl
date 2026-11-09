import { describe, expect, test } from 'vitest'

import { bgraToOpaqueRgba, blockOf, blurred, cut, dibFromBgra, pixelated } from './shotpixels'

/** A repeatable source of noise. */
function seeded(seed = 7): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

const silent = () => 0.5

/** A picture of a color per pixel, by rows. */
function image(rows: number[][][]): Uint8ClampedArray {
  return new Uint8ClampedArray(rows.flat().flatMap(([r, g, b]) => [r as number, g as number, b as number, 255]))
}

describe('pixels from the screen', () => {
  test('blue and red change places and every pixel is opaque', () => {
    const data = new Uint8Array([1, 2, 3, 0, 10, 20, 30, 77])
    bgraToOpaqueRgba(data)
    expect([...data]).toEqual([3, 2, 1, 255, 30, 20, 10, 255])
  })

  test('a part of a picture is cut out by rows', () => {
    const whole = image([
      [[1, 0, 0], [2, 0, 0], [3, 0, 0]],
      [[4, 0, 0], [5, 0, 0], [6, 0, 0]],
    ])
    expect([...cut(whole, 3, { x: 1, y: 1, width: 2, height: 1 })]).toEqual([5, 0, 0, 255, 6, 0, 0, 255])
  })

  test('the smallest block is big enough at any scaling', () => {
    expect(blockOf(1)).toBe(12)
    expect(blockOf(0.5)).toBe(12)
    expect(blockOf(2)).toBe(24)
  })
})

describe('what blur and pixels hide', () => {
  // Two different pictures whose 2 × 2 blocks have the same averages.
  const a = image([
    [[0, 0, 0], [100, 100, 100]],
    [[100, 100, 100], [0, 0, 0]],
  ])
  const b = image([
    [[100, 100, 100], [0, 0, 0]],
    [[0, 0, 0], [100, 100, 100]],
  ])

  test('two pictures with equal averages give the same pixels: nothing finer than a block is left', () => {
    expect([...pixelated(a, 2, 2, 2, seeded())]).toEqual([...pixelated(b, 2, 2, 2, seeded())])
    expect([...blurred(a, 2, 2, 2, seeded())]).toEqual([...blurred(b, 2, 2, 2, seeded())])
  })

  test('each block is one color, its average', () => {
    const out = pixelated(a, 2, 2, 2, silent)
    expect([...out.subarray(0, 4)]).toEqual([50, 50, 50, 255])
    expect([...out.subarray(12, 16)]).toEqual([50, 50, 50, 255])
  })

  test('noise moves a block by a little, never by much', () => {
    const out = pixelated(a, 2, 2, 2, () => 1)
    expect(out[0]).toBe(53)
    expect([...pixelated(a, 2, 2, 2, () => 0).subarray(0, 3)]).toEqual([47, 47, 47])
  })

  test('the result is opaque, a block wider than the picture included', () => {
    const out = blurred(a, 2, 2, 12, silent)
    expect(out[3]).toBe(255)
    expect(out[15]).toBe(255)
  })

  test('a blur softens the edge between two blocks', () => {
    const left = Array.from({ length: 4 }, () => [0, 0, 0])
    const right = Array.from({ length: 4 }, () => [200, 200, 200])
    const rows = Array.from({ length: 4 }, () => [...left, ...right])
    const out = blurred(image(rows), 8, 4, 4, silent)
    const at = (x: number) => out[(1 * 8 + x) * 4] as number
    expect(at(3)).toBeGreaterThan(at(0))
    expect(at(4)).toBeLessThan(at(7))
  })
})

describe('the picture for the clipboard', () => {
  test('a header, then the rows from the bottom up', () => {
    const bgra = new Uint8Array([1, 1, 1, 255, 2, 2, 2, 255])
    const dib = dibFromBgra(bgra, 1, 2)
    expect(dib.readUInt32LE(0)).toBe(40)
    expect(dib.readInt32LE(4)).toBe(1)
    expect(dib.readInt32LE(8)).toBe(2)
    expect(dib.readUInt16LE(14)).toBe(32)
    expect([...dib.subarray(40)]).toEqual([2, 2, 2, 255, 1, 1, 1, 255])
  })
})
