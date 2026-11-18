import type { BrowserWindow } from 'electron'
import { describe, expect, it } from 'vitest'
import { calmWhenHidden, PAUSED } from './calm'

/** A window as calmWhenHidden sees one: its events, whether it shows, and the rules put into its page. */
function fakeWindow(visible = false) {
  const listeners = new Map<string, () => void>()
  const state = { visible, minimized: false, destroyed: false, rules: new Map<string, string>(), made: 0, slow: 0 }
  const webContents = {
    isDestroyed: () => state.destroyed,
    on: (event: string, listener: () => void) => listeners.set(`page:${event}`, listener),
    insertCSS: async (css: string) => {
      if (state.slow) await new Promise(resolve => setTimeout(resolve, state.slow))
      const key = `rule${++state.made}`
      state.rules.set(key, css)
      return key
    },
    removeInsertedCSS: async (key: string) => {
      if (!state.rules.delete(key)) throw new Error('no such rule')
    },
  }
  const win = {
    isDestroyed: () => state.destroyed,
    isVisible: () => state.visible,
    isMinimized: () => state.minimized,
    on: (event: string, listener: () => void) => listeners.set(event, listener),
    webContents,
  }
  const fire = (event: string) => listeners.get(event)?.()
  return {
    win: win as unknown as BrowserWindow,
    state,
    show: () => {
      state.visible = true
      fire('show')
    },
    hide: () => {
      state.visible = false
      fire('hide')
    },
    minimize: () => {
      state.minimized = true
      fire('minimize')
    },
    restore: () => {
      state.minimized = false
      fire('restore')
    },
    /** The page loaded: whatever was put into the last one is gone. */
    load: () => {
      state.rules.clear()
      fire('page:did-finish-load')
    },
  }
}

const settled = () => new Promise(resolve => setTimeout(resolve, 30))

describe('a window out of sight pauses its animations', () => {
  it('pauses a page that loads in a hidden window', async () => {
    const w = fakeWindow()
    calmWhenHidden(w.win)
    w.load()
    await settled()
    expect([...w.state.rules.values()]).toEqual([PAUSED])
  })

  it('lets them go on when shown, and pauses again when hidden', async () => {
    const w = fakeWindow()
    calmWhenHidden(w.win)
    w.load()
    w.show()
    await settled()
    expect(w.state.rules.size).toBe(0)
    w.hide()
    await settled()
    expect(w.state.rules.size).toBe(1)
  })

  it('pauses a minimized window', async () => {
    const w = fakeWindow(true)
    calmWhenHidden(w.win)
    w.load()
    await settled()
    expect(w.state.rules.size).toBe(0)
    w.minimize()
    await settled()
    expect(w.state.rules.size).toBe(1)
    w.restore()
    await settled()
    expect(w.state.rules.size).toBe(0)
  })

  it('never puts the rule in twice', async () => {
    const w = fakeWindow()
    calmWhenHidden(w.win)
    w.load()
    w.hide()
    w.hide()
    await settled()
    expect(w.state.made).toBe(1)
  })

  it('ends as the window is when a hide and a show come close together', async () => {
    const w = fakeWindow(true)
    calmWhenHidden(w.win)
    w.load()
    w.state.slow = 10
    w.hide()
    w.show()
    w.hide()
    w.show()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(w.state.rules.size).toBe(0)
    w.hide()
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(w.state.rules.size).toBe(1)
  })

  it('pauses a page loaded again while hidden', async () => {
    const w = fakeWindow()
    calmWhenHidden(w.win)
    w.load()
    await settled()
    w.load()
    await settled()
    expect([...w.state.rules.values()]).toEqual([PAUSED])
  })

  it('leaves a window that is gone alone', async () => {
    const w = fakeWindow(true)
    calmWhenHidden(w.win)
    w.load()
    w.state.destroyed = true
    w.hide()
    await settled()
    expect(w.state.made).toBe(0)
  })
})
