// Kryakl's meeting recorder, beside the meeting site's page (the extension's own world):
// meeting-main.js says when a call starts and ends; this script tells the service worker
// and offers the recording on a small plate of Kryakl's. Chrome starts recording a tab
// only from a press of the person's own (the key, or Kryakl's icon on Chrome's bar), so
// the plate names them; the icon itself records with one click while the call is on.

(() => {
  const SOURCE = 'kryakl-meeting'
  const T = (key, ...subs) => chrome.i18n.getMessage(key, subs)
  let host = null

  // After the extension reloads itself (an update), this page's copy of the script has no extension to talk to.
  const ask = message => {
    try {
      return chrome.runtime.sendMessage({ target: 'background', ...message }).catch(() => null)
    } catch {
      return Promise.resolve(null)
    }
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('on')) node.addEventListener(k.slice(2), v)
      else node.setAttribute(k, v)
    }
    node.append(...children.filter(Boolean))
    return node
  }

  /** "Alt+Shift+M" as keycaps. */
  const caps = key => el('span', { class: 'keys' }, ...key.split('+').map(k => el('kbd', {}, k)))

  const STYLE = `
    :host { all: initial; }
    .plate { position: fixed; top: 64px; right: 16px; z-index: 2147483647; width: 300px; box-sizing: border-box;
      padding: 12px 14px 12px; border-radius: 8px; background: #fbfbfb; color: #1b1b1b; border: 1px solid #e5e5e5;
      box-shadow: 0 8px 24px rgba(0,0,0,.18), 0 1px 3px rgba(0,0,0,.1); font: 13px/1.45 'Segoe UI', system-ui, sans-serif;
      animation: in .22s ease-out; }
    @keyframes in { from { opacity: 0; transform: translateY(-6px); } }
    .head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    .logo { font: 800 13px 'Segoe UI', system-ui, sans-serif; color: #0f0f0f; white-space: nowrap; }
    .duck { font: 700 12px ui-monospace, Consolas, monospace; color: #f2a100; font-variant-ligatures: none; }
    .eye { color: #0f0f0f; }
    .arrow { margin-left: auto; font-size: 15px; color: #f2a100; }
    .title { font-weight: 600; color: #0f0f0f; }
    .note { color: #616161; font-size: 12px; margin-top: 2px; }
    .keys { display: inline-flex; gap: 3px; vertical-align: 1px; }
    kbd { font: 600 11px ui-monospace, Consolas, monospace; padding: 1px 5px; border-radius: 4px; border: 1px solid #e5e5e5;
      border-bottom-width: 2px; background: #f6f6f6; color: #0f0f0f; }
    .foot { display: flex; justify-content: flex-end; margin-top: 10px; }
    .ghost { font: 600 12px 'Segoe UI', system-ui, sans-serif; height: 26px; padding: 0 10px; border-radius: 6px; cursor: pointer;
      background: transparent; color: #1b1b1b; border: 1px solid #e5e5e5; }
    .ghost:hover { background: rgba(0,0,0,.04); }
    .ghost:focus-visible { outline: 2px solid #0f0f0f; outline-offset: 1px; }
    @media (prefers-color-scheme: dark) {
      .plate { background: #2b2b2b; color: #e8e8e8; border-color: #3d3d3d; box-shadow: 0 8px 24px rgba(0,0,0,.5), 0 1px 3px rgba(0,0,0,.3); }
      .logo, .title { color: #fff; } .duck, .arrow { color: #ffd60a; } .eye { color: #fff; } .note { color: #a8a8a8; }
      kbd { background: #323232; border-color: #3d3d3d; color: #fff; } .ghost { color: #e8e8e8; border-color: #4a4a4a; }
      .ghost:hover { background: rgba(255,255,255,.06); }
      .ghost:focus-visible { outline-color: #ffd60a; }
    }
    @media (prefers-reduced-motion: reduce) { .plate { animation: none; } }
  `

  function hide() {
    host?.remove()
    host = null
  }

  /** The plate: "Record this meeting?", the key or the icon, and Not now. */
  function show({ key, engine }) {
    hide()
    host = el('div', { 'data-kryakl': 'meeting' })
    const root = host.attachShadow({ mode: 'closed' })
    const how = key
      ? el('div', { class: 'note' }, T('offerPress'), ' ', caps(key), ' ', T('offerOrIcon'))
      : el('div', { class: 'note' }, T('offerIcon'))
    const plate = el(
      'div',
      { class: 'plate', role: 'dialog', 'aria-label': T('offerTitle') },
      el('div', { class: 'head' }, el('span', { class: 'logo' }, 'Kryakl ', el('span', { class: 'duck' }, '(', el('span', { class: 'eye' }, "'"), ')>')), el('span', { class: 'arrow', 'aria-hidden': 'true' }, '↗')),
      el('div', { class: 'title' }, engine ? T('offerTitle') : T('offerNoEngine')),
      engine ? how : el('div', { class: 'note' }, T('offerStartKryakl')),
      el('div', { class: 'foot' }, el('button', { class: 'ghost', onclick: () => { hide(); void ask({ type: 'meeting', state: 'dismissed' }) } }, T('offerNotNow'))),
    )
    root.append(el('style', {}, STYLE), plate)
    ;(document.body || document.documentElement).append(host)
  }

  window.addEventListener('message', async event => {
    if (event.source !== window || !event.data || event.data.source !== SOURCE) return
    const state = event.data.state
    if (state !== 'started' && state !== 'ended') return
    const answer = await ask({ type: 'meeting', state })
    if (state === 'ended') hide()
    else if (answer && answer.offer) show(answer)
  })

  // The service worker says when the recording started (by the key or the icon): the plate has done its work.
  chrome.runtime.onMessage.addListener(message => {
    if (message && message.target === 'meeting' && message.type === 'recording') hide()
  })
})()
