// Windows' UI Automation through koffi, for the field with the keyboard: is
// it a password field (field-worker.ts asks, away from the keyboard thread,
// whose hooks must never wait: programs answer it themselves, browsers too,
// which can take a while), and giving the keyboard back to it later (the main
// process, before pasting a translation: a window brought back to the front
// does not always put it back where it was, as VS Code's chat does not). COM
// is called by hand: the IUIAutomation and IUIAutomationElement methods by
// their place in the table.

import koffi from 'koffi'

const ole32 = koffi.load('ole32.dll')

const GUID = koffi.struct('UiaGuid', { a: 'uint32', b: 'uint16', c: 'uint16', d: koffi.array('uint8', 8) })
const CoInitializeEx = ole32.func('int32 __stdcall CoInitializeEx(void *reserved, uint32 flags)')
const CoCreateInstance = ole32.func('int32 __stdcall CoCreateInstance(UiaGuid *clsid, void *outer, uint32 ctx, UiaGuid *iid, _Out_ void **out)')

const oleaut32 = koffi.load('oleaut32.dll')
const SysFreeString = oleaut32.func('void __stdcall SysFreeString(void *text)')

const Release = koffi.proto('uint32 __stdcall UiaRelease(void *self)')
const GetFocusedElement = koffi.proto('int32 __stdcall UiaGetFocusedElement(void *self, _Out_ void **element)')
const GetBool = koffi.proto('int32 __stdcall UiaGetBool(void *self, _Out_ int32 *value)')
const SetFocus = koffi.proto('int32 __stdcall UiaSetFocus(void *self)')
const GetPatternAs = koffi.proto('int32 __stdcall UiaGetPatternAs(void *self, int32 pattern, UiaGuid *iid, _Out_ void **out)')
const GetObject = koffi.proto('int32 __stdcall UiaGetObject(void *self, _Out_ void **out)')
const GetInt = koffi.proto('int32 __stdcall UiaGetInt(void *self, _Out_ int32 *value)')
const GetAt = koffi.proto('int32 __stdcall UiaGetAt(void *self, int32 index, _Out_ void **out)')
const GetText = koffi.proto('int32 __stdcall UiaGetText(void *self, int32 max, _Out_ void **text)')

const COINIT_MULTITHREADED = 0
const CLSCTX_INPROC_SERVER = 1
const CLSID_CUIAutomation = guid('ff48dba4-60ef-4201-aa87-54103eef594e')
const IID_IUIAutomation = guid('30cbe57d-d9d0-452a-ab13-7ac5ac4825ee')
const IID_IUIAutomationTextPattern = guid('32eba289-3583-42c9-9c59-3b6d9a1e9b6a')
const UIA_TextPatternId = 10014
/**
 * IUnknown's Release; IUIAutomation's GetFocusedElement; IUIAutomationElement's
 * SetFocus, GetCurrentPatternAs and get_CurrentIsPassword; IUIAutomationTextPattern's
 * GetSelection; IUIAutomationTextRangeArray's get_Length and GetElement;
 * IUIAutomationTextRange's GetText (UIAutomationClient.h).
 */
const RELEASE = 2
const GET_FOCUSED_ELEMENT = 8
const SET_FOCUS = 3
const GET_CURRENT_PATTERN_AS = 14
const GET_CURRENT_IS_PASSWORD = 35
const GET_SELECTION = 5
const GET_LENGTH = 3
const GET_ELEMENT = 4
const GET_TEXT = 12

function guid(text: string): Record<string, unknown> {
  const h = text.replace(/-/g, '')
  const d: number[] = []
  for (let i = 16; i < 32; i += 2) d.push(parseInt(h.slice(i, i + 2), 16))
  return { a: parseInt(h.slice(0, 8), 16), b: parseInt(h.slice(8, 12), 16), c: parseInt(h.slice(12, 16), 16), d }
}

/** A COM method: the function at `index` in the object's table. */
function method<T>(object: unknown, index: number, proto: ReturnType<typeof koffi.proto>): T {
  const table = koffi.decode(object, 'void *')
  return koffi.decode(koffi.decode(table, index * koffi.sizeof('void *'), 'void *'), proto) as T
}

let automation: unknown
let failed = false

/** UI Automation, made at the first use; undefined when Windows will not give it. */
function automationOf(): unknown {
  if (failed) return undefined
  if (!automation) {
    // A thread COM knows already (the main process's) keeps its kind: the answer does not matter.
    CoInitializeEx(null, COINIT_MULTITHREADED)
    const out: unknown[] = [null]
    if ((CoCreateInstance(CLSID_CUIAutomation, null, CLSCTX_INPROC_SERVER, IID_IUIAutomation, out) as number) < 0 || !out[0]) {
      failed = true
      return undefined
    }
    automation = out[0]
  }
  return automation
}

/** The element with the keyboard, held until `release`; undefined when UI Automation does not say. */
export function focusedElement(): unknown {
  const uia = automationOf()
  if (!uia) return undefined
  const element: unknown[] = [null]
  const getFocused = method<(self: unknown, out: unknown[]) => number>(uia, GET_FOCUSED_ELEMENT, GetFocusedElement)
  return getFocused(uia, element) < 0 ? undefined : (element[0] ?? undefined)
}

export function release(element: unknown): void {
  method<(self: unknown) => number>(element, RELEASE, Release)(element)
}

/** Gives the keyboard back to an element (its window must be in front); false when it would not take it. */
export function focus(element: unknown): boolean {
  return method<(self: unknown) => number>(element, SET_FOCUS, SetFocus)(element) >= 0
}

/**
 * The text selected in an element, read without the clipboard: for a field that
 * does not answer Ctrl+C (Claude's question box in VS Code). Empty when nothing
 * is selected or the element has no text pattern.
 */
export const selectedText = (element: unknown): string => readSelection(element) ?? ''

/** Whether an element says outright that nothing is selected in it; false also when it cannot say. */
export const saysNothingSelected = (element: unknown): boolean => readSelection(element) === ''

/** The selected text; '' when nothing is, undefined when the element has no text pattern or would not answer. */
function readSelection(element: unknown): string | undefined {
  const held: unknown[] = []
  const take = (object: unknown) => (held.push(object), object)
  try {
    const pattern: unknown[] = [null]
    const getPattern = method<(self: unknown, id: number, iid: unknown, out: unknown[]) => number>(element, GET_CURRENT_PATTERN_AS, GetPatternAs)
    if (getPattern(element, UIA_TextPatternId, IID_IUIAutomationTextPattern, pattern) < 0 || !pattern[0]) return undefined
    const text = take(pattern[0])
    const ranges: unknown[] = [null]
    if (method<(self: unknown, out: unknown[]) => number>(text, GET_SELECTION, GetObject)(text, ranges) < 0 || !ranges[0]) return undefined
    const array = take(ranges[0])
    const length = [0]
    if (method<(self: unknown, out: number[]) => number>(array, GET_LENGTH, GetInt)(array, length) < 0) return undefined
    const parts: string[] = []
    for (let i = 0; i < (length[0] ?? 0); i++) {
      const range: unknown[] = [null]
      if (method<(self: unknown, index: number, out: unknown[]) => number>(array, GET_ELEMENT, GetAt)(array, i, range) < 0 || !range[0]) continue
      const r = take(range[0])
      const bstr: unknown[] = [null]
      if (method<(self: unknown, max: number, out: unknown[]) => number>(r, GET_TEXT, GetText)(r, -1, bstr) < 0 || !bstr[0]) continue
      // A BSTR is the characters themselves at that address (koffi gives the address as a number).
      parts.push(koffi.decode(bstr[0], 'char16_t', -1) as string)
      SysFreeString(bstr[0])
    }
    return parts.join('\n')
  } catch {
    return undefined
  } finally {
    for (const object of held.reverse()) release(object)
  }
}

/** Whether the field with the keyboard is a password field; undefined when UI Automation does not say. */
export function focusedIsPassword(): boolean | undefined {
  const element = focusedElement()
  if (!element) return undefined
  try {
    const value = [0]
    const isPassword = method<(self: unknown, out: number[]) => number>(element, GET_CURRENT_IS_PASSWORD, GetBool)
    return isPassword(element, value) < 0 ? undefined : value[0] !== 0
  } finally {
    release(element)
  }
}

// ---------------------------------------------------------------- the parts of a window, for a screenshot's frame

const ElementFromHandle = koffi.proto('int32 __stdcall UiaElementFromHandle(void *self, intptr hwnd, _Out_ void **element)')
const AddProperty = koffi.proto('int32 __stdcall UiaAddProperty(void *self, int32 property)')
const FindAllBuildCache = koffi.proto('int32 __stdcall UiaFindAllBuildCache(void *self, int32 scope, void *condition, void *request, _Out_ void **found)')
/** A RECT: the element's edges, in the screen's pixels. */
const UiaRect = koffi.struct('UiaRect', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
const GetRect = koffi.proto('int32 __stdcall UiaGetRect(void *self, _Out_ UiaRect *rect)')

/**
 * IUIAutomation's ElementFromHandle, get_ControlViewCondition and CreateCacheRequest;
 * IUIAutomationCacheRequest's AddProperty; IUIAutomationElement's FindAllBuildCache,
 * get_CachedControlType, get_CachedIsOffscreen and get_CachedBoundingRectangle.
 */
const ELEMENT_FROM_HANDLE = 6
const GET_CONTROL_VIEW_CONDITION = 18
const CREATE_CACHE_REQUEST = 20
const ADD_PROPERTY = 3
const FIND_ALL_BUILD_CACHE = 8
const GET_CACHED_CONTROL_TYPE = 53
const GET_CACHED_IS_OFFSCREEN = 70
const GET_CACHED_BOUNDING_RECTANGLE = 75
const TREE_SCOPE_CHILDREN = 2
const UIA_BoundingRectanglePropertyId = 30001
const UIA_ControlTypePropertyId = 30003
const UIA_IsOffscreenPropertyId = 30022
/** A web page (Chrome's, Edge's, an app's web view; Chrome's developer tools too): the one part a screenshot takes from such a window. */
export const UIA_DocumentControlTypeId = 50030
/** How deep a walk goes, and how many children of one element it looks at. */
const MOST_DEPTH = 40
const MOST_CHILDREN = 500

/** A part of a window on the screen, in the screen's pixels, with its UI Automation control type. */
export type ElementBox = { x: number; y: number; width: number; height: number; type: number }

let partsQuery: { condition: unknown; request: unknown } | undefined

/** The control view (no bare layout elements) and the three properties each child is read with, made once. */
function queryOf(uia: unknown): { condition: unknown; request: unknown } | undefined {
  if (partsQuery) return partsQuery
  const condition: unknown[] = [null]
  if (method<(self: unknown, out: unknown[]) => number>(uia, GET_CONTROL_VIEW_CONDITION, GetObject)(uia, condition) < 0 || !condition[0]) return undefined
  const request: unknown[] = [null]
  if (method<(self: unknown, out: unknown[]) => number>(uia, CREATE_CACHE_REQUEST, GetObject)(uia, request) < 0 || !request[0]) {
    release(condition[0])
    return undefined
  }
  const add = method<(self: unknown, id: number) => number>(request[0], ADD_PROPERTY, AddProperty)
  for (const id of [UIA_BoundingRectanglePropertyId, UIA_ControlTypePropertyId, UIA_IsOffscreenPropertyId]) add(request[0], id)
  partsQuery = { condition: condition[0], request: request[0] }
  return partsQuery
}

/** A cached child's box, or undefined when it would not say or is off the screen. */
function boxOf(element: unknown): ElementBox | undefined {
  const rect: Record<string, number> = {}
  const offscreen = [0]
  const type = [0]
  if (method<(self: unknown, out: Record<string, number>) => number>(element, GET_CACHED_BOUNDING_RECTANGLE, GetRect)(element, rect) < 0) return undefined
  if (method<(self: unknown, out: number[]) => number>(element, GET_CACHED_IS_OFFSCREEN, GetBool)(element, offscreen) < 0 || offscreen[0]) return undefined
  method<(self: unknown, out: number[]) => number>(element, GET_CACHED_CONTROL_TYPE, GetInt)(element, type)
  const left = rect.left ?? 0
  const top = rect.top ?? 0
  const box = { x: left, y: top, width: (rect.right ?? 0) - left, height: (rect.bottom ?? 0) - top }
  return box.width > 0 && box.height > 0 ? { ...box, type: type[0] ?? 0 } : undefined
}

/**
 * The parts of a window under a point of the screen, the narrowest first, from
 * the window's tree of elements (what screen readers read): Chrome, VS Code and
 * other programs that draw everything themselves have no child windows to list,
 * but they name their panels, page blocks and buttons there. Walked down from
 * the window, never asked at the point, as the screenshot's overlay is what lies
 * at every point. Stops at `budget` ms with what it has.
 */
export function elementsAt(hwnd: bigint, x: number, y: number, budget: number): ElementBox[] {
  const uia = automationOf()
  const query = uia ? queryOf(uia) : undefined
  if (!uia || !query) return []
  const started = Date.now()
  const chain: ElementBox[] = []
  const root: unknown[] = [null]
  const fromHandle = method<(self: unknown, hwnd: bigint, out: unknown[]) => number>(uia, ELEMENT_FROM_HANDLE, ElementFromHandle)
  if (fromHandle(uia, hwnd, root) < 0 || !root[0]) return []
  let current: unknown = root[0]
  try {
    for (let depth = 0; depth < MOST_DEPTH && Date.now() - started < budget; depth++) {
      const found: unknown[] = [null]
      const findAll = method<(self: unknown, scope: number, condition: unknown, request: unknown, out: unknown[]) => number>(current, FIND_ALL_BUILD_CACHE, FindAllBuildCache)
      if (findAll(current, TREE_SCOPE_CHILDREN, query.condition, query.request, found) < 0 || !found[0]) break
      const array = found[0]
      let best: { element: unknown; box: ElementBox } | undefined
      try {
        const length = [0]
        if (method<(self: unknown, out: number[]) => number>(array, GET_LENGTH, GetInt)(array, length) < 0) break
        for (let i = 0; i < Math.min(length[0] ?? 0, MOST_CHILDREN); i++) {
          const item: unknown[] = [null]
          if (method<(self: unknown, index: number, out: unknown[]) => number>(array, GET_ELEMENT, GetAt)(array, i, item) < 0 || !item[0]) continue
          const element = item[0]
          const box = boxOf(element)
          const holds = box && x >= box.x && y >= box.y && x < box.x + box.width && y < box.y + box.height
          // The smallest that holds the point; on a tie the later one, drawn over the earlier.
          if (box && holds && (!best || box.width * box.height <= best.box.width * best.box.height)) {
            if (best) release(best.element)
            best = { element, box }
          } else release(element)
        }
      } finally {
        release(array)
      }
      if (!best) break
      chain.unshift(best.box)
      // The page is what is wanted, never its blocks: no need to read its hundreds of elements.
      if (best.box.type === UIA_DocumentControlTypeId) break
      release(current)
      current = best.element
    }
  } catch {
    // What was found by then stands.
  } finally {
    release(current)
  }
  return chain
}
