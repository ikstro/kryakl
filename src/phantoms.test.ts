import { describe, expect, it } from 'vitest'

import { cleanDictated, joinedPieces, mendPauses, openEnded, type HeardSegment } from './phantoms'

// engine/tests/test_phantoms.py's HEARD and SILENT, as one segment of what Whisper heard.
const heard = (text: string): { segments: HeardSegment[]; seconds: number } => ({
  segments: [{ start: 0, end: 3, text, avgLogprob: -0.2, noSpeech: 0.02 }], // the sound carries the text
  seconds: 3,
})
const silent = (text: string): { segments: HeardSegment[]; seconds: number } => ({
  segments: [{ start: 0, end: 1, text, avgLogprob: -0.4, noSpeech: 0.7 }], // a breath, a pause
  seconds: 1,
})
const clean = (text: string, sound: (t: string) => { segments: HeardSegment[]; seconds: number }): string =>
  cleanDictated(text, sound(text)).text

describe('what Whisper writes where nobody spoke, in a dictated phrase', () => {
  it.each([
    ['Привет, буду через десять минут. Субтитры сделал DimaTorzok', 'Привет, буду через десять минут.'],
    ['Купи хлеба. Субтитры создавал DimaTorzok.', 'Купи хлеба.'],
    ['Субтитры сделал DimaTorzok', ''],
    ['Сделай отчёт к пятнице. Редактор субтитров А.Синецкая Корректор А.Егорова', 'Сделай отчёт к пятнице.'],
    ['Окей. Субтитры подогнал «Симон»!', 'Окей.'],
    ['Добре, домовились. Субтитри зроблені спільнотою Amara.org', 'Добре, домовились.'],
    ['Send it today. Subtitles by the Amara.org community', 'Send it today.'],
    ['Субтитры сделал DimaTorzok. Начнём с первого пункта.', 'Начнём с первого пункта.'],
  ])('credits go always: %s', (said, written) => {
    expect(clean(said, heard)).toBe(written)
  })

  it.each([
    ['Скинь мне файл. Продолжение следует...', 'Скинь мне файл.'],
    ['Встреча в три. Спасибо за просмотр! Подписывайтесь на канал!', 'Встреча в три.'],
    ['Ставьте лайки и подписывайтесь на канал.', ''],
    ['Надішли адресу. Дякую за перегляд!', 'Надішли адресу.'],
    ["I'll call you back. Thanks for watching!", "I'll call you back."],
  ])('a video’s sign-offs end no dictation: %s', (said, written) => {
    expect(clean(said, heard)).toBe(written)
  })

  it.each(['Спасибо.', 'Спасибо большое!', 'Thank you.', 'Дякую.', 'Спасибо за внимание.'])('thanks said are kept: %s', (said) => {
    expect(clean(said, heard)).toBe(said)
  })

  it.each(['Спасибо.', 'Thank you.', 'Спасибо за внимание.'])('thanks over silence go: %s', (said) => {
    expect(clean(said, silent)).toBe('')
  })

  it.each(['you', 'You.', 'Come on.'])('a murmur alone is never a dictated phrase: %s', (said) => {
    expect(clean(said, heard)).toBe('')
  })

  it.each(['I told you.', "Come on, let's go.", 'You and me.'])('"you" in a sentence stays: %s', (said) => {
    expect(clean(said, heard)).toBe(said)
  })

  it.each([
    'Всё готово, спасибо.',
    'Хорошо. Спасибо.', // thanks after a text: said, whatever the sound
    'Посмотри субтитры к фильму, там опечатка.',
    'Продолжение следует читать во второй главе.',
    'Подписывайтесь на канал Пети, он классный, и спасибо за просмотр моего отчёта.',
    'We need captions by Friday.',
  ])('ordinary text is left alone: %s', (said) => {
    expect(clean(said, silent)).toBe(said)
  })

  it('with no segments nothing says the sound is weak, as phantoms.Sound() by default', () => {
    expect(cleanDictated('Спасибо.', {}).text).toBe('Спасибо.')
    expect(cleanDictated('You.', {}).text).toBe('')
    expect(cleanDictated('Купи хлеба. Субтитры создавал DimaTorzok.', { segments: [] }).text).toBe('Купи хлеба.')
  })

  it('takes the worst segment as the evidence, as asr._said does', () => {
    const segments: HeardSegment[] = [
      { start: 0, end: 2, text: 'Спасибо.', avgLogprob: -0.2, noSpeech: 0.02 },
      { start: 2, end: 3, text: '', avgLogprob: -0.9, noSpeech: 0.1 },
    ]
    expect(cleanDictated('Спасибо.', { segments, seconds: 3 }).text).toBe('')
  })

  it('cuts thanks at the end of a dictated text when the last piece is weak, as Groq wrote them (2026-11-23)', () => {
    const segments = (tail: number): HeardSegment[] => [
      { start: 0, end: 4, text: 'Надо выпадайку сделать.', avgLogprob: -0.2, noSpeech: 0.02 },
      { start: 4, end: 6, text: 'Спасибо.', avgLogprob: -0.3, noSpeech: tail },
    ]
    expect(cleanDictated('Надо выпадайку сделать. Спасибо.', { segments: segments(0.6), seconds: 6 }).text).toBe('Надо выпадайку сделать.')
    expect(cleanDictated('Надо выпадайку сделать. Спасибо.', { segments: segments(0.05), seconds: 6 }).text).toBe('Надо выпадайку сделать. Спасибо.')
  })

  it('says what went by its kind, never the words', () => {
    const r = cleanDictated('В какой-то момент... я увидел. Субтитры сделал DimaTorzok', heard('x'))
    expect(r.text).toBe('В какой-то момент я увидел.')
    expect(r.cut).toEqual(['credit', 'pause'])
    expect(cleanDictated('Начинаем.', heard('Начинаем.'))).toEqual({ text: 'Начинаем.', cut: [] })
  })
})

describe('a pause is not a mark', () => {
  // The shapes of the 14 ellipses inside the owner's 200 phrases of 2026-11-19..20, with other words.
  it.each([
    ['Там отчёт по складу. В какой-то момент... я увидел, что цифры другие.', 'Там отчёт по складу. В какой-то момент я увидел, что цифры другие.'],
    ['если там много снега... допустим, метр', 'если там много снега допустим, метр'],
    ['От создания списка... ...по плану, который она же и написала.', 'От создания списка по плану, который она же и написала.'],
    ['не добавился в... нашу таблицу?', 'не добавился в нашу таблицу?'],
    ['коли у тебе… є групи', 'коли у тебе є групи'],
    ['перемикатися на інший тип... де показано дорогу.', 'перемикатися на інший тип де показано дорогу.'],
    ['слово ... и ещё слово', 'слово и ещё слово'],
    ['он сказал... «ладно», и ушёл', 'он сказал «ладно», и ушёл'],
    ['...и тогда всё заработало.', 'и тогда всё заработало.'],
    ['… и тогда всё заработало.', 'и тогда всё заработало.'],
    ['At some point... I saw the numbers change.', 'At some point I saw the numbers change.'],
    ["so then... I'm not sure it works", "so then I'm not sure it works"],
    ['we could... maybe try again', 'we could maybe try again'],
  ])('an ellipsis a sentence goes on after was a pause: %s', (said, written) => {
    expect(mendPauses(said)).toBe(written)
  })

  it.each([
    'А как мы будем...', // let go of mid-thought: it says so (the owner, 2026-11-20)
    'Если пользователь говорит…',
    'у меня останется... Закрытый лимит на всю неделю.', // Whisper heard a new sentence
    'Например... Отправить письмо может бот.',
    'I was thinking... It does not matter.',
    'It was... Ivan who called.',
    'около... 100 рублей',
    'Что?.. а, понял.',
    'Конец. Начало.',
    'версия 1..5 подойдёт',
    'მე ვფიქრობ... ეს კარგია', // no capitals to go by
  ])('other ellipses stay: %s', (said) => {
    expect(mendPauses(said)).toBe(said)
  })

  it('a dictated phrase is mended after it is cleaned', () => {
    expect(clean('В какой-то момент... я увидел.', heard)).toBe('В какой-то момент я увидел.')
    expect(clean('А как мы будем...', heard)).toBe('А как мы будем...')
  })
})

describe('pieces of a dictation joined (engine/stream.py joined, told)', () => {
  it('joins the pieces with no ellipsis at a seam the sentence goes on after', () => {
    expect(joinedPieces(['В какой-то момент...', 'я увидел.'])).toBe('В какой-то момент я увидел.')
    expect(joinedPieces(['у меня останется...', 'Закрытый лимит.'])).toBe('у меня останется... Закрытый лимит.')
    expect(joinedPieces(['', 'Привет.', ''])).toBe('Привет.')
  })

  it('tells the next piece the text without the ellipsis it ends in', () => {
    expect(openEnded('В какой-то момент...')).toBe('В какой-то момент')
    expect(openEnded('В какой-то момент…  ')).toBe('В какой-то момент')
    expect(openEnded('Что?..')).toBe('Что?..')
    expect(openEnded('Всё.')).toBe('Всё.')
  })
})
