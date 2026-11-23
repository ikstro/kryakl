// What Whisper writes in a dictated phrase where nobody said it, for a phrase recognized in the main
// process (Groq's Whisper) with no speech engine in the path. A port of engine/phantoms.py as
// engine/asr.py `_said` applies it to a dictated phrase: `clean(text, sound, dictation=True)`, then
// `pauses`. The tables and thresholds below are engine/phantoms.py's, copied verbatim: change both.
//
// - credits ("Субтитры сделал DimaTorzok"): nobody says them; cut wherever they are.
// - sign-offs of a video ("Продолжение следует...", "Thanks for watching!"): at the end of the text
//   or as all of it; a dictation never ends so, so they are cut always.
// - thanks ("Спасибо.", "Thank you."): only when they are all of the text and the sound does not carry it.
// - murmurs ("you", "come on"): all of a dictated phrase, always cut.
//
// Python's \b and \w are Unicode-aware, JavaScript's are not, so `B`, `E` and `W` stand for them.

export type HeardSegment = { start: number; end: number; text: string; avgLogprob: number; noSpeech: number }

// engine/phantoms.py NO_SPEECH, LOW_LOGPROB: Whisper's own measures of a segment.
export const NO_SPEECH = 0.4
export const LOW_LOGPROB = -0.8
// engine/phantoms.py FAST: letters and digits a second that nobody speaks faster than (dictation runs at 10–15).
export const FAST = 22.0
// engine/phantoms.py MEND_PAUSES.
export const MEND_PAUSES = true

const W = '[\\p{L}\\p{N}_]' // Python's \w
const B = '(?<![\\p{L}\\p{N}_])' // Python's \b before a word's letter
const E = '(?![\\p{L}\\p{N}_])' // Python's \b after a word's letter
const END = '(?=\\n?$)' // Python's $ without MULTILINE: the end, or before a newline that ends the text

const SENTENCE_END = '[^.!?…\\n]*[.!?…]*'

const CREDITS = [
  `[^.!?…\\n]*${B}dima\\s?torzok${E}` + SENTENCE_END,
  `[^.!?…\\n]*${B}amara\\.org${E}` + SENTENCE_END,
  `[^.!?…\\n]*${B}castingwords${E}` + SENTENCE_END,
  `${B}(?:субтитры|субтитри)\\s+(?:сделал|сделала|сделаны|делал|создавал|создал|подготовил|подготовила|подогнал|` +
    `зробив|зробила|зроблені|створив|створено|створені|підготував)\\s` + SENTENCE_END,
  `${B}редактор\\s+субтитр(?:ов|ів)\\s+[^\\n]*?(?:[.!?…](?=\\s|$)|${END})`,
  `${B}коректор${W}*\\s+[А-ЯЁІЇЄҐ]\\.\\s?[А-ЯЁІЇЄҐ][\\p{L}\\p{N}_-]+[.!]*`,
  `${B}корректор\\s+[А-ЯЁ]\\.\\s?[А-ЯЁ][\\p{L}\\p{N}_-]+[.!]*`,
  `${B}(?:subtitles|captions|subtitled|captioned)\\s+by\\s+(?:the\\s+)?(?:amara|castingwords|rev\\.com)` + SENTENCE_END,
].map((p) => new RegExp(p, 'giu'))

const whole = (patterns: string[]): RegExp[] => patterns.map((p) => new RegExp(`^(?:${p})$`, 'u'))

const SIGN_OFFS = whole([
  // ru
  '(?:всем )?спасибо за просмотр(?: (?:этого )?видео)?',
  'продолжение следует',
  '(?:и )?подписывайтесь на (?:наш |мой |этот )?канал',
  '(?:и )?подпишись на (?:наш |мой )?канал',
  '(?:ставьте|ставим) лайк(?:и)?(?: и подписывайтесь на (?:наш |мой )?канал)?',
  'до (?:встречи|скорой встречи) в (?:следующем|новом) (?:видео|выпуске)',
  // uk
  '(?:всім )?дякую за перегляд',
  'далі буде',
  'продовження (?:буде|слідує)',
  '(?:і )?підписуй(?:те)?с[ья] на (?:наш |мій )?канал',
  '(?:ставте|ставимо) лайк(?:и)?(?: і підписуйтеся на канал)?',
  // en
  '(?:thank you|thanks)(?: (?:so|very) much)? for watching',
  '(?:please )?(?:like and )?subscribe(?: to (?:my|our|the) channel)?',
  'see you in the next (?:video|one|episode)',
  'to be continued',
])

const THANKS = whole([
  '(?:большое )?спасибо(?: большое| вам)?',
  'спасибо за внимание',
  '(?:щиро )?дякую(?: вам)?',
  'дякую за увагу',
  'thank you(?: (?:so|very) much)?',
  'thanks(?: a lot)?',
  'thank you for your attention',
])

// engine/phantoms.py MURMURS: what Whisper writes for a breath; never a dictated phrase on its own.
const MURMURS = whole(['you', 'come on'])

const SENTENCE = new RegExp(`[^.!?…\\n]+(?:[.!?…]+|${END})`, 'gu')

type Span = [number, number]
/** `endWeak`: the last of two or more segments is weak, the text's end not heard as speech (engine/phantoms.py `Sound.end_weak`). */
type Sound = { seconds?: number; noSpeech: number; logprob: number; endWeak?: boolean }

const weak = (s: Sound): boolean => s.noSpeech >= NO_SPEECH || s.logprob <= LOW_LOGPROB
const tooFast = (s: Sound, text: string): boolean =>
  !!s.seconds && (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) / s.seconds > FAST

function norm(sentence: string): string {
  const s = sentence.toLowerCase().replace(/ё/g, 'е').replace(/’/g, "'")
  return s.replace(/[^\p{L}\p{N}_' ]+/gu, ' ').split(/\s+/u).filter(Boolean).join(' ')
}

const is = (patterns: RegExp[], sentence: string): boolean => {
  const s = norm(sentence)
  return patterns.some((p) => p.test(s))
}

function merge(spans: Span[]): Span[] {
  const out: Span[] = []
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0] || x[1] - y[1])) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** engine/phantoms.py `phantoms`: where Whisper wrote what nobody said, with a label for each piece. */
function phantoms(text: string, sound: Sound, dictation: boolean): { spans: Span[]; labels: string[] } {
  const found: Span[] = []
  for (const p of CREDITS) {
    for (const m of text.matchAll(p)) if (m[0].trim()) found.push([m.index!, m.index! + m[0].length])
  }
  let cut = merge(found)
  const labels = cut.map(() => 'credit')
  const inside = (a: number, b: number): boolean => cut.some(([x, y]) => x <= a && b <= y)
  const sentences: Span[] = []
  for (const m of text.matchAll(SENTENCE)) {
    const span: Span = [m.index!, m.index! + m[0].length]
    if (m[0].trim() && !inside(...span)) sentences.push(span)
  }
  const left = (): string => sentences.map(([a, b]) => text.slice(a, b)).join(' ')
  while (sentences.length) {
    const [a, b] = sentences[sentences.length - 1]!
    const last = text.slice(a, b)
    const alone = sentences.length === 1
    let label: string
    if (is(SIGN_OFFS, last)) {
      if (!(dictation || weak(sound) || tooFast(sound, left()))) break
      label = 'sign-off'
    } else if (is(THANKS, last)) {
      if (!((alone && weak(sound)) || (dictation && !alone && sound.endWeak))) break
      label = 'thanks'
    } else if (is(MURMURS, last)) {
      if (!(alone && (dictation || weak(sound)))) break
      label = 'murmur'
    } else break
    cut = [...cut, [a, b]]
    labels.push(label)
    sentences.pop()
  }
  return { spans: merge(cut), labels }
}

function stripChars(s: string, chars: string): string {
  let a = 0
  let b = s.length
  while (a < b && chars.includes(s[a]!)) a++
  while (b > a && chars.includes(s[b - 1]!)) b--
  return s.slice(a, b)
}

function without(text: string, spans: Span[]): string {
  let kept = ''
  let at = 0
  for (const [a, b] of spans) {
    kept += text.slice(at, a)
    at = b
  }
  kept += text.slice(at)
  const out = kept.split(/\s+/u).filter(Boolean).join(' ')
  return stripChars(out.replace(/\s+([,.!?…;:])/gu, '$1'), ' ,;:—-')
}

/** A dictated phrase as Whisper wrote it, without what nobody said. `cut`: what was removed, as short labels for a log (never the person's words beyond the phantom itself). */
export function cleanDictated(text: string, o: { segments?: readonly HeardSegment[]; seconds?: number }): { text: string; cut: string[] } {
  // engine/asr.py `_said`: the seconds of speech, the worst no-speech chance, the lowest mean log probability.
  // With no segments, phantoms.Sound()'s defaults: nothing says the sound is weak.
  const segments = o.segments ?? []
  const sound: Sound = segments.length
    ? {
        seconds: o.seconds,
        noSpeech: Math.max(...segments.map((s) => s.noSpeech)),
        logprob: Math.min(...segments.map((s) => s.avgLogprob)),
        endWeak: segments.length > 1 && weak({ noSpeech: segments.at(-1)!.noSpeech, logprob: segments.at(-1)!.avgLogprob }),
      }
    : { seconds: o.seconds, noSpeech: 0, logprob: 0 }
  const { spans, labels } = phantoms(text, sound, true)
  const cleaned = spans.length ? without(text, spans) : text
  const mended = mend(cleaned)
  return { text: mended.text, cut: [...labels, ...mended.labels] }
}

// A pause is not a mark (engine/phantoms.py, 2026-11-20): an ellipsis a sentence goes on after in a
// small letter goes, and so do the dots that open a piece; before a capital it stays, and at the end.
const DOTS = '(?<![?!.])(?:…|\\.{2,})' // not the dots of "?.."
const OPENING = new RegExp(`(^|\\s)${DOTS}(?=${W})`, 'gu')
const PAUSE = new RegExp(`\\s*${DOTS}(?:\\s*${DOTS})*\\s+(?=(\\S+))`, 'gu')
const I = /^I(?:['’](?:m|ll|ve|d))?(?![\p{L}\p{N}_'’])/u // English's only capital inside a sentence
const SMALL = /^[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}]$/u

/** A small letter of a script that opens its sentences with a capital (Georgian has none). */
const small = (letter: string): boolean => /^\p{Ll}$/u.test(letter) && SMALL.test(letter)

function mend(text: string): { text: string; labels: string[] } {
  if (!MEND_PAUSES || (!text.includes('…') && !text.includes('..'))) return { text, labels: [] }
  const labels: string[] = []
  const opened = text.replace(OPENING, '$1')
  if (opened !== text) labels.push('opening dots')
  const out = opened.replace(PAUSE, (found: string, next: string) => {
    const after = next.replace(/^[«"“„'‘([]+/u, '') // Python's lstrip
    const first = after ? String.fromCodePoint(after.codePointAt(0)!) : ''
    if (!(after && (small(first) || I.test(after)))) return found
    labels.push('pause')
    return ' '
  })
  if (out === text) return { text, labels: [] }
  return { text: out.trim(), labels }
}

/** phantoms.pauses for a dictated text: an ellipsis a sentence goes on after in a small letter goes, dots that open the text go; before a capital, a digit, after ? or !, and at the end it stays. */
export function mendPauses(text: string): string {
  return mend(text).text
}

/** engine/stream.py `joined`: the pieces' texts as one; an ellipsis at a seam the sentence goes on after was the pause, not a mark. */
export function joinedPieces(texts: readonly string[]): string {
  return mendPauses(texts.filter(Boolean).join(' ').trim())
}

const TRAILING = new RegExp(`\\s*${DOTS}\\s*$`, 'u')

/** engine/phantoms.py `open_ended`: the text as the next piece is told it, without the ellipsis a cut piece ends in, so Whisper goes on with the sentence. */
export function openEnded(text: string): string {
  return text.replace(TRAILING, '')
}
