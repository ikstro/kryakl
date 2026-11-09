// What a screen recording works out, with no window or file in it: the sound it
// is to take, the even box a video needs, the time and size it shows, and the
// list of files the clipboard holds. Kept apart so that it can be tested.

import type { Box } from './shotmodel'

/** What a recording hears: a microphone (`micName`, Windows' own name for it; '' for the one chosen in Windows), and what the computer plays. */
export type VideoSound = { mic: boolean; system: boolean; micName: string }

/** The first time: the computer's sound, and never the microphone until the person turns it on. */
export const VIDEO_SOUND: VideoSound = { mic: false, system: true, micName: '' }

const MOST_MIC_NAME = 200

export function videoSoundOf(raw: unknown): VideoSound {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof VideoSound, unknown>>) : {}
  return {
    mic: typeof r.mic === 'boolean' ? r.mic : VIDEO_SOUND.mic,
    system: typeof r.system === 'boolean' ? r.system : VIDEO_SOUND.system,
    micName: typeof r.micName === 'string' ? r.micName.slice(0, MOST_MIC_NAME) : VIDEO_SOUND.micName,
  }
}

export const ZOOM_SCALES = [1.5, 2, 2.5] as const
export type ZoomScale = (typeof ZOOM_SCALES)[number]

/** What a recording adds to its picture: rings on clicks, zooming in on them, a soft circle round the pointer, and how far a zoom goes. */
export type VideoEffects = { clicks: boolean; zoom: boolean; halo: boolean; zoomScale: ZoomScale }

/** None of it until the person turns it on. */
export const VIDEO_EFFECTS: VideoEffects = { clicks: false, zoom: false, halo: false, zoomScale: 2 }

export function videoEffectsOf(raw: unknown): VideoEffects {
  const r = raw && typeof raw === 'object' ? (raw as Partial<Record<keyof VideoEffects, unknown>>) : {}
  return {
    clicks: r.clicks === true,
    zoom: r.zoom === true,
    halo: r.halo === true,
    zoomScale: ZOOM_SCALES.includes(r.zoomScale as ZoomScale) ? (r.zoomScale as ZoomScale) : VIDEO_EFFECTS.zoomScale,
  }
}

type Device = { deviceId: string; kind: string; label: string }

/** The microphones to offer, by name. Chromium's "default" and "communications" only stand for whichever one Windows has chosen. */
export function micNames(devices: readonly Device[]): string[] {
  return [...new Set(devices.filter(d => d.kind === 'audioinput' && d.label && d.deviceId !== 'default' && d.deviceId !== 'communications').map(d => d.label))]
}

/** The device the name stands for; the name is what is kept, as an id means nothing on another computer. */
export function micDevice(devices: readonly Device[], name: string): string | undefined {
  return devices.find(d => d.kind === 'audioinput' && d.label === name && d.deviceId !== 'default' && d.deviceId !== 'communications')?.deviceId
}

/** A name as a person reads it: Chromium ends it with the device's numbers, "(0c76:161e)". */
export function micTitle(name: string): string {
  return name.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)$/i, '')
}

/** A smaller frame is a slip of the hand, and a video of it nothing anyone can see. */
export const MIN_VIDEO_FRAME = 64

/** A video keeps its colours per pair of pixels: its position and sides must be even, or the encoder refuses or blurs it. */
export function evenBox(box: Box): Box {
  const x = box.x - (box.x % 2)
  const y = box.y - (box.y % 2)
  const right = box.x + box.width
  const bottom = box.y + box.height
  const width = right - x
  const height = bottom - y
  return { x, y, width: width - (width % 2), height: height - (height % 2) }
}

/** The time as a recording shows it: 00:07, 12:34, 1:02:03. */
export function clockText(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const two = (value: number) => String(value).padStart(2, '0')
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = two(total % 60)
  return hours > 0 ? `${hours}:${two(minutes)}:${rest}` : `${two(minutes)}:${rest}`
}

/** A DROPFILES block (CF_HDROP): how the clipboard says "these files", so that a chat or Explorer can paste them. */
export function dropFiles(paths: readonly string[]): Buffer {
  const HEADER = 20
  const list = Buffer.from(paths.map(p => `${p}\0`).join('') + '\0', 'utf16le')
  const out = Buffer.alloc(HEADER + list.length)
  // Where the list starts; the point and the non-client flag stay zero; the names are UTF-16.
  out.writeUInt32LE(HEADER, 0)
  out.writeUInt32LE(1, 16)
  list.copy(out, HEADER)
  return out
}
