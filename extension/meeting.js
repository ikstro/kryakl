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

  // Who speaks, on Google Meet only: Meet writes the speaker's name beside each caption line, so while Kryakl records
  // this tab the captions are on and their changes noted as {name, start, end} in the recording's seconds. Only the
  // name and the moment are read, never a caption's words; names never go to the console, only counts. Meet's classes
  // change, so nothing below leans on them; every step is in try/catch, and with no names the recording ends as before.
  function speakerNotes() {
    const MERGE_MS = 2000     // a name's notes closer than this are one span
    const CLOSE_MS = 1500     // a span ends this long after its last change
    const MOST_SPANS = 5000
    const HANDLE_MS = 200     // at most five handlings a second
    const LOOK_MS = 2000      // looking for the captions button and region
    const PUSH_MS = 10_000    // a copy to the service worker, in case the tab closes
    const QUIET_MS = 3000     // an older caption changed after this long is Meet correcting its words, not speech
    const LONGEST_NAME = 80
    const MOST_RECORDS = 200  // mutation records looked at per batch
    const ICONS = '.google-symbols, .material-icons-extended'
    let rec = null

    const pressed = button => {
      const p = button.getAttribute('aria-pressed')
      return p === 'true' ? true : p === 'false' ? false : null
    }

    /** The captions button and whether captions are on (null: cannot tell). */
    function captionsButton() {
      for (const icon of document.querySelectorAll(ICONS)) {
        const text = (icon.textContent || '').trim()
        if (text !== 'closed_caption_off' && text !== 'closed_caption') continue
        const button = icon.closest('button')
        if (!button || button.closest('[role="menu"]')) continue
        const on = pressed(button)
        return { button, on: on ?? text === 'closed_caption' }
      }
      const button = document.querySelector('button[jsname="r8qRAd"]')
      if (button) {
        const icon = button.querySelector(ICONS)
        const text = icon ? (icon.textContent || '').trim() : ''
        const on = pressed(button)
        return { button, on: on ?? (text === 'closed_caption' ? true : text === 'closed_caption_off' ? false : null) }
      }
      return null
    }

    /** A caption block: its first child holds the avatar and the name, its second the words. A wrapper of blocks is
     *  not one (its first child is itself a block). */
    function captionLike(el) {
      const first = el.firstElementChild
      if (!first || !first.nextElementSibling || !first.querySelector('img')) return false
      const inner = first.firstElementChild
      return !(inner && inner.nextElementSibling && inner.querySelector('img'))
    }

    /** The caption block a change happened in: the deepest one around it, inside the region. */
    function blockOf(node, region) {
      let n = node && node.nodeType === 1 ? node : node?.parentElement
      for (let depth = 0; n && n !== region && depth < 12; depth++, n = n.parentElement) if (captionLike(n)) return n
      return null
    }

    /** The observer only keeps the nodes that changed and when; handle() looks at them at most five times a second. */
    function onMutations(records, region) {
      if (!rec || (rec.region && rec.region !== region)) return
      try {
        const now = Date.now()
        for (const r of records) {
          if (rec.pending.size >= MOST_RECORDS) break
          rec.pending.set(r.target, { at: now, region, added: false })
          if (r.type === 'childList') for (const n of r.addedNodes) if (n.nodeType === 1) rec.pending.set(n, { at: now, region, added: true })
        }
        schedule()
      } catch {}
    }

    function schedule() {
      if (!rec || rec.timer || !rec.pending.size) return
      rec.timer = setTimeout(handle, Math.max(0, rec.handled + HANDLE_MS - Date.now()))
    }

    /** The caption blocks the pending changes happened in, with the time of each block's latest change. */
    function blocksOf(pending) {
      const blocks = new Map()
      for (const [node, { at, region, added }] of pending) {
        if (rec.region && region !== rec.region) continue
        const block = added && captionLike(node) ? node : blockOf(node, region)
        if (!block) continue
        if (!rec.region) {
          // Not known yet which region holds the captions: the first that changes in a caption block is it.
          rec.region = region
          for (const o of rec.observers) if (o.region !== region) o.observer.disconnect()
          rec.observers = rec.observers.filter(o => o.region === region)
          if (!rec.saidRegion) {
            rec.saidRegion = true
            console.log('kryakl: captions region found')
          }
        }
        if (region === rec.region) blocks.set(block, Math.max(at, blocks.get(block) || 0))
      }
      return blocks
    }

    function handle() {
      if (!rec) return
      rec.timer = null
      rec.handled = Date.now()
      try {
        for (const [block, at] of blocksOf(rec.pending)) {
          const before = rec.changed.get(block)
          rec.changed.set(block, at)
          // A block that is not among the newest and was quiet for a while: Meet setting its words right afterwards.
          const parent = block.parentElement
          const newest = parent && (block === parent.lastElementChild || block === parent.lastElementChild?.previousElementSibling)
          if (before !== undefined && !newest && at - before > QUIET_MS) continue
          const name = (block.firstElementChild?.textContent || '').trim()
          if (name && name.length <= LONGEST_NAME) note(name, at)
        }
      } catch {}
      rec.pending.clear()
    }

    function note(name, at) {
      rec.changes++
      const open = rec.open.get(name)
      if (open && at - open.last < MERGE_MS) {
        open.last = at
        rec.dirty = true
        return
      }
      if (rec.spans.length >= MOST_SPANS) return
      const span = { name, first: at, last: at }
      rec.spans.push(span)
      rec.open.set(name, span)
      rec.dirty = true
    }

    /** The regions that may hold the captions: Meet's focusable region; any region only when there is none, or when
     *  it showed no caption a minute after the captions were on (another panel with avatars could look alike). */
    const WIDEN_MS = 60_000
    function candidates() {
      const first = document.querySelector('div[role="region"][tabindex="0"]')
      if (first && !(rec.decidedAt && Date.now() - rec.decidedAt > WIDEN_MS)) return [first]
      const all = [...document.querySelectorAll('[role="region"]')].filter(r => r !== first)
      return (first ? [first, ...all] : all).slice(0, 12)
    }

    function watchRegions() {
      const found = candidates()
      const now = rec.observers.map(o => o.region)
      if (found.length === now.length && found.every((r, i) => r === now[i])) return
      for (const o of rec.observers) o.observer.disconnect()
      rec.observers = found.map(region => {
        const observer = new MutationObserver(records => onMutations(records, region))
        observer.observe(region, { childList: true, subtree: true, characterData: true })
        return { region, observer }
      })
    }

    function look() {
      if (!rec) return
      try {
        if (!rec.decided) {
          const found = captionsButton()
          if (found) {
            rec.decided = true
            rec.decidedAt = Date.now()
            if (found.on === true || (found.on === null && rec.region)) rec.by = 'theirs'
            else {
              found.button.click()
              rec.by = 'ours'
            }
            console.log(`kryakl: captions button found (${rec.by === 'ours' ? 'turned on by Kryakl' : 'already on'})`)
          } else if (!rec.saidNoButton && Date.now() - rec.since > 30_000) {
            rec.saidNoButton = true
            console.log('kryakl: captions button not found yet')
          }
        }
        if (rec.region && !rec.region.isConnected) {
          // Meet drew its captions anew: look for them again.
          rec.region = null
          for (const o of rec.observers) o.observer.disconnect()
          rec.observers = []
        }
        if (!rec.region) watchRegions()
        if (rec.dirty && Date.now() - rec.pushed >= PUSH_MS) push()
      } catch {}
    }

    function spans() {
      const out = []
      for (const s of rec.spans) {
        const start = Math.max(0, (s.first - rec.origin) / 1000)
        const end = (s.last + CLOSE_MS - rec.origin) / 1000
        if (end > start) out.push({ name: s.name, start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 })
      }
      return out
    }

    const captionsState = () => (!rec.decided ? 'not-found' : rec.spans.length ? rec.by : 'none-seen')

    function push() {
      if (!rec) return
      rec.dirty = false
      rec.pushed = Date.now()
      void ask({ type: 'names', id: rec.id, spans: spans(), captions: captionsState() })
    }

    /** Stops watching the page (the call ended or the recording stops); what was noted stays for the stop. */
    function leave() {
      if (!rec) return
      try {
        for (const o of rec.observers) o.observer.disconnect()
      } catch {}
      rec.observers = []
      clearInterval(rec.looking)
      clearTimeout(rec.timer)
      rec.timer = null
      if (rec.pending.size) handle()
    }

    function begin(id, origin, kept) {
      if (typeof id !== 'string' || typeof origin !== 'number' || rec?.id === id) return
      if (rec) leave()
      rec = {
        id, origin, since: Date.now(), decided: false, decidedAt: 0, by: 'theirs', region: null, observers: [], pending: new Map(),
        changed: new WeakMap(), timer: null, handled: 0, spans: [], open: new Map(), changes: 0, dirty: false, pushed: 0,
        saidRegion: false, saidNoButton: false, looking: null,
      }
      // A page loaded again mid-recording: what the page before it noted goes on.
      if (Array.isArray(kept)) {
        for (const s of kept.slice(0, MOST_SPANS)) {
          if (!s || typeof s.name !== 'string' || typeof s.start !== 'number' || typeof s.end !== 'number') continue
          rec.spans.push({ name: s.name, first: origin + s.start * 1000, last: origin + s.end * 1000 - CLOSE_MS })
        }
      }
      console.log('kryakl: noting who speaks from Meet\'s captions')
      rec.looking = setInterval(look, LOOK_MS)
      look()
    }

    /** The recording stops: captions Kryakl turned on go off again, and the timeline goes to the finish. */
    function finish(id) {
      if (!rec || rec.id !== id) return null
      leave()
      try {
        if (rec.by === 'ours') {
          const found = captionsButton()
          // Only while they still read on: the person may have turned them off already.
          if (found && (found.on === true || (found.on === null && rec.region?.isConnected))) {
            found.button.click()
            console.log('kryakl: captions turned off again')
          }
        }
      } catch {}
      const out = { id, spans: spans(), captions: captionsState() }
      console.log(`kryakl: ${rec.changes} caption changes, ${new Set(rec.spans.map(s => s.name)).size} speakers, ${out.spans.length} spans (captions: ${out.captions})`)
      rec = null
      return out
    }

    window.addEventListener('pagehide', () => {
      try {
        if (rec) push()
      } catch {}
    })

    return { begin, finish, leave }
  }

  const names = location.hostname === 'meet.google.com' ? speakerNotes() : null

  window.addEventListener('message', async event => {
    if (event.source !== window || !event.data || event.data.source !== SOURCE) return
    const state = event.data.state
    if (state !== 'started' && state !== 'ended') return
    if (state === 'ended') names?.leave()
    const answer = await ask({ type: 'meeting', state })
    if (state === 'ended') hide()
    else if (answer && answer.offer) show(answer)
  })

  // The service worker says when the recording started (by the key or the icon): the plate has done its work, and on
  // Meet the captions are watched; at the stop it asks for who spoke when.
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (!message || message.target !== 'meeting') return false
    if (message.type === 'recording') {
      hide()
      names?.begin(message.id, message.origin)
    } else if (message.type === 'stopping') {
      reply(names ? names.finish(message.id) : null)
    }
    return false
  })

  // This page loaded while its tab is being recorded (Meet loaded again): the watching goes on.
  if (names) {
    void ask({ type: 'recorded' }).then(answer => {
      if (answer && answer.id) names.begin(answer.id, answer.origin, answer.spans)
    })
  }
})()
