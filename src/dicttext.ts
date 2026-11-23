// How a dictated phrase is typed (Voice typing › The typed text): exact rules
// applied after recognition, text editing and translation, with no model, so
// they cost no time and act the same on every computer:
//   the letter ё   as heard, always where a word has one reading, or never;
//   the full stop  kept or dropped at the end of a phrase of one sentence;
//   the space      after the phrase, or none.
// The speech models write ё seldom (the owner's 200 phrases, 2026-11-21: a word
// that is always written with ё got it once in 21: "еще" ten times, "ещё"
// never), and no instruction reaches them, so ё is put back by a dictionary:
// media/yo/safe.txt, the "safe" list of eyo-kernel (Denis Seleznev, MIT), words
// with one reading only; "все" / "всё" is not in it and stays as heard.

export type YoMode = 'heard' | 'always' | 'never'
export const YO_MODES: readonly YoMode[] = ['heard', 'always', 'never']

export type TextOptions = {
  yo: YoMode
  /** A full stop at the end of a phrase of one sentence. */
  endStop: boolean
}

/** A word written with е → the same word with ё, as the dictionary has it. */
export type YoDictionary = Map<string, string>

const plain = (word: string) => word.replace(/Ё/g, 'Е').replace(/ё/g, 'е')
const capital = (word: string) => word.slice(0, 1).toUpperCase() + word.slice(1)

/**
 * The dictionary from eyo-kernel's text: a word a line, its endings in
 * parentheses ("пчёлк(а|ам|е)"), a comment after "#", "_" before a word that
 * takes ё only with a small letter ("_киёв": Киев stays). A word with a small
 * letter is known with a capital too.
 */
export function yoDictionary(raw: string): YoDictionary {
  const dict: YoDictionary = new Map()
  const add = (entry: string) => {
    const lowerOnly = entry.startsWith('_')
    const word = lowerOnly ? entry.slice(1) : entry
    if (!word) return
    dict.set(plain(word), word)
    if (!lowerOnly && !/^[А-ЯЁ]/.test(word)) dict.set(capital(plain(word)), capital(word))
  }
  for (const line of raw.split(/\r?\n/)) {
    const entry = (line.split('#')[0] ?? '').trim()
    if (!entry) continue
    if (entry.includes('(')) {
      const parts = entry.split(/[(|)]/)
      const stem = parts[0] ?? ''
      for (const ending of parts.slice(1, -1)) add(stem + ending)
    } else add(entry)
  }
  return dict
}

/**
 * A word of the text: a first letter, then small ones (a word all in capitals
 * is left alone), never an abbreviation ("т. е.", "см. рис."), as eyo-kernel
 * finds them.
 */
const PUNCTUATION = '[{}()|<>=_"\'«»„“#$^%&*+:;,?!\\u2011\\-[\\]]'
const WORD = new RegExp(`[А-ЯЁа-яё][а-яё]+(?![а-яё]|\\.[ \\u00A0\\t]+([а-яё]|[А-ЯЁ]{2}|${PUNCTUATION})|\\.${PUNCTUATION})`, 'g')

/** Letters Russian does not have: a text with them is Ukrainian or Belarusian, whose words the dictionary would spoil ("мед" → "мёд"). */
const NOT_RUSSIAN = /[іїєґў]/i

/** ё put back in every word that has one reading with it; a text that is not Russian comes back as it was. */
export function restoreYo(text: string, dict: YoDictionary): string {
  if (!/[Ее]/.test(text) || NOT_RUSSIAN.test(text)) return text
  // "все" has two readings and is not in the dictionary; before "-таки" it has one.
  return text.replace(WORD, word => dict.get(word) ?? word).replace(/(?<![А-ЯЁа-яё])([Вв])се(?=-таки(?![а-яё]))/g, '$1сё')
}

export function dropYo(text: string): string {
  return plain(text)
}

/** A mark that ends a sentence, with more text after it. */
const INNER_END = /[.!?…](?=["'»”)\]]*\s+\S)/

/**
 * The full stop at the end of a phrase of one sentence taken off ("Хорошо." in
 * a chat). An ellipsis, a question or an exclamation stays, and so does the
 * stop of a phrase of two sentences or more, or of several lines.
 */
export function dropEndStop(text: string): string {
  const body = text.trimEnd()
  if (!body.endsWith('.') || body.endsWith('..') || body.includes('\n')) return text
  const inner = body.slice(0, -1)
  if (!inner.trim() || INNER_END.test(body)) return text
  return inner
}

/**
 * The phrase as it is typed. `language` is the phrase's (the engine's or the
 * text's own): ё is put back only in Russian. `dict` is asked for only when it
 * is needed, as it is read from a file.
 */
export function typedText(text: string, language: string, options: TextOptions, dict: () => YoDictionary | undefined): string {
  let out = text
  if (options.yo === 'never') out = dropYo(out)
  else if (options.yo === 'always' && language === 'ru') {
    const words = dict()
    if (words) out = restoreYo(out, words)
  }
  if (!options.endStop) out = dropEndStop(out)
  return out
}
