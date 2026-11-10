// The Screenshots window's page (media/shots.html): its bar, the list of the
// screenshots kept, and the actions on the ones picked. The screenshot open is
// drawn and changed by webview/shot.ts, the frame's own page, in its editor
// mode; this file runs it.

import { formatDate, t } from '../i18n'
import type { ShotsAction, ShotsItem, ToHost, ToView, TutorHost } from '../protocol'
import { dwmFlag, el } from './dom'
import { glyph } from './glyphs'
import { lucide, type LucideName } from './lucide'
import { clearPicture, flushEdit } from './shot'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

dwmFlag()
// What the taskbar shows for this window.
document.title = `${t('shots.title')} · ${t('app.name')}`

const post = (message: ToHost) => window.tutorHost.post(message)
const part = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const top = part<HTMLElement>('top')
const list = part<HTMLElement>('list')
const acts = part<HTMLDivElement>('acts')
const empty = part<HTMLDivElement>('empty')
const write = part<HTMLTextAreaElement>('write')

let items: ShotsItem[] = []
/** The one shown on the right. */
let openId: number | undefined
/** Ticked for Copy, Save, Text and Delete; when none is, those act on the one open. */
const picked = new Set<number>()
/** Where a Shift+click range starts. */
let anchor: number | undefined

// ---------------------------------------------------------------- the window's bar

const count = el('span', { class: 'count' })
const maxButton = el('button', { class: 'ib', onclick: () => post({ type: 'shotsWindow', command: 'maximize' }) })
top.append(
  el('span', { class: 'name' }, t('shots.title')),
  count,
  el('span', { class: 'grow' }),
  el('button', { class: 'ib', title: t('nav.minimize'), 'aria-label': t('nav.minimize'), onclick: () => post({ type: 'shotsWindow', command: 'minimize' }) }, glyph('minimize')),
  maxButton,
  el('button', { class: 'ib', title: t('common.close'), 'aria-label': t('common.close'), onclick: () => post({ type: 'shotsWindow', command: 'close' }) }, glyph('close')),
)

function drawTop(maximized: boolean): void {
  count.textContent = items.length ? String(items.length) : ''
  maxButton.replaceChildren(glyph(maximized ? 'restore' : 'maximize'))
  maxButton.title = maximized ? t('common.restore') : t('common.maximize')
  maxButton.setAttribute('aria-label', maxButton.title)
}

// ---------------------------------------------------------------- the list

const head = el('div', { class: 'list-head' })
const rows = el('div', { class: 'items', role: 'listbox', 'aria-multiselectable': 'true' })
list.append(head, rows)

/** What the actions take: the ones ticked, else the one open. */
function chosen(): number[] {
  const ticked = items.filter(item => picked.has(item.id)).map(item => item.id)
  if (ticked.length) return ticked
  return openId !== undefined && items.some(item => item.id === openId) ? [openId] : []
}

function drawHead(): void {
  const n = picked.size
  const all = n === items.length && n > 0
  head.replaceChildren(
    el('span', {}, n > 1 ? t('shots.selected', { n }) : ''),
    el('span', { class: 'grow' }),
    ...(items.length > 1 ? [el('button', { class: 'link-btn', onclick: () => pickAll(!all) }, all ? t('shots.askCancel') : t('shots.all'))] : []),
  )
}

function drawList(): void {
  list.classList.toggle('some', picked.size > 0)
  rows.replaceChildren(
    ...items.map(item => {
      const when = formatDate(new Date(item.at), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const row = el(
        'div',
        {
          class: `item${item.id === openId ? ' open' : ''}${picked.has(item.id) ? ' picked' : ''}`,
          role: 'option',
          'aria-selected': String(picked.has(item.id)),
          draggable: 'true',
          title: `${when} · ${item.width} × ${item.height} · ${t('shots.dragTip')}`,
          onclick: (event: Event) => clicked(item.id, event as MouseEvent),
          ondragstart: (event: Event) => dragOut(item.id, event as DragEvent),
        },
        el('img', { src: item.thumb, alt: '' }),
        el(
          'div',
          { class: 'meta' },
          el('span', {}, when),
          el('span', { class: 'grow' }),
          el('span', {}, `${item.width}×${item.height}`),
          item.handled ? null : el('i', { class: 'dot', title: t('shots.notSaved') }),
        ),
        el(
          'button',
          {
            class: 'tick',
            title: t('shots.pick'),
            'aria-label': t('shots.pick'),
            onclick: (event: Event) => {
              event.stopPropagation()
              toggle(item.id)
            },
          },
          lucide('check', 's'),
        ),
      )
      return row
    }),
  )
  drawHead()
  drawActs()
}

function toggle(id: number): void {
  if (picked.has(id)) picked.delete(id)
  else picked.add(id)
  anchor = id
  drawList()
}

function pickAll(on: boolean): void {
  picked.clear()
  if (on) for (const item of items) picked.add(item.id)
  drawList()
}

function clicked(id: number, event: MouseEvent): void {
  list.focus()
  if (event.ctrlKey) {
    toggle(id)
    if (picked.has(id)) void show(id)
    return
  }
  if (event.shiftKey && anchor !== undefined) {
    const from = items.findIndex(item => item.id === anchor)
    const to = items.findIndex(item => item.id === id)
    if (from >= 0 && to >= 0) {
      picked.clear()
      for (const item of items.slice(Math.min(from, to), Math.max(from, to) + 1)) picked.add(item.id)
      drawList()
      void show(id)
      return
    }
  }
  picked.clear()
  anchor = id
  void show(id)
}

/** Opens one on the right: what was changed on the one before reaches main first. */
async function show(id: number): Promise<void> {
  if (id === openId) {
    drawList()
    return
  }
  await flushEdit()
  openId = id
  drawList()
  post({ type: 'shotsWant', id })
}

/** Out into a chat or a folder: the ones ticked when this is one of them, else this one. */
function dragOut(id: number, event: DragEvent): void {
  event.preventDefault()
  const ids = picked.has(id) ? chosen() : [id]
  void flushEdit().then(() => post({ type: 'shotsDrag', ids }))
}

// ---------------------------------------------------------------- the actions

function act(action: ShotsAction): void {
  const ids = chosen()
  if (!ids.length) return
  void flushEdit().then(() => {
    if (action === 'delete') for (const id of ids) picked.delete(id)
    post({ type: 'shotsAction', action, ids })
  })
}

function actButton(name: LucideName, title: string, action: ShotsAction, label?: string): HTMLButtonElement {
  const off = chosen().length === 0
  return el('button', { class: `b${label ? ' lab copy' : ''}`, title, 'aria-label': title, disabled: off, onclick: () => act(action) }, lucide(name, 's'), label)
}

function drawActs(): void {
  const several = chosen().length > 1
  acts.replaceChildren(
    ...(several ? [] : [actButton('scan-text', t('shots.textTip'), 'text')]),
    actButton('save', t('shots.saveTip'), 'save'),
    actButton('trash-2', t('shots.deleteTip'), 'delete'),
    actButton('copy', t('shots.copyTip'), 'copy', t('shot.copy')),
  )
}

// ---------------------------------------------------------------- the keys

window.addEventListener('keydown', event => {
  if (document.activeElement === write) return
  const ctrl = event.ctrlKey
  const code = event.code
  let handled = true
  if (ctrl && code === 'KeyC') act('copy')
  else if (ctrl && code === 'KeyS') act('save')
  else if (ctrl && code === 'KeyA') pickAll(true)
  else if (document.activeElement === list && code === 'Delete') act('delete')
  else if (document.activeElement === list && (code === 'ArrowDown' || code === 'ArrowUp')) {
    const at = items.findIndex(item => item.id === openId)
    const next = items[Math.max(0, Math.min(items.length - 1, at + (code === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      picked.clear()
      anchor = next.id
      void show(next.id)
      rows.querySelector('.item.open')?.scrollIntoView({ block: 'nearest' })
    }
  } else handled = false
  if (handled) event.preventDefault()
})

// ---------------------------------------------------------------- messages

function receiveList(message: Extract<ToView, { type: 'shotsList' }>): void {
  const before = new Set(items.map(item => item.id))
  items = message.items
  const here = new Set(items.map(item => item.id))
  for (const id of [...picked]) if (!here.has(id)) picked.delete(id)
  if (openId !== undefined && !here.has(openId)) openId = undefined
  // A new one comes in at the top.
  if (items.some(item => !before.has(item.id))) rows.scrollTop = 0
  drawTop(message.maximized)
  drawList()
  empty.hidden = items.length > 0
  if (!items.length) clearPicture()
}

empty.append(el('strong', {}, t('shots.empty')), el('p', {}, t('shots.emptyNote')))

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  if (event.source !== window) return
  const message = event.data
  if (message.type === 'shotsList') receiveList(message)
  else if (message.type === 'shotsPicture') {
    openId = message.id
    drawList()
    rows.querySelector('.item.open')?.scrollIntoView({ block: 'nearest' })
  }
})

drawTop(false)
drawList()
post({ type: 'shotsReady' })
