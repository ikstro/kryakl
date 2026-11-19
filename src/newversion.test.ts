import { describe, expect, it } from 'vitest'

import { LOOK_EVERY_MS, RETRY_MS, dueToLook, latestFrom, newer, numbersOf, offered, readState } from './newversion'

describe("a version's numbers", () => {
  it('reads a tag, a plain version and a test build', () => {
    expect(numbersOf('v0.18.0')).toEqual([0, 18, 0])
    expect(numbersOf('0.18.0')).toEqual([0, 18, 0])
    expect(numbersOf('0.17.4-dictation.2')).toEqual([0, 17, 4])
    expect(numbersOf('1.0.0+build')).toEqual([1, 0, 0])
  })

  it('reads nothing else', () => {
    expect(numbersOf('')).toBeUndefined()
    expect(numbersOf('0.18')).toBeUndefined()
    expect(numbersOf('latest')).toBeUndefined()
    expect(numbersOf('v0.18.0.1')).toBeUndefined()
  })
})

describe('a newer release', () => {
  it('is a higher number, compared as numbers', () => {
    expect(newer('0.18.0', '0.17.4')).toBe(true)
    expect(newer('v0.18.0', '0.17.4')).toBe(true)
    expect(newer('0.10.0', '0.9.9')).toBe(true)
    expect(newer('1.0.0', '0.99.99')).toBe(true)
    expect(newer('0.18.1', '0.18.0')).toBe(true)
  })

  it('is not the same or an older one', () => {
    expect(newer('0.18.0', '0.18.0')).toBe(false)
    expect(newer('0.17.4', '0.18.0')).toBe(false)
    expect(newer('0.9.9', '0.10.0')).toBe(false)
  })

  it('is the release of a test build with the same number', () => {
    expect(newer('0.17.4', '0.17.4-dictation.2')).toBe(true)
    expect(newer('0.18.0', '0.17.4-dictation.2')).toBe(true)
    expect(newer('0.17.3', '0.17.4-dictation.2')).toBe(false)
  })

  it('is never a test build, nor something unreadable', () => {
    expect(newer('0.19.0-beta.1', '0.18.0')).toBe(false)
    expect(newer('nightly', '0.18.0')).toBe(false)
    expect(newer('0.19.0', 'dev')).toBe(false)
  })
})

describe("GitHub's answer", () => {
  it("gives the release's version", () => {
    expect(latestFrom({ tag_name: 'v0.18.0', draft: false, prerelease: false })).toBe('0.18.0')
    expect(latestFrom({ tag_name: '0.18.0' })).toBe('0.18.0')
  })

  it('gives nothing for a draft, a prerelease, a test tag or anything odd', () => {
    expect(latestFrom({ tag_name: 'v0.19.0', draft: true })).toBe('')
    expect(latestFrom({ tag_name: 'v0.19.0', prerelease: true })).toBe('')
    expect(latestFrom({ tag_name: 'v0.19.0-beta.1' })).toBe('')
    expect(latestFrom({ tag_name: 'nightly' })).toBe('')
    expect(latestFrom({ message: 'API rate limit exceeded' })).toBe('')
    expect(latestFrom(null)).toBe('')
    expect(latestFrom('v0.19.0')).toBe('')
  })
})

describe('what is kept between starts', () => {
  it('is read back', () => {
    expect(readState({ latest: '0.18.0', lookedAt: 1000 })).toEqual({ latest: '0.18.0', lookedAt: 1000 })
  })

  it('is nothing seen when the file is odd', () => {
    expect(readState(undefined)).toEqual({ latest: '', lookedAt: 0 })
    expect(readState({ latest: 'https://example.com', lookedAt: 'now' })).toEqual({ latest: '', lookedAt: 0 })
    expect(readState({ latest: '0.19.0-beta.1', lookedAt: -5 })).toEqual({ latest: '', lookedAt: 0 })
  })
})

describe('when GitHub is asked', () => {
  const now = 10 * LOOK_EVERY_MS

  it('at once when never asked', () => {
    expect(dueToLook({ latest: '', lookedAt: 0 }, 0, now)).toBe(true)
  })

  it('a day after the last answer, not before', () => {
    expect(dueToLook({ latest: '0.18.0', lookedAt: now - LOOK_EVERY_MS + 1 }, 0, now)).toBe(false)
    expect(dueToLook({ latest: '0.18.0', lookedAt: now - LOOK_EVERY_MS }, 0, now)).toBe(true)
  })

  it('again when the clock was set back', () => {
    expect(dueToLook({ latest: '0.18.0', lookedAt: now + 5000 }, 0, now)).toBe(true)
  })

  it('an hour after a failure, not before', () => {
    expect(dueToLook({ latest: '', lookedAt: 0 }, now - RETRY_MS + 1, now)).toBe(false)
    expect(dueToLook({ latest: '', lookedAt: 0 }, now - RETRY_MS, now)).toBe(true)
  })
})

describe('the version told', () => {
  it('is the newest seen when it is newer than this one', () => {
    expect(offered({ latest: '0.18.0', lookedAt: 1 }, '0.17.4')).toBe('0.18.0')
  })

  it('is none once this one is as new', () => {
    expect(offered({ latest: '0.18.0', lookedAt: 1 }, '0.18.0')).toBe('')
    expect(offered({ latest: '0.18.0', lookedAt: 1 }, '0.19.0')).toBe('')
    expect(offered({ latest: '', lookedAt: 0 }, '0.17.4')).toBe('')
  })
})
