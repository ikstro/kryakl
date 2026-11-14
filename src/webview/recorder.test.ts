import { afterEach, expect, it, vi } from 'vitest'
import { StreamRecorder } from './recorder'
import type { HostCall } from '../protocol'
type SpeechCall = Extract<HostCall, { call: 'speech' }>

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

function setup(options: { broken?: boolean; ack?: boolean; ackDelta?: number; ready?: boolean; tail?: Float32Array; start?: Promise<MediaStream> } = {}) {
  const stop = vi.fn()
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
  const requests: SpeechCall[] = []
  let captured = 0
  const post = vi.fn(async (request: HostCall) => {
    if (request.call !== 'speech') throw new Error('unexpected call')
    requests.push(request)
    if (options.broken && request.method === 'PUT') return { ok: false, status: 404, error: 'gone' }
    return { ok: true, data: request.method === 'PUT' ? { pending: 0, heard: '' } : { text: 'Done.', language: 'en', sure: 1 } }
  })
  let tap: FakeTap
  class FakeTap {
    onprocessorerror: (() => void) | null = null
    port = {
      onmessage: null as ((event: { data: Float32Array | { type: string } }) => void) | null,
      postMessage: vi.fn(() => {
        queueMicrotask(() => {
          if (options.tail) { captured += options.tail.length; this.port.onmessage?.({ data: options.tail }) }
          if (options.ack !== false) this.port.onmessage?.({ data: { type: 'flushed', samples: captured + (options.ackDelta ?? 0) } as { type: string } })
        })
      }),
      close: vi.fn(),
    }
    constructor() { tap = this; if (options.ready !== false) queueMicrotask(() => this.port.onmessage?.({ data: { type: 'ready' } })) }
    connect(node: unknown) { return node }
  }
  const close = vi.fn(async () => undefined)
  class Context {
    audioWorklet = { addModule: vi.fn(async () => undefined) }
    destination = {}
    createMediaStreamSource() { return { connect: (node: unknown) => node, disconnect: vi.fn() } }
    createGain() { return { gain: { value: 0 }, connect: vi.fn() } }
    resume() { return Promise.resolve() }
    close = close
  }
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => options.start ?? Promise.resolve(stream) } })
  vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('AudioWorkletNode', FakeTap)
  const recorder = new StreamRecorder(post, 'test', ['en'], vi.fn())
  const send = (samples: Float32Array) => { captured += samples.length; tap!.port.onmessage?.({ data: samples }) }
  const audio = () => requests.filter(r => r.call === 'speech' && (r.method === 'PUT' || r.route.includes('/finish') || r.route.includes('?')))
  return { recorder, requests, send, audio, stop, stream, close, failProcessor: () => tap!.onprocessorerror?.() }
}

const pcm = (samples: Float32Array) => [...samples].map(v => Math.max(-32768, Math.min(32767, Math.round(v * 32767))))
const bytes = (body: unknown) => { const b = body as Uint8Array; return [...new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2)] }

it('waits for the worklet tail; finishes once with exactly the captured PCM', async () => {
  const head = Float32Array.from({ length: 4096 }, (_, i) => i % 2 ? -0.25 : 0.5)
  const tail = new Float32Array(960).fill(0.75)
  const s = setup({ tail })
  await s.recorder.start()
  s.send(head)
  const first = s.recorder.finish()
  expect(s.recorder.finish()).toBe(first)
  expect(await first).toEqual({ text: 'Done.', language: 'en', sure: 1 })
  expect(s.audio().flatMap(r => bytes(r.body))).toEqual([...pcm(head), ...pcm(tail)])
  expect(s.audio().filter(r => r.call === 'speech' && r.route.includes('/finish'))).toHaveLength(1)
  expect(s.stop).toHaveBeenCalledOnce()
})

it('sends the same complete sound to the fallback when a session is gone', async () => {
  const head = new Float32Array(4096).fill(0.25)
  const tail = new Float32Array(961).fill(-0.5)
  const s = setup({ broken: true, tail })
  await s.recorder.start()
  s.send(head)
  await s.recorder.finish()
  const fallback = s.requests.find(r => r.call === 'speech' && r.route.startsWith('/dictate?'))!
  expect(bytes(fallback.body)).toEqual([...pcm(head), ...pcm(tail)])
})

it('fails visibly rather than submitting truncated sound when the worklet does not acknowledge', async () => {
  vi.useFakeTimers()
  const s = setup({ ack: false })
  await s.recorder.start()
  s.send(new Float32Array(123).fill(0.5))
  const failed = expect(s.recorder.finish()).rejects.toThrow('capturing')
  await vi.advanceTimersByTimeAsync(1500)
  await failed
  expect(s.audio()).toEqual([])
  expect(s.close).toHaveBeenCalledOnce()
})

it('cancels a pending flush without sending a final transcription', async () => {
  const s = setup({ ack: false })
  await s.recorder.start()
  const finished = expect(s.recorder.finish()).rejects.toMatchObject({ name: 'AbortError' })
  await s.recorder.cancel()
  await finished
  expect(s.requests.filter(r => r.call === 'speech' && r.method === 'POST')).toEqual([])
})

it('stops a microphone that becomes available after cancellation', async () => {
  let ready!: (stream: MediaStream) => void
  const s = setup({ start: new Promise(resolve => { ready = resolve }) })
  const starting = s.recorder.start()
  await s.recorder.cancel()
  ready(s.stream)
  await starting
  expect(s.stop).toHaveBeenCalledOnce()
  expect(s.audio()).toEqual([])
})

it('does not report recording ready without input from the worklet', async () => {
  vi.useFakeTimers()
  const s = setup({ ready: false })
  const failed = expect(s.recorder.start()).rejects.toThrow('capturing')
  await vi.advanceTimersByTimeAsync(5000)
  await failed
  expect(s.recorder.startedAt).toBe(0)
  expect(s.stop).toHaveBeenCalledOnce()
  expect(s.audio()).toEqual([])
})

it('rejects a mismatching sample count instead of accepting a missing tail', async () => {
  const s = setup({ ackDelta: 128 })
  await s.recorder.start()
  s.send(new Float32Array(123))
  await expect(s.recorder.finish()).rejects.toThrow('capturing')
  expect(s.audio()).toEqual([])
  expect(s.stop).toHaveBeenCalledOnce()
})

it('does not submit audio after a processor error', async () => {
  const s = setup()
  await s.recorder.start()
  s.failProcessor()
  await expect(s.recorder.finish()).rejects.toThrow('capturing')
  expect(s.audio()).toEqual([])
  expect(s.stop).toHaveBeenCalledOnce()
})
