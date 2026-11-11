import { describe, expect, it } from 'vitest'
import { loudnessOf } from './loudness'

const at = (db: number) => loudnessOf(10 ** (db / 10))

describe('loudnessOf', () => {
  it('draws silence and a quiet room as nothing', () => {
    expect(loudnessOf(0)).toBe(0)
    expect(at(-70)).toBe(0)
    expect(at(-55)).toBe(0)
  })

  it('shows an unprocessed voice well above the dots', () => {
    expect(at(-35)).toBeCloseTo(0.5)
    expect(at(-30)).toBeGreaterThan(0.6)
  })

  it('tops out at −15 dB', () => {
    expect(at(-15)).toBe(1)
    expect(at(0)).toBe(1)
  })
})
