import { describe, expect, test } from 'vitest'

import type { ChatAsk, RemoteChat } from './groq'
import { batchPrompt, batches, BATCH_CHARS, createRemoteTranslator, readBatch } from './llm'

describe('batches', () => {
  test('keeps the order and cuts at the character budget', () => {
    const s = ['aaaa', 'bbbb', 'cccc', 'dddd']
    expect(batches([0, 1, 2, 3], s, 8)).toEqual([[0, 1], [2, 3]])
    expect(batches([0, 1, 2, 3], s, 100)).toEqual([[0, 1, 2, 3]])
  })

  test('a sentence longer than the budget goes alone, never dropped', () => {
    const s = ['x'.repeat(50), 'a', 'b']
    expect(batches([0, 1, 2], s, 10)).toEqual([[0], [1, 2]])
  })

  test('only the indices asked for, nothing for none', () => {
    expect(batches([2, 0], ['a', 'b', 'c'], 100)).toEqual([[2, 0]])
    expect(batches([], ['a'])).toEqual([])
  })

  test('the default budget is BATCH_CHARS', () => {
    const s = ['x'.repeat(BATCH_CHARS - 1), 'yy']
    expect(batches([0, 1], s)).toEqual([[0], [1]])
  })
})

describe('batchPrompt', () => {
  test('names the languages and asks for numbered JSON', () => {
    const p = batchPrompt('ru', 'en')
    expect(p).toContain('Russian')
    expect(p).toContain('English')
    expect(p).toContain('JSON')
    expect(p).not.toContain('Reply with the translation only')
  })
})

describe('readBatch', () => {
  test('maps items back by their numbers', () => {
    const out = readBatch(JSON.stringify({ items: [{ i: 2, text: ' two ' }, { i: 0, text: 'zero' }] }), [0, 1, 2])
    expect([...out]).toEqual([[2, 'two'], [0, 'zero']])
  })

  test('tolerates missing items, extra numbers, empty text, wrong types and junk', () => {
    const items = [{ i: 0, text: 'a' }, { i: 9, text: 'extra' }, { i: 1, text: '  ' }, { i: '2', text: 'c' }, { i: 3 }, null]
    expect([...readBatch(JSON.stringify({ items }), [0, 1, 2, 3])]).toEqual([[0, 'a']])
    expect(readBatch('not json', [0]).size).toBe(0)
    expect(readBatch('{"items":5}', [0]).size).toBe(0)
    expect(readBatch('{}', [0]).size).toBe(0)
  })
})

describe('createRemoteTranslator', () => {
  function chatOf(answer: (asked: number[]) => { i: number; text: string }[]) {
    const calls: { asked: number[]; ask: ChatAsk }[] = []
    const chat: RemoteChat = {
      async ask(job, ask) {
        expect(job).toBe('translate')
        const asked = (JSON.parse(ask.messages[1]!.content) as { items: { i: number }[] }).items.map(x => x.i)
        calls.push({ asked, ask })
        return { content: JSON.stringify({ items: answer(asked) }), model: 'm', cut: false }
      },
    }
    return { chat, calls }
  }

  test('lines come back in order, blanks as they were, progress is told', async () => {
    const { chat, calls } = chatOf(asked => asked.map(i => ({ i, text: `T${i}` })))
    const seen: number[] = []
    const out = await createRemoteTranslator(chat).translate(['one', '  ', 'two', 'three'], 'en', 'uk', (i: number) => seen.push(i))
    expect(out).toEqual(['T0', '  ', 'T2', 'T3'])
    expect(seen.sort()).toEqual([0, 2, 3])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.ask.schema?.name).toBe('translation')
    expect(calls[0]!.ask.temperature).toBe(0)
  })

  test('a missing item is asked again alone, and stays undefined when still missing', async () => {
    let round = 0
    const { chat, calls } = chatOf(asked => {
      round++
      return round === 1 ? asked.filter(i => i !== 1).map(i => ({ i, text: `T${i}` })) : []
    })
    const out = await createRemoteTranslator(chat).translate(['a', 'b', 'c'], 'en', 'uk')
    expect(out).toEqual(['T0', undefined, 'T2'])
    expect(calls.map(c => c.asked)).toEqual([[0, 1, 2], [1]])
  })

  test('the second ask fills the gap when it answers', async () => {
    let round = 0
    const { chat } = chatOf(asked => {
      round++
      return round === 1 ? [{ i: 0, text: 'A' }] : asked.map(i => ({ i, text: `again${i}` }))
    })
    expect(await createRemoteTranslator(chat).translate(['a', 'b'], 'en', 'uk')).toEqual(['A', 'again1'])
  })

  test('a language the manifest does not know is refused before any request', async () => {
    const { chat, calls } = chatOf(() => [])
    await expect(createRemoteTranslator(chat).translate(['a'], 'en', 'zz')).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  test('state and prepare follow the languages Kryakl knows', async () => {
    const t = createRemoteTranslator(chatOf(() => []).chat)
    expect(t.direct).toBe(true)
    expect(t.state('uk').status).toBe('ready')
    expect(t.state('zz').status).toBe('unsupported')
    await expect(t.prepare('uk', () => undefined)).resolves.toBeUndefined()
    await expect(t.prepare('zz', () => undefined)).rejects.toThrow()
  })
})
