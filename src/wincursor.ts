// The pointer and its clicks, for what a recording draws over the picture: where
// it is, in physical pixels, and which button went down since the last look.

import koffi from 'koffi'

import type { Box } from './shotmodel'

const user32 = koffi.load('user32.dll')
const dwmapi = koffi.load('dwmapi.dll')

const GetCursorPos = user32.func('bool __stdcall GetCursorPos(void *point)')
const GetAsyncKeyState = user32.func('int16 __stdcall GetAsyncKeyState(int vk)')
const GetSystemMetrics = user32.func('int __stdcall GetSystemMetrics(int index)')
const DwmGetWindowAttribute = dwmapi.func('int32 __stdcall DwmGetWindowAttribute(intptr hwnd, uint32 attr, void *value, uint32 size)')
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 count, void *inputs, int size)')

const VK_LBUTTON = 1
const VK_RBUTTON = 2
const SM_SWAPBUTTON = 23
const DWMWA_EXTENDED_FRAME_BOUNDS = 9
/** The size of Windows' INPUT on 64 bits; all zeros, it is a mouse input that moves and presses nothing. */
const INPUT_BYTES = 40

/**
 * Lets a window of Kryakl's take the keyboard next. A key caught by the keyboard
 * thread gives Kryakl no right to come to the front, so Windows would show the
 * window and leave the keyboard with the program under it (measured 2026-11-09:
 * refused two times of two, and taken every time after this empty input, as the
 * process that made the last input may).
 */
export function mayTakeKeyboard(): void {
  SendInput(1, Buffer.alloc(INPUT_BYTES), INPUT_BYTES)
}

export type MouseLook = { x: number; y: number; left: boolean; right: boolean }

type Button = { down: boolean; pressed: boolean }

function button(vk: number): Button {
  const state = GetAsyncKeyState(vk) as number
  return { down: (state & 0x8000) !== 0, pressed: (state & 1) !== 0 }
}

/** What the window shows of itself, without Windows' invisible border; undefined for one that is gone. */
export function windowFrame(hwnd: bigint): Box | undefined {
  const box = Buffer.alloc(16)
  if ((DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, box, 16) as number) !== 0) return undefined
  const x = box.readInt32LE(0)
  const y = box.readInt32LE(4)
  const width = box.readInt32LE(8) - x
  const height = box.readInt32LE(12) - y
  return width > 0 && height > 0 ? { x, y, width, height } : undefined
}

/**
 * A function to look at the mouse with, again and again. `left` and `right` say a
 * button went down since the last look: the key state's low bit catches a click
 * shorter than the time between two looks, and the first look only clears what
 * was left there before (the click that started the recording).
 */
export function mouseWatch(): () => MouseLook {
  const point = Buffer.alloc(8)
  // Windows reports the buttons as they are on the mouse; "left" here is the one the person has as left.
  const [leftKey, rightKey] = (GetSystemMetrics(SM_SWAPBUTTON) as number) !== 0 ? [VK_RBUTTON, VK_LBUTTON] : [VK_LBUTTON, VK_RBUTTON]
  let leftDown = button(leftKey).down
  let rightDown = button(rightKey).down
  return () => {
    GetCursorPos(point)
    const left = button(leftKey)
    const right = button(rightKey)
    const look = { x: point.readInt32LE(0), y: point.readInt32LE(4), left: left.pressed || (left.down && !leftDown), right: right.pressed || (right.down && !rightDown) }
    leftDown = left.down
    rightDown = right.down
    return look
  }
}
