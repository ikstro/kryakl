// Kryakl's meeting recorder, the service worker: starts and stops a recording of
// a tab. The recording itself lives in the offscreen document (offscreen.js),
// which outlives this worker; chrome.storage.session remembers which tab it is.
//
// On a meeting site (manifest's content_scripts) meeting.js says when a call is on:
// the icon then records with one click (no popup) and a plate in the page names the
// key; the call over, a recording of that tab stops by itself. Chrome starts a tab's
// recording only from a press of the person's own, so nothing records unasked.
//
// Kryakl keeps this extension in a folder of its own (src/extensionhome.ts) and puts
// each new version there; Chrome reads a folder only when it loads it, so the worker
// looks at the manifest on the disk and reloads itself once it is newer, never while
// recording.

const OFFSCREEN = 'offscreen.html'
const T = (key, ...subs) => chrome.i18n.getMessage(key, subs)

async function port() {
  const { port } = await chrome.storage.local.get('port')
  return port || 8765
}

/** Whether this copy is the one in Kryakl's own folder: Kryakl puts home.json only there. */
let home
async function isHome() {
  if (home === undefined) {
    try {
      home = (await fetch(chrome.runtime.getURL('home.json'), { cache: 'no-store' })).ok
    } catch {
      home = false
    }
  }
  return home
}

// Every call to /health says which version of the extension this is, so Kryakl can show "Installed in Chrome",
// and whether it is loaded from Kryakl's own folder (else updates of Kryakl do not reach it).
async function self() {
  return { 'X-Krya-Extension': chrome.runtime.getManifest().version, ...((await isHome()) ? { 'X-Krya-Extension-Home': '1' } : {}) }
}

async function engineReady() {
  try {
    const r = await fetch(`http://127.0.0.1:${await port()}/health`, { headers: await self(), signal: AbortSignal.timeout(1500) })
    return r.ok
  } catch {
    return false
  }
}

/** The version in the folder Chrome loaded this copy from, as it is on the disk now. */
async function diskVersion() {
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })
    const v = (await r.json()).version
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

/** Kryakl put a new version into the folder: reload into it, unless recording (then after the stop). */
async function selfUpdate() {
  const disk = await diskVersion()
  if (!disk || disk === chrome.runtime.getManifest().version || (await current())) return
  // Reloaded for that version once and still not on it: Chrome kept the old files; the person's Reload will do.
  const { reloadedFor } = await chrome.storage.local.get('reloadedFor')
  if (reloadedFor === disk) return
  await chrome.storage.local.set({ reloadedFor: disk })
  chrome.runtime.reload()
}

/** Lets the engine know the extension is there; the engine may be off, which is fine. */
async function ping() {
  try {
    await fetch(`http://127.0.0.1:${await port()}/health`, { headers: await self(), signal: AbortSignal.timeout(1500) })
  } catch {}
  await selfUpdate()
}

function startPinging() {
  chrome.alarms.create('ping', { periodInMinutes: 15 })
  void ping()
}

chrome.runtime.onInstalled.addListener(startPinging)
chrome.runtime.onStartup.addListener(startPinging)
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'ping') void ping()
})

async function current() {
  const { recording } = await chrome.storage.session.get('recording')
  return recording || null
}

// Calls on now, by tab: {[tabId]: {dismissed}}. Not now hides the plate for that call; the icon still records.
async function meetings() {
  const { meetings } = await chrome.storage.session.get('meetings')
  return meetings || {}
}

async function setMeeting(tabId, value) {
  const all = await meetings()
  if (value) all[tabId] = value
  else delete all[tabId]
  await chrome.storage.session.set({ meetings: all })
}

async function offersOn() {
  const { offers } = await chrome.storage.local.get('offers')
  return offers !== false
}

/** The key that starts a recording, as Chrome shows it ("Alt+Shift+M"); empty when none is set. */
async function recordKey() {
  try {
    const command = (await chrome.commands.getAll()).find(c => c.name === 'toggle-recording')
    return command?.shortcut || ''
  } catch {
    return ''
  }
}

// The icon on one tab: a call on and nothing recording, a yellow dot and one click records; an error, "!" and the
// popup says what; else as everywhere (the popup, the global REC while a recording runs).
const RED = '#e5534b'
async function paint(tabId) {
  if (typeof tabId !== 'number' || tabId < 0) return
  const recording = await current()
  const meeting = (await meetings())[tabId]
  const { lastError } = await chrome.storage.session.get('lastError')
  try {
    if (meeting && !recording && !lastError) {
      await chrome.action.setPopup({ tabId, popup: '' })
      await chrome.action.setBadgeBackgroundColor({ tabId, color: '#f7c700' })
      await chrome.action.setBadgeTextColor({ tabId, color: '#1a1500' })
      await chrome.action.setBadgeText({ tabId, text: '●' })
      const key = await recordKey()
      await chrome.action.setTitle({ tabId, title: key ? T('actionRecordMeetingKey', [key]) : T('actionRecordMeeting') })
    } else {
      await chrome.action.setPopup({ tabId, popup: 'popup.html' })
      await chrome.action.setTitle({ tabId, title: T('actionTitle') })
      await chrome.action.setBadgeBackgroundColor({ tabId, color: RED })
      await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' })
      await followGlobalBadge(tabId)
    }
  } catch {} // the tab is gone
}

/** The tab shows the global badge again (REC, "!" or none): null clears the tab's own; else the global text, copied. */
async function followGlobalBadge(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: null })
  } catch {
    await chrome.action.setBadgeText({ tabId, text: await chrome.action.getBadgeText({}) })
  }
}

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (contexts.length) return
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ['USER_MEDIA'],
    justification: 'Records the tab and the microphone for a transcript in Kryakl',
  })
}

async function closeOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (contexts.length) await chrome.offscreen.closeDocument()
}

// A meeting's tab title as the recording's name: Meet's "Meet – Weekly sync" → "Weekly sync" ("Meet – abc-defg-hij"
// → "Meeting abc-defg-hij"); the others lose their service's name and an unread count: "(2) Standup | Microsoft Teams"
// → "Standup". Any other tab keeps its title.
const SERVICE_SUFFIX = /\s*[|–-]\s*(Microsoft Teams|Teams|Zoom|Jitsi Meet|Whereby)\s*$/i
function titleOf(tab) {
  const title = (tab.title || '').trim().replace(/^\(\d+\)\s*/, '')
  const meet = title.match(/^Meet\s*[–-]\s*(.+)$/)
  if (meet) return /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(meet[1]) ? T('meeting', [meet[1]]) : meet[1]
  return title.replace(SERVICE_SUFFIX, '').trim() || title || T('tabRecording')
}

async function start(tab) {
  if (await current()) return { ok: false, error: T('errAlready') }
  if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) return { ok: false, error: T('errTab') }
  if (!(await engineReady())) return { ok: false, error: T('errEngine') }
  let streamId
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id })
  } catch (error) {
    return { ok: false, error: T('errNoSound', [error.message]) }
  }
  await ensureOffscreen()
  const answer = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', streamId, title: titleOf(tab), port: await port() })
  if (!answer || !answer.ok) {
    await closeOffscreen()
    return answer || { ok: false, error: T('errNoStart') }
  }
  const recording = { tabId: tab.id, id: answer.id, title: titleOf(tab), startedAt: Date.now(), mic: answer.mic }
  await chrome.storage.session.set({ recording })
  await chrome.action.setBadgeBackgroundColor({ color: RED })
  await chrome.action.setBadgeText({ text: 'REC' })
  await paint(tab.id)
  // The plate in the meeting's page has done its work.
  chrome.tabs.sendMessage(tab.id, { target: 'meeting', type: 'recording' }).catch(() => {})
  return { ok: true, recording }
}

async function stop() {
  const recording = await current()
  if (!recording) return { ok: false, error: T('errNotRecording') }
  let answer
  try {
    answer = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' })
  } catch (error) {
    answer = { ok: false, error: error.message }
  }
  await chrome.storage.session.remove('recording')
  await chrome.action.setBadgeText({ text: '' })
  await closeOffscreen()
  await paint(recording.tabId)
  // A new version that came while recording goes in now.
  void selfUpdate()
  return answer || { ok: false, error: T('errNoStop') }
}

async function toggle(tab) {
  return (await current()) ? stop() : start(tab)
}

/** A shortcut or the icon has no popup to answer in: a failure shows as "!" on the icon, and the popup says what. */
async function remember(answer, tabId) {
  if (answer && !answer.ok) {
    await chrome.storage.session.set({ lastError: answer.error })
    await chrome.action.setBadgeBackgroundColor({ color: RED })
    await chrome.action.setBadgeText({ text: '!' })
  } else {
    await chrome.storage.session.remove('lastError')
  }
  await paint(tabId)
  return answer
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-recording') return
  try {
    await remember(await toggle(tab), tab?.id)
  } catch (error) {
    await remember({ ok: false, error: error.message || String(error) }, tab?.id)
  }
})

// The icon of a tab with a call on has no popup: a click is the person's own press, and it records.
chrome.action.onClicked.addListener(async tab => {
  try {
    await remember(await start(tab), tab.id)
  } catch (error) {
    await remember({ ok: false, error: error.message || String(error) }, tab.id)
  }
})

// The meeting's tab closed: what was recorded goes to the engine.
chrome.tabs.onRemoved.addListener(async tabId => {
  await setMeeting(tabId, null)
  const recording = await current()
  if (recording && recording.tabId === tabId) await stop()
})

// A new page in the tab: its call, if any, is announced again by its own meeting.js.
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (change.status !== 'loading' || !(await meetings())[tabId]) return
  await setMeeting(tabId, null)
  await paint(tabId)
})

// Offers turned off in the popup: the icons of calls on now go back to the popup.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.offers || changes.offers.newValue !== false) return
  const all = await meetings()
  await chrome.storage.session.set({ meetings: {} })
  for (const tabId of Object.keys(all)) await paint(Number(tabId))
})

/** meeting.js: a call started or ended in its tab, or Not now on the plate. */
async function meeting(state, tabId) {
  if (typeof tabId !== 'number') return { offer: false }
  if (state === 'ended') {
    await setMeeting(tabId, null)
    const recording = await current()
    if (recording && recording.tabId === tabId) await stop()
    else await paint(tabId)
    return { ok: true }
  }
  if (state === 'dismissed') {
    const now = (await meetings())[tabId]
    if (now) await setMeeting(tabId, { ...now, dismissed: true })
    return { ok: true }
  }
  if (state !== 'started' || !(await offersOn())) return { offer: false }
  await setMeeting(tabId, { since: Date.now(), dismissed: false })
  await paint(tabId)
  if (await current()) return { offer: false }
  return { offer: true, key: await recordKey(), engine: await engineReady() }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== 'background') return false
  ;(async () => {
    if (message.type === 'status') {
      const { lastError } = await chrome.storage.session.get('lastError')
      if (lastError && !(await current())) await chrome.action.setBadgeText({ text: '' })
      await chrome.storage.session.remove('lastError')
      if (typeof message.tabId === 'number') await paint(message.tabId)
      void selfUpdate()
      return { recording: await current(), engine: await engineReady(), lastError, offers: await offersOn(), key: await recordKey() }
    }
    if (message.type === 'start') return start(await chrome.tabs.get(message.tabId))
    if (message.type === 'stop') return stop()
    // The offscreen document saw the tab's sound end (the tab navigated away, Chrome stopped the capture).
    if (message.type === 'ended') return stop()
    if (message.type === 'meeting') return meeting(message.state, sender.tab?.id)
    return { ok: false, error: 'unknown' }
  })().then(reply, error => reply({ ok: false, error: String(error) }))
  return true
})
