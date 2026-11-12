import { describe, expect, test } from 'vitest'

import { paragraphsOf, screenText, type OcrLine } from './ocrtext'

const line = (text: string, y: number, x = 10): OcrLine => ({ text, x, y, w: 300, h: 20 })

describe('paragraphsOf', () => {
  test('lines close under each other are one paragraph; a hyphenated word is joined back', () => {
    expect(paragraphsOf([line('The build failed again, so we have to', 0), line('check the log be-', 26), line('fore the release.', 52)])).toBe(
      'The build failed again, so we have to check the log before the release.',
    )
  })

  test('a wide gap or a line far to the side starts a new paragraph', () => {
    const text = paragraphsOf([line('Settings', 0), line('Dark mode', 60), line('Turn it on', 86), line('Cancel', 112, 400)])
    expect(text).toBe('Settings\n\nDark mode Turn it on\n\nCancel')
  })

  test('a dash between words stays, empty lines are skipped', () => {
    expect(paragraphsOf([line('A well-', 0), line('Known fact', 26), line('  ', 52)])).toBe('A well- Known fact')
    expect(paragraphsOf([])).toBe('')
  })
})

/** A piece of a line in a font 10 px a character, 20 px tall. */
const piece = (text: string, y: number, x = 0): OcrLine => ({ text, x, y, w: 10 * [...text].length, h: 20 })

describe('screenText', () => {
  test('a column of numbers and the lines beside it are read row by row', () => {
    const lines = [
      piece('9', 0, 10),
      piece('10', 26),
      piece('11', 52),
      piece('Can you send me the link?', 0, 50),
      piece('Почему диктовка печатает с задержкой?', 26, 50),
      piece('В выходные поедем за город.', 52, 50),
    ]
    expect(screenText(lines)).toBe(' 9   Can you send me the link?\n10   Почему диктовка печатает с задержкой?\n11   В выходные поедем за город.')
  })

  test('indents and empty lines stay', () => {
    const lines = [piece('function f() {', 0), piece('return 1', 26, 20), piece('}', 52), piece('f()', 104)]
    expect(screenText(lines)).toBe('function f() {\n  return 1\n}\n\nf()')
  })

  test('pieces close together are one space apart; a box a pixel off is no indent', () => {
    expect(screenText([piece('Hello', 0), piece('world', 1, 60), piece('Next line', 26, 3)])).toBe('Hello world\nNext line')
  })

  test('two columns come out side by side, each piece at its own column', () => {
    expect(screenText([piece('Name', 0), piece('Size', 0, 200), piece('Kryakl', 26), piece('12 GB', 26, 200)])).toBe('Name                Size\nKryakl              12 GB')
  })

  test('a full stop or a comma read apart goes back to its word', () => {
    expect(screenText([piece('посмотрим логи .', 0), piece('a , b', 26)])).toBe('посмотрим логи.\na, b')
  })

  test('nothing, or one line', () => {
    expect(screenText([])).toBe('')
    expect(screenText([piece('  Only this  ', 5, 40)])).toBe('Only this')
  })
})
