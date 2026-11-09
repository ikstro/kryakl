// One look at the screens for a screenshot, on a thread of its own that ends
// with it: each monitor's pixels through GDI, and the windows on them from the
// top one down, all of the same moment, before anything of Kryakl's is drawn
// over them. winshot.ts starts it and ends it if a graphics driver hangs.

import { parentPort, workerData } from 'node:worker_threads'

import koffi from 'koffi'

import { panelsOf, type Box, type ChildWindow } from './shotmodel'
import { bgraToOpaqueRgba } from './shotpixels'

const user32 = koffi.load('user32.dll')
const gdi32 = koffi.load('gdi32.dll')
const dwmapi = koffi.load('dwmapi.dll')

const GetDC = user32.func('intptr __stdcall GetDC(intptr hwnd)')
const ReleaseDC = user32.func('int __stdcall ReleaseDC(intptr hwnd, intptr dc)')
const CreateCompatibleDC = gdi32.func('intptr __stdcall CreateCompatibleDC(intptr dc)')
const CreateCompatibleBitmap = gdi32.func('intptr __stdcall CreateCompatibleBitmap(intptr dc, int width, int height)')
const SelectObject = gdi32.func('intptr __stdcall SelectObject(intptr dc, intptr object)')
const BitBlt = gdi32.func('bool __stdcall BitBlt(intptr to, int x, int y, int width, int height, intptr from, int fromX, int fromY, uint32 op)')
const GetDIBits = gdi32.func('int __stdcall GetDIBits(intptr dc, intptr bitmap, uint32 start, uint32 lines, void *bits, void *info, uint32 usage)')
const DeleteObject = gdi32.func('bool __stdcall DeleteObject(intptr object)')
const DeleteDC = gdi32.func('bool __stdcall DeleteDC(intptr dc)')

const EnumProc = koffi.proto('bool __stdcall ShotEnumProc(intptr hwnd, intptr param)')
const EnumWindows = user32.func('bool __stdcall EnumWindows(ShotEnumProc *proc, intptr param)')
const EnumChildWindows = user32.func('bool __stdcall EnumChildWindows(intptr parent, ShotEnumProc *proc, intptr param)')
const GetParent = user32.func('intptr __stdcall GetParent(intptr hwnd)')
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr hwnd, void *rect)')
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr hwnd)')
const IsIconic = user32.func('bool __stdcall IsIconic(intptr hwnd)')
const GetWindowTextLengthW = user32.func('int __stdcall GetWindowTextLengthW(intptr hwnd)')
const GetWindowLongPtrW = user32.func('intptr __stdcall GetWindowLongPtrW(intptr hwnd, int index)')
const GetClassNameW = user32.func('int __stdcall GetClassNameW(intptr hwnd, void *name, int n)')
const DwmGetWindowAttribute = dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, void *value, uint32 size)')

const SRCCOPY = 0x00cc0020
/** Layered windows (tooltips, some programs' own frames) come along. */
const CAPTUREBLT = 0x40000000
const DIB_RGB_COLORS = 0
const GWL_EXSTYLE = -20
const WS_EX_TRANSPARENT = 0x20
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
const DWMWA_CLOAKED = 14
/** The desktop itself is not a window to take: a click there takes the screen. */
const NOT_WINDOWS = new Set(['Progman', 'WorkerW'])
const MOST_WINDOWS = 200
/** A program with more controls than this has them for its own reasons: enough for its panels. */
const MOST_PANELS = 400

export type ShotRequest = { rects: ({ id: number } & Box)[] }
/** A window and the handle a recording of it goes by, or a panel inside one (no handle: it is recorded as a piece of the screen). */
export type ShotWindow = Box & { hwnd?: string; panel?: boolean }
export type ShotReply = { monitors: ({ id: number; rgba: ArrayBuffer } & Box)[]; windows: ShotWindow[] }

/** A monitor's pixels, top row first, as a page draws them. */
function grab(rect: Box): ArrayBuffer {
  const { x, y, width, height } = rect
  const screen = GetDC(0)
  const memory = CreateCompatibleDC(screen)
  const bitmap = CreateCompatibleBitmap(screen, width, height)
  const before = SelectObject(memory, bitmap)
  try {
    if (!BitBlt(memory, 0, 0, width, height, screen, x, y, SRCCOPY | CAPTUREBLT)) throw new Error('BitBlt failed')
    SelectObject(memory, before)
    const rgba = new ArrayBuffer(width * height * 4)
    const header = Buffer.alloc(40)
    header.writeUInt32LE(40, 0)
    header.writeInt32LE(width, 4)
    // Negative: the top row first.
    header.writeInt32LE(-height, 8)
    header.writeUInt16LE(1, 12)
    header.writeUInt16LE(32, 14)
    const pixels = new Uint8Array(rgba)
    if ((GetDIBits(memory, bitmap, 0, height, pixels, header, DIB_RGB_COLORS) as number) !== height) throw new Error('GetDIBits failed')
    bgraToOpaqueRgba(pixels)
    return rgba
  } finally {
    SelectObject(memory, before)
    DeleteObject(bitmap)
    DeleteDC(memory)
    ReleaseDC(0, screen)
  }
}

/** What Windows draws as this window's edge, without its invisible border; undefined for one that is not shown. */
function frameOf(hwnd: number | bigint): Box | undefined {
  if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || (GetWindowTextLengthW(hwnd) as number) === 0) return undefined
  if (Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TRANSPARENT) return undefined
  const cloak = Buffer.alloc(4)
  if ((DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloak, 4) as number) === 0 && cloak.readUInt32LE(0) !== 0) return undefined
  const name = Buffer.alloc(128)
  const length = GetClassNameW(hwnd, name, 64) as number
  if (NOT_WINDOWS.has(name.toString('utf16le', 0, length * 2))) return undefined
  const box = Buffer.alloc(16)
  if ((DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, box, 16) as number) !== 0) return undefined
  const left = box.readInt32LE(0)
  const top = box.readInt32LE(4)
  const width = box.readInt32LE(8) - left
  const height = box.readInt32LE(12) - top
  return width > 0 && height > 0 ? { x: left, y: top, width, height } : undefined
}

/** A window's controls that show, as Windows lists them: none of these calls waits for the program. */
function childrenOf(hwnd: string): ChildWindow[] {
  const found: ChildWindow[] = []
  const visit = koffi.register((child: number | bigint) => {
    if (IsWindowVisible(child) && !(Number(GetWindowLongPtrW(child, GWL_EXSTYLE)) & WS_EX_TRANSPARENT)) {
      const rect = Buffer.alloc(16)
      if (GetWindowRect(child, rect)) {
        const x = rect.readInt32LE(0)
        const y = rect.readInt32LE(4)
        found.push({ id: String(child), parent: String(GetParent(child)), box: { x, y, width: rect.readInt32LE(8) - x, height: rect.readInt32LE(12) - y } })
      }
    }
    return found.length < MOST_PANELS
  }, koffi.pointer(EnumProc))
  try {
    EnumChildWindows(BigInt(hwnd), visit, 0)
  } finally {
    koffi.unregister(visit)
  }
  return found
}

/** The windows shown now, the top one first, each after its panels. */
function windows(): ShotWindow[] {
  const out: (Box & { hwnd: string })[] = []
  const visit = koffi.register((hwnd: number | bigint) => {
    const frame = frameOf(hwnd)
    if (frame) out.push({ ...frame, hwnd: String(hwnd) })
    return out.length < MOST_WINDOWS
  }, koffi.pointer(EnumProc))
  try {
    EnumWindows(visit, 0)
  } finally {
    koffi.unregister(visit)
  }
  return out.flatMap(top => [...panelsOf(top.hwnd, top, childrenOf(top.hwnd)).map(box => ({ ...box, panel: true })), top])
}

const { rects } = workerData as ShotRequest
const monitors = rects.map(rect => ({ ...rect, rgba: grab(rect) }))
const reply: ShotReply = { monitors, windows: windows() }
parentPort?.postMessage(reply, monitors.map(m => m.rgba))
