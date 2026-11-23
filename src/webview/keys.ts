// Settings › Keys (2026-11-23, the owner: "ввод всех ключей … должен быть в одном
// месте"): every key Kryakl can use, Groq's and Hugging Face's, on one page.
// For each: what it is for, what leaves the computer with it, its state, and
// the steps to get one. A key typed here goes to main at once and the field is
// emptied; the page only ever learns its last four letters back.

import { numberText, t } from '../i18n'
import type { AppView, Settings } from '../protocol'
import { GROQ_FREE, isSpeechModel } from '../remote/plan'
import { el } from './dom'
import { hfKeyRows } from './speech'
import { aside, btn, card, grp, link, linkBtn, post, row, toggleCard, warn } from './ui'

const GROQ_KEYS = 'https://console.groq.com/keys'
const GROQ_PRIVACY = 'https://groq.com/privacy-policy'

/** "Replace" was tapped: the field comes back over a saved key. */
let replacing = false

/** What each model of Groq's does in Kryakl, as the usage lines name it. */
const MODEL_JOB: Record<string, () => string> = {
  'whisper-large-v3': () => t('apikeys.useDictation'),
  'whisper-large-v3-turbo': () => t('apikeys.useRecordings'),
  'openai/gpt-oss-120b': () => t('apikeys.useTexts'),
  'qwen/qwen3.8-27b': () => t('apikeys.useTalk'),
  'openai/gpt-oss-20b': () => t('apikeys.useEdit'),
}

/** 2 h 5 min, 12 min. */
function duration(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m >= 60 ? t('apikeys.hours', { h: Math.floor(m / 60), m: m % 60 }) : t('apikeys.minutes', { m })
}

/** The free day spent, per model used today: requests, and the sound or the words. */
function usageRows(v: AppView): HTMLElement[] {
  const used = v.keys.usage.filter(u => u.day.requests > 0)
  if (!used.length) return [row(t('apikeys.usageNone'), [t('apikeys.usageNoneNote')], null)]
  return used.map(u => {
    const speech = isSpeechModel(u.model)
    const plan = speech ? GROQ_FREE.speech : GROQ_FREE.chat
    const requests = t('apikeys.requests', { n: numberText(u.day.requests), of: numberText(u.limit ?? plan.perDay) })
    const amount = speech
      ? t('apikeys.sound', { used: duration(u.day.seconds), of: duration(GROQ_FREE.speech.secondsPerDay) })
      : t('apikeys.tokens', { used: numberText(Math.round(u.day.tokens / 1000)), of: numberText(GROQ_FREE.chat.tokensPerDay / 1000) })
    const left = u.left !== undefined ? [t('apikeys.groqLeft', { n: numberText(u.left) })] : []
    return row(MODEL_JOB[u.model]?.() ?? u.model, [`${requests} · ${amount}`, ...left], null)
  })
}

/** The key's line: saved (its last four letters and how its check went), or the field to paste one into. */
function groqKeyRow(v: AppView): HTMLElement[] {
  const k = v.keys.groq
  const state = k.check === 'checking' ? t('apikeys.checking') : k.check === 'bad' ? t('apikeys.bad') : k.check === 'offline' ? t('apikeys.offline') : k.check === 'ok' ? t('apikeys.works') : ''
  if (k.set && !replacing) {
    return [
      row(
        t('apikeys.groqKey'),
        [el('small', { class: k.check === 'bad' ? 'kstate bad' : k.check === 'ok' ? 'kstate ok' : 'kstate' }, t('apikeys.saved', { tail: k.tail ?? '' }), state ? ` · ${state}` : '')],
        el(
          'span',
          { class: 'kchg' },
          linkBtn(t('apikeys.checkAgain'), () => post({ type: 'checkKey', service: 'groq' })),
          linkBtn(t('apikeys.replace'), () => {
            replacing = true
            redraw()
          }),
          linkBtn(t('apikeys.delete'), () => post({ type: 'removeKey', service: 'groq' })),
        ),
      ),
    ]
  }
  const field = el('input', {
    type: 'password',
    class: 'field wide',
    placeholder: 'gsk_…',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-label': t('apikeys.groqKey'),
  })
  const send = () => {
    const key = field.value.trim()
    if (!key) return field.focus()
    // Out of the page at once: main checks it with Groq and keeps it encrypted.
    field.value = ''
    replacing = false
    post({ type: 'saveKey', service: 'groq', key })
  }
  field.addEventListener('keydown', event => {
    if (event.key === 'Enter') send()
    if (event.key === 'Escape' && replacing) {
      event.preventDefault()
      replacing = false
      redraw()
    }
  })
  const note = k.check === 'checking' ? t('apikeys.checking') : k.check === 'bad' ? t('apikeys.bad') : t('apikeys.notSaved')
  return [
    row(t('apikeys.groqKey'), [el('small', { class: k.check === 'bad' ? 'kstate bad' : 'kstate' }, note)], null),
    el(
      'ol',
      { class: 'steps' },
      el('li', {}, link(GROQ_KEYS, t('apikeys.step1')), t('apikeys.step1Rest')),
      el('li', {}, t('apikeys.step2'), el('b', {}, 'Kryakl'), t('apikeys.step2Rest')),
      el('li', {}, t('apikeys.step3'), el('span', { class: 'kline' }, el('span', { class: 'kchg' }, field, btn(t('apikeys.save'), send, 'primary')))),
    ),
  ]
}

/** One switch per part that can go to Groq. */
function partRows(s: Settings): HTMLElement[] {
  const set = (part: keyof Settings['remote']) => (on: boolean) => post({ type: 'remote', part, on })
  return [
    toggleCard('mic', t('apikeys.partDictate'), s.remote.dictate, set('dictate'), t('apikeys.partDictateNote')),
    toggleCard('file-audio', t('apikeys.partTranscribe'), s.remote.transcribe, set('transcribe'), t('apikeys.partTranscribeNote')),
    toggleCard('languages', t('apikeys.partLlm'), s.remote.llm, set('llm'), t('apikeys.partLlmNote')),
    toggleCard('scan-text', t('apikeys.partScreen'), s.remote.screen, set('screen'), t('apikeys.partScreenNote')),
  ]
}

let redraw: () => void = () => undefined

/** The page; `again` draws it anew (the field's Replace and Escape). */
export function keysPage(v: AppView, again: () => void): HTMLElement[] {
  redraw = again
  const s = v.settings
  const all = s.remote.dictate && s.remote.transcribe && s.remote.llm
  const out: HTMLElement[] = [grp('Groq'), el('p', { class: 'para' }, t('apikeys.groqWhat')), aside('info', t('apikeys.price'))]
  if (!v.keys.usable) out.push(warn(t('apikeys.noEncryption')))
  out.push(...groqKeyRow(v))
  if (v.keys.groq.set) {
    out.push(
      card('cloud', t('apikeys.useGroq'), [t('apikeys.useGroqNote')], all ? linkBtn(t('apikeys.useNone'), () => post({ type: 'useGroq', on: false })) : btn(t('apikeys.useAll'), () => post({ type: 'useGroq', on: true }), 'primary')),
      ...partRows(s),
      grp(t('apikeys.usage')),
      ...usageRows(v),
    )
  }
  out.push(
    aside('cloud', t('apikeys.leaves'), ' ', link(GROQ_PRIVACY, t('apikeys.privacy'))),
    aside('lock', t('apikeys.safe')),
    grp('Hugging Face'),
    el('p', { class: 'para' }, t('apikeys.hfWhat')),
    ...hfKeyRows(v),
  )
  return out
}

/** The Groq key's line alone, the same as on this page, for the first run's setup. */
export function groqKeyRows(v: AppView, again: () => void): HTMLElement[] {
  redraw = again
  return [...groqKeyRow(v), aside('info', t('apikeys.price')), aside('cloud', t('apikeys.leaves'), ' ', link(GROQ_PRIVACY, t('apikeys.privacy'))), aside('lock', t('apikeys.safe'))]
}

/** A line on another page leading here: the key's state in a word. */
export function keyState(v: AppView): string {
  return v.keys.groq.set ? t('apikeys.saved', { tail: v.keys.groq.tail ?? '' }) : t('apikeys.notSaved')
}
