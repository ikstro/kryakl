import { describe, expect, it } from 'vitest'

import type { DeviceProfile } from './hardware'
import { BUDGET, cpuFactor, gpuOffer, minutes, planSpeech, runKey, seconds, testKey, testRuns, type PlanInput } from './speechplan'

const i9: DeviceProfile = {
  cpu: { name: 'Intel(R) Core(TM) i9-9900K CPU @ 3.60GHz', cores: 8, threads: 16 },
  ramGb: 32,
  gpus: [{ name: 'NVIDIA GeForce RTX 2080 SUPER', vendor: 'nvidia', vramMb: 8192, driver: '610.88', computeCap: 7.5 }],
  laptop: false,
  at: 1,
}

const weakLaptop: DeviceProfile = {
  cpu: { name: 'Intel(R) Core(TM) i5-8250U', cores: 4, threads: 8 },
  ramGb: 8,
  gpus: [{ name: 'Intel(R) UHD Graphics 620', vendor: 'intel', vramMb: 0, driver: '31.0.101.2111' }],
  laptop: true,
  at: 1,
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    profile: i9,
    fingerprint: 'fp',
    bench: undefined,
    cuda: false,
    speakersCuda: false,
    speakers: false,
    downloaded: [],
    native: 'ru',
    prefer: 'accuracy',
    pins: { dictation: '', transcripts: '' },
    ...over,
  }
}

describe('planSpeech', () => {
  it('a busy card falls to a lighter model already here, never a picked one, never tiny or base', () => {
    const previous = { transcripts: 'large-v3' }
    const both = planSpeech(input({ cuda: true, downloaded: ['large-v3', 'large-v3-turbo', 'base'], previous }))
    expect(both.engine.cuda?.transcripts).toMatchObject({ model: 'large-v3', lighter: { model: 'large-v3-turbo', compute: 'float16' } })
    // Nothing lighter on the disk but base: the processor, as before.
    expect(planSpeech(input({ cuda: true, downloaded: ['large-v3', 'base'] })).engine.cuda?.transcripts.lighter).toBeUndefined()
    // Picked by hand: kept, on the processor if it must be.
    const picked = planSpeech(input({ cuda: true, downloaded: ['large-v3', 'large-v3-turbo'], pins: { dictation: '', transcripts: 'large-v3' } }))
    expect(picked.engine.cuda?.transcripts.lighter).toBeUndefined()
    // Dictation and the processor's plan have none.
    expect(both.engine.cuda?.dictation.lighter).toBeUndefined()
    expect(both.engine.cpu.transcripts.lighter).toBeUndefined()
  })

  it('a weak laptop dictates Russian with Parakeet, Kazakh with a quick Whisper', () => {
    const plan = planSpeech(input({ profile: weakLaptop }))
    expect(plan.device).toBe('cpu')
    expect(plan.dictation.chosen.model).toBe('parakeet-tdt-0.6b-v3')
    expect(plan.engine.cpu.dictation.model).toBe('parakeet-tdt-0.6b-v3')
    // Parakeet dictates only.
    expect(plan.transcripts.choices.some(c => c.model === 'parakeet-tdt-0.6b-v3')).toBe(false)
    const kazakh = planSpeech(input({ profile: weakLaptop, native: 'kk' }))
    expect(kazakh.dictation.chosen.model).toBe('base')
    expect(kazakh.dictation.choices.find(c => c.model === 'parakeet-tdt-0.6b-v3')?.why).toMatch(/language/)
  })

  it('the card dictates with the more accurate model, and Parakeet is the processor\'s for a busy card', async () => {
    const { spareToFetch } = await import('./speechplan')
    const downloaded = ['large-v3-turbo', 'parakeet-tdt-0.6b-v3']
    const plan = planSpeech(input({ cuda: true, downloaded, languages: ['ru', 'en'], previous: { dictation: 'parakeet-tdt-0.6b-v3' } }))
    expect(plan.device).toBe('cuda')
    // Parakeet dictated here until 2026-11-21: turbo gets half its words wrong, so having been used keeps nothing.
    expect(plan.dictation.chosen).toMatchObject({ model: 'large-v3-turbo', device: 'cuda', compute: 'float16' })
    expect(plan.engine.cuda?.dictation).toEqual({ model: 'large-v3-turbo', compute: 'float16', beam: 5 })
    expect(plan.engine.cuda?.transcripts).toEqual({ model: 'large-v3-turbo', compute: 'float16' })
    // While other programs fill the card, the processor's plan dictates.
    expect(plan.engine.cpu.dictation).toEqual({ model: 'parakeet-tdt-0.6b-v3', beam: 2 })
    expect(plan.spare?.chosen).toMatchObject({ model: 'parakeet-tdt-0.6b-v3', device: 'cpu', downloaded: true })
    expect(spareToFetch(plan)).toBeUndefined()
    // A language Parakeet does not know, and a model the person picked, as before.
    const kazakhToo = planSpeech(input({ cuda: true, downloaded, languages: ['ru', 'en', 'kk'] })).dictation
    expect(kazakhToo.chosen.model).toBe('large-v3-turbo')
    expect(kazakhToo.choices.find(c => c.model === 'parakeet-tdt-0.6b-v3')?.why).toMatch(/every language/)
    expect(planSpeech(input({ cuda: true, downloaded, pins: { dictation: 'parakeet-tdt-0.6b-v3', transcripts: '' } })).dictation.chosen).toMatchObject({ model: 'parakeet-tdt-0.6b-v3', device: 'cpu' })
    // Speed first, on a card where turbo's phrase is over 0.8 s: the processor's quick model, and no spare to speak of.
    const slowCard: DeviceProfile = { ...i9, gpus: [{ ...i9.gpus[0]!, name: 'NVIDIA GeForce GTX 1660 Ti', vramMb: 6144 }] }
    const quick = planSpeech(input({ profile: slowCard, cuda: true, downloaded, prefer: 'speed' }))
    expect(quick.dictation.chosen).toMatchObject({ model: 'parakeet-tdt-0.6b-v3', device: 'cpu' })
    expect(quick.spare).toBeUndefined()
    // With accuracy first that card dictates too, compact: about a second a phrase.
    expect(planSpeech(input({ profile: slowCard, cuda: true, downloaded })).dictation.chosen).toMatchObject({ model: 'large-v3-turbo', device: 'cuda', compute: 'int8_float16' })
  })

  it('the processor\'s model for a busy card downloads by itself, and the card\'s is never fetched unasked', async () => {
    const { spareToFetch } = await import('./speechplan')
    const plan = planSpeech(input({ cuda: true, downloaded: ['large-v3-turbo'] }))
    expect(plan.dictation.chosen).toMatchObject({ model: 'large-v3-turbo', device: 'cuda' })
    expect(plan.dictation.better).toBeUndefined()
    expect(spareToFetch(plan)).toMatchObject({ model: 'parakeet-tdt-0.6b-v3', device: 'cpu', downloaded: false })
    // Only Parakeet here: it dictates, turbo is offered, nothing is fetched.
    const parakeet = planSpeech(input({ cuda: true, downloaded: ['parakeet-tdt-0.6b-v3'] }))
    expect(parakeet.dictation.chosen).toMatchObject({ model: 'parakeet-tdt-0.6b-v3', device: 'cpu' })
    expect(parakeet.dictation.better?.model).toBe('large-v3-turbo')
    expect(spareToFetch(parakeet)).toBeUndefined()
  })

  it('a phrase going to Groq is previewed by the processor\'s model only when it is here', async () => {
    const { processorPreview } = await import('./speechplan')
    const both = planSpeech(input({ cuda: true, downloaded: ['large-v3-turbo', 'parakeet-tdt-0.6b-v3'], languages: ['ru', 'en'] }))
    // The card's turbo is never the preview: the processor's Parakeet is.
    expect(processorPreview(both, ['large-v3-turbo', 'parakeet-tdt-0.6b-v3'])).toBe('parakeet-tdt-0.6b-v3')
    // Not downloaded: no preview, and nothing fetched for it.
    expect(processorPreview(planSpeech(input({ cuda: true, downloaded: ['large-v3-turbo'] })), ['large-v3-turbo'])).toBeUndefined()
    expect(processorPreview(planSpeech(input({ profile: weakLaptop })), [])).toBeUndefined()
  })

  it('an action Groq does takes a model here, never one to download, and Groq\'s dictation falls to the processor', () => {
    const remote = { dictation: true, transcripts: true }
    const both = planSpeech(input({ cuda: true, downloaded: ['large-v3-turbo', 'parakeet-tdt-0.6b-v3'], languages: ['ru', 'en'], remote }))
    // Dictation: Parakeet, which previews the phrase anyway; turbo stays only for recordings.
    expect(both.engine.cuda?.dictation.model).toBe('parakeet-tdt-0.6b-v3')
    expect(both.engine.cuda?.transcripts.model).toBe('large-v3-turbo')
    // The spare turbo removed: dictation keeps Parakeet, nothing chosen to download where something is here.
    const left = planSpeech(input({ cuda: true, downloaded: ['parakeet-tdt-0.6b-v3', 'base'], languages: ['ru', 'en'], remote }))
    expect(left.engine.cuda?.dictation.model).toBe('parakeet-tdt-0.6b-v3')
    expect(left.transcripts.chosen).toMatchObject({ model: 'base', downloaded: true })
  })

  it('dictation shares the transcripts\' model only when that costs it nothing', () => {
    // large-v3 kept for recordings: a phrase in it takes four times turbo's, so dictation keeps turbo.
    const two = planSpeech(input({ cuda: true, downloaded: ['large-v3', 'large-v3-turbo', 'parakeet-tdt-0.6b-v3'], previous: { transcripts: 'large-v3' } }))
    expect(two.transcripts.chosen.model).toBe('large-v3')
    expect(two.dictation.chosen.model).toBe('large-v3-turbo')
  })

  it('a weak laptop transcribes with turbo, whose decoder is light, and keeps the large model out of its memory', () => {
    const plan = planSpeech(input({ profile: weakLaptop, native: 'kk' }))
    expect(plan.dictation.chosen.model).toBe('base')
    expect(plan.dictation.chosen.estimate).toBeLessThanOrEqual(BUDGET.dictation.accuracy)
    expect(plan.transcripts.chosen.model).toBe('large-v3-turbo')
    expect(plan.dictation.chosen.basis).toBe('guess')
    // 8 GB: large-v3 needs more than a third of it.
    expect(plan.transcripts.choices.find(c => c.model === 'large-v3')?.why).toMatch(/memory/)
    expect(plan.offers.gpu).toBe(false)
  })

  it('speed over accuracy takes quicker models, the beam kept (a beam of one saved no time)', () => {
    const plan = planSpeech(input({ profile: weakLaptop, prefer: 'speed', native: 'kk' }))
    expect(plan.dictation.chosen.model).toBe('tiny')
    expect(plan.engine.cpu.dictation).toEqual({ model: 'tiny', beam: 2 })
  })

  it('a downloaded model within the budget is used, and a better one offered', () => {
    const plan = planSpeech(input({ downloaded: ['base', 'small'], native: 'kk' }))
    expect(plan.dictation.chosen.model).toBe('small')
    const russian = planSpeech(input({ downloaded: ['base', 'small'] }))
    expect(russian.dictation.chosen.model).toBe('small')
    expect(russian.dictation.better?.model).toBe('parakeet-tdt-0.6b-v3')
    const slow = planSpeech(input({ profile: weakLaptop, downloaded: ['tiny'], native: 'kk' }))
    expect(slow.dictation.chosen.model).toBe('tiny')
    expect(slow.dictation.better?.model).toBe('base')
  })

  it('a model too slow here is left for a quicker one that will download (going down needs no asking)', () => {
    const plan = planSpeech(input({ profile: weakLaptop, downloaded: ['small'], native: 'kk' }))
    expect(plan.dictation.chosen.model).toBe('base')
    expect(plan.dictation.chosen.downloaded).toBe(false)
  })

  it('the card: one model for both, in float16 when it fits, both plans for the engine', () => {
    const plan = planSpeech(input({ cuda: true, downloaded: ['small', 'large-v3-turbo'] }))
    expect(plan.device).toBe('cuda')
    expect(plan.transcripts.chosen.model).toBe('large-v3-turbo')
    expect(plan.dictation.chosen.model).toBe('large-v3-turbo')
    // small, downloaded, is what a busy card takes instead of the processor.
    expect(plan.engine.cuda?.transcripts).toEqual({ model: 'large-v3-turbo', compute: 'float16', lighter: { model: 'small', compute: 'float16' } })
    expect(plan.engine.cuda?.dictation.beam).toBe(5)
    // Should the card fail, the processor's own choice.
    expect(plan.engine.cpu.dictation.model).toBe('small')
    expect(plan.offers).toEqual({ gpu: true, speakersGpu: true })
    // large-v3 fits the card but is no more accurate than turbo by what was measured: not offered.
    expect(plan.transcripts.better).toBeUndefined()
  })

  it('a fresh install on a strong card downloads turbo, not the 3 GB model', () => {
    const plan = planSpeech(input({ cuda: true }))
    expect(plan.transcripts.chosen.model).toBe('large-v3-turbo')
    expect(plan.dictation.chosen.model).toBe('large-v3-turbo')
    expect(plan.transcripts.better).toBeUndefined()
  })

  it('accuracy is the errors measured in the person\'s languages, the worst of them', async () => {
    const { errorsFor } = await import('./speechplan')
    expect(errorsFor('large-v3-turbo', { native: 'ru' })).toBe(5.0)
    expect(errorsFor('large-v3-turbo', { native: 'ru', languages: ['ru', 'uk', 'en'] })).toBe(10.0)
    // A language never measured: no number, and the plan goes by rank.
    expect(errorsFor('large-v3-turbo', { native: 'kk', languages: ['kk', 'en'] })).toBeUndefined()
    expect(errorsFor('nothing', { native: 'ru' })).toBeUndefined()
  })

  it('a model already here that is clearly less accurate is not used when a better one is here too', () => {
    // small makes twice turbo's errors in Russian: turbo, though small is quicker.
    const plan = planSpeech(input({ cuda: true, downloaded: ['small', 'large-v3-turbo'], previous: { transcripts: 'small' } }))
    expect(plan.transcripts.chosen.model).toBe('large-v3-turbo')
  })

  it('a small card takes int8_float16, and too small a card is left out', () => {
    const small: DeviceProfile = { ...i9, gpus: [{ ...i9.gpus[0]!, vramMb: 3072 }] }
    const plan = planSpeech(input({ profile: small, cuda: true }))
    expect(plan.transcripts.choices.find(c => c.model === 'large-v3-turbo')?.compute).toBe('int8_float16')
    expect(plan.transcripts.choices.find(c => c.model === 'large-v3')?.why).toMatch(/too big/)
    expect(plan.offers.speakersGpu).toBe(false)
    expect(gpuOffer({ ...i9, gpus: [{ ...i9.gpus[0]!, vramMb: 1024 }] })).toBe(false)
    expect(gpuOffer({ ...i9, gpus: [{ ...i9.gpus[0]!, driver: '472.12' }] })).toBe(false)
    expect(gpuOffer(undefined, true)).toBe(true)
  })

  it('a card slow at half precision takes int8_float16: by its name first, then by what the speed test measured', async () => {
    const { slowHalf } = await import('./speechplan')
    const card = (name: string, vramMb = 6144): DeviceProfile => ({ ...i9, gpus: [{ ...i9.gpus[0]!, name, vramMb }] })
    const gtx = card('NVIDIA GeForce GTX 1660 Ti')
    const downloaded = ['large-v3-turbo', 'parakeet-tdt-0.6b-v3']
    const turbo = (profile: DeviceProfile, bench?: PlanInput['bench']) => planSpeech(input({ profile, bench, cuda: true, downloaded })).transcripts.chosen
    // Room for float16, and four times its time there (a phrase in 4.4 s): the compact format, with a guess of its own.
    expect(turbo(gtx)).toMatchObject({ model: 'large-v3-turbo', compute: 'int8_float16', basis: 'guess' })
    expect(planSpeech(input({ profile: gtx, cuda: true, downloaded })).engine.cuda?.transcripts).toEqual({ model: 'large-v3-turbo', compute: 'int8_float16' })
    expect(planSpeech(input({ profile: gtx, cuda: true, downloaded, native: 'kk' })).dictation.chosen.estimate).toBeCloseTo(0.26 * 4.5, 5)
    // The reference card and its like keep float16, which writes a little better.
    expect(turbo(i9).compute).toBe('float16')
    expect(slowHalf({ profile: i9, bench: undefined })).toBe(false)
    // A card nobody named: the speed test's own two numbers decide, never those of real use.
    const tested = (full: number, compact: number, field = 'tested') => ({
      fingerprint: 'fp',
      runs: {
        [runKey('large-v3-turbo', 'cuda', 'float16')]: { phrase: full, rtf: full / 20, [field]: { phrase: full, rtf: full / 20 } },
        [runKey('large-v3-turbo', 'cuda', 'int8_float16')]: { phrase: compact, rtf: compact / 20, [field]: { phrase: compact, rtf: compact / 20 } },
      },
    })
    const old = card('NVIDIA GeForce GTX 1080', 8192)
    expect(turbo(old).compute).toBe('float16')
    expect(turbo(old, tested(4.2, 1.1))).toMatchObject({ compute: 'int8_float16', basis: 'measured', estimate: expect.closeTo(60 * (1.1 / 20 + 0.015), 5) })
    expect(turbo(old, tested(0.3, 0.3)).compute).toBe('float16')
    expect(turbo(old, tested(4.2, 1.1, 'other')).compute).toBe('float16')
    // A named card that measures quick at it after all is believed.
    expect(turbo(gtx, tested(0.3, 0.3)).compute).toBe('float16')
  })

  it('the speed test compares the two formats once on a card not known to be quick at half precision', () => {
    const card = (name: string): DeviceProfile => ({ ...i9, gpus: [{ ...i9.gpus[0]!, name }] })
    const downloaded = ['large-v3-turbo', 'parakeet-tdt-0.6b-v3']
    const runsOn = (name: string, bench?: PlanInput['bench']) => {
      const i = input({ profile: card(name), bench, cuda: true, downloaded })
      return testRuns(i, planSpeech(i)).filter(r => r.device === 'cuda')
    }
    const both = [
      { model: 'large-v3-turbo', device: 'cuda', compute: 'float16', beam: 5 },
      { model: 'large-v3-turbo', device: 'cuda', compute: 'int8_float16', beam: 5 },
    ]
    expect(runsOn('NVIDIA GeForce GTX 1080')).toEqual(both)
    // The compact format first where the plan takes it; an RTX card is not asked twice.
    expect(runsOn('NVIDIA GeForce GTX 1660 Ti')).toEqual([both[1], both[0]])
    expect(runsOn('NVIDIA GeForce RTX 2080 SUPER')).toEqual([both[0]])
    // Measured in both: nothing more to ask. A format the card had no room for is not asked again.
    const run = { phrase: 0.3, rtf: 0.02, tested: { phrase: 0.3, rtf: 0.02 } }
    const measured = { fingerprint: 'fp', runs: { [runKey('large-v3-turbo', 'cuda', 'float16')]: run, [runKey('large-v3-turbo', 'cuda', 'int8_float16')]: run } }
    expect(runsOn('NVIDIA GeForce GTX 1080', measured)).toEqual([])
    const noRoom = { fingerprint: 'fp', runs: { [runKey('large-v3-turbo', 'cuda', 'float16')]: run, [runKey('large-v3-turbo', 'cuda', 'int8_float16')]: { failed: 'loaded as float16' } } }
    expect(runsOn('NVIDIA GeForce GTX 1080', noRoom)).toEqual([])
  })

  it('measured numbers replace the guesses, and scale to the models not measured', () => {
    const bench = { fingerprint: 'fp', runs: { [runKey('small', 'cpu', 'int8')]: { phrase: 3.0, rtf: 0.4 } } }
    const plan = planSpeech(input({ bench, downloaded: ['small'], native: 'kk' }))
    const small = plan.dictation.choices.find(c => c.model === 'small')!
    expect(small).toMatchObject({ estimate: 3.0, basis: 'measured', fits: false })
    const base = plan.dictation.choices.find(c => c.model === 'base')!
    expect(base.basis).toBe('scaled')
    expect(base.estimate).toBeCloseTo((3.0 * 0.45) / 1.4, 5)
    expect(plan.dictation.chosen.model).toBe('base')
  })

  it('a pinned model is kept whatever it costs', () => {
    const plan = planSpeech(input({ profile: weakLaptop, pins: { dictation: 'large-v3-turbo', transcripts: '' } }))
    expect(plan.dictation.pinned).toBe(true)
    expect(plan.dictation.chosen.model).toBe('large-v3-turbo')
    expect(plan.dictation.chosen.fits).toBe(false)
  })

  it('a model near the budget is kept while the numbers move a little', () => {
    const runs = (phrase: number) => ({ fingerprint: 'fp', runs: { [runKey('small', 'cpu', 'int8')]: { phrase, rtf: 0.2 } } })
    const kk = { native: 'kk' }
    expect(planSpeech(input({ ...kk, bench: runs(1.6), downloaded: ['small', 'base'] })).dictation.chosen.model).toBe('base')
    expect(planSpeech(input({ ...kk, bench: runs(1.6), downloaded: ['small', 'base'], previous: { dictation: 'small' } })).dictation.chosen.model).toBe('small')
    expect(planSpeech(input({ ...kk, bench: runs(2.0), downloaded: ['small', 'base'], previous: { dictation: 'small' } })).dictation.chosen.model).toBe('base')
  })

  it('the hour counts speakers when their part is here', () => {
    const without = planSpeech(input()).transcripts.chosen.estimate
    const withSpeakers = planSpeech(input({ speakers: true })).transcripts.chosen.estimate
    expect(withSpeakers - without).toBeCloseTo(60 * 0.8, 1)
  })

  it('tests the downloaded models not yet measured, the smallest first, and remembers a decline by them', () => {
    const bench = { fingerprint: 'fp', runs: { [runKey('small', 'cpu', 'int8')]: { phrase: 1.4, rtf: 0.2 } } }
    const i = input({ bench, downloaded: ['large-v3-turbo', 'small', 'base', 'parakeet-tdt-0.6b-v3'] })
    const plan = planSpeech(i)
    expect(testRuns(i, plan)).toEqual([
      { model: 'base', device: 'cpu', beam: 2 },
      { model: 'parakeet-tdt-0.6b-v3', device: 'cpu', beam: 2 },
      { model: 'large-v3-turbo', device: 'cpu', beam: 2 },
    ])
    expect(testKey(i, plan)).toBe('fp|cpu|base,small,parakeet-tdt-0.6b-v3,large-v3-turbo')
    // On a card's computer each is measured where it runs.
    const card = input({ cuda: true, downloaded: ['large-v3-turbo', 'parakeet-tdt-0.6b-v3'] })
    expect(testRuns(card, planSpeech(card))).toEqual([
      { model: 'parakeet-tdt-0.6b-v3', device: 'cpu', beam: 2 },
      { model: 'large-v3-turbo', device: 'cuda', compute: 'float16', beam: 5 },
    ])
  })
})

describe('the numbers as said', () => {
  it('seconds and minutes', () => {
    expect(seconds(0.43)).toBe('0.4 s')
    expect(seconds(12.4)).toBe('12 s')
    expect(minutes(12.4)).toBe('12 min')
    expect(minutes(70)).toBe('1 h 10 min')
    expect(minutes(120)).toBe('2 h')
  })

  it('a laptop of four cores is about twice slower than the reference desktop', () => {
    expect(cpuFactor(weakLaptop)).toBeCloseTo(1.98, 2)
    expect(cpuFactor(i9)).toBe(1)
  })
})
