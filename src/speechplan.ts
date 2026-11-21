// Which speech model runs where on this computer, and how long each one takes
// here. Every model of the catalog (engine/models.json) gets an estimate per
// feature: its time measured on this computer when the speed test (or real use)
// has one, scaled from a measured model when another was measured, else a first
// guess from the processor's cores. Each feature then takes the most accurate
// model within its budget (a phrase in about 1.5 s; the words of an hour in about
// 45 min), preferring one already downloaded and offering the better one; a model
// the person picked is kept whatever it costs. On a computer with the card,
// dictation takes the card's model too when it is the more accurate one within
// the budget (2026-11-21; from 2026-10-31 Parakeet dictated on the processor
// wherever it suited the person's languages). The engine gets the result as its
// plan (settings.py), for the card and for the processor, which dictates while
// other programs fill the card or should the card fail.

import catalog from '../engine/models.json'
import { nvidiaCard, type DeviceProfile } from './hardware'
import { numberText, t } from './i18n'

export type Feature = 'dictation' | 'transcripts'
export type Device = 'cpu' | 'cuda'
export type Prefer = 'accuracy' | 'speed'
/** Where an estimate comes from: this model measured here, another model measured here and scaled, or a first guess. */
export type Basis = 'measured' | 'scaled' | 'guess'

type Prior = { phrase: number; rtf: number }
export type CatalogModel = {
  name: string
  label: string
  about: string
  backend: string
  /** Where it comes from on Hugging Face: the engine keeps a Whisper model under this name. */
  repo: string
  bytes: number
  rank: number
  /** Words wrong in a hundred, measured per language (docs/speech-quality.md); a language not here falls back to `rank`. */
  errors?: Record<string, number>
  languages: 'all' | string[]
  /** Where it runs (Parakeet: the processor only) and what for (Parakeet: dictation). */
  devices: Device[]
  features: Feature[]
  cpu: Prior
  cuda: Prior
  ramMb: number
  vramMb: { float16: number; int8_float16: number }
}

export const MODELS = catalog.models as CatalogModel[]
const SPEAKERS = catalog.speakers as Record<Device, { rtf: number }>

/** Seconds for a 7 s phrase; minutes of words for an hour of sound. */
export const BUDGET: Record<Feature, Record<Prefer, number>> = {
  dictation: { accuracy: 1.5, speed: 0.8 },
  transcripts: { accuracy: 45, speed: 20 },
}
/** A model already chosen stays until it is this much over the budget, so numbers moving a little do not flip it. */
const KEEP = 1.15
/** Decoding the file and saving the sound, per second of an hour: a minute or so. */
const OVERHEAD_RTF = 0.015
/** A model bigger than this (large-v3, 3.1 GB) is never downloaded by itself: it is offered, with its size. */
export const AUTO_DOWNLOAD_MB = 2000

/** `tested`: the speed test's own numbers (bench.py), measured one after another with nothing else running. */
export type BenchRun = { phrase?: number; rtf?: number; n?: number; at?: string; source?: 'test' | 'use'; failed?: string; tested?: { phrase?: number; rtf?: number } }
export type Bench = { fingerprint: string; runs: Record<string, BenchRun> }

export type PlanInput = {
  profile: DeviceProfile | undefined
  fingerprint: string
  bench: Bench | undefined
  /** The engine can use the card now: the gpu part is there, a card answered, and it has not failed. */
  cuda: boolean
  /** Speakers run on the card (torch's CUDA build is installed). */
  speakersCuda: boolean
  /** The speakers part is installed: Transcribe's hour includes telling them apart. */
  speakers: boolean
  downloaded: string[]
  /** The person's own language (a code). */
  native: string
  /** Every language they use (codes, their own among them; settings.ts myLanguages): a model for some of them only does not dictate. */
  languages?: string[]
  prefer: Prefer
  /** A model the person picked per feature; empty for Automatic. */
  pins: Record<Feature, string>
  /** The models the engine has now per feature, so a choice near the budget does not flip back and forth. */
  previous?: Partial<Record<Feature, string>>
  /** No profile yet: whether an NVIDIA driver is installed at all (nvidia-smi.exe). */
  nvidiaDriver?: boolean
}

export type Choice = {
  model: string
  label: string
  about: string
  device: Device
  compute: string
  /** dictation: seconds for a 7 s phrase; transcripts: minutes for an hour, speakers included when their part is here. */
  estimate: number
  basis: Basis
  downloaded: boolean
  mb: number
  /** Within the budget (for transcripts, the words alone). */
  fits: boolean
  /** Why it cannot run here; empty when it can. */
  why: string
}

export type FeaturePlan = {
  chosen: Choice
  /** Every model, the usable ones first, the most accurate first. */
  choices: Choice[]
  pinned: boolean
  /** The model that fits this computer best, when it still has to be downloaded. */
  better?: Choice
  budget: number
}

/** `lighter`: what the engine takes on the card when another program leaves too little of it for this model (jobs.py _smaller). */
export type EngineEntry = { model: string; compute?: string; beam?: number; lighter?: { model: string; compute?: string } }
export type EnginePlan = {
  fingerprint: string
  threads: number
  cpu: Record<Feature, EngineEntry>
  cuda?: Record<Feature, EngineEntry>
}

export type SpeechPlan = {
  device: Device
  dictation: FeaturePlan
  transcripts: FeaturePlan
  /** The chosen models' times are this computer's own. */
  measured: boolean
  engine: EnginePlan
  /** Worth offering: the graphics card's part (an NVIDIA card that can take Whisper), and speakers on it. */
  offers: { gpu: boolean; speakersGpu: boolean }
  /** Minutes to tell an hour's speakers apart here, on the processor and (when offered) on the card; where it is advised. */
  speakers: { cpu: number; cuda?: number; advised: Device }
  /** When the card dictates: what dictates on the processor while other programs fill the card (the processor's
   *  plan), and the model that would do it better once downloaded. */
  spare?: { chosen: Choice; better?: Choice }
  threads: number
}

export const runKey = (model: string, device: Device, compute: string) => `${model}|${device}|${compute}`

/** How much slower than the reference processor (8 cores, a desktop) this one probably is. */
export function cpuFactor(profile: DeviceProfile | undefined): number {
  if (!profile) return 1.5
  const cores = Math.max(1, profile.cpu.cores)
  return Math.sqrt(8 / cores) * (profile.laptop ? 1.4 : 1)
}

/** How much slower than the reference card (an RTX 2080, compute 7.5) this one probably is. */
function cudaFactor(profile: DeviceProfile | undefined): number {
  const cap = nvidiaCard(profile)?.computeCap
  if (!cap) return 1
  return cap < 7 ? 2 : cap >= 8 ? 0.8 : 1
}

const driverMajor = (driver: string) => Number(driver.split('.')[0]) || 0

/** The graphics card's part is worth offering: an NVIDIA card with 2 GB or more, new enough for CUDA 12. */
export function gpuOffer(profile: DeviceProfile | undefined, nvidiaDriver = false): boolean {
  const card = nvidiaCard(profile)
  if (!card) return !profile?.at && nvidiaDriver
  if (card.vramMb && card.vramMb < 2048) return false
  if (card.computeCap && card.computeCap < 5) return false
  // nvidia-smi's driver numbers (528.33); Windows' own (32.0.15.6109) say nothing comparable.
  if (/^\d{3}\.\d+$/.test(card.driver) && driverMajor(card.driver) < 528) return false
  return true
}

/** The compute type a model has room for on this card, or '' when it does not fit. */
function roomCompute(m: CatalogModel, profile: DeviceProfile | undefined): string {
  const vram = nvidiaCard(profile)?.vramMb
  if (!vram) return 'float16'
  if (vram >= m.vramMb.float16 + 1024) return 'float16'
  if (vram >= m.vramMb.int8_float16 + 512) return 'int8_float16'
  return ''
}

/** The compute type a model takes on this card, or '' when it does not fit: float16 where there is room for it,
 *  as it writes a little better than int8_float16 (2026-11-21, docs/speech-quality.md: turbo on 750 phrases,
 *  25.7 against 26.4 words wrong in a hundred, worse in 102 phrases and better in 55), except on a card slow at
 *  half precision (`slowHalf`), where float16 costs four times the time. */
function cudaCompute(m: CatalogModel, input: Pick<PlanInput, 'profile' | 'bench'>): string {
  const room = roomCompute(m, input.profile)
  return room === 'float16' && slowHalf(input) ? 'int8_float16' : room
}

function measuredValue(bench: Bench | undefined, key: string, field: 'phrase' | 'rtf'): number | undefined {
  const v = bench?.runs[key]?.[field]
  return typeof v === 'number' && v > 0 ? v : undefined
}

function testedValue(bench: Bench | undefined, key: string, field: 'phrase' | 'rtf'): number | undefined {
  const v = bench?.runs[key]?.tested?.[field]
  return typeof v === 'number' && v > 0 ? v : undefined
}

/** float16 must take this many times int8_float16's time for a card to count as slow at half precision: where
 *  both run alike the ratio is 1 (an RTX 2080 SUPER: 0.16 s a window either way), where they do not it is 4. */
const HALF_SLOWER = 2
/** Cards known to be slow at half precision before anything is measured: a GTX 1660 Ti read Whisper turbo's 30 s
 *  window in 3.9 s in float16 and in 0.96 s in int8_float16 (2026-11-21), so a dictated phrase took 4.4 s. */
const SLOW_HALF_CARDS = /\bGTX 16\d\d\b/i
/** Cards known to be quick at it, which the speed test need not ask. */
const QUICK_HALF_CARDS = /\bRTX\b/i
/** A first guess for such a card against the reference card, per format (the 1660 Ti's phrase: 4.2 s and about 1.1 s). */
const SLOW_HALF_FACTOR: Record<string, number> = { float16: 16, int8_float16: 4.5 }

/** This card computes half precision slowly, so Whisper runs in int8_float16 on it: by the speed test's own
 *  numbers once it has measured a model in both formats here (real use is not compared: another program on the
 *  card slows one format's phrases and not the other's), else by the card's name. */
export function slowHalf(input: Pick<PlanInput, 'profile' | 'bench'>): boolean {
  let measured = false
  for (const m of MODELS) {
    for (const field of ['rtf', 'phrase'] as const) {
      const full = testedValue(input.bench, runKey(m.name, 'cuda', 'float16'), field)
      const compact = testedValue(input.bench, runKey(m.name, 'cuda', 'int8_float16'), field)
      if (full === undefined || compact === undefined) continue
      if (full >= compact * HALF_SLOWER) return true
      measured = true
    }
  }
  return !measured && SLOW_HALF_CARDS.test(nvidiaCard(input.profile)?.name ?? '')
}

/** Seconds for a phrase or seconds per second, and where the number comes from. */
function speed(m: CatalogModel, device: Device, compute: string, field: 'phrase' | 'rtf', input: PlanInput): { value: number; basis: Basis } {
  const exact = measuredValue(input.bench, runKey(m.name, device, compute), field)
  if (exact !== undefined) return { value: exact, basis: 'measured' }
  // Another model measured on this device: this one by the catalog's ratio between the two,
  // from the measured model nearest in size and kind (small says more about turbo than tiny
  // does; a Whisper measured says something of Parakeet's processor, though less).
  let near: { value: number; distance: number } | undefined
  const slow = device === 'cuda' && slowHalf(input)
  for (const other of MODELS) {
    if (other.name === m.name) continue
    for (const c of device === 'cpu' ? ['int8'] : ['float16', 'int8_float16']) {
      // On a card slow at half precision one format's time says nothing of the other's.
      if (slow && c !== compute) continue
      const v = measuredValue(input.bench, runKey(other.name, device, c), field)
      if (v === undefined) continue
      const distance = Math.abs(Math.log(other.bytes / m.bytes)) + (other.backend === m.backend ? 0 : 1)
      const value = ((v * m[device][field]) / other[device][field]) * (compute === 'int8_float16' && c !== compute ? 1.1 : 1)
      if (!near || distance < near.distance) near = { value, distance }
    }
  }
  if (near) return { value: near.value, basis: 'scaled' }
  const factor = device === 'cpu' ? cpuFactor(input.profile) : slow ? (SLOW_HALF_FACTOR[compute] ?? 1) : cudaFactor(input.profile) * (compute === 'int8_float16' ? 1.1 : 1)
  return { value: m[device][field] * factor, basis: 'guess' }
}

/** Seconds per second of sound to tell the speakers apart on a device: measured here, else the catalog's guess scaled to this computer. */
function speakersRtfOn(input: PlanInput, device: Device): number {
  const measured = measuredValue(input.bench, `speakers|${device}`, 'rtf')
  return measured ?? SPEAKERS[device].rtf * (device === 'cpu' ? cpuFactor(input.profile) : cudaFactor(input.profile))
}

function speakersRtf(input: PlanInput): number {
  return speakersRtfOn(input, input.speakersCuda && input.cuda ? 'cuda' : 'cpu')
}

function choice(m: CatalogModel, feature: Feature, plan: Device, input: PlanInput): Choice {
  // A processor-only model (Parakeet) in the card's plan runs on the processor, beside the card's Whisper.
  const device: Device = m.devices.includes(plan) ? plan : 'cpu'
  let why = ''
  let compute = device === 'cpu' ? 'int8' : cudaCompute(m, input)
  if (device === 'cuda' && !compute) {
    why = 'too big for this graphics card'
    compute = 'int8_float16'
  }
  const ramMb = (input.profile?.ramGb ?? 8) * 1024
  if (device === 'cpu' && m.ramMb > ramMb * 0.3) why = 'needs more memory than this computer has'
  if (m.languages !== 'all') {
    const known = m.languages
    if (!known.includes(input.native)) why = 'not for your language'
    else if (!(input.languages ?? []).every(code => known.includes(code))) why = 'not for every language you use'
  }
  const field = feature === 'dictation' ? 'phrase' : 'rtf'
  const s = speed(m, device, compute, field, input)
  const budget = BUDGET[feature][input.prefer]
  const estimate = feature === 'dictation' ? s.value : 60 * (s.value + OVERHEAD_RTF + (input.speakers ? speakersRtf(input) : 0))
  const words = feature === 'dictation' ? s.value : 60 * s.value
  return {
    model: m.name,
    label: m.label,
    about: m.about,
    device,
    compute,
    estimate,
    basis: s.basis,
    downloaded: input.downloaded.includes(m.name),
    mb: Math.round(m.bytes / 1e6),
    fits: !why && words <= budget,
    why,
  }
}

const rankOf = (model: string) => MODELS.find(m => m.name === model)?.rank ?? 0

/** Models whose errors are this close count as equally accurate, and the quicker one goes first. Measured
 *  2026-11-11 (docs/speech-quality.md): large led turbo on read speech by up to a quarter (English 5.1 against
 *  6.4 words wrong in a hundred) and lost on the owner's own reading (16.8 against 15.4, five phrases in the
 *  wrong language), so a lead under 30 % is not worth twice the time. */
const SAME_ERRORS = 1.3

/** The model's words wrong in a hundred for this person: the worst among the languages they use; undefined
 *  when one of them was not measured. */
export function errorsFor(model: string, input: Pick<PlanInput, 'native' | 'languages'>): number | undefined {
  const errors = MODELS.find(m => m.name === model)?.errors
  if (!errors) return undefined
  const languages = input.languages?.length ? input.languages : [input.native]
  let worst = 0
  for (const code of languages) {
    const e = errors[code]
    if (e === undefined) return undefined
    worst = Math.max(worst, e)
  }
  return worst
}

/** Negative when `a` is the more accurate for this person: by the errors measured in their languages, else by rank. */
function accuracyOrder(a: string, b: string, input: PlanInput): number {
  const ea = errorsFor(a, input)
  const eb = errorsFor(b, input)
  if (ea !== undefined && eb !== undefined) return ea * SAME_ERRORS < eb ? -1 : eb * SAME_ERRORS < ea ? 1 : 0
  return rankOf(b) - rankOf(a)
}

function decide(feature: Feature, device: Device, input: PlanInput): FeaturePlan {
  const budget = BUDGET[feature][input.prefer]
  const better = (a: Choice, b: Choice) => accuracyOrder(a.model, b.model, input) < 0
  const choices = MODELS.filter(m => m.features.includes(feature))
    .map(m => choice(m, feature, device, input))
    .sort((a, b) => Number(!!a.why) - Number(!!b.why) || accuracyOrder(a.model, b.model, input) || a.estimate - b.estimate)
  const usable = choices.filter(c => !c.why)
  const pick = (c: Choice, pinned = false, better?: Choice): FeaturePlan => ({ chosen: c, choices, pinned, budget, ...(better ? { better } : {}) })
  const pinned = input.pins[feature] && usable.find(c => c.model === input.pins[feature])
  if (pinned) return pick(pinned, true)
  if (usable.length === 0) return pick(choices[0]!)
  const words = (c: Choice) => (feature === 'dictation' ? c.estimate : c.estimate - (input.speakers ? 60 * speakersRtf(input) : 0) - 60 * OVERHEAD_RTF)
  const fits = usable.filter(c => c.fits)
  const kept = usable.find(c => c.model === input.previous?.[feature] && c.downloaded && words(c) <= budget * KEEP)
  const best = fits[0]
  const here = fits.find(c => c.downloaded)
  if (kept && (!here || !better(here, kept))) return pick(kept, false, best && best !== kept && !best.downloaded && better(best, kept) ? best : undefined)
  if (here) return pick(here, false, best && best !== here && better(best, here) ? best : undefined)
  // Nothing within the budget is here yet: the best that downloads by itself (a big one is only offered).
  const first = fits.find(c => c.mb <= AUTO_DOWNLOAD_MB)
  if (first) return pick(first, false, best && best !== first ? best : undefined)
  if (best) return pick(best)
  // Nothing within the budget: the quickest, with its honest time.
  return pick(usable.slice().sort((a, b) => a.estimate - b.estimate)[0]!)
}

function forDevice(device: Device, input: PlanInput): Record<Feature, FeaturePlan> {
  const transcripts = decide('transcripts', device, input)
  let dictation = decide('dictation', device, input)
  if (device !== 'cuda' || dictation.pinned) return { dictation, transcripts }
  // The most accurate model quick enough dictates, on the card too (2026-11-21, the owner: "да, меняй правило";
  // Parakeet on the processor, which dictated on every card's computer from 2026-10-31, gets twice turbo's
  // words wrong: 34.6 against 15.4 in a hundred on the owner's reading). The card is still the person's
  // programs' first: while they fill it the processor's plan dictates (jobs.py _card_full; `spare` below).
  // On the card, dictation uses the transcripts' model when that costs it neither time nor accuracy: one
  // model in the card's memory.
  const own = dictation.chosen
  const same = dictation.choices.find(c => c.model === transcripts.chosen.model && !c.why)
  const costsNothing = same && same.estimate <= Math.min(dictation.budget, own.estimate) * KEEP && accuracyOrder(same.model, own.model, input) <= 0
  // Never a model still to download in place of one that is here: that one is only offered (`better`).
  if (same && same.model !== own.model && costsNothing && (same.downloaded || !own.downloaded)) dictation = { ...dictation, chosen: same, better: undefined }
  return { dictation, transcripts }
}

/** Dictation's beam: five on the card, two on the processor. Speed gets the same: measured 2026-11-11
 * (docs/speech-quality.md, Whisper small on the processor), a beam of one made 4 % more word errors and
 * no phrase quicker (1.73 s against 1.67), as the encoder, not the search, costs the time there. */
const beamOn = (device: Device, _input: PlanInput) => (device === 'cuda' ? 5 : 2)

/** The lightest a busy card may fall to before the processor: tiny and base write a meeting too poorly. */
const LIGHTEST_RANK = rankOf('small')

/** When another program leaves the card too little for the chosen model (2026-11-10), the most accurate smaller one
 *  already downloaded, on the card, rather than the chosen one on the processor (a meeting in 40 minutes instead of 4).
 *  Only for Transcribe on Automatic: a model the person picked was picked over speed. */
function lighterOf(plan: FeaturePlan): EngineEntry['lighter'] {
  const c = plan.chosen
  if (plan.pinned || c.device !== 'cuda') return undefined
  const vram = (model: string) => MODELS.find(m => m.name === model)?.vramMb.int8_float16 ?? 0
  const light = plan.choices.find(o => o.device === 'cuda' && !o.why && o.downloaded && o.model !== c.model && rankOf(o.model) >= LIGHTEST_RANK && rankOf(o.model) < rankOf(c.model) && vram(o.model) < vram(c.model))
  return light ? { model: light.model, compute: light.compute } : undefined
}

const entryOf = (feature: Feature, plan: FeaturePlan, input: PlanInput): EngineEntry => {
  const c = plan.chosen
  const beam = feature === 'dictation' ? { beam: beamOn(c.device, input) } : {}
  if (c.device !== 'cuda') return { model: c.model, ...beam }
  const lighter = feature === 'transcripts' ? lighterOf(plan) : undefined
  return { model: c.model, compute: c.compute, ...beam, ...(lighter ? { lighter } : {}) }
}

export function planSpeech(input: PlanInput): SpeechPlan {
  const threads = Math.max(1, input.profile?.cpu.cores ?? 2)
  const cpu = forDevice('cpu', input)
  const cuda = input.cuda ? forDevice('cuda', input) : undefined
  const shown = cuda ?? cpu
  const offers = { gpu: gpuOffer(input.profile, input.nvidiaDriver), speakersGpu: false }
  offers.speakersGpu = offers.gpu && (nvidiaCard(input.profile)?.vramMb ?? 8192) >= 6144
  return {
    device: cuda ? 'cuda' : 'cpu',
    dictation: shown.dictation,
    transcripts: shown.transcripts,
    measured: shown.dictation.chosen.basis === 'measured' && shown.transcripts.chosen.basis === 'measured',
    engine: {
      fingerprint: input.fingerprint,
      threads,
      cpu: { dictation: entryOf('dictation', cpu.dictation, input), transcripts: entryOf('transcripts', cpu.transcripts, input) },
      ...(cuda ? { cuda: { dictation: entryOf('dictation', cuda.dictation, input), transcripts: entryOf('transcripts', cuda.transcripts, input) } } : {}),
    },
    offers,
    speakers: {
      cpu: Math.round(60 * speakersRtfOn(input, 'cpu')),
      ...(offers.speakersGpu ? { cuda: Math.max(1, Math.round(60 * speakersRtfOn(input, 'cuda'))) } : {}),
      advised: offers.speakersGpu ? 'cuda' : 'cpu',
    },
    ...(cuda?.dictation.chosen.device === 'cuda' ? { spare: { chosen: cpu.dictation.chosen, ...(cpu.dictation.better ? { better: cpu.dictation.better } : {}) } } : {}),
    threads,
  }
}

/** The processor's dictation model still to download, so that a busy card never leaves dictation waiting:
 *  the better one when the processor's plan names one, else its choice when that is not here yet. */
export function spareToFetch(plan: SpeechPlan): Choice | undefined {
  const spare = plan.spare
  const c = spare && (spare.better ?? spare.chosen)
  return c && c.device === 'cpu' && !c.downloaded && !c.why && c.mb <= AUTO_DOWNLOAD_MB ? c : undefined
}

/** The model whose two formats the speed test compares on this card, so that `slowHalf` is this card's own answer:
 *  the one Transcribe runs there, when the card has room for float16 and is not known to be quick at it. */
function formatProbe(input: PlanInput, plan: SpeechPlan): string | undefined {
  const card = nvidiaCard(input.profile)
  if (plan.device !== 'cuda' || !card || QUICK_HALF_CARDS.test(card.name)) return undefined
  const c = plan.transcripts.chosen
  const m = MODELS.find(o => o.name === c.model)
  return m && c.device === 'cuda' && c.downloaded && !c.why && roomCompute(m, input.profile) === 'float16' ? m.name : undefined
}

/** The models the speed test should measure: those downloaded, on the device in use, not yet measured here; and,
 *  on a card not known to be quick at half precision, one model in the format the plan did not take as well. */
export function testRuns(input: PlanInput, plan: SpeechPlan, all = false): { model: string; device: Device; compute?: string; beam: number }[] {
  // Each model where it runs: on a card's computer Parakeet is measured on the processor.
  const runs: { model: string; device: Device; compute?: string; beam: number }[] = plan.dictation.choices
    .filter(c => c.downloaded && !c.why)
    .filter(c => all || measuredValue(input.bench, runKey(c.model, c.device, c.compute), 'phrase') === undefined || measuredValue(input.bench, runKey(c.model, c.device, c.compute), 'rtf') === undefined)
    .sort((a, b) => a.mb - b.mb)
    .map(c => ({ model: c.model, device: c.device, ...(c.device === 'cuda' ? { compute: c.compute } : {}), beam: beamOn(c.device, input) }))
  const probe = formatProbe(input, plan)
  for (const compute of probe ? ['float16', 'int8_float16'] : []) {
    if (runs.some(r => r.model === probe && r.device === 'cuda' && r.compute === compute)) continue
    // A format the card had no room for when it was asked (bench.py marks it) is not asked again and again.
    const run = input.bench?.runs[runKey(probe!, 'cuda', compute)]
    if (all || (testedValue(input.bench, runKey(probe!, 'cuda', compute), 'rtf') === undefined && !run?.failed)) runs.push({ model: probe!, device: 'cuda', compute, beam: beamOn('cuda', input) })
  }
  return runs
}

/** What a declined test is remembered by: it is offered again when this changes (another computer, a model added). */
export function testKey(input: PlanInput, plan: SpeechPlan): string {
  return `${input.fingerprint}|${plan.device}|${testRuns(input, plan, true)
    .map(r => r.model)
    .join(',')}`
}

/** 0.4 s, 2.1 s, 12 s. */
export function seconds(s: number): string {
  return t('speech.sec', { n: s < 10 ? numberText(Math.round(s * 10) / 10, 1) : Math.round(s) })
}

/** 12 min, 1 h 10 min. */
export function minutes(m: number): string {
  const r = Math.max(1, Math.round(m))
  if (r < 60) return t('speech.min', { n: r })
  return r % 60 ? t('speech.hMin', { h: Math.floor(r / 60), m: r % 60 }) : t('speech.h', { h: Math.floor(r / 60) })
}

/** A choice's time as the pages say it: "≈0.4 s a phrase", "≈12 min an hour". */
export function estimateText(feature: Feature, c: Choice): string {
  return feature === 'dictation' ? t('speech.perPhrase', { time: seconds(c.estimate) }) : t('speech.perHour', { time: minutes(c.estimate) })
}

export const BASIS_TEXT: Record<Basis, string> = { measured: 'measured here', scaled: 'from this computer’s test', guess: 'first guess' }
