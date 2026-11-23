// Scores the readers of scripts/ocr-groq-bench.ts: node scripts/ocr-groq-score.mjs
// Reads .cache/ocr-quality/groq/{<name>.txt (truth), windows/, groq-qwen/}, prints a table.
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve('.cache/ocr-quality/groq')
const readers = [['Windows', 'windows'], ['Groq qwen3.8-27b', 'groq-qwen']]
const secs = {
  Windows: JSON.parse(fs.readFileSync(path.join(ROOT, 'windows.json'), 'utf8')),
  'Groq qwen3.8-27b': {},
}
// Seconds of the Groq requests, from its log lines "<name>.png 1.57 s".
for (const m of fs.readFileSync(path.join(ROOT, 'groq-qwen.log'), 'utf8').matchAll(/^(\S+)\.png ([\d.]+) s/gm)) secs['Groq qwen3.8-27b'][m[1]] = Number(m[2])

const norm = ls => ls.map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}
const names = fs.readdirSync(ROOT).filter(n => n.endsWith('.png')).map(n => n.replace('.png', ''))
const total = {}
const rows = []
for (const n of names) {
  const truth = norm(fs.readFileSync(path.join(ROOT, `${n}.txt`), 'utf8').split(/\r?\n/))
  const row = { name: n }
  for (const [label, dir] of readers) {
    const file = path.join(ROOT, dir, `${n}.txt`)
    if (!fs.existsSync(file)) { row[label] = null; continue }
    const raw = fs.readFileSync(file, 'utf8')
    const out = norm(raw.replace(/^```\w*\n?|```$/gm, '').split(/\r?\n/))
    const t = truth.join('\n')
    const o = out.join('\n')
    const ce = distance([...o], [...t]), tc = [...t].length
    const we = distance(o.split(/\s+/), t.split(/\s+/)), tw = t.split(/\s+/).length
    const set = new Set(out)
    const right = truth.filter(l => set.has(l)).length
    const extra = out.filter(l => !truth.includes(l)).length
    const indents = raw.split(/\r?\n/).filter(l => /^\s+\S/.test(l)).length
    const r = { ce, tc, we, tw, right, lines: truth.length, nOut: out.length, indents, s: secs[label][n] }
    row[label] = r
    const T = (total[label] ??= { ce: 0, tc: 0, we: 0, tw: 0, right: 0, lines: 0, s: 0, n: 0 })
    T.ce += ce; T.tc += tc; T.we += we; T.tw += tw; T.right += right; T.lines += truth.length; T.s += r.s ?? 0; T.n++
  }
  rows.push(row)
}
const pct = (a, b) => ((a / b) * 100).toFixed(1)
console.log('| Picture | ' + readers.map(r => r[0]).join(' | ') + ' |')
console.log('|---|' + readers.map(() => '---|').join(''))
for (const row of rows) {
  console.log(`| ${row.name} | ` + readers.map(([l]) => { const r = row[l]; return r ? `${pct(r.ce, r.tc)} % / ${pct(r.we, r.tw)} %, ${r.right}/${r.lines} lines, ${r.s?.toFixed(2) ?? '-'} s (out ${r.nOut}, indented ${r.indents})` : 'none' }).join(' | ') + ' |')
}
console.log(`| **total** | ` + readers.map(([l]) => { const t = total[l]; return `${pct(t.ce, t.tc)} % / ${pct(t.we, t.tw)} %, ${t.right}/${t.lines} lines, ${(t.s / t.n).toFixed(2)} s avg` }).join(' | ') + ' |')
