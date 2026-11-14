import { ipcRenderer } from 'electron'
import { StreamRecorder } from '../../src/webview/recorder'
import type { HostCall } from '../../src/protocol'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function run() {
  const rows: unknown[] = []
  let partial = false
  for (const fallback of [false, true]) {
    for (const duration of [45, 90, 175, 325, 475]) {
      const source = new AudioContext({ sampleRate: 16000 })
      const destination = source.createMediaStreamDestination()
      const oscillator = source.createOscillator()
      oscillator.frequency.value = 440
      const gain = source.createGain()
      gain.gain.value = 0.2
      oscillator.connect(gain).connect(destination)
      oscillator.start()
      await source.resume()
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => destination.stream })
      let streamed = 0
      let final = 0
      let submitted = 0
      const call = async (request: HostCall) => {
        if (request.call !== 'speech') throw new Error('unexpected request')
        const n = request.body instanceof Uint8Array ? request.body.byteLength / 2 : 0
        if (request.method === 'PUT') {
          streamed += n
          if (fallback) return { ok: false, status: 404, error: 'simulate expired session' }
        } else if (request.route.includes('/finish') || request.route.includes('?')) {
          final = n
          submitted++
        }
        return { ok: true, data: { pending: 0, heard: '', text: 'Synthetic audio.', language: 'en', sure: 1 } }
      }
      const recorder = new StreamRecorder(call, 'synthetic', ['en'], () => {})
      try {
        await recorder.start()
        await sleep(duration)
        await recorder.finish()
        const captured = recorder.capturedSamples
        const received = fallback ? final : streamed + final
        if (!captured || received !== captured || submitted !== 1) throw new Error(`PCM mismatch: ${captured} / ${received}`)
        partial ||= captured % 1600 !== 0
        rows.push({ fallback, duration, captured, received, tail: captured % 1600 })
      } finally {
        oscillator.stop()
        await source.close()
      }
    }
  }
  if (!partial) throw new Error('No partial worklet block exercised')
  return { ok: true, cases: rows, physicalMicrophone: false }
}
run().then(result => ipcRenderer.send('audio-probe', result), error => ipcRenderer.send('audio-probe', { ok: false, error: String(error) }))
