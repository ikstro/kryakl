// Words to spell put right after recognition, as the speech engine does it
// (engine/vocab.py `correct`, ported line for line for a phrase heard by Groq,
// which never reaches the engine): first what a name is heard as (1–3 tokens,
// any case), then its spelling in another case, then, for a word of 5 letters or
// more, a near miss of one edit (5–7 letters) or two (8 and more), of the same
// script and first letter, never a tie, never a word of the list itself, never
// an ordinary word of the en/uk/ru lists (media/layout). Only words are touched;
// the text between them stays as it was. Pure: the ordinary words come in.

import type { VocabularyEntry } from './vocabulary'

const TOKEN = /[\p{L}\p{N}_]+(?:['’-][\p{L}\p{N}_]+)*/gu
const WHOLE_TOKEN = /^[\p{L}\p{N}_]+(?:['’-][\p{L}\p{N}_]+)*$/u
const SUFFIXES = ["'s", '’s']
const LONGEST_RUN = 3 // tokens in the longest thing a word may be heard as
const FUZZY_SHORTEST = 5 // letters: a shorter word is too easily another word to be guessed at
const LETTER = /^\p{L}$/u
const LATIN = /^\p{Script=Latin}$/u
const CYRILLIC = /^\p{Script=Cyrillic}$/u
const ASCII_LETTERS = /^[A-Za-z]+$/
// Python's str.isspace: category Zs or bidirectional WS, B, S (JavaScript's \s differs: the byte order mark in, \x1c to \x1f and \x85 out).
const hex = (...codes: number[]) => codes.map(c => '\\u' + c.toString(16).padStart(4, '0')).join('')
const SPACE = new RegExp(`^[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0${hex(0x1680)}${hex(0x2000)}-${hex(0x200a)}${hex(0x2028, 0x2029, 0x202f, 0x205f, 0x3000)}]+$`)
// Python's str.splitlines: \r\n, or one of \n \r \v \f \x1c \x1d \x1e \x85 and the line and paragraph separators.
const LINE_BREAK = new RegExp(`\\r\\n|[\\n\\r\\v\\f\\x1c-\\x1e\\x85${hex(0x2028, 0x2029)}]`)

const chars = (s: string) => Array.from(s)
const length = (s: string) => chars(s).length

/** Python's casefold for the scripts Words to spell meets (lower case, ß as ss, a final sigma as σ), and ё as е. */
export function norm(token: string): string {
  return token.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ').replace(/ё/g, 'е')
}

/** The ordinary words of the word lists (each file's text), normalized; empty when none could be read. */
export function ordinaryWords(lists: readonly string[]): Set<string> {
  const words = new Set<string>()
  for (const text of lists) for (const line of text.split(LINE_BREAK)) {
    const word = line.trim()
    if (word) words.add(norm(word))
  }
  return words
}

/** True when the stem is an ordinary word (or a plain derivation of one); always true without the lists, so nothing is guessed. */
export function ordinaryWord(stem: string, words: ReadonlySet<string> | undefined): boolean {
  if (!words || words.size === 0) return true
  if (words.has(stem)) return true
  // Frequent-word lists miss ordinary derived words (coder -> code): protection only, a false match leaves text alone.
  if (ASCII_LETTERS.test(stem)) {
    for (const ending of ['ers', 'er', 'ing', 'ed', 's']) {
      if (stem.endsWith(ending) && stem.length > ending.length + 2) {
        const base = stem.slice(0, -ending.length)
        if (words.has(base) || words.has(base + 'e')) return true
      }
    }
  }
  return false
}

/** [the token normalized, the same without an English 's, the 's as it was written]. */
function forms(token: string): [string, string, string] {
  const full = norm(token)
  for (const suffix of SUFFIXES) {
    if (full.endsWith(suffix) && length(full) > suffix.length) return [full, full.slice(0, -suffix.length), token.slice(-suffix.length)]
  }
  return [full, full, '']
}

/** latin or cyrillic when every character is a letter of that script; else undefined. */
function script(text: string): 'latin' | 'cyrillic' | undefined {
  let found: 'latin' | 'cyrillic' | undefined
  for (const ch of text) {
    if (!LETTER.test(ch)) return undefined
    const here = LATIN.test(ch) ? 'latin' : CYRILLIC.test(ch) ? 'cyrillic' : undefined
    if (!here || (found && here !== found)) return undefined
    found = here
  }
  return found
}

/** Optimal string alignment distance (a swap of two neighbours is one edit); limit + 1 once it is past the limit. */
export function distance(first: string, second: string, limit: number): number {
  const a = chars(first)
  const b = chars(second)
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let before: number[] = []
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const prev = before
    before = row
    row = [i, ...new Array<number>(b.length).fill(0)]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] !== b[j - 1] ? 1 : 0
      row[j] = Math.min(before[j]! + 1, row[j - 1]! + 1, before[j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j]!, prev[j - 2]! + 1)
    }
    if (Math.min(...row) > limit) return limit + 1
  }
  return row[row.length - 1]!
}

const limitFor = (letters: number) => (letters <= 4 ? 0 : letters <= 7 ? 1 : 2)
const tokensOf = (text: string) => Array.from(text.matchAll(TOKEN), m => m[0])
const runKey = (tokens: readonly string[]) => tokens.join('\u0000')

type Fuzzy = { norm: string; word: string; script: 'latin' | 'cyrillic' }

/** A vocabulary made ready for matching: what each run of normalized tokens stands for, and the spellings to guess at. */
class Matcher {
  readonly runs = new Map<string, string>()
  readonly known = new Set<string>()
  /** The spellings of one word that a near miss may be, by first letter. */
  readonly fuzzy = new Map<string, Fuzzy[]>()

  constructor(entries: readonly (readonly [string, readonly string[]])[]) {
    const spellings: [string[], string][] = []
    const add = (tokens: string[], word: string) => {
      if (tokens.length < 1 || tokens.length > LONGEST_RUN) return
      const key = runKey(tokens)
      if (!this.runs.has(key)) this.runs.set(key, word)
      for (const t of tokens) this.known.add(t)
    }
    for (const [word, heard] of entries) {
      for (const alias of heard) add(tokensOf(alias).map(norm), word)
      spellings.push([tokensOf(word).map(norm), word])
    }
    // A spelling is also what it is heard as, in any case ("KRYAKL", "visual studio"); after the aliases, which come first.
    for (const [tokens, word] of spellings) {
      add(tokens, word)
      if (tokens.length === 1 && WHOLE_TOKEN.test(word)) {
        const only = tokens[0]!
        const its = script(only)
        if (its && limitFor(length(only))) {
          const first = chars(only)[0]!
          const list = this.fuzzy.get(first) ?? []
          list.push({ norm: only, word, script: its })
          this.fuzzy.set(first, list)
        }
      }
    }
  }

  /** The one spelling this word is a near miss of, or undefined (none near, or two equally near). */
  guess(stem: string, ordinary: ReadonlySet<string> | undefined): string | undefined {
    const letters = length(stem)
    if (letters < FUZZY_SHORTEST || this.known.has(stem) || ordinaryWord(stem, ordinary)) return undefined
    const its = script(stem)
    if (!its) return undefined
    let best = 99
    let found: string | undefined
    let tie = false
    for (const { norm: theirs, word, script: their } of this.fuzzy.get(chars(stem)[0]!) ?? []) {
      if (their !== its || Math.abs(length(theirs) - letters) > 2) continue
      const limit = limitFor(length(theirs))
      const d = distance(stem, theirs, limit)
      if (d > limit || d === 0) continue
      if (d < best) [best, found, tie] = [d, word, false]
      else if (d === best && word !== found) tie = true
    }
    return tie ? undefined : found
  }
}

const compiled = new Map<string, Matcher>()

/** The vocabulary compiled once (the same list comes with every phrase); undefined when it is empty. */
function matcher(vocabulary: readonly VocabularyEntry[]): Matcher | undefined {
  const entries = (vocabulary ?? [])
    .filter(e => e && typeof e.word === 'string' && e.word)
    .map(e => [e.word, (e.heard ?? []).filter(h => typeof h === 'string')] as const)
  if (!entries.length) return undefined
  const key = JSON.stringify(entries)
  let m = compiled.get(key)
  if (!m) {
    m = new Matcher(entries)
    if (compiled.size >= 8) compiled.delete(compiled.keys().next().value!)
    compiled.set(key, m)
  }
  return m
}

/** [first token, last token, the text they become] for every change: aliases and spellings by the longest run first,
 * then near misses. `joinable[k]`: token k and k + 1 may be one name. */
function plan(m: Matcher, tokens: readonly string[], joinable: readonly boolean[], ordinary: ReadonlySet<string> | undefined): [number, number, string][] {
  const out: [number, number, string][] = []
  const all = tokens.map(forms)
  const guessed = new Map<string, string | undefined>()
  let i = 0
  while (i < tokens.length) {
    let done = false
    for (let n = Math.min(LONGEST_RUN, tokens.length - i); n > 0; n--) {
      if (!joinable.slice(i, i + n - 1).every(Boolean)) continue
      // Only the last token of a run may lose its 's (and get it back after the spelling).
      const head = all.slice(i, i + n - 1).map(f => f[0])
      const [full, stem, suffix] = all[i + n - 1]!
      let word = m.runs.get(runKey([...head, full]))
      if (word === undefined && suffix) {
        const bare = m.runs.get(runKey([...head, stem]))
        word = bare !== undefined ? bare + suffix : undefined
      }
      if (word !== undefined) {
        if (word !== tokens.slice(i, i + n).join(' ')) out.push([i, i + n - 1, word])
        i += n
        done = true
        break
      }
    }
    if (done) continue
    const [full, stem, suffix] = all[i]!
    if (!/\p{Nd}/u.test(stem) && !m.known.has(full)) {
      if (!guessed.has(stem)) guessed.set(stem, m.guess(stem, ordinary))
      const word = guessed.get(stem)
      if (word) out.push([i, i, word + suffix])
    }
    i++
  }
  return out
}

/** A phrase spelled as the vocabulary says; `ordinary` the word lists' words (ordinaryWords), without which no near miss is guessed. */
export function correct(text: string, vocabulary: readonly VocabularyEntry[], ordinary?: ReadonlySet<string>): string {
  const m = matcher(vocabulary)
  if (!m || !text) return text
  const found = Array.from(text.matchAll(TOKEN))
  const joinable = found.slice(1).map((b, k) => SPACE.test(text.slice(found[k]!.index! + found[k]![0].length, b.index!)))
  const changes = plan(m, found.map(f => f[0]), joinable, ordinary)
  let out = text
  for (const [first, last, word] of changes.reverse()) {
    out = out.slice(0, found[first]!.index!) + word + out.slice(found[last]!.index! + found[last]![0].length)
  }
  return out
}
