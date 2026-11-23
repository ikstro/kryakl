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
  // A reload empties storage.session: a transcript being followed is followed to its end first.
  const followed = await following()
  if (followed && !followed.done && !followed.failed) return
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
  // The worker slept and its 5-second timer with it: the alarm wakes the following up again.
  if (alarm.name === 'follow') void follow()
})

// After the finish, how far Kryakl is with the transcript (GET /recordings/<id>/status: stage and progress, no words),
// every 5 s while the worker is awake and at least every 30 s by the alarm, for 4 hours at most. Kept in
// storage.session as `following` {id, title, since, progress, stage, done, failed}; the popup shows it, and opened
// once it is done or failed, lets it go (the ✓ goes with it).
const FOLLOW_EVERY_MS = 5_000
const FOLLOW_MOST_MS = 4 * 60 * 60_000
let followTimer = 0

async function following() {
  const { following } = await chrome.storage.session.get('following')
  return following || null
}

async function startFollowing(id, title) {
  if (!id) return
  await chrome.storage.session.set({ following: { id, title, since: Date.now(), progress: 0, stage: '', done: false, failed: false } })
  chrome.alarms.create('follow', { periodInMinutes: 0.5 })
  await badge()
  scheduleFollow()
}

async function stopFollowing() {
  clearTimeout(followTimer)
  followTimer = 0
  await chrome.alarms.clear('follow')
  await chrome.storage.session.remove('following')
  await badge()
}

function scheduleFollow() {
  clearTimeout(followTimer)
  followTimer = setTimeout(() => void follow(), FOLLOW_EVERY_MS)
}

async function follow() {
  const f = await following()
  if (!f || f.done || f.failed) {
    await chrome.alarms.clear('follow')
    return
  }
  if (Date.now() - f.since > FOLLOW_MOST_MS) return stopFollowing()
  try {
    const r = await fetch(`http://127.0.0.1:${await port()}/recordings/${encodeURIComponent(f.id)}/status`, { headers: await self(), signal: AbortSignal.timeout(3000) })
    // Gone (deleted in Kryakl): nothing to wait for.
    if (r.status === 404) return stopFollowing()
    if (r.ok) {
      const s = await r.json()
      const next = { ...f, progress: Number(s.progress) || 0, stage: String(s.stage || ''), done: Boolean(s.done), failed: Boolean(s.failed) }
      // The popup may have let it go meanwhile.
      if ((await following())?.id !== f.id) return
      await chrome.storage.session.set({ following: next })
      await badge()
      if (next.done || next.failed) {
        clearTimeout(followTimer)
        await chrome.alarms.clear('follow')
        return
      }
    }
  } catch {} // Kryakl not running just now: asked again
  scheduleFollow()
}

// The icon's badge for every tab without one of its own: REC while recording, "!" after a failure, else how far the
// last meeting's transcript is ("42%"), ✓ once it is ready; nothing when none of these.
const GREY = '#616161'
const GREEN = '#0f7b0f'
async function badge() {
  const recording = await current()
  const { lastError } = await chrome.storage.session.get('lastError')
  const f = await following()
  let text = ''
  let color = RED
  if (recording) text = 'REC'
  else if (lastError) text = '!'
  else if (f?.done) [text, color] = ['✓', GREEN]
  else if (f?.failed) text = '!'
  else if (f) [text, color] = [f.progress > 0 ? `${Math.min(99, Math.round(f.progress * 100))}%` : '…', GREY]
  try {
    await chrome.action.setBadgeBackgroundColor({ color })
    await chrome.action.setBadgeTextColor({ color: '#ffffff' })
    await chrome.action.setBadgeText({ text })
  } catch {}
  // A tab painted before keeps its own colours: it takes these again.
  for (const tabId of await paintedTabs()) await paint(tabId)
}

async function paintedTabs() {
  const { painted } = await chrome.storage.session.get('painted')
  return Array.isArray(painted) ? painted : []
}

async function notePainted(tabId, on) {
  const now = await paintedTabs()
  const next = on ? (now.includes(tabId) ? now : [...now, tabId].slice(-50)) : now.filter(t => t !== tabId)
  if (next.length !== now.length) await chrome.storage.session.set({ painted: next })
}

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
      // The global badge's colours (REC and "!" red, a transcript's progress grey, ✓ green), not the call's yellow.
      await chrome.action.setBadgeBackgroundColor({ tabId, color: await chrome.action.getBadgeBackgroundColor({}) })
      await chrome.action.setBadgeTextColor({ tabId, color: await chrome.action.getBadgeTextColor({}) })
      await followGlobalBadge(tabId)
    }
    await notePainted(tabId, true)
  } catch {
    await notePainted(tabId, false) // the tab is gone
  }
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
  const recording = { tabId: tab.id, id: answer.id, title: titleOf(tab), startedAt: Date.now(), mic: answer.mic, origin: answer.origin }
  await chrome.storage.session.remove('names')
  await chrome.storage.session.set({ recording })
  await badge()
  await paint(tab.id)
  // The plate in the meeting's page has done its work; on Meet, meeting.js starts noting who speaks.
  chrome.tabs.sendMessage(tab.id, { target: 'meeting', type: 'recording', id: answer.id, origin: answer.origin }).catch(() => {})
  return { ok: true, recording }
}

/** Who spoke when on Meet: asked of the tab at the stop (meeting.js also turns off the captions it turned on), else
 *  the last copy it sent (the tab closed); null when the tab noted nothing (another site, an older page). */
const NAMES_WAIT_MS = 1500
async function namesOf(recording) {
  let names = null
  try {
    names = await Promise.race([
      chrome.tabs.sendMessage(recording.tabId, { target: 'meeting', type: 'stopping', id: recording.id }),
      new Promise(resolve => setTimeout(() => resolve(null), NAMES_WAIT_MS)),
    ])
  } catch {}
  if (!names || names.id !== recording.id) {
    const kept = (await chrome.storage.session.get('names')).names
    names = kept && kept.id === recording.id ? kept : null
  }
  await chrome.storage.session.remove('names')
  return names && Array.isArray(names.spans) && typeof names.captions === 'string' ? { spans: names.spans, captions: names.captions } : null
}

async function stop() {
  const recording = await current()
  if (!recording) return { ok: false, error: T('errNotRecording') }
  let answer
  try {
    const names = await namesOf(recording)
    answer = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop', names })
  } catch (error) {
    answer = { ok: false, error: error.message }
  }
  await chrome.storage.session.remove('recording')
  await closeOffscreen()
  // The engine took it: the icon shows how far its transcript is, until it is ready.
  if (answer?.ok) await startFollowing(answer.id || recording.id, recording.title)
  else await badge()
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
  if (answer && !answer.ok) await chrome.storage.session.set({ lastError: answer.error })
  else await chrome.storage.session.remove('lastError')
  await badge()
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
  await notePainted(tabId, false)
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
      await chrome.storage.session.remove('lastError')
      // A transcript that is ready (or failed) is said once, here: then the ✓ goes.
      const followed = await following()
      if (followed && (followed.done || followed.failed)) await stopFollowing()
      else await badge()
      if (typeof message.tabId === 'number') await paint(message.tabId)
      void selfUpdate()
      return { recording: await current(), engine: await engineReady(), lastError, offers: await offersOn(), key: await recordKey(), following: followed }
    }
    if (message.type === 'start') return start(await chrome.tabs.get(message.tabId))
    if (message.type === 'stop') return stop()
    // The offscreen document saw the tab's sound end (the tab navigated away, Chrome stopped the capture).
    if (message.type === 'ended') return stop()
    if (message.type === 'meeting') return meeting(message.state, sender.tab?.id)
    // meeting.js on Meet, as its page loads: is this tab being recorded (a page loaded again mid-recording)?
    if (message.type === 'recorded') {
      const recording = await current()
      if (!recording || recording.tabId !== sender.tab?.id || !recording.origin) return null
      const kept = (await chrome.storage.session.get('names')).names
      return { id: recording.id, origin: recording.origin, spans: kept && kept.id === recording.id ? kept.spans : [] }
    }
    // meeting.js on Meet, now and then while recording: who spoke when so far, kept in case the tab closes.
    if (message.type === 'names') {
      const recording = await current()
      if (!recording || recording.tabId !== sender.tab?.id || message.id !== recording.id || !Array.isArray(message.spans)) return { ok: false }
      await chrome.storage.session.set({ names: { id: message.id, spans: message.spans.slice(0, 5000), captions: String(message.captions || '') } })
      return { ok: true }
    }
    return { ok: false, error: 'unknown' }
  })().then(reply, error => reply({ ok: false, error: String(error) }))
  return true
})

// Every wake of the worker (an event, the popup, the alarm) goes on with a transcript being followed.
void follow()
