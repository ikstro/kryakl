// The recording: the tab's sound and the microphone as two tracks, each sent
// to the engine in 10-second chunks while the meeting goes on. The tab's sound
// is played back too, since capturing a tab mutes it.

const SLICE = 10_000
const RETRIES = 5

let session = null
/** The engine's port, kept apart from the session: the last call comes after the session is let go. */
let port = 8765

function call(method, route, body) {
  const binary = body instanceof Blob
  return fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': binary ? 'application/octet-stream' : 'application/json' },
    body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
  })
}

function track(name, stream) {
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 })
  const id = session.id
  const t = { name, recorder, seq: 0, uploads: Promise.resolve(), lost: 0 }
  recorder.ondataavailable = event => {
    if (!event.data.size) return
    const seq = t.seq++
    const blob = event.data
    // In order, one after another; a sleeping engine gets a few more tries.
    t.uploads = t.uploads.then(async () => {
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        try {
          const r = await call('PUT', `/recordings/${id}/${name}/${seq}`, blob)
          if (r.ok || r.status === 409) return
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)))
      }
      t.lost++
    })
  }
  return t
}

async function start({ streamId, title, port: enginePort }) {
  port = enginePort
  const tab = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
  })
  const context = new AudioContext()
  context.createMediaStreamSource(tab).connect(context.destination)
  // The microphone was allowed once on permission.html; without it the tab alone is recorded.
  let mic = null
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch {}
  session = { id: null, tab, mic, context, tracks: [] }
  const startedAt = Date.now()
  const tracks = { tab: { startedAt } }
  if (mic) tracks.mic = { startedAt }
  const r = await call('POST', '/recordings', { source: 'meet', title, tracks })
  if (!r.ok) {
    release()
    return { ok: false, error: `Kryakl did not take the recording (${r.status})` }
  }
  session.id = (await r.json()).id
  session.tracks.push(track('tab', tab))
  if (mic) session.tracks.push(track('mic', mic))
  for (const t of session.tracks) t.recorder.start(SLICE)
  // The tab track's second 0, as the engine reads it (both tracks share startedAt, so neither is shifted): meeting.js
  // times Meet's captions from it. Date.now() is the same clock in every part of the extension.
  const origin = Date.now()
  tab.getAudioTracks()[0].addEventListener('ended', () => chrome.runtime.sendMessage({ target: 'background', type: 'ended' }))
  return { ok: true, id: session.id, mic: Boolean(mic), origin }
}

/** Who spoke when, from Meet's captions (meeting.js): the finish request's body; {} as before when there is none.
 *  The timeline goes under "names", not "speakers": the engine reads "speakers" in this body as the number of voices. */
function finishBody(names) {
  if (!names || typeof names.captions !== 'string' || !Array.isArray(names.spans)) return {}
  return { names: names.spans, captions: names.captions }
}

async function stop({ names } = {}) {
  if (!session) return { ok: false, error: 'Not recording' }
  const s = session
  await Promise.all(
    s.tracks.map(t => new Promise(resolve => {
      if (t.recorder.state === 'inactive') return resolve()
      t.recorder.onstop = resolve
      t.recorder.stop()
    })),
  )
  await Promise.all(s.tracks.map(t => t.uploads))
  release()
  const lost = s.tracks.reduce((n, t) => n + t.lost, 0)
  const r = await call('POST', `/recordings/${s.id}/finish`, finishBody(names))
  return r.ok ? { ok: true, id: s.id, lost } : { ok: false, error: `Kryakl did not take the end of the recording (${r.status})` }
}

function release() {
  if (!session) return
  for (const stream of [session.tab, session.mic]) for (const t of stream?.getTracks() ?? []) t.stop()
  session.context?.close()
  session = null
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.target !== 'offscreen') return false
  const run = message.type === 'start' ? start(message) : message.type === 'stop' ? stop(message) : Promise.resolve({ ok: false })
  run.then(reply, error => {
    release()
    reply({ ok: false, error: error.message || String(error) })
  })
  return true
})
