// A screenshot's pixels, with no window or canvas. Blur and pixels hide what
// is under them for good: each block is first replaced by its average, with a
// little noise on top, so nothing finer than a block reaches the picture, and
// matching a guessed text against the blocks has nothing exact to compare.
// (A plain Gaussian blur, or small tidy blocks, can be read back.)

export type Noise = () => number

/** Noise on a block's average, up and down. */
const NOISE = 3

/** The smallest block, at 100 % scaling: letters of ordinary size fit inside two or three. */
const MIN_BLOCK = 12

export function blockOf(scale: number): number {
  return Math.max(MIN_BLOCK, Math.round(MIN_BLOCK * scale))
}

/** Windows' screen bytes (blue, green, red, undefined) as a page's (red, green, blue, opaque), in place. */
export function bgraToOpaqueRgba(data: Uint8Array): void {
  for (let i = 0; i + 3 < data.length; i += 4) {
    const blue = data[i] as number
    data[i] = data[i + 2] as number
    data[i + 2] = blue
    data[i + 3] = 255
  }
}

/** The pixels of `box` out of a whole picture. */
export function cut(rgba: Uint8ClampedArray | Uint8Array, width: number, box: { x: number; y: number; width: number; height: number }): Uint8ClampedArray {
  const out = new Uint8ClampedArray(box.width * box.height * 4)
  for (let y = 0; y < box.height; y++) {
    const from = (box.y + y) * width * 4 + box.x * 4
    out.set(rgba.subarray(from, from + box.width * 4), y * box.width * 4)
  }
  return out
}

/** Each block replaced by its average, with noise from `noise`; opaque. */
export function pixelated(rgba: Uint8ClampedArray, width: number, height: number, block: number, noise: Noise): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length)
  for (let top = 0; top < height; top += block) {
    for (let left = 0; left < width; left += block) {
      const right = Math.min(left + block, width)
      const bottom = Math.min(top + block, height)
      const sum = [0, 0, 0]
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const at = (y * width + x) * 4
          sum[0]! += rgba[at] as number
          sum[1]! += rgba[at + 1] as number
          sum[2]! += rgba[at + 2] as number
        }
      }
      const count = (right - left) * (bottom - top)
      const color = sum.map(s => s / count + (noise() - 0.5) * 2 * NOISE)
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const at = (y * width + x) * 4
          out[at] = color[0] as number
          out[at + 1] = color[1] as number
          out[at + 2] = color[2] as number
          out[at + 3] = 255
        }
      }
    }
  }
  return out
}

/** One pass of an average over (2 × radius + 1) pixels along one direction, the picture's edge repeated. */
function smoothLine(source: Uint8ClampedArray, target: Uint8ClampedArray, length: number, lines: number, step: number, lineStep: number, radius: number): void {
  const span = radius * 2 + 1
  for (let line = 0; line < lines; line++) {
    const start = line * lineStep
    for (let channel = 0; channel < 3; channel++) {
      const at = (i: number) => source[start + Math.max(0, Math.min(length - 1, i)) * step + channel] as number
      let sum = 0
      for (let i = -radius; i <= radius; i++) sum += at(i)
      for (let i = 0; i < length; i++) {
        target[start + i * step + channel] = sum / span
        sum += at(i + radius + 1) - at(i - radius)
      }
    }
    for (let i = 0; i < length; i++) target[start + i * step + 3] = 255
  }
}

/** The blocks of `pixelated`, softened so it looks like a blur; it only ever sees the blocks. */
export function blurred(rgba: Uint8ClampedArray, width: number, height: number, block: number, noise: Noise): Uint8ClampedArray {
  let from = pixelated(rgba, width, height, block, noise)
  const radius = Math.max(1, Math.round(block * 0.6))
  for (let pass = 0; pass < 2; pass++) {
    const across = new Uint8ClampedArray(from.length)
    smoothLine(from, across, width, height, 4, width * 4, radius)
    const down = new Uint8ClampedArray(from.length)
    smoothLine(across, down, height, width, width * 4, 4, radius)
    from = down
  }
  return from
}

/**
 * A device-independent bitmap for the clipboard: a BITMAPINFOHEADER and the
 * rows from the bottom up, as the programs that read CF_DIB expect.
 */
export function dibFromBgra(bgra: Uint8Array, width: number, height: number): Buffer {
  const header = 40
  const out = Buffer.alloc(header + width * height * 4)
  out.writeUInt32LE(header, 0)
  out.writeInt32LE(width, 4)
  out.writeInt32LE(height, 8)
  out.writeUInt16LE(1, 12)
  out.writeUInt16LE(32, 14)
  out.writeUInt32LE(width * height * 4, 20)
  for (let y = 0; y < height; y++) {
    const from = y * width * 4
    out.set(bgra.subarray(from, from + width * 4), header + (height - 1 - y) * width * 4)
  }
  return out
}
