import { afterEach, describe, expect, it, vi } from 'vitest'

const windows = vi.hoisted(() => [] as { shown: number; hidden: number; moves: { x: number; y: number }[]; bounds: { x: number; y: number; width: number; height: number }; heard: Record<string, () => void> }[])

vi.mock('electron', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  class BrowserWindow {
    shown = 0
    hidden = 0
    moves: { x: number; y: number }[] = []
    bounds = { x: 0, y: 0, width: 360, height: 64 }
    heard: Record<string, () => void> = {}
    webContents = { send: vi.fn(), on: vi.fn(), setWindowOpenHandler: vi.fn() }
    constructor() {
      windows.push(this)
    }
    on(event: string, listener: () => void) {
      this.heard[event] = listener
    }
    setAlwaysOnTop() {}
    removeMenu() {}
    loadFile() {
      return Promise.resolve()
    }
    isDestroyed() {
      return false
    }
    isVisible() {
      return this.shown > this.hidden
    }
    getBounds() {
      return this.bounds
    }
    setBounds(bounds: BrowserWindow['bounds']) {
      this.bounds = bounds
    }
    setPosition(x: number, y: number) {
      this.moves.push({ x, y })
      this.bounds = { ...this.bounds, x, y }
    }
    showInactive() {
      this.shown++
    }
    hide() {
      this.hidden++
      this.heard.hide?.()
    }
  }
  return {
    BrowserWindow,
    globalShortcut: { register: vi.fn(), unregister: vi.fn() },
    screen: { getDisplayNearestPoint: () => ({ workArea: area }), getDisplayMatching: () => ({ workArea: area }), getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    shell: {},
  }
})
vi.mock('./dwm', () => ({ frameWindow: vi.fn() }))
vi.mock('./winclip', () => ({ handleOf: vi.fn() }))
vi.mock('./winkbd', () => ({ foreground: () => ({ hwnd: 0 }), putOnTop: vi.fn(), sightOf: vi.fn(), windowRect: vi.fn() }))

import { Dictation, type DictationOptions, previewHere, ROOM_WAIT_MS } from './dictation'
import type { DictationMode, ToView } from './protocol'

type Inside = {
  send: (message: ToView) => void
  typeHeard: (mode: DictationMode, heard: string, language: string, sure: number) => Promise<void>
}

function setup(over: Partial<DictationOptions> = {}) {
  const typed: string[] = []
  const logged: unknown[] = []
  const sent: ToView[] = []
  const toEnglish = vi.fn(async (text: string) => ({ text: `EN ${text}` }))
  const edit = vi.fn(async (text: string): Promise<{ text: string; note?: string }> => ({ text: `edited ${text}` }))
  const check = vi.fn()
  const d = new Dictation({
    paste: async (text: string) => void typed.push(text),
    toEnglish,
    edit,
    editing: () => true,
    polish: (text: string) => text,
    space: () => true,
    sound: () => false,
    capturing: () => false,
    captured: vi.fn(),
    check,
    languageOf: () => 'ru',
    log: { add: (entry: unknown) => void logged.push(entry) },
    logged: vi.fn(),
    onChange: vi.fn(),
    ...over,
  } as unknown as DictationOptions)
  const inside = d as unknown as Inside
  inside.send = message => void sent.push(message)
  d.state = 'working'
  return { d, hear: (mode: DictationMode, text: string) => inside.typeHeard(mode, text, 'ru', 0.9), typed, logged, sent, toEnglish, edit, check }
}

describe('a phrase heard, with text editing', () => {
  it('types the phrase as heard while editing is off', async () => {
    const { hear, typed, logged, edit } = setup({ editing: () => false })
    await hear('type', 'привет мир')
    expect(edit).not.toHaveBeenCalled()
    expect(typed).toEqual(['привет мир '])
    expect(logged).toEqual([{ mode: 'type', text: 'привет мир' }])
  })

  it('types the edit, and keeps what was said in the phrase list', async () => {
    const { hear, typed, logged, sent } = setup()
    await hear('type', 'привет мир')
    expect(sent).toContainEqual({ type: 'dictationEditing' })
    expect(typed).toEqual(['edited привет мир '])
    expect(logged).toEqual([{ mode: 'type', text: 'edited привет мир', heard: 'привет мир' }])
  })

  it('edits first and translates what comes of it', async () => {
    const { hear, typed, toEnglish } = setup()
    await hear('english', 'привет мир')
    expect(toEnglish).toHaveBeenCalledWith('edited привет мир', 'ru')
    expect(typed).toEqual(['EN edited привет мир '])
  })

  it('says in the badge why a phrase went as said', async () => {
    const { hear, typed, sent } = setup({ edit: async text => ({ text, note: 'typed as said' }) })
    await hear('type', 'привет мир')
    expect(typed).toEqual(['привет мир '])
    expect(sent).toContainEqual({ type: 'dictationDone', text: 'привет мир', note: 'typed as said' })
  })

  it('types nothing once Esc stopped the edit', async () => {
    let started = (): void => undefined
    const asked = new Promise<void>(resolve => {
      started = resolve
    })
    const { d, hear, typed, logged } = setup({
      edit: (text, signal) =>
        new Promise(resolve => {
          signal.addEventListener('abort', () => resolve({ text }))
          started()
        }),
    })
    const heard = hear('type', 'привет мир')
    await asked
    d.cancel()
    await heard
    expect(typed).toEqual([])
    expect(logged).toEqual([])
  })

  it('never edits spoken practice', async () => {
    const { hear, edit, check } = setup()
    await hear('check', 'I has a dog')
    expect(edit).not.toHaveBeenCalled()
    expect(check).toHaveBeenCalledWith('I has a dog')
  })
})

describe('the typed text, its sound, and a phrase kept for a report', () => {
  it('types by the person\'s rules, in the phrase\'s language, and says nothing was reworded', async () => {
    const polish = vi.fn((text: string) => text.replace('еще', 'ещё').replace(/\.$/, ''))
    const { hear, typed, logged } = setup({ editing: () => false, polish })
    await hear('type', 'еще раз.')
    expect(polish).toHaveBeenCalledWith('еще раз.', 'ru')
    expect(typed).toEqual(['ещё раз '])
    // The rules changed letters, not words: nothing "said" beside the phrase.
    expect(logged).toEqual([{ mode: 'type', text: 'ещё раз' }])
  })

  it('takes an English phrase as English', async () => {
    const polish = vi.fn((text: string) => text)
    const { hear } = setup({ polish })
    await hear('english', 'привет мир')
    expect(polish).toHaveBeenCalledWith('EN edited привет мир', 'en')
  })

  it('types no space after the phrase when the person wants none, the again key too', async () => {
    const { d, hear, typed } = setup({ editing: () => false, space: () => false, log: { add: vi.fn(), last: () => ({ text: 'ещё раз' }) } } as unknown as Partial<DictationOptions>)
    await hear('type', 'привет мир')
    d.typeAgain()
    expect(typed).toEqual(['привет мир', 'ещё раз'])
  })

  it('sounds once the text is typed, when sounds are on', async () => {
    const on = setup({ editing: () => false, sound: () => true })
    await on.hear('type', 'привет мир')
    expect(on.sent).toContainEqual({ type: 'dictationSound', sound: 'done' })
    const off = setup({ editing: () => false })
    await off.hear('type', 'привет мир')
    expect(off.sent.some(m => m.type === 'dictationSound')).toBe(false)
  })

  it('keeps the phrase with its sound for the report: what was heard, what was typed', async () => {
    const captured = vi.fn()
    const { d, hear } = setup({ captured, polish: (text: string) => text.replace(/\.$/, '') })
    const pcm = new Uint8Array([1, 2, 3, 4])
    d.onMessage({ type: 'dictationKept', pcm })
    await hear('type', 'привет мир.')
    expect(captured).toHaveBeenCalledWith({ mode: 'type', heard: 'привет мир.', language: 'ru', sure: 0.9, typed: 'edited привет мир' }, pcm)
  })

  it('keeps a phrase that came to nothing, with why', async () => {
    const captured = vi.fn()
    const { d, hear } = setup({ captured })
    const pcm = new Uint8Array([1, 2])
    d.onMessage({ type: 'dictationKept', pcm })
    await hear('type', '  ')
    expect(captured).toHaveBeenCalledWith({ mode: 'type', heard: '  ', language: 'ru', sure: 0.9, typed: '', error: 'Nothing was heard' }, pcm)
  })

  it('keeps nothing without a sound handed over, and nothing of a phrase thrown away', async () => {
    const captured = vi.fn()
    const plain = setup({ captured })
    await plain.hear('type', 'привет мир')
    expect(captured).not.toHaveBeenCalled()
    const dropped = setup({ captured })
    dropped.d.onMessage({ type: 'dictationKept', pcm: new Uint8Array([1, 2]) })
    dropped.d.cancel()
    await dropped.hear('type', 'привет мир')
    expect(captured).not.toHaveBeenCalled()
  })
})

describe('the panel while a phrase is dictated', () => {
  afterEach(() => {
    vi.useRealTimers()
    windows.length = 0
  })

  /** A phrase started on a computer with the engine ready, the badge's window made. */
  async function started(over: Partial<DictationOptions> = {}) {
    const typed: string[] = []
    const d = new Dictation({
      page: 'dictation.html',
      preload: 'preload.js',
      query: () => ({}),
      speech: { installed: true, ready: true, call: async () => ({ ok: true, data: { id: 'session' } }) },
      paste: async (text: string) => void typed.push(text),
      editing: () => false,
      polish: (text: string) => text,
      space: () => true,
      sound: () => false,
      capturing: () => false,
      captured: vi.fn(),
      languageOf: () => 'ru',
      expected: () => ['ru', 'en'],
      warm: vi.fn(async () => {}),
      offset: () => ({ dx: 0, dy: 0 }),
      panel: () => true,
      trayPoint: () => ({ x: 1900, y: 1060 }),
      log: { add: vi.fn() },
      logged: vi.fn(),
      onChange: vi.fn(),
      moved: vi.fn(),
      ...over,
    } as unknown as DictationOptions)
    const phrase = async () => {
      d.press('type', 'Control+Alt+D')
      await new Promise(resolve => setTimeout(resolve))
    }
    await phrase()
    const badge = windows[windows.length - 1]!
    const heard = (text: string) => (d as unknown as Inside).typeHeard('type', text, 'ru', 0.9)
    return { d, badge, typed, phrase, heard }
  }

  it('opens its session once the card is made ready for it', async () => {
    const order: string[] = []
    let ready = () => {}
    const d = await started({
      warm: () => new Promise<void>(resolve => (ready = () => (order.push('room'), resolve()))),
      speech: { installed: true, ready: true, call: async (_m: string, p: string) => (order.push(p), { ok: true, data: { id: 'session' } }) },
    } as unknown as Partial<DictationOptions>)
    expect(order).toEqual([])
    ready()
    await new Promise(resolve => setTimeout(resolve))
    expect(order).toEqual(['room', '/dictate/sessions'])
    void d
  })

  it('waits for the card no longer than its limit', async () => {
    vi.useFakeTimers()
    const paths: string[] = []
    const d = new Dictation({
      page: 'dictation.html',
      preload: 'preload.js',
      query: () => ({}),
      speech: { installed: true, ready: true, call: async (_m: string, p: string) => (paths.push(p), { ok: true, data: { id: 'session' } }) },
      expected: () => ['ru', 'en'],
      sound: () => false,
      capturing: () => false,
      warm: () => new Promise<void>(() => {}),
      offset: () => ({ dx: 0, dy: 0 }),
      panel: () => true,
      onChange: vi.fn(),
    } as unknown as DictationOptions)
    d.press('type', 'Control+Alt+D')
    await vi.advanceTimersByTimeAsync(ROOM_WAIT_MS - 1)
    expect(paths).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(paths).toEqual(['/dictate/sessions'])
  })

  it('tells the badge to keep the sound only while the person records dictation for a report, and whether to sound', async () => {
    /** The start message the badge gets once its page is ready. */
    const begun = async (over: Partial<DictationOptions>) => {
      const { d, badge } = await started(over)
      d.onMessage({ type: 'dictationReady' })
      const calls = (badge as unknown as { webContents: { send: { mock: { calls: [string, ToView][] } } } }).webContents.send.mock.calls
      return calls.map(c => c[1]).find(m => m.type === 'dictation')
    }
    expect(await begun({})).toMatchObject({ command: 'start', keep: false, sound: false })
    expect(await begun({ capturing: () => true, sound: () => true })).toMatchObject({ command: 'start', keep: true, sound: true })
  })

  it('shows it for a phrase', async () => {
    const { badge } = await started()
    expect(badge.shown).toBe(1)
  })

  it('still makes the window with the setting off, as the recording runs in it, and shows nothing', async () => {
    const { badge } = await started({ panel: () => false })
    expect(badge.shown).toBe(0)
  })

  it('folds away at once where motion is reduced, for this phrase only', async () => {
    const { d, badge, phrase, heard, typed } = await started()
    d.onMessage({ type: 'dictationTuck', fly: false })
    expect(badge.hidden).toBe(1)
    d.state = 'working'
    await heard('привет мир')
    expect(typed).toEqual(['привет мир '])
    expect(badge.shown).toBe(1)
    await phrase()
    expect(badge.shown).toBe(2)
  })

  it('flies into the tray, its corner on the icon, and is hidden there', async () => {
    const { d, badge } = await started()
    vi.useFakeTimers()
    d.onMessage({ type: 'dictationTuck', fly: true })
    vi.advanceTimersByTime(300)
    expect(badge.hidden).toBe(1)
    expect(badge.moves.length).toBeGreaterThan(5)
    const last = badge.moves[badge.moves.length - 1]!
    expect(last.x).toBeGreaterThan(1400)
    expect(last.y).toBeGreaterThan(900)
    // Done flying: it moves no more.
    const moves = badge.moves.length
    vi.advanceTimersByTime(100)
    expect(badge.moves.length).toBe(moves)
  })

  it('does nothing once the phrase is over', async () => {
    const { d, badge } = await started()
    d.state = 'idle'
    d.onMessage({ type: 'dictationTuck', fly: false })
    expect(badge.hidden).toBe(0)
  })

  it('comes up to say why a phrase went as said', async () => {
    const { d, badge, heard } = await started({ editing: () => true, edit: async text => ({ text, note: 'typed as said' }) })
    d.onMessage({ type: 'dictationTuck', fly: false })
    d.state = 'working'
    await heard('вот такая фраза')
    expect(badge.shown).toBe(2)
  })

  it('comes up to say what went wrong, with the setting off too', async () => {
    const { d, badge } = await started({ panel: () => false })
    d.onMessage({ type: 'dictationFailed', message: 'The microphone is off' })
    expect(badge.shown).toBe(1)
  })

  it('keeps a new height for the drop while it is being moved', async () => {
    const { d, badge } = await started()
    badge.heard['will-move']?.()
    d.onMessage({ type: 'dictationHeight', px: 120 })
    expect(badge.bounds.height).toBe(64)
    badge.heard.moved?.()
    expect(badge.bounds.height).toBe(120)
  })
})

describe('a phrase heard by Groq while it is spoken', () => {
  type Stream = { push: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }
  /** A phrase under way to Groq: its stream as the main process holds it, the key just pressed. */
  function streaming(finish: () => Promise<{ text: string; language: string }>, over: Partial<DictationOptions> = {}) {
    const stream: Stream = { push: vi.fn(), finish: vi.fn(finish), cancel: vi.fn() }
    const hear = vi.fn(async () => ({ text: 'again', language: 'ru' }))
    const s = setup({ editing: () => false, expected: () => ['ru', 'en'], remote: { on: () => true, hear, stream: () => stream }, ...over } as Partial<DictationOptions>)
    Object.assign(s.d as unknown as Record<string, unknown>, { byRemote: true, stream })
    return { ...s, stream, hear }
  }
  const pcm = (...samples: number[]) => new Uint8Array(Int16Array.from(samples).buffer)
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))

  it('hands the sound on as it comes, and types the whole text at the key', async () => {
    const { d, stream, typed } = streaming(async () => ({ text: 'привет мир', language: 'ru' }))
    d.onMessage({ type: 'dictationPcm', pcm: pcm(1, 2, 3), last: false })
    expect(stream.push).toHaveBeenCalledWith(Int16Array.from([1, 2, 3]))
    d.onMessage({ type: 'dictationPcm', pcm: pcm(4), last: true })
    await settle()
    expect(stream.finish).toHaveBeenCalledTimes(1)
    expect(typed).toEqual(['привет мир '])
  })

  it('sends the whole sound to the engine here when Groq failed, and says so', async () => {
    const call = vi.fn(async () => ({ ok: true, data: { text: 'привет', language: 'ru', sure: 1 } }))
    const { d, typed, sent } = streaming(async () => Promise.reject(new Error('offline')), { speech: { installed: true, ready: true, call } } as unknown as Partial<DictationOptions>)
    d.onMessage({ type: 'dictationPcm', pcm: pcm(1, 2), last: false })
    d.onMessage({ type: 'dictationPcm', pcm: pcm(3), last: true })
    await settle()
    expect(call).toHaveBeenCalledWith('POST', expect.stringContaining('&format=pcm16'), pcm(1, 2, 3))
    expect(typed).toEqual(['привет '])
    expect(sent.some(m => m.type === 'dictationDone' && !!m.note)).toBe(true)
  })

  it('holds the sound for the again key as a WAV when nothing here can hear it', async () => {
    const { d, typed, hear, sent } = streaming(async () => Promise.reject(new Error('offline')), { speech: { installed: false, ready: false, call: vi.fn() } } as unknown as Partial<DictationOptions>)
    d.onMessage({ type: 'dictationPcm', pcm: pcm(1, 2, 3, 4), last: true })
    await settle()
    expect(sent.some(m => m.type === 'dictationError')).toBe(true)
    expect(typed).toEqual([])
    d.typeAgain()
    await settle()
    const [audio, mime, seconds] = hear.mock.calls[0] as unknown as [Uint8Array, string, number]
    expect(mime).toBe('audio/wav')
    expect(new TextDecoder().decode(audio.subarray(0, 4))).toBe('RIFF')
    expect(audio.byteLength).toBe(44 + 8)
    expect(seconds).toBeCloseTo(8 / 32000, 6)
    expect(typed).toEqual(['again '])
  })

  it('shows this computer\'s preview only with the engine running and the processor\'s model here', () => {
    const engine = { installed: true, ready: true, previewModel: 'parakeet-tdt-0.6b-v3' }
    expect(previewHere(true, engine)).toBe(true)
    expect(previewHere(false, engine)).toBe(false)
    expect(previewHere(true, { ...engine, previewModel: undefined })).toBe(false)
    expect(previewHere(true, { ...engine, ready: false })).toBe(false)
    expect(previewHere(true, { ...engine, installed: false })).toBe(false)
  })

  it('opens the preview on the processor, hands the badge both, and throws it away at the key, Groq typing', async () => {
    const calls: [string, string, unknown][] = []
    const call = vi.fn(async (method: string, route: string, body?: unknown) => (calls.push([method, route, body]), { ok: true, data: { id: 'preview' } }))
    const stream: Stream = { push: vi.fn(), finish: vi.fn(async () => ({ text: 'текст Groq', language: 'ru' })), cancel: vi.fn() }
    const typed: string[] = []
    const d = new Dictation({
      page: 'dictation.html',
      preload: 'preload.js',
      query: () => ({}),
      speech: { installed: true, ready: true, previewModel: 'parakeet-tdt-0.6b-v3', call },
      remote: { on: () => true, hear: vi.fn(), stream: () => stream },
      paste: async (text: string) => void typed.push(text),
      editing: () => false,
      polish: (text: string) => text,
      space: () => true,
      sound: () => false,
      capturing: () => false,
      languageOf: () => 'ru',
      expected: () => ['ru', 'en'],
      warm: vi.fn(async () => {}),
      offset: () => ({ dx: 0, dy: 0 }),
      panel: () => true,
      trayPoint: () => ({ x: 1900, y: 1060 }),
      log: { add: vi.fn() },
      logged: vi.fn(),
      onChange: vi.fn(),
      moved: vi.fn(),
    } as unknown as DictationOptions)
    d.press('type', 'Control+Alt+D')
    await settle()
    expect(calls[0]).toEqual(['POST', '/dictate/sessions', { expected: ['ru', 'en'], strict: true, device: 'cpu' }])
    const badge = windows[windows.length - 1]!
    d.onMessage({ type: 'dictationReady' })
    const views = (badge as unknown as { webContents: { send: { mock: { calls: [string, ToView][] } } } }).webContents.send.mock.calls.map(c => c[1])
    expect(views.find(m => m.type === 'dictation')).toMatchObject({ command: 'start', session: 'preview', remote: true })
    d.press('type', 'Control+Alt+D')
    d.onMessage({ type: 'dictationPcm', pcm: pcm(1, 2), last: true })
    await settle()
    expect(calls.map(c => `${c[0]} ${c[1]}`)).toEqual(['POST /dictate/sessions', 'DELETE /dictate/sessions/preview'])
    expect(typed).toEqual(['текст Groq '])
    windows.length = 0
  })

  it('throws the preview away on Esc too, and opens none without the processor\'s model', async () => {
    const calls: string[] = []
    const make = (previewModel?: string) =>
      new Dictation({
        page: 'dictation.html',
        preload: 'preload.js',
        query: () => ({}),
        speech: { installed: true, ready: true, previewModel, call: async (method: string, route: string) => (calls.push(`${method} ${route}`), { ok: true, data: { id: 'preview' } }) },
        remote: { on: () => true, hear: vi.fn(), stream: () => ({ push: vi.fn(), finish: vi.fn(), cancel: vi.fn() }) },
        sound: () => false,
        capturing: () => false,
        expected: () => ['ru'],
        warm: vi.fn(async () => {}),
        offset: () => ({ dx: 0, dy: 0 }),
        panel: () => true,
        onChange: vi.fn(),
      } as unknown as DictationOptions)
    const d = make('parakeet-tdt-0.6b-v3')
    d.press('type', 'Control+Alt+D')
    await settle()
    d.cancel()
    expect(calls).toEqual(['POST /dictate/sessions', 'DELETE /dictate/sessions/preview'])
    calls.length = 0
    make(undefined).press('type', 'Control+Alt+D')
    await settle()
    expect(calls).toEqual([])
    windows.length = 0
  })

  it('types nothing once Esc dropped it', async () => {
    let answer: (value: { text: string; language: string }) => void = () => undefined
    const { d, stream, typed } = streaming(() => new Promise(resolve => (answer = resolve)))
    d.onMessage({ type: 'dictationPcm', pcm: pcm(1), last: true })
    d.cancel()
    expect(stream.cancel).toHaveBeenCalled()
    answer({ text: 'привет', language: 'ru' })
    await settle()
    expect(typed).toEqual([])
    // Sound that comes after Esc goes nowhere.
    d.onMessage({ type: 'dictationPcm', pcm: pcm(2), last: false })
    expect(stream.push).toHaveBeenCalledTimes(1)
  })
})
