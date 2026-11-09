import { describe, expect, test } from 'vitest'

import { clockText, dropFiles, evenBox, micDevice, micNames, micTitle, VIDEO_EFFECTS, VIDEO_SOUND, videoEffectsOf, videoSoundOf } from './recordmodel'

describe('the sound', () => {
  test('the first time, never the microphone', () => {
    expect(VIDEO_SOUND).toEqual({ mic: false, system: true, micName: '' })
    expect(videoSoundOf(undefined)).toEqual(VIDEO_SOUND)
  })

  test('what the person chose stays, and nonsense does not', () => {
    expect(videoSoundOf({ mic: true, system: false })).toEqual({ mic: true, system: false, micName: '' })
    expect(videoSoundOf({ mic: 'yes', system: 0, micName: 7 })).toEqual(VIDEO_SOUND)
    expect(videoSoundOf({ micName: 'USB' }).micName).toBe('USB')
    expect(videoSoundOf({ micName: 'x'.repeat(1000) }).micName).toHaveLength(200)
  })

  const devices = [
    { deviceId: 'default', kind: 'audioinput', label: 'Default - Microphone (USB) (0c76:161e)' },
    { deviceId: 'communications', kind: 'audioinput', label: 'Communications - Microphone (USB) (0c76:161e)' },
    { deviceId: 'a1', kind: 'audioinput', label: 'Microphone (USB) (0c76:161e)' },
    { deviceId: 'a2', kind: 'audioinput', label: 'Headset' },
    { deviceId: 'b1', kind: 'audiooutput', label: 'Speakers' },
    { deviceId: 'c1', kind: 'audioinput', label: '' },
  ]

  test('the list of microphones: real ones, with names', () => {
    expect(micNames(devices)).toEqual(['Microphone (USB) (0c76:161e)', 'Headset'])
  })

  test('a name finds its device, and a name not connected finds none', () => {
    expect(micDevice(devices, 'Headset')).toBe('a2')
    expect(micDevice(devices, 'Gone')).toBeUndefined()
  })

  test('a name as a person reads it', () => {
    expect(micTitle('Microphone (USB) (0c76:161e)')).toBe('Microphone (USB)')
    expect(micTitle('Headset')).toBe('Headset')
  })
})

describe('what a recording adds', () => {
  test('nothing until it is turned on', () => {
    expect(VIDEO_EFFECTS).toEqual({ clicks: false, zoom: false, halo: false, zoomScale: 2 })
    expect(videoEffectsOf(undefined)).toEqual(VIDEO_EFFECTS)
  })

  test('what the person chose stays, and nonsense does not', () => {
    expect(videoEffectsOf({ clicks: true, zoom: true, halo: true, zoomScale: 2.5 })).toEqual({ clicks: true, zoom: true, halo: true, zoomScale: 2.5 })
    expect(videoEffectsOf({ clicks: 'yes', zoomScale: 9 })).toEqual(VIDEO_EFFECTS)
  })
})

describe('an even box', () => {
  test('an even box stays as it is', () => {
    const box = { x: 40, y: 32, width: 800, height: 600 }
    expect(evenBox(box)).toEqual(box)
  })

  test('an odd start moves a pixel back, and an odd side gives up a pixel', () => {
    expect(evenBox({ x: 41, y: 33, width: 801, height: 601 })).toEqual({ x: 40, y: 32, width: 802, height: 602 })
    expect(evenBox({ x: 40, y: 32, width: 801, height: 601 })).toEqual({ x: 40, y: 32, width: 800, height: 600 })
  })
})

describe('the time', () => {
  test.each([
    [0, '00:00'],
    [7.9, '00:07'],
    [754, '12:34'],
    [3723, '1:02:03'],
    [-3, '00:00'],
  ])('%d s reads %s', (seconds, text) => {
    expect(clockText(seconds)).toBe(text)
  })
})

describe('files on the clipboard', () => {
  test('a DROPFILES block: its header, then the names in UTF-16 and a closing zero', () => {
    const block = dropFiles(['C:\\Видео\\a.mp4'])
    expect(block.readUInt32LE(0)).toBe(20)
    expect(block.readUInt32LE(16)).toBe(1)
    expect(block.toString('utf16le', 20)).toBe('C:\\Видео\\a.mp4\0\0')
  })

  test('two files, each ended by its own zero', () => {
    expect(dropFiles(['a', 'b']).toString('utf16le', 20)).toBe('a\0b\0\0')
  })
})
