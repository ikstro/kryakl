// A snipped picture is read by every text recognition of the person's
// languages Windows has, and each line is taken from the reading that reads
// it best. One engine is not enough: the Russian engine reads Latin letters
// too, but turns many English words into Cyrillic look-alikes ("can" →
// "сап", "a" → "а", "gpu" → "дри"), while the English engine turns Russian
// into Latin rubbish ("Кнопки" → "KHonKb1").

import type { OcrLine } from './ocrtext'

export type OcrReading = {
  /** The language tag of the engine, "ru", "en-US". */
  lang: string
  lines: OcrLine[]
}

/** Letters of other scripts a recognizer writes for Latin ones: Cyrillic and Greek look-alikes, and the shapes Windows' Russian engine was seen to give (п for n, и for u, д for g). */
const LOOKALIKE = new Set('аеорсухпидтАВЕКМНОРСТХИДУПοαειкνρτυχΑΒΕΖΗΙΚΜΝΟΡΤΥΧ')

const LATIN = /^\p{Script=Latin}+$/u
/** A list's number opening a line, maybe read as one or two letters: "зе." for "30.". */
const LETTER_MARKER = /^\p{L}{1,2}[.)]$/u
const LETTER = /\p{L}/u
/** A bracket or a bar next to a letter: "a[ready", "[п", "FastAP|". */
const BROKEN = /\p{L}[[\]|{}]|[[\]|{}]\p{L}/u

function scriptOf(letters: string): string {
  if (/\p{Script=Latin}/u.test(letters)) return /^[\p{Script=Latin}]+$/u.test(letters) ? 'Latin' : 'mixed'
  return 'other'
}

/** A word without the signs around it, apostrophes and hyphens inside kept. */
function coreOf(token: string): string {
  return token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function isKnown(core: string, known: (word: string) => boolean): boolean {
  const word = core.toLowerCase()
  if (known(word) || known(word.replace(/['’]/g, ''))) return true
  const parts = word.split('-')
  return parts.length > 1 && parts.every(p => p.length > 0 && known(p))
}

/**
 * How well a line reads: a word found in the person's word lists counts for
 * it; a word that mixes scripts, holds a bracket by a letter, or is a word of
 * look-alike letters between Latin words, against it. A line of one number
 * reads better than a line of one letter.
 */
export function lineScore(text: string, known: (word: string) => boolean): number {
  // A line of one number (a line number in an editor's margin) against one letter alone: the Russian engine read 5 as "Б" and 3 as "З" (2026-11-12).
  const alone = text.trim()
  if (/^\d+[.,:)]?$/u.test(alone)) return 1
  if (/^\p{L}{1,2}[.,:)]?$/u.test(alone)) return 0
  const cores = text.split(/\s+/).map(token => ({ token, core: coreOf(token) }))
  const letters = cores.map(c => c.core.replace(/[^\p{L}]/gu, ''))
  const latin = letters.map(l => l.length > 0 && LATIN.test(l))
  // A list's number opening the line ("30. На сегодня…") counts for it: the Russian engine read it "зе.".
  let score = /^\d+[.)]$/u.test(cores[0]?.token ?? '') ? 1 : 0
  cores.forEach(({ token, core }, i) => {
    const own = letters[i] ?? ''
    if (!LETTER.test(own)) return
    // "зе." opening a line is no word of the list, but a number misread ("зе" is a Russian word too).
    if (i === 0 && LETTER_MARKER.test(token)) return
    if (BROKEN.test(token) || scriptOf(own) === 'mixed') return void (score -= 1)
    if (!latin[i] && [...own].every(c => LOOKALIKE.has(c))) {
      let before = i - 1
      while (before >= 0 && !letters[before]) before--
      const after = letters.findIndex((l, j) => j > i && l.length > 0)
      const around = [before, after].filter(j => j >= 0)
      if (around.length > 0 && around.every(j => latin[j])) return void (score -= 1)
    }
    if (isKnown(core, known)) score += 1
  })
  return score
}

/** A word a recognizer may have got wrong: a bracket or a digit among its letters, scripts mixed, or only look-alike letters of another script than Latin. */
function doubtful(token: string): boolean {
  const letters = coreOf(token).replace(/[^\p{L}]/gu, '')
  if (!letters) return false
  if (BROKEN.test(token) || /\p{L}\d+\p{L}/u.test(token) || scriptOf(letters) === 'mixed') return true
  return !LATIN.test(letters) && [...letters].every(c => LOOKALIKE.has(c))
}

/**
 * A line with the words another reading of it reads better: the two are
 * lined up by the words they share, and each stretch where they differ that
 * holds a doubtful word is taken from the other when the line then scores
 * higher ("Translate (п place" → "Translate in place"; "ГБ" stays, though
 * "rS" is in a list). Words only one of them has stay as the line has them.
 */
export function mergeLine(line: string, other: string, known: (word: string) => boolean): string {
  const a = line.split(/\s+/).filter(Boolean)
  const b = other.split(/\s+/).filter(Boolean)
  // The longest run of shared words, by the usual table.
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = table[i] as number[]
      row[j] = a[i] === b[j] ? (table[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const out: string[] = []
  let i = 0
  let j = 0
  const stretch = (endA: number, endB: number) => {
    const mine = a.slice(i, endA)
    const theirs = b.slice(j, endB)
    // As many words on both sides: word by word; else the stretch whole.
    const pairs = mine.length === theirs.length ? mine.map((word, k) => [[word], [theirs[k] as string]]) : [[mine, theirs]]
    pairs.forEach(([own, other], k) => {
      if (!own || !other) return
      const marker = out.length === 0 && own.length === 1 && LETTER_MARKER.test(own[0] as string)
      if (own.length === 0 || other.length === 0 || !(marker || own.some(doubtful))) return void out.push(...own)
      const rest = [...pairs.slice(k + 1).flatMap(([o]) => o ?? []), ...a.slice(endA)]
      const kept = lineScore([...out, ...own, ...rest].join(' '), known)
      const taken = lineScore([...out, ...other, ...rest].join(' '), known)
      out.push(...(taken > kept ? other : own))
    })
    i = endA
    j = endB
  }
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push(a[i] as string)
      i++
      j++
      continue
    }
    // The next pair of shared words ends this stretch; with none left, the ends do.
    if ((table[i]?.[j] ?? 0) === 0) break
    let endA = i
    let endB = j
    while (a[endA] !== b[endB]) {
      if ((table[endA + 1]?.[endB] ?? 0) >= (table[endA]?.[endB + 1] ?? 0)) endA++
      else endB++
    }
    stretch(endA, endB)
  }
  stretch(a.length, b.length)
  return out.join(' ')
}

const overlaps = (a: OcrLine, b: OcrLine) => {
  const vertical = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  const horizontal = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  return vertical > 0.5 * Math.min(a.h, b.h) && horizontal > 0
}

/**
 * The lines of a picture, each from the reading that reads it best (the
 * first reading wins a tie: the person's own language comes first). Lines of
 * different readings that cover the same place are one line there; a line
 * one reading split in two and another did not is taken whole from either.
 */
export function pickLines(readings: readonly OcrReading[], known: (word: string) => boolean): OcrLine[] {
  const withLines = readings.filter(r => r.lines.length > 0)
  if (withLines.length <= 1) return withLines[0]?.lines ?? []
  type Item = { reading: number; index: number; line: OcrLine }
  const items: Item[] = withLines.flatMap((r, reading) => r.lines.map((line, index) => ({ reading, index, line })))
  // Places: the lines that overlap, joined across readings.
  const group = items.map((_, i) => i)
  const root = (i: number): number => (group[i] === i ? i : (group[i] = root(group[i] ?? i)))
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]
      const b = items[j]
      if (a && b && a.reading !== b.reading && overlaps(a.line, b.line)) group[root(i)] = root(j)
    }
  }
  const places = new Map<number, Item[]>()
  items.forEach((item, i) => {
    const key = root(i)
    places.set(key, [...(places.get(key) ?? []), item])
  })
  const chosen = [...places.values()].map(place => {
    const read = withLines
      .map((_, reading) => place.filter(item => item.reading === reading))
      .filter(lines => lines.length > 0)
      .map(lines => ({ lines, text: lines.map(item => item.line.text).join(' ') }))
    let best = read[0]
    let bestScore = -Infinity
    for (const r of read) {
      const score = lineScore(r.text, known)
      if (score > bestScore) {
        best = r
        bestScore = score
      }
    }
    let lines = best?.lines.map(item => item.line) ?? []
    // One line: its words that another reading reads better are taken from it.
    const only = lines.length === 1 ? lines[0] : undefined
    if (only) {
      const text = read.filter(r => r !== best).reduce((text, r) => mergeLine(text, r.text, known), only.text)
      lines = [{ ...only, text }]
    }
    return { lines, top: Math.min(...place.map(item => item.line.y)), first: place.find(item => item.reading === 0)?.index }
  })
  // The first reading's order (columns stay apart); a place it has no line in goes by its height.
  const ordered = chosen.filter(c => c.first !== undefined).sort((a, b) => (a.first ?? 0) - (b.first ?? 0))
  for (const extra of chosen.filter(c => c.first === undefined)) {
    const at = ordered.findIndex(c => c.top > extra.top)
    ordered.splice(at < 0 ? ordered.length : at, 0, extra)
  }
  return ordered.flatMap(c => c.lines)
}

/** Cyrillic letters a recognizer writes for Latin ones, and back: each with the letters it may stand for, the likelier first. */
const TO_LATIN: Record<string, string> = {
  а: 'a', в: 'b', г: 'r', д: 'gd', е: 'e', и: 'un', і: 'il', ј: 'j', к: 'k', м: 'm', н: 'h', о: 'o', п: 'n', р: 'p', с: 'c', т: 'mt', у: 'y', х: 'x', ѕ: 's',
  А: 'A', В: 'B', Д: 'D', Е: 'E', З: '3', І: 'Il', Ј: 'J', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', Ѕ: 'S',
}
const TO_CYRILLIC: Record<string, string> = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', i: 'і', j: 'ј', k: 'к', m: 'м', n: 'п', o: 'о', p: 'р', r: 'г', u: 'и', x: 'х', y: 'у',
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
}
const CYRILLIC = /\p{Script=Cyrillic}/u
/** At most this many spellings of one word are tried. */
const MOST_SPELLINGS = 64

/** Every spelling of `word` with its letters of one script put into the other by `map`; undefined when a letter of that script has no look-alike. */
function spellings(word: string, from: RegExp, map: Record<string, string>): string[] | undefined {
  let out = ['']
  for (const ch of word) {
    const options = from.test(ch) ? map[ch] : ch
    if (options === undefined) return undefined
    out = out.flatMap(start => [...options].map(o => start + o)).slice(0, MOST_SPELLINGS)
  }
  return out
}

/**
 * A word a recognizer wrote in two scripts, or in Cyrillic look-alikes between
 * Latin words, put into one script letter by letter: "риll rеqиеst" → "pull
 * request", "Fідта" → "Figma", "VS Соде" → "VS Code", "yвiмкни" → "увімкни".
 * A Cyrillic word no list knows becomes the Latin word it may be ("соттіт" →
 * "commit"). A spelling in the word lists wins; with none, a word of two scripts goes into
 * the script most of its letters are in (Latin on a tie, as Cyrillic
 * look-alikes stand for Latin more often), look-alikes between Latin words go
 * into Latin ("Gemma 4 Е4В" → "E4B"), and any other word stays.
 */
export function fixScripts(text: string, known: (word: string) => boolean): string {
  const tokens = text.split(/(\s+)/)
  const words = tokens.map(t => coreOf(t).replace(/[^\p{L}]/gu, ''))
  const isLatin = words.map(w => w.length > 0 && LATIN.test(w))
  return tokens
    .map((token, i) => {
      const core = coreOf(token)
      const letters = words[i] ?? ''
      if (!letters) return token
      const mixed = scriptOf(letters) === 'mixed' && CYRILLIC.test(letters)
      let before = i - 1
      while (before >= 0 && !words[before]) before--
      const after = words.findIndex((w, j) => j > i && w.length > 0)
      const around = [before, after].filter(j => j >= 0)
      const lookalike = !mixed && !isLatin[i] && [...letters].every(c => LOOKALIKE.has(c)) && around.length > 0 && around.every(j => isLatin[j])
      const latin = spellings(core, CYRILLIC, TO_LATIN) ?? []
      // A word of look-alikes no list knows, while a Latin spelling of it is a word: "соттіт" → "commit".
      if (!mixed && !lookalike) {
        const plain = letters.length >= 3 && !isLatin[i] && !isKnown(core, known) ? latin.find(s => isKnown(s, known)) : undefined
        return plain === undefined ? token : token.replace(core, plain)
      }
      const cyrillic = mixed ? (spellings(core, /\p{Script=Latin}/u, TO_CYRILLIC) ?? []) : []
      const found = [...latin, ...cyrillic].find(s => isKnown(s, known))
      const latinCount = [...letters].filter(c => LATIN.test(c)).length
      const choice = found ?? (mixed ? ((latinCount * 2 >= [...letters].length ? latin[0] : cyrillic[0]) ?? latin[0]) : latin[0])
      return choice === undefined ? token : token.replace(core, choice)
    })
    .join('')
}
