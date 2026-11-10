import { describe, expect, test } from 'vitest'

import {
  shotFileName,
  keepsUntitled,
  squareOf,
  snap45,
  nudge,
  MIN_FRAME,
  arrowHead,
  barPlace,
  boxOf,
  clampBox,
  commit,
  dragFrame,
  handleAt,
  historyOf,
  moved,
  onShape,
  optionsOf,
  redo,
  SHOT_STYLE,
  SHOT_TOOLS,
  shapeAt,
  shotStyleOf,
  stepNumber,
  toolOfCode,
  undo,
  elementsOf,
  panelsOf,
  shotToolOf,
  targetAt,
  targetsAt,
  worthKeeping,
  type Measure,
  type Scene,
  type Shape,
} from './shotmodel'

const style = SHOT_STYLE
const frame = { x: 100, y: 100, width: 200, height: 100 }
const screen = { x: 0, y: 0, width: 1000, height: 800 }
const measure: Measure = shape => ({ x: shape.at.x, y: shape.at.y, width: 40, height: 20 })
const scene = (shapes: Shape[] = []): Scene => ({ frame, shapes })

describe('the tools', () => {
  test('ten tools, each picked by its own physical key', () => {
    expect(SHOT_TOOLS).toHaveLength(10)
    expect(new Set(SHOT_TOOLS.map(tool => tool.code)).size).toBe(10)
    expect(toolOfCode('KeyR')).toBe('rect')
    expect(toolOfCode('KeyB')).toBe('blur')
    expect(toolOfCode('KeyZ')).toBeUndefined()
  })

  test('dashes are for outlines; blur and pixels have no options', () => {
    expect(optionsOf('arrow')).toEqual({ color: true, size: true, dashed: true })
    expect(optionsOf('pen')).toEqual({ color: true, size: true, dashed: false })
    expect(optionsOf('blur')).toEqual({ color: false, size: false, dashed: false })
  })

  test('a style read from a file keeps only what is real', () => {
    expect(shotStyleOf({ color: '#2fb344', size: 2, dashed: true })).toEqual({ color: '#2fb344', size: 2, dashed: true })
    expect(shotStyleOf({ color: 'url(evil)', size: 9, dashed: 'yes' })).toEqual(SHOT_STYLE)
    expect(shotStyleOf(undefined)).toEqual(SHOT_STYLE)
  })
})

describe('the history', () => {
  const rect: Shape = { id: 1, kind: 'rect', box: frame, style }

  test('undo and redo walk the steps', () => {
    const start = historyOf(scene())
    const drawn = commit(start, scene([rect]))
    expect(undo(drawn).now.shapes).toEqual([])
    expect(redo(undo(drawn)).now.shapes).toEqual([rect])
  })

  test('a new step drops what was undone', () => {
    const drawn = commit(historyOf(scene()), scene([rect]))
    const other = commit(undo(drawn), scene())
    expect(other.future).toEqual([])
  })

  test('nothing to undo or redo leaves it as it is', () => {
    const start = historyOf(scene())
    expect(undo(start)).toBe(start)
    expect(redo(start)).toBe(start)
  })
})

describe('the frame', () => {
  test('two points make a box whichever way the drag went', () => {
    expect(boxOf({ x: 30, y: 40 }, { x: 10, y: 5 })).toEqual({ x: 10, y: 5, width: 20, height: 35 })
  })

  test('a window is cut to the screen', () => {
    expect(clampBox({ x: -50, y: 700, width: 200, height: 300 }, screen)).toEqual({ x: 0, y: 700, width: 150, height: 100 })
  })

  test('the topmost window under the point', () => {
    const top = { x: 0, y: 0, width: 50, height: 50 }
    const under = { x: 0, y: 0, width: 500, height: 500 }
    expect(targetAt([top, under], { x: 10, y: 10 }, 0)).toBe(top)
    expect(targetAt([top, under], { x: 100, y: 100 }, 0)).toBe(under)
    expect(targetAt([top], { x: 100, y: 100 }, 0)).toBeUndefined()
  })

  test('the tool last picked comes back, and nonsense does not', () => {
    expect(shotToolOf('rect')).toBe('rect')
    expect(shotToolOf('hammer')).toBe('')
    expect(shotToolOf(undefined)).toBe('')
  })

  test('edges, corners, the inside and outside', () => {
    expect(handleAt(frame, { x: 100, y: 100 }, 6)).toBe('nw')
    expect(handleAt(frame, { x: 300, y: 200 }, 6)).toBe('se')
    expect(handleAt(frame, { x: 200, y: 203 }, 6)).toBe('s')
    expect(handleAt(frame, { x: 200, y: 150 }, 6)).toBe('move')
    expect(handleAt(frame, { x: 50, y: 150 }, 6)).toBeUndefined()
  })

  test('moved whole, it stays on the screen', () => {
    expect(dragFrame(frame, 'move', -500, 0, screen)).toEqual({ ...frame, x: 0 })
    expect(dragFrame(frame, 'move', 5000, 5000, screen)).toEqual({ ...frame, x: 800, y: 700 })
  })

  test('an edge moves alone and never passes the opposite one', () => {
    expect(dragFrame(frame, 'e', 50, 0, screen)).toEqual({ ...frame, width: 250 })
    expect(dragFrame(frame, 'nw', 10, 20, screen)).toEqual({ x: 110, y: 120, width: 190, height: 80 })
    expect(dragFrame(frame, 'w', 900, 0, screen).width).toBe(4)
  })
})

describe('shapes', () => {
  const rect: Shape = { id: 1, kind: 'rect', box: { x: 100, y: 100, width: 100, height: 100 }, style }
  const blur: Shape = { id: 2, kind: 'blur', box: { x: 100, y: 100, width: 100, height: 100 }, style }
  const line: Shape = { id: 3, kind: 'line', from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, style }

  test('an outline is hit on its line, not in the middle; a blur anywhere in it', () => {
    expect(onShape(rect, { x: 100, y: 150 }, 6, measure)).toBe(true)
    expect(onShape(rect, { x: 150, y: 150 }, 6, measure)).toBe(false)
    expect(onShape(blur, { x: 150, y: 150 }, 6, measure)).toBe(true)
  })

  test('a line is hit near it', () => {
    expect(onShape(line, { x: 50, y: 5 }, 6, measure)).toBe(true)
    expect(onShape(line, { x: 50, y: 30 }, 6, measure)).toBe(false)
  })

  test('the shape on top is found first', () => {
    const a: Shape = { ...blur, id: 7 }
    const b: Shape = { ...blur, id: 8 }
    expect(shapeAt([a, b], { x: 150, y: 150 }, 6, measure)?.id).toBe(8)
  })

  test('moved shapes keep their form', () => {
    expect(moved(line, 5, 7)).toMatchObject({ from: { x: 5, y: 7 }, to: { x: 105, y: 7 } })
    expect(moved(rect, 5, 7)).toMatchObject({ box: { x: 105, y: 107, width: 100, height: 100 } })
  })

  test('numbers count among numbers, and close up when one goes', () => {
    const one: Shape = { id: 10, kind: 'step', at: { x: 0, y: 0 }, style }
    const two: Shape = { id: 11, kind: 'step', at: { x: 9, y: 9 }, style }
    expect(stepNumber([one, rect, two], 11)).toBe(2)
    expect(stepNumber([rect, two], 11)).toBe(1)
  })

  test('a slip of the mouse is not kept', () => {
    expect(worthKeeping({ ...line, to: { x: 1, y: 1 } })).toBe(false)
    expect(worthKeeping(line)).toBe(true)
    expect(worthKeeping({ id: 4, kind: 'text', at: { x: 0, y: 0 }, text: '  ', style })).toBe(false)
  })

  test('the arrow’s head ends at the tip and sits behind it', () => {
    const head = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4)
    expect(head.left.x).toBeLessThan(100)
    expect(head.right.x).toBeLessThan(100)
    expect(head.left.y).toBeCloseTo(-head.right.y)
    expect(head.neck.x).toBeLessThan(100)
  })
})

describe('a saved picture', () => {
  const when = new Date(2026, 10, 9, 8, 5, 3)

  test('is named by when it was taken, in the local time', () => {
    expect(shotFileName(when)).toBe('Kryakl 2026-11-09 08-05-03.png')
  })

  test('takes a number when that second has one', () => {
    expect(shotFileName(when, 2)).toBe('Kryakl 2026-11-09 08-05-03 (2).png')
  })
})

describe('the bar', () => {
  const size = { width: 620, height: 44 }
  const view = { width: 1920, height: 1080 }

  test('under the frame, centred on it', () => {
    expect(barPlace({ x: 500, y: 100, width: 400, height: 200 }, view, size, 8)).toEqual({ x: 390, y: 308, inside: false })
  })

  test('above the frame when there is no room below', () => {
    expect(barPlace({ x: 500, y: 300, width: 400, height: 770 }, view, size, 8)).toEqual({ x: 390, y: 248, inside: false })
  })

  test('inside, near its bottom, for a frame as tall as the screen', () => {
    expect(barPlace({ x: 0, y: 0, width: 1920, height: 1080 }, view, size, 8)).toEqual({ x: 650, y: 1020, inside: true })
  })

  test('never off the side of the screen', () => {
    expect(barPlace({ x: 1800, y: 100, width: 100, height: 100 }, view, size, 8).x).toBe(1292)
    expect(barPlace({ x: 0, y: 100, width: 40, height: 100 }, view, size, 8).x).toBe(8)
  })
})

describe('panels inside a window', () => {
  const frame = { x: 0, y: 0, width: 2576, height: 1408 }
  const child = (id: string, parent: string, width: number, height: number, x: number, y: number) => ({ id, parent, box: { x, y, width, height } })
  // Total Commander on the owner's computer, as Windows lists it (2026-11-09).
  const commander = [
    child('split', 'top', 3, 1255, 1286, 115),
    child('headR', 'top', 1280, 30, 1288, 84),
    child('headL', 'top', 1280, 30, 8, 84),
    child('tools', 'top', 2560, 32, 8, 52),
    child('listR', 'top', 1275, 1141, 1291, 209),
    child('listL', 'top', 1274, 1141, 10, 209),
    child('cmd', 'top', 2560, 30, 8, 1370),
    child('cmdBox', 'cmd', 1704, 26, 863, 1373),
    child('cmdEdit', 'cmdBox', 1681, 20, 866, 1376),
    child('cmdPath', 'cmd', 851, 24, 9, 1373),
    child('paneL', 'top', 1278, 1255, 8, 115),
    child('tabsL', 'paneL', 1278, 1227, 9, 143),
    child('statusL', 'tabsL', 1274, 18, 10, 1350),
    child('titleL', 'tabsL', 1274, 19, 10, 190),
    child('barL', 'tabsL', 1236, 21, 10, 169),
    child('driveL', 'paneL', 56, 25, 9, 116),
    child('pathL', 'paneL', 1179, 23, 66, 117),
  ]
  const lit = (panels: { width: number; height: number }[]) => panels.map(p => `${p.width}x${p.height}`)

  test('Total Commander: its lists first, a splitter never', () => {
    const panels = panelsOf('top', frame, commander)
    expect(lit(panels)).not.toContain('3x1255')
    const targets = [...panels.map(box => ({ ...box, panel: true })), frame]
    // A file list, then the tab holding it, its pane, the whole window.
    expect(lit(targetsAt(targets, { x: 100, y: 500 }))).toEqual(['1274x1141', '1277x1227', '1278x1255', '2576x1408'])
    expect(lit(targetsAt(targets, { x: 2000, y: 500 }))).toEqual(['1275x1141', '2576x1408'])
  })

  test('the deepest is found first, and the wheel goes wider up to the window', () => {
    const targets = [...panelsOf('top', frame, commander).map(box => ({ ...box, panel: true })), frame]
    const at = { x: 900, y: 1385 }
    expect(lit(targetsAt(targets, at))).toEqual(['1681x20', '1704x26', '2560x30', '2576x1408'])
    expect(targetAt(targets, at, 0)?.width).toBe(1681)
    expect(targetAt(targets, at, 2)?.width).toBe(2560)
    expect(targetAt(targets, at, 99)).toBe(frame)
    expect(targetAt(targets, at, -1)?.width).toBe(1681)
  })

  test('VS Code, Chrome: the page fills the window, so a click takes the window', () => {
    const vscode = [child('page', 'top', 2560, 1392, 8, 8), child('d3d', 'page', 2560, 1392, 8, 8)]
    expect(panelsOf('top', frame, vscode)).toEqual([])
  })

  test('a window with nothing inside', () => {
    expect(panelsOf('top', frame, [])).toEqual([])
  })

  test('cut to what shows of its parent; what does not show is gone', () => {
    const box = { x: 0, y: 0, width: 1000, height: 1000 }
    const list = [child('a', 'top', 200, 200, 100, 100), child('b', 'a', 500, 50, 200, 120), child('c', 'a', 50, 50, 700, 700)]
    expect(panelsOf('top', box, list)).toEqual([
      { x: 200, y: 120, width: 100, height: 50 },
      { x: 100, y: 100, width: 200, height: 200 },
    ])
  })

  test('siblings: the one on top first', () => {
    const box = { x: 0, y: 0, width: 1000, height: 1000 }
    const list = [child('over', 'top', 100, 100, 50, 50), child('under', 'top', 300, 300, 0, 0)]
    expect(lit(targetsAt([...panelsOf('top', box, list).map(b => ({ ...b, panel: true })), box], { x: 60, y: 60 }))).toEqual(['100x100', '300x300', '1000x1000'])
  })

  test('a child as big as its parent is one step, and its own children still count', () => {
    const box = { x: 0, y: 0, width: 1000, height: 1000 }
    const list = [child('a', 'top', 400, 400, 0, 0), child('b', 'a', 400, 400, 0, 0), child('c', 'b', 100, 100, 0, 0)]
    expect(lit(panelsOf('top', box, list))).toEqual(['100x100', '400x400'])
  })

  test('a lower window\'s panels count only where nothing is over them', () => {
    const top = { x: 0, y: 0, width: 100, height: 100 }
    const low = { x: 0, y: 0, width: 500, height: 500 }
    const panel = { x: 10, y: 10, width: 300, height: 300, panel: true }
    const list = [top, panel, low]
    expect(targetsAt(list, { x: 20, y: 20 })).toEqual([top])
    expect(targetsAt(list, { x: 200, y: 200 })).toEqual([panel, low])
  })
})

describe('parts a program names (Chrome, VS Code)', () => {
  const D = 50030
  const chrome = { x: 0, y: 0, width: 2560, height: 1392 }
  test("Chrome's page alone, cut to the window, never its blocks or panels", () => {
    // As measured on 2026-11-10: the walk stops at the page, the panels around it wider.
    const boxes = [
      { x: 540, y: 89, width: 2020, height: 4568, type: D },
      { x: 540, y: 49, width: 2020, height: 1343, type: 50033 },
      { x: 240, y: 49, width: 2320, height: 1343, type: 50033 },
    ]
    expect(elementsOf(chrome, boxes)).toEqual([{ x: 540, y: 89, width: 2020, height: 1303, panel: true }])
  })
  test('over the tabs or the toolbar there is no page: the window alone', () => {
    expect(elementsOf(chrome, [{ x: 550, y: 55, width: 28, height: 28, type: 50000 }, { x: 240, y: 0, width: 2320, height: 48, type: 50021 }])).toEqual([])
  })
  test('the developer tools are a page of their own', () => {
    expect(elementsOf(chrome, [{ x: 1800, y: 89, width: 760, height: 1303, type: D }])).toEqual([{ x: 1800, y: 89, width: 760, height: 1303, panel: true }])
  })
  test("a browser's page under its tabs is a choice however big; an app that is all page is the window", () => {
    expect(elementsOf(chrome, [{ x: 0, y: 86, width: 2560, height: 1306, type: D }])).toEqual([{ x: 0, y: 86, width: 2560, height: 1306, panel: true }])
    expect(elementsOf(chrome, [{ x: 1, y: 2, width: 2558, height: 1389, type: D }])).toEqual([])
  })
  test('the page lights before its window, the wheel going up to it', () => {
    const parts = elementsOf(chrome, [{ x: 540, y: 89, width: 2020, height: 1303, type: D }])
    const targets = [...parts, chrome]
    expect(targetAt(targets, { x: 1000, y: 600 }, 0)).toEqual(parts[0])
    expect(targetAt(targets, { x: 1000, y: 600 }, 1)).toEqual(chrome)
  })
})

describe('windows with no title (the taskbar, menus)', () => {
  const screens = [{ x: 0, y: 0, width: 2560, height: 1440 }, { x: 2560, y: 0, width: 2560, height: 1440 }]
  const plain = { popup: false, topmost: false, tool: false }
  test("Windows' taskbars are taken, on either monitor (measured 2026-11-10: both have no title)", () => {
    expect(keepsUntitled({ cls: 'Shell_TrayWnd', ...plain, topmost: true, tool: true, box: { x: 0, y: 1392, width: 2560, height: 48 } }, screens)).toBe(true)
    expect(keepsUntitled({ cls: 'Shell_SecondaryTrayWnd', ...plain, box: { x: 2560, y: 1392, width: 2560, height: 48 } }, screens)).toBe(true)
  })
  test("a menu, a tooltip and a program's own popup menu are taken", () => {
    expect(keepsUntitled({ cls: '#32768', ...plain, box: { x: 300, y: 300, width: 240, height: 400 } }, screens)).toBe(true)
    expect(keepsUntitled({ cls: 'tooltips_class32', ...plain, box: { x: 300, y: 300, width: 120, height: 24 } }, screens)).toBe(true)
    expect(keepsUntitled({ cls: 'Chrome_WidgetWin_1', popup: true, topmost: true, tool: false, box: { x: 2900, y: 200, width: 300, height: 500 } }, screens)).toBe(true)
  })
  test('a helper no one sees, a sliver and an overlay over the whole screen are not', () => {
    expect(keepsUntitled({ cls: 'Chrome_WidgetWin_0', ...plain, box: { x: 0, y: 0, width: 800, height: 600 } }, screens)).toBe(false)
    expect(keepsUntitled({ cls: 'Overlay', popup: true, topmost: true, tool: true, box: { x: 0, y: 0, width: 2560, height: 1440 } }, screens)).toBe(false)
    expect(keepsUntitled({ cls: 'Edge', popup: true, topmost: true, tool: false, box: { x: 10, y: 10, width: 4, height: 300 } }, screens)).toBe(false)
    expect(keepsUntitled({ cls: 'Away', popup: true, topmost: true, tool: false, box: { x: -5000, y: 0, width: 200, height: 200 } }, screens)).toBe(false)
  })
})

describe('a precise frame', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1080 }
  test('Shift makes a square from the press toward the pointer, the longer side', () => {
    expect(squareOf({ x: 100, y: 100 }, { x: 160, y: 120 })).toEqual({ x: 100, y: 100, width: 60, height: 60 })
    expect(squareOf({ x: 100, y: 100 }, { x: 80, y: 40 })).toEqual({ x: 40, y: 40, width: 60, height: 60 })
  })
  test('Shift on a line keeps it to eight directions', () => {
    expect(snap45({ x: 0, y: 0 }, { x: 100, y: 8 })).toEqual({ x: 100, y: 0 })
    expect(snap45({ x: 0, y: 0 }, { x: 70, y: 72 })).toEqual({ x: 71, y: 71 })
    expect(snap45({ x: 0, y: 0 }, { x: -3, y: -90 })).toEqual({ x: 0, y: -90 })
  })
  test('the arrows move the frame inside the screen, with Ctrl its right or bottom edge', () => {
    const frame = { x: 10, y: 10, width: 100, height: 50 }
    expect(nudge(frame, 1, 0, screen, false)).toEqual({ x: 11, y: 10, width: 100, height: 50 })
    expect(nudge(frame, -50, 0, screen, false)).toEqual({ x: 0, y: 10, width: 100, height: 50 })
    expect(nudge({ ...frame, x: 1815 }, 10, 0, screen, false).x).toBe(1820)
    expect(nudge(frame, 0, 10, screen, true)).toEqual({ x: 10, y: 10, width: 100, height: 60 })
    expect(nudge(frame, -500, 0, screen, true).width).toBe(MIN_FRAME)
  })
})
