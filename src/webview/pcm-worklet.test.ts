import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

describe('PCM worklet completion', () => {
  it.each([0, 1, 127, 128, 1599, 1600, 1601, 2560, 7999])('delivers every one of %i samples before its acknowledgement', count => {
    const messages: (Float32Array | { type: string })[] = []
    let Processor: new () => { port: { onmessage(event: { data: string }): void }; process(inputs: Float32Array[][]): boolean }
    class Base {
      port = { onmessage: undefined, postMessage: (value: Float32Array | { type: string }) => messages.push(value) }
    }
    const code = ts.transpile(readFileSync('src/webview/pcm-worklet.ts', 'utf8'), { target: ts.ScriptTarget.ES2022 })
    runInNewContext(code, { AudioWorkletProcessor: Base, Float32Array, registerProcessor: (_: string, cls: typeof Processor) => { Processor = cls } })
    const processor = new Processor!()
    const input = Float32Array.from({ length: count }, (_, i) => i / Math.max(1, count))
    for (let at = 0; at < input.length; at += 128) processor.process([[input.subarray(at, at + 128)]])
    processor.port.onmessage({ data: 'flush' })
    expect(messages.at(-1)).toEqual({ type: 'flushed', samples: count })
    const actual = messages.flatMap(m => m instanceof Float32Array ? [...m] : [])
    expect(actual).toEqual([...input])
    const sent = actual.length
    processor.port.onmessage({ data: 'flush' })
    expect(messages.flatMap(m => m instanceof Float32Array ? [...m] : [])).toHaveLength(sent)
    expect(processor.process([[new Float32Array(128)]])).toBe(false)
  })
})
