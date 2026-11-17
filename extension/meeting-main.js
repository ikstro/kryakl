// Kryakl's meeting recorder, in the meeting site's own page (the MAIN world, before the
// site's scripts): it tells when a call is on, by the call's connection itself, not by
// the site's buttons, so the site's language and layout do not matter. A call is on
// while a WebRTC connection is connected and brings sound in; it is over once no such
// connection has been there for 15 s (a moment's reconnection is not the end). Zoom's
// web client may send its sound another way, so there its microphone in use counts too:
// Zoom opens the microphone only after one has joined. Only "started" and "ended" leave
// this page, to meeting.js beside it; nothing of the call is read.

(() => {
  const SOURCE = 'kryakl-meeting'
  const END_AFTER_MS = 15_000
  const LOOK_MS = 2_000
  const MIC_MEANS_CALL = /(^|\.)zoom\.us$/.test(location.hostname)

  /** Each connection the site made, with whether sound has come in through it. */
  const connections = new Set()
  /** The microphone's tracks the site took (Zoom only). */
  const mics = new Set()
  let on = false
  let lastLive = 0
  let timer = null

  const say = state => window.postMessage({ source: SOURCE, state }, location.origin)

  function live() {
    for (const c of connections) {
      const state = c.pc.connectionState
      if (state === 'closed' || state === 'failed') connections.delete(c)
      else if (state === 'connected' && c.sound) return true
    }
    if (MIC_MEANS_CALL) {
      for (const track of mics) {
        if (track.readyState === 'live') return true
        mics.delete(track)
      }
    }
    return false
  }

  function look() {
    const now = Date.now()
    if (live()) {
      lastLive = now
      if (!on) {
        on = true
        say('started')
      }
    } else if (on && now - lastLive >= END_AFTER_MS) {
      on = false
      say('ended')
    }
    if (!on && !connections.size && !mics.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function watching() {
    if (!timer) timer = setInterval(look, LOOK_MS)
  }

  function watch(pc) {
    const c = { pc, sound: false }
    connections.add(c)
    pc.addEventListener('track', event => {
      if (event.track && event.track.kind === 'audio') {
        c.sound = true
        look()
      }
    })
    pc.addEventListener('connectionstatechange', look)
    watching()
  }

  const Native = window.RTCPeerConnection
  if (typeof Native === 'function') {
    // A subclass, so the site's connections are its own in every way (instanceof, static methods).
    class Watched extends Native {
      constructor(...args) {
        super(...args)
        try {
          watch(this)
        } catch {}
      }
    }
    Object.defineProperty(Watched, 'name', { value: Native.name })
    window.RTCPeerConnection = Watched
    if (window.webkitRTCPeerConnection === Native) window.webkitRTCPeerConnection = Watched
  }

  const devices = navigator.mediaDevices
  if (MIC_MEANS_CALL && devices && typeof devices.getUserMedia === 'function') {
    const getUserMedia = devices.getUserMedia.bind(devices)
    devices.getUserMedia = async constraints => {
      const stream = await getUserMedia(constraints)
      try {
        for (const track of stream.getAudioTracks()) mics.add(track)
        if (mics.size) {
          watching()
          look()
        }
      } catch {}
      return stream
    }
  }
})()
