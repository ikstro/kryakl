// Starts the thread that looks at the screens (shot-worker.ts). A thread of its
// own: the main process stays free, its memory goes with it, and a graphics
// driver that hangs cannot take Kryakl along.

import { Worker } from 'node:worker_threads'

import type { ShotReply, ShotRequest } from './shot-worker'

const STALLED_MS = 2000

export function captureScreens(workerPath: string, rects: ShotRequest['rects']): Promise<ShotReply> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData: { rects } satisfies ShotRequest })
    const timer = setTimeout(() => {
      void worker.terminate()
      reject(new Error('the screen did not answer in time'))
    }, STALLED_MS)
    worker.once('message', (reply: ShotReply) => {
      clearTimeout(timer)
      resolve(reply)
    })
    worker.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
  })
}
