// A window out of sight draws nothing. A page whose window turns background throttling off (the dictation
// badge records while folded away; the card, Talk, the menu, the recording strip, the screenshot panes) goes on
// drawing while hidden, so one endless CSS animation left on it costs a processor for good. Measured
// 2026-11-18 on the owner's Kryakl: the badge is hidden after each phrase with its "typing…" spinner still
// turning, and in four hours the GPU process took 33.9 min of the processor and the badge's page 6.6 (8–15 %
// and 1–4 % of a core at rest, from the first phrase until Kryakl quits). A probe of the same page hidden:
// 18.7 % and 3.8 % with the spinner turning, 0.1 % and 0.0 % with its animations paused.
//
// So every window pauses its page's CSS animations while it is hidden or minimized, and lets them go on once
// it is shown: a rule put in from here (insertCSS, which the page's own style policy does not stop), so no
// page has to remember to stop anything. Timers, sound and the microphone are not touched.
import type { BrowserWindow } from 'electron'

export const PAUSED = '*, *::before, *::after { animation-play-state: paused !important; }'

export function calmWhenHidden(win: BrowserWindow): void {
  /** The rule's key while it is in the page. */
  let key: string | undefined
  /** One change at a time, in the order asked: a hide and a show close together never cross. */
  let work: Promise<void> = Promise.resolve()
  const gone = () => win.isDestroyed() || win.webContents.isDestroyed()
  const settle = () => {
    work = work
      .then(async () => {
        if (gone()) return
        const calm = !win.isVisible() || win.isMinimized()
        if (calm && key === undefined) key = await win.webContents.insertCSS(PAUSED)
        else if (!calm && key !== undefined) {
          const was = key
          key = undefined
          await win.webContents.removeInsertedCSS(was)
        }
      })
      // A page that went meanwhile: its rule went with it.
      .catch(() => undefined)
  }
  win.on('hide', settle)
  win.on('minimize', settle)
  win.on('show', settle)
  win.on('restore', settle)
  // A page loaded (a window made hidden) or loaded again (another interface language) has no rule in it.
  win.webContents.on('did-finish-load', () => {
    work = work.then(() => {
      key = undefined
    })
    settle()
  })
}
