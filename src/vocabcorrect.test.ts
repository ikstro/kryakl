// The cases of engine/tests/test_vocab.py that cover `correct`, with the same word lists.
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { correct, distance, ordinaryWord, ordinaryWords } from './vocabcorrect'

const ORDINARY = ordinaryWords(['en', 'ru', 'uk'].map(code => fs.readFileSync(`media/layout/${code}.txt`, 'utf8')))

const VOCABULARY = [
  { word: 'Altype', heard: ['альтайп', 'алтайп', 'all type'] },
  { word: 'Paximizer', heard: [] },
  { word: 'Peshynskyi', heard: [] },
  { word: 'Льоша', heard: ['леша'] },
  { word: 'Lisa', heard: [] },
]

describe('correct', () => {
  it.each([
    ['I use альтайп daily.', 'I use Altype daily.'],
    ['Open all type, then save', 'Open Altype, then save'],
    ['the paximiser report', 'the Paximizer report'],
    ['Peshinsky said', 'Peshynskyi said'],
    ['Лёша пришёл', 'Льоша пришёл'],
    ["ALTYPE's plan", "Altype's plan"],
    ['lisa and Алтайп’s key', 'Lisa and Altype’s key'],
  ])('%s → %s', (said, written) => {
    expect(correct(said, VOCABULARY, ORDINARY)).toBe(written)
  })

  it.each([
    'Which type? Alt key. Altai trip. Maximizer on. Make a list.',
    'Паксимайзер',
    'all, type', // punctuation between: two words, not a name
    'Paximizer2 and paximizer2', // digits match only exactly
  ])('leaves alone: %s', said => {
    expect(correct(said, VOCABULARY, ORDINARY)).toBe(said)
  })

  it('a tie between two spellings changes nothing', () => {
    const two = [{ word: 'Kowalska', heard: [] }, { word: 'Kowalski', heard: [] }]
    expect(correct('Kowalsky came', two, ORDINARY)).toBe('Kowalsky came')
    expect(correct('Kowalskaa came', two, ORDINARY)).toBe('Kowalska came')
  })

  it('an empty vocabulary changes nothing', () => {
    expect(correct('all type', [], ORDINARY)).toBe('all type')
  })

  it.each([
    ['The coder fixed the bug.', 'Codex'],
    ['gamma rays', 'Gemma'],
    ['The coders fixed the bug.', 'Codex'],
  ])('ordinary words are not fuzzy names: %s', (text, term) => {
    expect(correct(text, [{ word: term, heard: [] }], ORDINARY)).toBe(text)
  })

  it('an explicit heard form wins even when it is an ordinary word', () => {
    expect(correct('open coder', [{ word: 'Codex', heard: ['coder'] }], ORDINARY)).toBe('open Codex')
  })

  it('without the word lists, heard forms and spellings still apply and nothing is guessed', () => {
    expect(correct('I use all type, the paximiser and PAXIMIZER', VOCABULARY)).toBe('I use Altype, the paximiser and Paximizer')
    expect(correct('the paximiser', VOCABULARY, new Set())).toBe('the paximiser')
  })

  it('a small list passed in guards its own words', () => {
    const lists = ordinaryWords(['code\nrays\r\nЁлка\n'])
    expect(lists.has('елка')).toBe(true)
    expect(ordinaryWord('coders', lists)).toBe(true)
    expect(correct('the paximiser', VOCABULARY, lists)).toBe('the Paximizer')
  })
})

describe('distance', () => {
  it('counts a swap as one', () => {
    expect(distance('paxmiizer', 'paximizer', 2)).toBe(1)
    expect(distance('abcdef', 'uvwxyz', 2)).toBe(3)
  })
})
