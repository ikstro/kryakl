// Windows OCR gives a snipped piece of the screen back as lines with their
// boxes. Lines close under each other are one paragraph and are joined into
// one line (a word hyphenated at the end of a line is joined back); a wider
// gap, or a line that starts far to the left or right of the one above,
// starts a new paragraph.

export type OcrLine = { text: string; x: number; y: number; w: number; h: number }

/** A gap under a line wider than this share of the usual line height starts a new paragraph. */
const PARAGRAPH_GAP = 0.8

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

export function paragraphsOf(lines: readonly OcrLine[]): string {
  const kept = lines.filter(l => l.text.trim().length > 0)
  const height = median(kept.map(l => l.h))
  const paragraphs: string[] = []
  let current = ''
  let previous: OcrLine | undefined
  for (const line of kept) {
    const text = line.text.trim()
    const together =
      previous !== undefined &&
      line.y - (previous.y + previous.h) < PARAGRAPH_GAP * height &&
      line.y >= previous.y &&
      Math.abs(line.x - previous.x) < 2 * height
    if (!together) {
      if (current) paragraphs.push(current)
      current = text
    } else if (/\p{L}-$/u.test(current) && /^\p{Ll}/u.test(text)) {
      current = current.slice(0, -1) + text
    } else {
      current += ' ' + text
    }
    previous = line
  }
  if (current) paragraphs.push(current)
  return paragraphs.join('\n\n')
}

/** A gap between two pieces of one line under this many characters' widths is one space. */
const ONE_SPACE = 1.5
/** The most spaces a gap inside a line becomes, and the most an indent does. */
const MOST_GAP = 40
const MOST_INDENT = 40
/** A step down to the next line this many times the usual one leaves an empty line between them (two at most). */
const EMPTY_LINE = 1.7

type Row = { top: number; bottom: number; pieces: OcrLine[] }

/**
 * The text as it stands on the screen, for copying (2026-11-12, the owner: "a
 * formatted text as it was"): every line of the screen is a line, the pieces
 * Windows reads apart on one height joined left to right (a line number and
 * its line), a wide gap and an indent kept as spaces by the usual width of a
 * character (a wide gap up to the piece's own column), a wider step down as an empty line. Nothing is joined into
 * paragraphs, as `paragraphsOf` does for a translation.
 */
export function screenText(lines: readonly OcrLine[]): string {
  const kept = lines.filter(l => l.text.trim().length > 0).map(l => ({ ...l, text: l.text.trim() }))
  if (kept.length === 0) return ''
  const height = median(kept.map(l => l.h))
  const long = kept.filter(l => [...l.text].length >= 3)
  const cw = median(long.map(l => l.w / [...l.text].length)) || height / 2 || 1
  const rows: Row[] = []
  for (const line of [...kept].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))) {
    const row = rows[rows.length - 1]
    const shared = row ? Math.min(row.bottom, line.y + line.h) - Math.max(row.top, line.y) : 0
    if (row && shared > 0.5 * Math.min(row.bottom - row.top, line.h)) {
      row.pieces.push(line)
      row.top = Math.min(row.top, line.y)
      row.bottom = Math.max(row.bottom, line.y + line.h)
    } else {
      rows.push({ top: line.y, bottom: line.y + line.h, pieces: [line] })
    }
  }
  const left = Math.min(...kept.map(l => l.x))
  const steps = rows.slice(1).map((row, i) => row.top - (rows[i] as Row).top)
  const step = median(steps)
  const out: string[] = []
  rows.forEach((row, i) => {
    if (i > 0 && step > 0) {
      const ratio = (row.top - (rows[i - 1] as Row).top) / step
      const empty = ratio >= EMPTY_LINE + 1 ? 2 : ratio >= EMPTY_LINE ? 1 : 0
      for (let k = 0; k < empty; k++) out.push('')
    }
    const pieces = [...row.pieces].sort((a, b) => a.x - b.x)
    const first = pieces[0] as OcrLine
    let text = ' '.repeat(Math.min(MOST_INDENT, Math.max(0, Math.round((first.x - left) / cw)))) + first.text
    for (let k = 1; k < pieces.length; k++) {
      const before = pieces[k - 1] as OcrLine
      const piece = pieces[k] as OcrLine
      const gap = (piece.x - (before.x + before.w)) / cw
      // A wide gap reaches the piece's own column, so columns of a table stay under each other.
      const column = Math.round((piece.x - left) / cw) - [...text].length
      text += ' '.repeat(gap < ONE_SPACE ? 1 : Math.min(MOST_GAP, Math.max(2, column))) + piece.text
    }
    // Windows reads a full stop or a comma as a word of its own: "логи ." → "логи.".
    out.push(text.replace(/(?<=[\p{L}\p{N}]) (?=[.,;:!?)»]+(?:\s|$))/gu, '').trimEnd())
  })
  return out.join('\n')
}
