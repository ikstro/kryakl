// A recording's strip, in a window Windows leaves out of every capture (recordwindow.ts):
// the recorder itself and its buttons. The page is told what to record and hands
// the bytes over as they come; it never learns where they go.

import { numberText, sizeText, t } from '../i18n'
import type { RecordAction, ToHost, ToView, TutorHost } from '../protocol'
import { clockText, type VideoEffects, type VideoSound } from '../recordmodel'
import { haloRadius, liveRings, ringLook, toOutput, viewOf, zoomClicked, zoomKeyed, zoomOut, zoomStep, type Ring, type Zoom } from '../recordview'
import type { Box, Point } from '../shotmodel'
import { dwmFlag, el } from './dom'
import { lucide, type LucideName } from './lucide'
import { micTrouble, recordingMicrophone } from './recorder'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

// Chromium's, not yet in TypeScript's own list.
declare class MediaStreamTrackProcessor {
  constructor(init: { track: MediaStreamTrack })
  readable: ReadableStream<VideoFrame>
}
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
  constructor(init: { kind: 'video' })
  writable: WritableStream<VideoFrame>
}

dwmFlag()

const post = (message: ToHost) => window.tutorHost.post(message)
const root = document.getElementById('root') as HTMLDivElement

type Begin = Extract<ToView, { type: 'recordBegin' }>
type Done = Extract<ToView, { type: 'recordDone' }>
type Size = { width: number; height: number }
type Extension = 'mp4' | 'webm'

/** A piece every second, once a key frame has been made: at most this much is lost in a crash. */
const SLICE_MS = 1000
const KEY_FRAME_MS = 2000
/** Measured: 21–27 MB a minute at 1080p and 1440p, and text stays sharp. */
const MOST_BITS = 16e6
const BITS_PER_PIXEL = 0.1
const FPS = 30
const AUDIO_BITS = 128_000
/** Nothing from the MP4 recorder in this long: WebM takes over before the person has lost anything. */
const FIRST_BYTES_MS = 6000
const FIRST_FRAME_MS = 3000
/** Both sounds together would clip at full level. */
const TWO_SOUNDS_GAIN = 0.8
const METER_MS = 100
const CLOCK_MS = 250
const DONE_MS = 15_000
const SURE_MS = 3000
const RELEASE_MS = 250

const MIME: Record<Extension, { video: string; audio: string }> = {
  // The size's own level is what the recorder writes; this names the highest it may need.
  mp4: { video: 'video/mp4;codecs=avc1.640033', audio: ',mp4a.40.2' },
  webm: { video: 'video/webm;codecs=vp9', audio: ',opus' },
}

// ---------------------------------------------------------------- the sources

function desktop(source: string, size: Size | undefined, system: boolean): Promise<MediaStream> {
  const fixed = size ? { minWidth: size.width, maxWidth: size.width, minHeight: size.height, maxHeight: size.height } : {}
  return navigator.mediaDevices.getUserMedia({
    audio: system ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source, maxFrameRate: FPS, ...fixed } },
  } as unknown as MediaStreamConstraints)
}

/** A window's real size, from its first picture: the size it was asked for may not be it. */
async function firstFrameSize(track: MediaStreamTrack): Promise<Size> {
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
  const late = new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), FIRST_FRAME_MS))
  const read = await Promise.race([reader.read(), late])
  const frame = read?.value
  const size = frame ? { width: frame.displayWidth, height: frame.displayHeight } : undefined
  frame?.close()
  void reader.cancel().catch(() => undefined)
  if (size) return size
  const { width = 0, height = 0 } = track.getSettings()
  return { width, height }
}

/** A window: opened once to see its size, then at that size for good, as a video whose size changes breaks in the file (measured). */
async function windowStream(source: string, system: boolean): Promise<MediaStream> {
  const first = await desktop(source, undefined, false)
  const size = await firstFrameSize(first.getVideoTracks()[0] as MediaStreamTrack).finally(() => first.getTracks().forEach(track => track.stop()))
  const fixed = { width: size.width - (size.width % 2), height: size.height - (size.height % 2) }
  if (fixed.width < 2 || fixed.height < 2) throw new Error('the window has no size')
  outputSize = fixed
  return desktop(source, fixed, system)
}

/** The part of the monitor asked for: a new picture out of each picture. */
function cropped(track: MediaStreamTrack, box: Box): MediaStreamTrack {
  const generator = new MediaStreamTrackGenerator({ kind: 'video' })
  const cut = new TransformStream<VideoFrame, VideoFrame>({
    transform(frame, controller) {
      try {
        controller.enqueue(new VideoFrame(frame, { visibleRect: box, displayWidth: box.width, displayHeight: box.height }))
      } finally {
        frame.close()
      }
    },
  })
  // It ends with the tracks: a closed stream is no fault.
  void new MediaStreamTrackProcessor({ track }).readable.pipeThrough(cut).pipeTo(generator.writable).catch(() => undefined)
  return generator
}

/** What is drawn over the picture, the duck's yellow for the left button and blue for the right, on a dark edge so that it shows on white too. */
const RING_COLOR = { left: '#ffd60a', right: '#2f6fed' }
const RING_EDGE = 'rgba(0, 0, 0, 0.4)'
const HALO = 'rgba(255, 214, 10, 0.28)'

/** The pointer in pixels of what is recorded; undefined while it is outside. */
let cursorAt: Point | undefined
let rings: Ring[] = []
let zoom: Zoom | undefined
let effects: VideoEffects | undefined
let stopComposing: (() => void) | undefined

function circle(c: OffscreenCanvasRenderingContext2D, p: Point, radius: number): void {
  c.beginPath()
  c.arc(p.x, p.y, radius, 0, Math.PI * 2)
}

function drawMarks(c: OffscreenCanvasRenderingContext2D, view: Box, now: number): void {
  const { height } = outputSize
  if (effects?.halo && cursorAt) {
    c.fillStyle = HALO
    circle(c, toOutput(cursorAt, view, outputSize), haloRadius(height))
    c.fill()
  }
  rings = liveRings(rings, now)
  for (const ring of rings) {
    const look = ringLook(ring, now, height)
    c.globalAlpha = look.alpha
    circle(c, toOutput(ring, view, outputSize), look.radius)
    c.strokeStyle = RING_EDGE
    c.lineWidth = look.line + 2
    c.stroke()
    c.strokeStyle = ring.right ? RING_COLOR.right : RING_COLOR.left
    c.lineWidth = look.line
    c.stroke()
  }
  c.globalAlpha = 1
}

/**
 * The picture drawn afresh on a clock of its own, as a video's size may not change, so a zoom is a part of it scaled up.
 * Capture sends a picture only when the screen changes: the last one is kept and drawn again. Measured at 2560×1440: 1.4 ms a frame, 30 a second.
 */
function composed(track: MediaStreamTrack, crop: Box | undefined, size: Size, chosen: VideoEffects): MediaStreamTrack {
  const generator = new MediaStreamTrackGenerator({ kind: 'video' })
  const writer = generator.writable.getWriter()
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
  let latest: VideoFrame | undefined
  let reading = true
  void (async () => {
    while (reading) {
      const { value, done } = await reader.read()
      if (done) break
      latest?.close()
      latest = value
    }
  })().catch(() => undefined)
  const canvas = new OffscreenCanvas(size.width, size.height)
  const c = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D
  c.imageSmoothingQuality = 'high'
  const offset = crop ?? { x: 0, y: 0 }
  effects = chosen
  zoom = zoomOut(size)
  let last = performance.now()
  const timer = setInterval(() => {
    const now = performance.now()
    zoom = zoomStep(zoom as Zoom, cursorAt, now - last, now, chosen.zoomScale, size)
    last = now
    // The encoder is behind: a frame skipped now is better than all of them late.
    if (!latest || (writer.desiredSize !== null && writer.desiredSize <= 0)) return
    const view = viewOf(zoom, size)
    c.drawImage(latest, offset.x + view.x, offset.y + view.y, view.width, view.height, 0, 0, size.width, size.height)
    drawMarks(c, view, now)
    void writer.write(new VideoFrame(canvas, { timestamp: Math.round(now * 1000) })).catch(() => undefined)
  }, 1000 / FPS)
  stopComposing = () => {
    clearInterval(timer)
    reading = false
    void reader.cancel().catch(() => undefined)
    latest?.close()
    latest = undefined
    void writer.close().catch(() => undefined)
  }
  return generator
}

function pointerMoved(message: Extract<ToView, { type: 'recordCursor' }>): void {
  if (!effects || !zoom) return
  const at = { x: (message.x * outputSize.width) / message.width, y: (message.y * outputSize.height) / message.height }
  cursorAt = message.inside ? at : undefined
  if (stage !== 'rec' || (!message.left && !message.right)) return
  const now = performance.now()
  if (effects.clicks) rings.push({ ...at, at: now, right: !message.left })
  if (effects.zoom) zoom = zoomClicked(zoom, at, now, effects.zoomScale, outputSize)
}

function zoomKeyPressed(): void {
  if (!effects || !zoom || stage !== 'rec') return
  zoom = zoomKeyed(zoom, cursorAt ?? { x: outputSize.width / 2, y: outputSize.height / 2 }, performance.now(), effects.zoomScale, outputSize)
}

// ---------------------------------------------------------------- the sound

class Mixer {
  private readonly context = new AudioContext()
  private readonly out = this.context.createMediaStreamDestination()

  /** One more source in the mix; its level is read after its gain, so it shows what goes into the file. */
  add(stream: MediaStream, gain: number): AnalyserNode {
    const source = this.context.createMediaStreamSource(stream)
    const volume = this.context.createGain()
    volume.gain.value = gain
    const analyser = this.context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(volume)
    volume.connect(analyser)
    volume.connect(this.out)
    return analyser
  }

  get track(): MediaStreamTrack {
    return this.out.stream.getAudioTracks()[0] as MediaStreamTrack
  }

  close(): void {
    void this.context.close()
  }
}

const samples = new Float32Array(1024)

function loudness(analyser: AnalyserNode): number {
  analyser.getFloatTimeDomainData(samples)
  let sum = 0
  for (const v of samples) sum += v * v
  return Math.min(1, Math.sqrt(sum / samples.length) * 4)
}

// ---------------------------------------------------------------- the recording

let stage: 'idle' | 'count' | 'rec' | 'paused' | 'done' = 'idle'
let count = 0
let outputSize: Size = { width: 0, height: 0 }
let recording: MediaStream | undefined
let held: MediaStream[] = []
let mixer: Mixer | undefined
let meters: { name: 'mic' | 'system'; analyser: AnalyserNode; bar?: HTMLElement }[] = []
let hasSound = false
let recorder: MediaRecorder | undefined
let extension: Extension = 'mp4'
let seq = 0
let sending: Promise<void> = Promise.resolve()
let gotBytes = false
let firstBytes: ReturnType<typeof setTimeout> | undefined
let startedAt = 0
let pausedFor = 0
let pausedAt = 0
let wantPause = false
let screenLocked = false
let halted = false
/** Why it ended, when the person did not end it. */
let trouble: string | undefined
let micLost = false
/** The microphone picked is not connected: the one chosen in Windows is heard instead. */
let micMissing = false
let meterTimer: ReturnType<typeof setInterval> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined
let clock: HTMLElement | undefined
let sure = false
let sureTimer: ReturnType<typeof setTimeout> | undefined
let doneTimer: ReturnType<typeof setTimeout> | undefined
let done: Done | undefined

const act = (action: RecordAction) => post({ type: 'recordAct', action })
const elapsed = () => Math.max(0, (Date.now() - startedAt - pausedFor - (pausedAt ? Date.now() - pausedAt : 0)) / 1000)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function keep(stream: MediaStream): MediaStream {
  held.push(stream)
  return stream
}

/** Everything is opened before the count ends, so the first second of the recording is the first second after it. */
async function prepare(begin: Begin): Promise<void> {
  const { sound } = begin
  let source: MediaStream
  if (begin.size) {
    outputSize = begin.crop ? { width: begin.crop.width, height: begin.crop.height } : begin.size
    source = keep(await desktop(begin.source, begin.size, sound.system))
  } else {
    source = keep(await windowStream(begin.source, sound.system))
  }
  const picture = source.getVideoTracks()[0] as MediaStreamTrack
  // Only a window closed, or a monitor unplugged, ends it from here: tracks stopped by this page say nothing.
  picture.addEventListener('ended', () => stop(begin.source.startsWith('window:') ? t('record.windowClosed') : t('record.monitorChanged')))
  const tracks = [begin.effects ? composed(picture, begin.crop, outputSize, begin.effects) : begin.crop ? cropped(picture, begin.crop) : picture]
  const audio = await sounds(sound, source)
  if (audio) tracks.push(audio)
  hasSound = !!audio
  recording = new MediaStream(tracks)
}

async function sounds(sound: VideoSound, source: MediaStream): Promise<MediaStreamTrack | undefined> {
  if (!sound.mic && !sound.system) return undefined
  mixer = new Mixer()
  const gain = sound.mic && sound.system ? TWO_SOUNDS_GAIN : 1
  if (sound.system) meters.push({ name: 'system', analyser: mixer.add(new MediaStream(source.getAudioTracks()), gain) })
  if (sound.mic) {
    let mic: MediaStream
    try {
      const opened = await recordingMicrophone(sound.micName)
      mic = keep(opened.stream)
      micMissing = opened.missing
    } catch (error) {
      // Asked for and not there: better said now than found out after the recording.
      throw new Error(micTrouble(error), { cause: error })
    }
    const [line] = mic.getAudioTracks()
    line?.addEventListener('ended', () => {
      micLost = true
      draw()
    })
    meters.push({ name: 'mic', analyser: mixer.add(mic, gain) })
  }
  return mixer.track
}

function release(): void {
  clearTimeout(firstBytes)
  clearInterval(meterTimer)
  clearInterval(clockTimer)
  stopComposing?.()
  stopComposing = undefined
  for (const stream of held) for (const line of stream.getTracks()) line.stop()
  held = []
  mixer?.close()
  mixer = undefined
  meters = []
  recording = undefined
}

function bitsFor(size: Size): number {
  return Math.round(Math.min(MOST_BITS, size.width * size.height * FPS * BITS_PER_PIXEL))
}

function roll(kind: Extension): void {
  if (!recording) return
  const parts = MIME[kind]
  const mimeType = parts.video + (hasSound ? parts.audio : '')
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    if (kind === 'mp4') return roll('webm')
    return void end(t('record.died'))
  }
  extension = kind
  const made = new MediaRecorder(recording, {
    mimeType,
    videoBitsPerSecond: bitsFor(outputSize),
    audioBitsPerSecond: AUDIO_BITS,
    videoKeyFrameIntervalDuration: KEY_FRAME_MS,
  } as MediaRecorderOptions)
  recorder = made
  made.ondataavailable = event => {
    if (recorder !== made || event.data.size === 0) return
    gotBytes = true
    clearTimeout(firstBytes)
    hand(event.data)
  }
  made.onerror = () => broke(made)
  made.onstop = () => {
    if (recorder === made) void end()
  }
  made.start(SLICE_MS)
  // WebM is the last resort, and a screen with nothing new on it may send nothing for a while.
  if (kind === 'mp4') firstBytes = setTimeout(() => broke(made), FIRST_BYTES_MS)
  if (stage === 'count') begun()
}

/** Pieces go over in the order they were made, however long each takes to read. */
function hand(blob: Blob): void {
  const number = seq++
  const kind = extension
  sending = sending.then(async () => post({ type: 'recordChunk', seq: number, extension: kind, data: await blob.arrayBuffer() }))
}

function broke(made: MediaRecorder): void {
  if (recorder !== made) return
  if (!gotBytes && extension === 'mp4') {
    // Nothing is in the file yet, so the video begins now, and so does its clock.
    clearTimeout(firstBytes)
    recorder = undefined
    if (made.state !== 'inactive') made.stop()
    startedAt = Date.now()
    pausedFor = 0
    roll('webm')
    return
  }
  stop(t('record.died'))
}

function begun(): void {
  stage = 'rec'
  startedAt = Date.now()
  post({ type: 'recordRolling' })
  meterTimer = setInterval(showLevels, METER_MS)
  clockTimer = setInterval(showClock, CLOCK_MS)
  draw()
  // The screen may have been locked during the countdown.
  applyPause()
}

/** Ends what is being recorded; `why` when the person did not ask for it. */
function stop(why?: string): void {
  trouble ??= why
  if (stage === 'count') {
    halted = true
    return
  }
  // A recorder that broke is inactive already, with its last piece still to come: its own stop ends the recording.
  if (recorder) {
    if (recorder.state !== 'inactive') recorder.stop()
    return
  }
  void end()
}

let ending = false

async function end(why?: string): Promise<void> {
  if (ending) return
  ending = true
  const failure = why ?? trouble ?? (micLost ? t('record.micLost') : micMissing ? t('record.micMissing') : undefined)
  const seconds = startedAt ? elapsed() : 0
  await sending
  release()
  post({ type: 'recordEnded', seconds, ...(failure ? { trouble: failure } : {}) })
}

/** Paused by the button, or by a locked screen: it goes on only when neither holds it. */
function applyPause(): void {
  if (!recorder) return
  const want = wantPause || screenLocked
  if (want && recorder.state === 'recording') {
    recorder.pause()
    pausedAt = Date.now()
    stage = 'paused'
    draw()
  } else if (!want && recorder.state === 'paused') {
    recorder.resume()
    pausedFor += Date.now() - pausedAt
    pausedAt = 0
    stage = 'rec'
    draw()
  }
}

async function start(begin: Begin): Promise<void> {
  stage = 'count'
  count = begin.countdown
  draw()
  const counted = (async () => {
    while (count > 1 && !halted) {
      await new Promise(resolve => setTimeout(resolve, 1000))
      count--
      if (stage === 'count') draw()
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  })()
  try {
    await Promise.all([prepare(begin), counted])
  } catch (error) {
    release()
    post({ type: 'recordEnded', seconds: 0, trouble: t('record.cannotStart', { why: messageOf(error) }) })
    return
  }
  if (halted) {
    release()
    post({ type: 'recordEnded', seconds: 0, ...(trouble ? { trouble } : {}) })
    return
  }
  roll('mp4')
}

// ---------------------------------------------------------------- the strip

function button(name: LucideName, title: string, run: () => void, options: { label?: string; cls?: string } = {}): HTMLButtonElement {
  const cls = ['b', options.label ? 'lab' : '', options.cls ?? ''].filter(Boolean).join(' ')
  return el('button', { class: cls, title, 'aria-label': title, onclick: run }, lucide(name, 's'), options.label)
}

const separator = () => el('span', { class: 'sep' })

/** Twice, as what is lost does not come back: the first press only asks. */
function deleteButton(run: () => void): HTMLButtonElement {
  return button('trash-2', t('record.delete'), () => {
    if (!sure) {
      sure = true
      clearTimeout(sureTimer)
      sureTimer = setTimeout(() => {
        sure = false
        draw()
      }, SURE_MS)
      draw()
      return
    }
    clearTimeout(sureTimer)
    sure = false
    run()
  }, sure ? { label: t('record.sure'), cls: 'warn' } : {})
}

function meterNodes(): HTMLElement[] {
  return meters.map(meter => {
    const lost = meter.name === 'mic' && micLost
    const icon: LucideName = meter.name === 'mic' ? (lost ? 'mic-off' : 'mic') : 'volume-2'
    const bar = el('i', {})
    meter.bar = bar
    return el('span', { class: `lv${lost ? ' lost' : ''}`, title: lost ? t('record.micLost') : t(meter.name === 'mic' ? 'shot.mic' : 'shot.system') }, lucide(icon, 's'), el('span', { class: 'lb' }, bar))
  })
}

function showLevels(): void {
  for (const meter of meters) {
    if (!meter.bar) continue
    meter.bar.style.transform = `scaleX(${stage === 'paused' ? 0 : loudness(meter.analyser).toFixed(2)})`
  }
}

function showClock(): void {
  if (clock) clock.textContent = clockText(elapsed())
}

function draw(): void {
  root.replaceChildren(...rows())
}

function rows(): HTMLElement[] {
  clock = undefined
  const aside = micMissing ? [el('div', { class: 'note' }, t('record.micMissing'))] : []
  if (stage === 'count') {
    return [el('div', { class: 'row' }, el('span', { class: 'dot wait' }), el('span', { class: 'say' }, t('record.in', { n: numberText(count) })), separator(), button('x', t('record.close'), () => act('cancel'))), ...aside]
  }
  if (stage === 'rec' || stage === 'paused') {
    const paused = stage === 'paused'
    clock = el('span', { class: 'time' }, clockText(elapsed()))
    const meterItems = meterNodes()
    return [
      el(
        'div',
        { class: 'row' },
        el('span', { class: `dot${paused ? ' held' : ''}` }),
        clock,
        button(paused ? 'play' : 'pause', t(paused ? 'record.resume' : 'record.pause'), () => {
          wantPause = !paused
          applyPause()
        }),
        meterItems.length ? separator() : null,
        ...meterItems,
        separator(),
        deleteButton(() => act('cancel')),
        button('square', t('record.stop'), () => act('stop'), { label: t('record.stop'), cls: 'stop' }),
      ),
      ...aside,
    ]
  }
  if (stage === 'done' && done) {
    const row = el(
      'div',
      { class: 'row' },
      el('span', { class: 'info' }, el('b', {}, clockText(done.seconds)), ` · ${sizeText(done.bytes / 1048576)}`),
      separator(),
      button('play', t('record.open'), () => act('open'), { label: t('record.open') }),
      button('folder', t('record.folder'), () => act('folder')),
      deleteButton(() => act('delete')),
      separator(),
      button('copy', done.keyboard ? `${t('record.copy')} · Ctrl+C` : t('record.copy'), () => act('copy'), { label: t('record.copy'), cls: 'copy' }),
      button('x', done.keyboard ? `${t('record.close')} · Esc` : t('record.close'), () => act('dismiss')),
    )
    return done.note ? [row, el('div', { class: 'note' }, done.note)] : [row]
  }
  return []
}

function holdDismiss(on: boolean): void {
  clearTimeout(doneTimer)
  if (stage === 'done' && !on) doneTimer = setTimeout(() => act('dismiss'), DONE_MS)
}

function showDone(message: Done): void {
  done = message
  stage = 'done'
  sure = false
  draw()
  holdDismiss(document.body.matches(':hover'))
}

/** The C of Ctrl+C is let go first, so that its release does not reach the program coming back. */
function released(code: string): Promise<void> {
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer)
      window.removeEventListener('keyup', up, true)
      resolve()
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === code) finish()
    }
    const timer = setTimeout(finish, RELEASE_MS)
    window.addEventListener('keyup', up, true)
  })
}

document.body.addEventListener('mouseenter', () => holdDismiss(true))
document.body.addEventListener('mouseleave', () => holdDismiss(false))

window.addEventListener('keydown', event => {
  if (stage !== 'done' || !done?.keyboard) return
  if (event.code === 'Escape') act('dismiss')
  else if (event.ctrlKey && event.code === 'KeyC') void released('KeyC').then(() => act('copy'))
  else return
  event.preventDefault()
})

new ResizeObserver(() => {
  const { width, height } = root.getBoundingClientRect()
  if (width > 0) post({ type: 'recordSize', width: Math.ceil(width) + 2, height: Math.ceil(height) + 2 })
}).observe(root)

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const message = event.data
  switch (message.type) {
    case 'recordBegin':
      void start(message)
      break
    case 'recordHalt':
      stop(message.why)
      break
    case 'recordCursor':
      pointerMoved(message)
      break
    case 'recordZoomKey':
      zoomKeyPressed()
      break
    case 'recordHold':
      screenLocked = message.on
      applyPause()
      break
    case 'recordDone':
      showDone(message)
      break
  }
})

post({ type: 'recordReady' })
