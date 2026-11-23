import { describe, expect, it } from 'vitest'
import { type LibraryRow, TranscriptWatch } from './transcriptwatch'

const row = (id: string, status: string, source = 'meet'): LibraryRow => ({ id, title: `T ${id}`, source, status })

describe('TranscriptWatch', () => {
  it('announces nothing from the first look', () => {
    const w = new TranscriptWatch()
    expect(w.see([row('a', 'done'), row('b', 'failed'), row('c', 'working')])).toEqual([])
    expect(w.waiting).toBe(true)
  })

  it('announces a transcript seen unfinished once it is done or failed, each once', () => {
    const w = new TranscriptWatch()
    w.see([row('a', 'recording'), row('b', 'queued', 'file')])
    expect(w.see([row('a', 'working'), row('b', 'working', 'file')])).toEqual([])
    expect(w.see([row('a', 'done'), row('b', 'working', 'file')]).map(r => r.id)).toEqual(['a'])
    expect(w.see([row('a', 'done'), row('b', 'failed', 'file')]).map(r => r.id)).toEqual(['b'])
    expect(w.waiting).toBe(false)
    // Split by speaker later: not again.
    w.see([row('a', 'working')])
    expect(w.see([row('a', 'done')])).toEqual([])
  })

  it('announces one made between two looks', () => {
    const w = new TranscriptWatch()
    w.see([row('old', 'done')])
    expect(w.see([row('old', 'done'), row('new', 'done', 'mic')]).map(r => r.id)).toEqual(['new'])
  })

  it('never announces a voice note', () => {
    const w = new TranscriptWatch()
    w.see([row('n', 'working', 'note')])
    expect(w.see([row('n', 'done', 'note'), row('m', 'done', 'note')])).toEqual([])
    expect(w.waiting).toBe(false)
  })

  it('stops waiting for one deleted meanwhile', () => {
    const w = new TranscriptWatch()
    w.see([row('a', 'working')])
    expect(w.see([])).toEqual([])
    expect(w.waiting).toBe(false)
  })
})
