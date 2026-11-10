// A thread for a screenshot's frame: the parts of a window under the pointer,
// through UI Automation (uia.ts elementsAt). The program answers it itself,
// which can take a while, so the main process never waits on it. Asked
// {id, hwnd, x, y} in the screen's pixels; answers {id, boxes, ms}.

import { parentPort } from 'node:worker_threads'

import { elementsAt, type ElementBox } from './uia'

/** What one look may take; the parts found by then are the answer. */
const BUDGET_MS = 300

parentPort?.on('message', (ask: { id: number; hwnd: string; x: number; y: number }) => {
  const began = Date.now()
  let boxes: ElementBox[] = []
  try {
    boxes = elementsAt(BigInt(ask.hwnd), ask.x, ask.y, BUDGET_MS)
  } catch {
    boxes = []
  }
  parentPort?.postMessage({ id: ask.id, boxes, ms: Date.now() - began })
})
