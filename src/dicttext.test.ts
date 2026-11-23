import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

import { dropEndStop, dropYo, restoreYo, typedText, yoDictionary, type TextOptions } from './dicttext'

const dict = yoDictionary(fs.readFileSync(path.join(__dirname, '..', 'media', 'yo', 'safe.txt'), 'utf8'))
const AS_HEARD: TextOptions = { yo: 'heard', endStop: true }

describe('the letter ё', () => {
  it('reads the dictionary: endings, comments, a word with a small letter only', () => {
    const d = yoDictionary('пчёлк(а|е|и)\nещё\n_киёв# город Киев\nАлёнушк(а|е)\n')
    expect(d.get('пчелка')).toBe('пчёлка')
    expect(d.get('Пчелки')).toBe('Пчёлки')
    expect(d.get('еще')).toBe('ещё')
    expect(d.get('киев')).toBe('киёв')
    expect(d.has('Киев')).toBe(false)
    expect(d.get('Аленушка')).toBe('Алёнушка')
    expect(d.has('аленушка')).toBe(false)
  })

  it('puts ё back where a word has one reading, a capital kept', () => {
    expect(restoreYo('Еще раз: у нее все-таки идет дождь, а ее нет.', dict)).toBe('Ещё раз: у неё всё-таки идёт дождь, а её нет.')
    expect(restoreYo('Пчелка летит вперед.', dict)).toBe('Пчёлка летит вперёд.')
  })

  it('leaves a word with two readings as heard', () => {
    expect(restoreYo('Все пришли, и все хорошо.', dict)).toBe('Все пришли, и все хорошо.')
    expect(restoreYo('Небо и небо.', dict)).toBe('Небо и небо.')
  })

  it('leaves alone a word all in capitals, Latin text and a text that is not Russian', () => {
    expect(restoreYo('ЕЩЕ', dict)).toBe('ЕЩЕ')
    expect(restoreYo('Pull request is here', dict)).toBe('Pull request is here')
    // Ukrainian: "мед" is honey, and Russian's "мёд" would spoil it.
    expect(restoreYo('Це мій мед і ще трохи', dict)).toBe('Це мій мед і ще трохи')
  })

  it('takes ё away', () => {
    expect(dropYo('Ёлка, ещё её')).toBe('Елка, еще ее')
  })
})

describe('the full stop of one sentence', () => {
  it('goes from a phrase of one sentence', () => {
    expect(dropEndStop('Хорошо, буду в пять.')).toBe('Хорошо, буду в пять')
    expect(dropEndStop('Ok. ')).toBe('Ok')
    expect(dropEndStop('Версия 0.18.2 вышла.')).toBe('Версия 0.18.2 вышла')
  })

  it('stays after two sentences, and other marks stay', () => {
    expect(dropEndStop('Хорошо. Буду в пять.')).toBe('Хорошо. Буду в пять.')
    expect(dropEndStop('Ты где? Я тут.')).toBe('Ты где? Я тут.')
    expect(dropEndStop('Ну не знаю...')).toBe('Ну не знаю...')
    expect(dropEndStop('Ты где?')).toBe('Ты где?')
    expect(dropEndStop('Ура!')).toBe('Ура!')
    expect(dropEndStop('Он сказал «нет». И ушёл.')).toBe('Он сказал «нет». И ушёл.')
  })

  it('stays in a list of several lines, and a lone stop is left', () => {
    expect(dropEndStop('- молоко\n- хлеб.')).toBe('- молоко\n- хлеб.')
    expect(dropEndStop('.')).toBe('.')
  })
})

describe('the phrase as it is typed', () => {
  it('is as heard by default', () => {
    expect(typedText('Еще раз.', 'ru', AS_HEARD, () => dict)).toBe('Еще раз.')
  })

  it('takes ё only in Russian, and reads the dictionary only then', () => {
    let asked = 0
    const words = () => (asked++, dict)
    expect(typedText('Еще раз.', 'ru', { yo: 'always', endStop: true }, words)).toBe('Ещё раз.')
    expect(typedText('Ще раз.', 'uk', { yo: 'always', endStop: true }, words)).toBe('Ще раз.')
    expect(typedText('Once more.', 'en', { yo: 'heard', endStop: true }, words)).toBe('Once more.')
    expect(asked).toBe(1)
  })

  it('goes on as heard when the dictionary cannot be read', () => {
    expect(typedText('Еще раз.', 'ru', { yo: 'always', endStop: false }, () => undefined)).toBe('Еще раз')
  })

  it('never ё, no stop', () => {
    expect(typedText('Ещё раз.', 'ru', { yo: 'never', endStop: false }, () => dict)).toBe('Еще раз')
  })
})
