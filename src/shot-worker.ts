// One look at the screens for a screenshot, on a thread of its own that ends
// with it: each monitor's pixels through GDI, and the windows on them from the
// top one down, all of the same moment, before anything of Kryakl's is drawn
// over them. winshot.ts starts it and ends it if a graphics driver hangs.

import { parentPort, workerData } from 'node:worker_threads'

import koffi from 'koffi'

import { clampBox, keepsUntitled, panelsOf, SHELL_BARS, type Box, type ChildWindow } from './shotmodel'
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
const GetCursorInfo = user32.func('bool __stdcall GetCursorInfo(_Inout_ void *info)')
const GetIconInfo = user32.func('bool __stdcall GetIconInfo(intptr icon, void *info)')
const GetObjectW = gdi32.func('int __stdcall GetObjectW(intptr object, int size, void *out)')
const DrawIconEx = user32.func('bool __stdcall DrawIconEx(intptr dc, int x, int y, intptr icon, int width, int height, uint32 step, intptr brush, uint32 flags)')
const CURSOR_SHOWING = 1
const DI_NORMAL = 3

const SRCCOPY = 0x00cc0020
/** Layered windows (tooltips, some programs' own frames) come along. */
const CAPTUREBLT = 0x40000000
const DIB_RGB_COLORS = 0
const GWL_EXSTYLE = -20
const GWL_STYLE = -16
const WS_POPUP = 0x80000000
const WS_EX_TOPMOST = 0x8
const WS_EX_TOOLWINDOW = 0x80
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
/** The pointer on a monitor: a patch of its pixels with the pointer drawn in, at the patch's place in the monitor's own pixels. */
export type ShotCursor = Box & { rgba: ArrayBuffer }
export type ShotReply = { monitors: ({ id: number; rgba: ArrayBuffer; cursor?: ShotCursor } & Box)[]; windows: ShotWindow[] }

/** The pointer as Windows shows it now: its icon, and where its picture's corner lies (its spot less its hotspot); none while it is hidden. */
function pointerNow(): { icon: number | bigint; x: number; y: number; width: number; height: number } | undefined {
  // CURSORINFO on 64 bits: cbSize, flags, then the handle at 8 and the point at 16.
  const info = Buffer.alloc(24)
  info.writeUInt32LE(24, 0)
  if (!GetCursorInfo(info) || !(info.readUInt32LE(4) & CURSOR_SHOWING)) return undefined
  const icon = info.readBigInt64LE(8)
  if (icon === 0n) return undefined
  // ICONINFO: fIcon, the hotspot, then the mask's and the color's bitmaps at 16 and 24.
  const parts = Buffer.alloc(32)
  if (!GetIconInfo(icon, parts)) return undefined
  const mask = parts.readBigInt64LE(16)
  const color = parts.readBigInt64LE(24)
  try {
    const bitmap = Buffer.alloc(32)
    if ((GetObjectW(mask, 32, bitmap) as number) === 0) return undefined
    const width = bitmap.readInt32LE(4)
    // A cursor of two colors keeps its AND and XOR masks one over the other in one bitmap.
    const height = color === 0n ? bitmap.readInt32LE(8) / 2 : bitmap.readInt32LE(8)
    return { icon, x: info.readInt32LE(16) - parts.readUInt32LE(4), y: info.readInt32LE(20) - parts.readUInt32LE(8), width, height }
  } finally {
    if (mask !== 0n) DeleteObject(mask)
    if (color !== 0n) DeleteObject(color)
  }
}

type Pointer = NonNullable<ReturnType<typeof pointerNow>>

/** The rows of a bitmap selected in no DC, top row first, as RGBA. */
function rowsOf(memory: number | bigint, bitmap: number | bigint, width: number, start: number, lines: number, height: number): Uint8Array {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(width, 4)
  // Negative: the top row first, so `start` counts from the top.
  header.writeInt32LE(-height, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  const pixels = new Uint8Array(width * lines * 4)
  if ((GetDIBits(memory, bitmap, start, lines, pixels, header, DIB_RGB_COLORS) as number) !== lines) throw new Error('GetDIBits failed')
  bgraToOpaqueRgba(pixels)
  return pixels
}

/**
 * A monitor's pixels, top row first, as a page draws them, and, when the
 * pointer is on it, a patch of them with the pointer drawn in: Windows puts
 * the pointer on the screen apart from its pixels, and drawing it on what was
 * under it gets a pointer that inverts (the text cursor) right.
 */
function grab(rect: Box, pointer: Pointer | undefined): { rgba: ArrayBuffer; cursor?: ShotCursor } {
  const { x, y, width, height } = rect
  const screen = GetDC(0)
  const memory = CreateCompatibleDC(screen)
  const bitmap = CreateCompatibleBitmap(screen, width, height)
  const before = SelectObject(memory, bitmap)
  try {
    if (!BitBlt(memory, 0, 0, width, height, screen, x, y, SRCCOPY | CAPTUREBLT)) throw new Error('BitBlt failed')
    SelectObject(memory, before)
    const pixels = rowsOf(memory, bitmap, width, 0, height, height)
    const patch = pointer && clampBox({ x: pointer.x - x, y: pointer.y - y, width: pointer.width, height: pointer.height }, { x: 0, y: 0, width, height })
    let cursor: ShotCursor | undefined
    if (pointer && patch && patch.width > 0 && patch.height > 0) {
      SelectObject(memory, bitmap)
      DrawIconEx(memory, pointer.x - x, pointer.y - y, pointer.icon, 0, 0, 0, 0, DI_NORMAL)
      SelectObject(memory, before)
      const rows = rowsOf(memory, bitmap, width, patch.y, patch.height, height)
      const rgba = new Uint8Array(patch.width * patch.height * 4)
      for (let row = 0; row < patch.height; row++) rgba.set(rows.subarray((row * width + patch.x) * 4, (row * width + patch.x + patch.width) * 4), row * patch.width * 4)
      cursor = { ...patch, rgba: rgba.buffer }
    }
    return { rgba: pixels.buffer as ArrayBuffer, ...(cursor ? { cursor } : {}) }
  } finally {
    SelectObject(memory, before)
    DeleteObject(bitmap)
    DeleteDC(memory)
    ReleaseDC(0, screen)
  }
}

/** What Windows draws as this window's edge, without its invisible border, and its class; undefined for one that is not shown or not to be taken. */
function frameOf(hwnd: number | bigint, monitors: readonly Box[]): { box: Box; cls: string } | undefined {
  if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return undefined
  const exStyle = Number(GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
  if (exStyle & WS_EX_TRANSPARENT) return undefined
  const cloak = Buffer.alloc(4)
  if ((DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, cloak, 4) as number) === 0 && cloak.readUInt32LE(0) !== 0) return undefined
  const name = Buffer.alloc(512)
  const length = GetClassNameW(hwnd, name, 256) as number
  const cls = name.toString('utf16le', 0, length * 2)
  if (NOT_WINDOWS.has(cls)) return undefined
  const frame = Buffer.alloc(16)
  if ((DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, frame, 16) as number) !== 0) return undefined
  const left = frame.readInt32LE(0)
  const top = frame.readInt32LE(4)
  const box = { x: left, y: top, width: frame.readInt32LE(8) - left, height: frame.readInt32LE(12) - top }
  if (box.width <= 0 || box.height <= 0) return undefined
  if ((GetWindowTextLengthW(hwnd) as number) === 0) {
    const popup = (Number(GetWindowLongPtrW(hwnd, GWL_STYLE)) & WS_POPUP) !== 0
    if (!keepsUntitled({ cls, popup, topmost: (exStyle & WS_EX_TOPMOST) !== 0, tool: (exStyle & WS_EX_TOOLWINDOW) !== 0, box }, monitors)) return undefined
  }
  return { box, cls }
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
function windows(monitors: readonly Box[]): ShotWindow[] {
  const out: (Box & { hwnd: string; cls: string })[] = []
  const visit = koffi.register((hwnd: number | bigint) => {
    const frame = frameOf(hwnd, monitors)
    if (frame) out.push({ ...frame.box, hwnd: String(hwnd), cls: frame.cls })
    return out.length < MOST_WINDOWS
  }, koffi.pointer(EnumProc))
  try {
    EnumWindows(visit, 0)
  } finally {
    koffi.unregister(visit)
  }
  return out.flatMap(({ cls, ...top }) => [...(SHELL_BARS.has(cls) ? [] : panelsOf(top.hwnd, top, childrenOf(top.hwnd)).map(box => ({ ...box, panel: true }))), top])
}

const { rects } = workerData as ShotRequest
let pointer: Pointer | undefined
try {
  pointer = pointerNow()
} catch {
  pointer = undefined
}
const monitors = rects.map(rect => ({ ...rect, ...grab(rect, pointer) }))
const reply: ShotReply = { monitors, windows: windows(rects) }
parentPort?.postMessage(reply, monitors.flatMap(m => (m.cursor ? [m.rgba, m.cursor.rgba] : [m.rgba])))
