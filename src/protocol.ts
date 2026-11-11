// Messages between the main process and the card, the small window that
// shows one picked text or one snipped piece of the screen at a time.
import type { DictationEntry } from './dictationlog'
import type { DeviceProfile } from './hardware'
import type { WordTime } from './kokoro'
import type { Gloss } from './lemma'
import type { NaturalState } from './natural'
import type { LlmModel, Settings, TranslationLevel } from './settings'
import type { SpeechPackState, SpeechPart } from './speechpack'
import type { Choice, Feature, FeaturePlan, SpeechPlan } from './speechplan'
import type { SpeechHealth, SpeechResult, SpeechServiceState } from './speechservice'
import type { TalkState, TalkTurn } from './talk'
import type { TalkRecord, TalkSummary } from './talks'
import type { TranslationEntry } from './translationlog'
import type { TranslatorState } from './translator'
import type { MistakeEntry } from './mistakes'
import type { VideoEffects, VideoSound } from './recordmodel'
import type { Box, Shape, ShotStyle, ShotTarget, Tool } from './shotmodel'
import type { Learned } from './typist'
import type { DiffPart } from './worddiff'
import type { SavedWord } from './words'

/** The word dictionary for the person's language: here, none for the language, coming, failed, or not downloaded yet. */
export type DictionaryStatus = 'ready' | 'none' | 'downloading' | 'failed' | 'absent'

export type { Choice, DeviceProfile, DictationEntry, DiffPart, Feature, FeaturePlan, Gloss, MistakeEntry, NaturalState, SavedWord, Settings, SpeechHealth, SpeechPackState, SpeechPart, SpeechPlan, SpeechResult, TalkRecord, TalkSummary, TalkTurn, WordTime }

/**
 * What the card is for, and where the text came from. To listen to it, in
 * English with its translation under it: `selection` (copied or selected in
 * any program), `screenshot` (read from a snipped piece of the screen). To
 * translate it, shown as it is with its translation, From and To, like
 * DeepL: `translate` (selected), `text` (read from the screen). To check the
 * person's own English, its mistakes marked and set right: `check`.
 */
export type CardKind = 'selection' | 'screenshot' | 'translate' | 'text' | 'check'

/** The translation under a text shown as it is (a `translate` or `text` card), asked for with `translateText`. */
export type TextResult =
  | { status: 'none' }
  | { status: 'translating' }
  /** The translator for `language` (a code) is downloading, once. */
  | { status: 'downloading'; language: string; progress: number; size: number }
  /**
   * `text`: the translation as plain text (Copy, Paste); `html`: the same,
   * every sentence a `span.t` (render.ts textOutHtml); `sentences`: the
   * text's sentences in order, as translated, for the card to find in its field;
   * `drafts`: how many sentences are still quick drafts (`span.t.draft`), the
   * accurate model's translation replacing them one by one; `busy`: Fast
   * translated it, the model too slow just now.
   */
  | { status: 'ready'; text: string; from: string; to: string; html: string; sentences: string[]; drafts?: number; busy?: BusyPart }
  | { status: 'failed'; message: string }

/** What kept the local model too slow just now, so Fast translated instead (modelbusy.ts): the graphics card or the processor taken by another program. */
export type BusyPart = 'card' | 'processor'

/** Check my English's answer under the person's text (a `check` card), asked for with `checkText`. */
export type CheckResult =
  | { status: 'none' }
  | { status: 'checking' }
  /** The checker's model is downloading, once. */
  | { status: 'downloading'; progress: number; size: number }
  /**
   * `text`: the text checked; `corrected`: it set right (Copy, Paste; the
   * same text when it was right); `parts`: what changed, word by word
   * (worddiff.ts); `note`: the main mistake in the person's language, or "".
   */
  | { status: 'ready'; text: string; corrected: string; parts: DiffPart[]; note: string }
  | { status: 'failed'; message: string }

/** The card's lower half: the translation, or what keeps it. */
export type TranslationState =
  | { status: 'translating' }
  /** The translator for this language pair is downloading, once. */
  | { status: 'downloading'; progress: number; size: number }
  /** `drafts`, `busy`: as a text's (TextResult). */
  | { status: 'ready'; html: string; drafts?: number; busy?: BusyPart }
  | { status: 'failed'; message: string }

/**
 * What the card shows. `done`: `html` is the text in English (see render.ts),
 * on top; an English text is done at once, while its translation still comes.
 */
export type CardState =
  | { status: 'reading' }
  | { status: 'translating' }
  | { status: 'downloading'; progress: number; size: number }
  | { status: 'done'; html: string; translation: TranslationState; note?: string }
  /**
   * The translator's text, as it is: `from` is the language it seems to be
   * in and `to` the one it is translated into (codes, out of `languages`,
   * those the translator has); `canPaste`: it was selected in a window the
   * translation can be pasted into, over the selection.
   */
  /** `mine`: the languages the person uses, put first in From and To. */
  | { status: 'text'; text: string; from: string; to: string; languages: string[]; mine?: string[]; result: TextResult; canPaste?: boolean }
  /** Check my English: the person's text as it is (editable) and what the checker (`model`, its level's name: Accurate) says of it; `canPaste` as a text's. */
  | { status: 'check'; text: string; result: CheckResult; model: string; canPaste?: boolean }
  /** The snipped piece of the screen holds no text. */
  | { status: 'empty' }
  /** Windows has no text recognition installed for any language the card could use. */
  | { status: 'no-ocr' }
  | { status: 'failed'; message: string }

export type CardView = {
  /** A new id is a new text: the card scrolls to the top and may read it aloud. */
  id: number
  kind: CardKind
  state: CardState
  /** The learned language (English) and the person's own. */
  target: string
  native: string
  /** The translation level the card translates with (Settings). */
  level: TranslationLevel
  /** The level's model too slow just now: Fast translates until it is tried again (modelbusy.ts). */
  busy?: BusyPart
  /** Read the English aloud as soon as the card has it. */
  autoRead: boolean
  /**
   * The key that called the card, lit in its header (hotkey.ts notation;
   * "Control+C*2" for Ctrl+C pressed twice); none when it came from the tray.
   */
  via?: string
}

/** When the word card shows: while Shift is held over a word, on any hover, or never. */
export type WordHintMode = 'shift' | 'hover' | 'off'

export type ViewConfig = { voice: string; rate: number; wordHint: WordHintMode; rareWords: boolean; oneAtATime: boolean }

/**
 * The app window's places: Home (always first), the five action pages, the person's lists, Settings, Models,
 * Disk space, About; 'checkModel' is Models › Check and talk. The names before 2026-11-04 still come (a second
 * start, an older page): 'talk' and 'check' open English, 'listen' and 'screen' Translate, 'dictate' Voice typing,
 * 'transcribe' Recordings and meetings, 'keyboard' Keyboard layout, 'howto' Home.
 */
export type AppTab =
  | 'home'
  | 'translate'
  | 'english'
  | 'voice'
  | 'recordings'
  | 'layout'
  | 'words'
  | 'mistakes'
  | 'transcripts'
  | 'vocabulary'
  | 'kept'
  | 'phrases'
  | 'settings'
  | 'models'
  | 'checkModel'
  | 'storage'
  | 'about'
  | 'report'
  | 'talk'
  | 'listen'
  | 'check'
  | 'screen'
  | 'dictate'
  | 'transcribe'
  | 'keyboard'
  | 'howto'

export type HostVoice = { name: string; lang: string }

/** A keyboard layout Windows has: `id` as settings.ts keeps it ("04090409"), `name` as Windows calls its language. */
/** One of Windows' layouts: `lang` is its language's code, as the layout fixer's word lists are named. */
export type KeyboardLayout = { id: string; name: string; short: string; lang: string }

/**
 * The speech engine (Dictate, Transcribe, Transcripts): its installed parts,
 * the running service and what it reports. `download` is each choice's size in MB.
 */
export type SpeechView = {
  pack: SpeechPackState
  service: SpeechServiceState
  trouble?: string
  health?: SpeechHealth
  port: number
  /** The Chrome extension's folder, for Load unpacked. */
  extensionDir: string
  /** The extension's version in that folder: Chrome runs an older copy until Reload. */
  extensionShipped: string
  download: { core: number; gpu: number; speakers: number }
  /** What each choice takes on the disk once installed, in MB. */
  installed: { core: number; gpu: number; speakers: number }
  /**
   * Who spoke when: where it runs (the person's choice, else the advice), each way's download and disk in MB,
   * and whether the voices' model itself is on the disk already (then no Hugging Face key is asked).
   */
  speakers: {
    on: 'cuda' | 'cpu'
    sizes: Record<'cuda' | 'cpu', { download: number; installed: number }>
    model: boolean
  }
  /** The model dictation downloads at its first use (0 MB: it is here), on the processor or on the card, and its time for a phrase. */
  firstModel: { cpu: { model: string; mb: number; phrase: number }; cuda: { model: string; mb: number; phrase: number } }
  /** Free space where the engine goes. */
  disk: { freeMb: number; drive: string }
  /** This computer: processor, memory, cards. */
  device: DeviceProfile
  /** Which model runs where and how long each takes here. */
  plan: SpeechPlan
  /** The speed test: offered now (the person has not agreed, and something is still unmeasured), agreed once, models it would measure. */
  test: { offer: boolean; agreed: boolean; runs: number }
  /** The dictation keys are registered (false: another program holds one). */
  keysOk: { dictate: boolean; note: boolean; english: boolean; again: boolean; practice: boolean; talk: boolean }
}

/**
 * What the talk window draws (webview/talk.ts): the talk (talk.ts), the
 * settings it reads, and what stands in its way. `engine`: the speech engine
 * that hears the person; `model`: the local model that checks and answers,
 * named; `needsCard`: this computer's graphics card cannot hold Accurate
 * whole, so no talk is offered; `slow`: the model picked runs partly on the
 * card or on the processor here; `busy`: another program holds the card or
 * the processor now; `keyTaken`: the Talk key could not be registered;
 * `talks`: the history panel's list; `maximized`: the window fills the screen.
 */
export type TalkWindowView = {
  talk: TalkState
  talks: TalksView
  maximized: boolean
  talkKey: string
  talkAloud: boolean
  onTop: boolean
  voice: string
  rate: number
  wordHint: Settings['wordHint']
  rareWords: boolean
  native: string
  natural: NaturalState['status']
  engine: 'absent' | 'starting' | 'ready'
  /** `full`: the model's own name ("Gemma 4 E4B"), for the bar's tooltip. */
  model: { name: string; full: string } & TranslatorState
  needsCard: boolean
  slow: boolean
  busy?: BusyPart
  keyTaken: boolean
}

/** The talks (talks.ts): the one going on and those put away, newest first, for the talk window's history. */
export type TalksView = { current?: TalkSummary; past: TalkSummary[] }

/** Everything the app window shows, sent whole whenever any of it changes. */
export type AppView = {
  settings: Settings
  version: string
  /** When this copy was built, and from which commit ("30 Oct, 07:12 (ff17ba8, changed)"). */
  build: string
  /** A run from source, not an installed copy. */
  dev: boolean
  natural: NaturalState
  hostVoices: HostVoice[]
  /** The languages a person may name as their own: English name and own name. */
  languages: { name: string; native: string }[]
  words: SavedWord[]
  /** Each shortcut is registered (false: another program holds it). */
  keysOk: { snip: boolean; select: boolean; translate: boolean; text: boolean; inPlace: boolean; check: boolean; type: boolean; typeCheck: boolean; pause: boolean; window: boolean }
  /** What Kryakl learned from the person's typing (learning.ts): words fixed always, words of theirs. */
  learned: { alwaysFix: Learned[]; myWords: Learned[] }
  /** A program that runs as administrator was in front lately: its keys never reach Kryakl. */
  elevatedApp?: string
  /** The texts translated lately, newest first (the last 10). */
  translations: TranslationEntry[]
  /** The translator between English and the person's language: here, downloading, or to be downloaded on the first translation. */
  translator: 'absent' | 'downloading' | 'ready' | 'failed' | 'unsupported'
  /** The keyboard layouts Windows has, in its order. */
  layouts: KeyboardLayout[]
  /** Why the keyboard helper does not run, when it should. */
  keyboardTrouble?: string
  /** The program typed in last (its .exe name), to keep words in it as typed. */
  lastApp?: string
  /** Other layout switchers running now (EveryLang, Punto Switcher): they would fix words twice. */
  rivals: string[]
  /** Other screenshot programs running now: one may hold the same key. */
  shotApps: string[]
  /** How many screenshots the Screenshots window holds now. */
  shotsHeld: number
  /** Where recordings of the screen go, the default when none was chosen. */
  videoDir: string
  /** Other programs known to watch the keyboard, running now (AutoHotkey, WhisperTyping…): no harm, named so the person knows. */
  keyboardApps: string[]
  /** Some program pressed keys by itself since the keyboard helper started; Kryakl ignores those. */
  foreignKeys: boolean
  speech: SpeechView
  /** The phrases dictated lately, newest first: all kept (200 at most, 30 days, dictationlog.ts). */
  dictation: { recent: DictationEntry[] }
  /** The translator for the person's language with its download's progress and size (MB), for the setup's list. */
  translatorState: TranslatorState
  /** Each translation level's models for the person's language (Fast: Firefox's pair), for the Translate page. */
  translation: Record<TranslationLevel, TranslatorState>
  /** Each local model's download, whatever the language (Check my English; never `unsupported`). */
  models: Record<LlmModel, TranslatorState>
  /**
   * Seconds a local model takes here, each once measured a few times: a
   * sentence translated, a text checked, the duck's answer in Talk, and
   * loading the model after it was let go; `card`: the MB of the graphics
   * card it holds while loaded.
   */
  modelSpeed: Partial<Record<LlmModel, { sentence?: number; text?: number; reply?: number; start?: number; card?: number }>>
  /** The local model loaded now, and whether on the graphics card (Models › This computer says what Kryakl holds right now). */
  llmLoaded?: { model: LlmModel; onCard: boolean }
  /** The word dictionary for the person's language. */
  dictionary: { status: DictionaryStatus }
  /** The mistakes checked texts had, newest first (mistakes.ts). */
  mistakes: MistakeEntry[]
  /** The talk going on, for the Talk page's line. */
  talk?: TalkSummary
  /** What Kryakl keeps on this computer, measured once the Storage page was opened. */
  storage?: StorageView
}

/**
 * A part of what Kryakl keeps (storage.ts): Firefox's models and the word dictionaries by language, the natural voice, the
 * two language models and an older Kryakl's, llama.cpp's builds, each speech model, the speech engine's program and its
 * graphics card's and speakers' parts, the person's own things.
 */
export type StorageId = 'fast' | 'dict' | 'voice' | 'accurate' | 'most' | 'unused' | 'llama' | 'speechModel' | 'speech' | 'gpu' | 'speakers' | 'yours' | 'transcripts'
/**
 * Its place, its bytes, and how many of them are files linked from elsewhere too (a developer's uv cache), which a removal does not free.
 * `item`: the language's code (fast, dict), the speech model's name, the build (llama: vulkan, cuda). `users`: the actions it serves now;
 * `unused`: nothing uses it, Clean up removes it; `reserve`: kept for when the graphics card fails ("Dictate"), not cleaned up.
 */
export type StoragePart = { id: StorageId; item?: string; path: string; bytes: number; shared: number; away?: boolean; users?: string[]; unused?: boolean; reserve?: string }
/** `refused`: the parts the last removal or Clean up could not take off the disk, each with why, in the interface's language. */
export type StorageView = { measuring: boolean; root: string; drive: string; freeMb: number; parts: StoragePart[]; old?: OldFolder; refused?: Refused[] }
export type Refused = { id: StorageId; item?: string; why: string }
export type OldFolder = { dir: string; why?: string; moving: boolean }

/** What the tray's panel shows, sent whole whenever any of it changes. */
export type TrayView = {
  /** The keys of its commands, hotkey.ts notation ("Control+C*2" for Ctrl+C twice); empty when there is none. */
  keys: { shot: string; video: string; listenCopied: string; typeToTranslate: string; checkEnglish: string; talk: string; snipListen: string; snipTranslate: string; switch: string }
  /** The quick settings' switches: fixing as one types, the switch key, the badge, the layout in the tray's icon, Kryakl paused. */
  autoFix: boolean
  switchOn: boolean
  layoutBadge: boolean
  trayLayout: boolean
  paused: boolean
  /** "Keep a word as typed…": shown while the fixer works (fixing as one types, or the fix key on); `word` the last word fixed by itself, as typed, and `fixed` what it became (empty when none, or it is kept already). */
  keep: { on: boolean; word: string; fixed: string }
  /** The speech engine is installed: a note can be started from here; one is being recorded now. */
  speech: { installed: boolean; recording: boolean; noteKey: string }
  /** The translator between English and the person's language (as `AppView.translator`). */
  translator: AppView['translator']
  /** How many screenshots the Screenshots window holds: its row shows while there are any. */
  shots: number
  /** The last dictated phrases, newest first (3 at most): a click copies one. */
  phrases: { at: string; text: string }[]
  native: string
  version: string
  build: string
  dev: boolean
}

/** What the tray's panel can do; each puts the panel away first. */
export type TrayCommand = 'shot' | 'shots' | 'video' | 'listenCopied' | 'translateCopied' | 'typeToTranslate' | 'checkEnglish' | 'talk' | 'listenScreen' | 'translateScreen' | 'note' | 'transcripts' | 'vocabulary' | 'kept' | 'phrases' | 'settings' | 'report' | 'open' | 'quit'

/**
 * Why a word has no meanings: no dictionary exists for the person's language,
 * it is being downloaded, the download failed or is turned off, or the word
 * is not in it.
 */
export type GlossMissing = 'not-english' | 'no-dictionary' | 'downloading' | 'download-failed' | 'download-off' | 'not-found'

export type ToView =
  /** `maximized`: the card fills the screen's work area (and stays, pinned, until closed or restored). */
  | { type: 'card'; card: CardView; config: ViewConfig; pinned: boolean; maximized: boolean }
  /** `platform` is Node's name for the system (win32, darwin, linux), for the steps to add a voice. */
  | { type: 'hostVoices'; voices: HostVoice[]; canSpeak: boolean; platform: string }
  | { type: 'progress'; id: number; pos: number; len: number }
  | { type: 'speakDone'; id: number }
  | { type: 'stop' }
  | { type: 'gloss'; word: string; gloss?: Gloss; missing?: GlossMissing; saved?: boolean }
  /** The word's pronunciation, from the natural voice's phonemizer, once that voice is here. */
  | { type: 'ipa'; word: string; ipa: string }
  /** The word went into the notebook, or left it. */
  | { type: 'saved'; word: string; saved: boolean }
  /** The 3000 most common English words, for the dotted line under the others. */
  | { type: 'common'; words: string[] }
  /** A dictionary finished downloading: words asked while it ran can be asked again. */
  | { type: 'dictReady' }
  /** The app window's whole state. */
  | { type: 'app'; view: AppView }
  /** Show this tab of the app window (the tray's "About Kryakl…"). */
  | { type: 'appTab'; tab: AppTab }
  /** The app window fills the screen or not (its button, a double click on its bar, Windows' keys): Maximize or Restore. */
  | { type: 'appWindow'; maximized: boolean }
  /** A key went down or up while a key field waits for one (`recordKeys`), read by the keyboard thread's hook: KeyboardEvent.code ('' for a key no hotkey names), at (ms since 1970). */
  | { type: 'keyEvent'; code: string; down: boolean; at: number }
  /** The tray's panel's whole state. */
  | { type: 'tray'; view: TrayView }
  /** Show this transcript in the app window (a finished note's balloon, the extension). */
  | { type: 'openTranscript'; id: string }
  /** A report was made at `file` for the person to attach, or could not be. */
  | { type: 'reported'; file?: string; error?: string }
  /** The Talk key, pressed anywhere: the talk window listens, sends what was said, or stops the duck and listens; `hidden`: the window was closed or minimized, the microphone and the voice stop. */
  | { type: 'talk'; command: 'toggle' | 'hidden' }
  /** The talk window's snapshot. */
  | { type: 'talkView'; view: TalkWindowView }
  /**
   * The dictation badge: record, then stop (and type it, or keep it as a note), or throw away.
   * `session`: the engine's dictation heard while spoken (engine/stream.py), when the engine has them;
   * `expected`: the languages the person uses (their own, English, the others named); the phrase is one of them.
   */
  | { type: 'dictation'; command: 'start' | 'stop' | 'cancel'; mode: DictationMode; key: string; session?: string; expected?: string[] }
  /** `note`: said in place of "Typed" (Fast translated it, the model too slow just now). */
  | { type: 'dictationDone'; text: string; note?: string }
  /** The phrase is with the local model (text editing). */
  | { type: 'dictationEditing' }
  | { type: 'dictationError'; message: string }
  /** The tray's panel was just shown: focus its first command. */
  | { type: 'trayShown' }
  /** Kryakl's menu on one key: what it draws now. */
  | { type: 'menu'; view: MenuView }
  /** A screenshot: this monitor as it was at the press, in its physical pixels (`rgba`, handed over to the page), how wide the window is in CSS pixels, and the windows on it, the top one first; `video`: opened to record; `quick`: only for the text in a frame. */
  | { type: 'shotFrame'; width: number; height: number; cssWidth: number; rgba: Uint8Array; windows: ShotTarget[]; style: ShotStyle; tool: Tool | ''; video: boolean; quick: boolean; sound: VideoSound; effects: VideoEffects; shutter: boolean; cursor?: ShotPointer; cursorOn: boolean }
  /** The parts the program names there, the narrowest first, as panels of that window. */
  | { type: 'shotElements'; window: number; boxes: ShotTarget[] }
  /** The screenshot is over: its pixels go. */
  | { type: 'shotClear' }
  /** A frame was begun on another monitor: this one only stays dim. */
  | { type: 'shotOther' }
  /** The pointer is on another monitor now: nothing lit here, no loupe. */
  | { type: 'shotAway' }
  /** The picture stays on the screen after all (a save called off, or failed: `message` says why). */
  | { type: 'shotResume'; message?: string }
  /** The Screenshots window (shotseditor.ts): what it holds, newest first, and whether the window fills the screen. */
  | { type: 'shotsList'; items: ShotsItem[]; maximized: boolean }
  /** One of them to work on: its picture as taken (no drawings), the pixels of the screen in one CSS pixel there (`ink`), its frame and what is drawn on it. */
  | { type: 'shotsPicture'; id: number; png: Uint8Array; ink: number; frame: Box; shapes: Shape[]; style: ShotStyle; tool: Tool | '' }
  /** A recording's strip: what to take (the source and the crop are main's, in the source's own pixels; no size for a window, which has its own). */
  | { type: 'recordBegin'; source: string; size?: { width: number; height: number }; crop?: Box; sound: VideoSound; countdown: number; effects?: VideoEffects }
  /** The pointer, in pixels of what is recorded, whose size is `width` × `height`; a button that went down there since the last look. */
  | { type: 'recordCursor'; x: number; y: number; width: number; height: number; inside: boolean; left: boolean; right: boolean }
  /** The zoom key was pressed. */
  | { type: 'recordZoomKey' }
  /** The recording ends now; `why` when it is not the person's doing. */
  | { type: 'recordHalt'; why?: string }
  /** The screen was locked or unlocked: the recording waits. */
  | { type: 'recordHold'; on: boolean }
  /** The file is ready: how long it runs, how big it is, its name, why it stopped when the person did not stop it, and whether the strip has the keyboard. */
  | { type: 'recordDone'; seconds: number; bytes: number; name: string; note?: string; keyboard: boolean }
  | { type: 'natural'; state: NaturalState }
  /** One sentence of reading `id` in the natural voice: 24 kHz audio and when each of its words is spoken. */
  | { type: 'naturalAudio'; id: number; index: number; samples: Float32Array; words: WordTime[] }
  | { type: 'naturalFailed'; id: number; message: string }

/** What a dictated phrase becomes: typed where the cursor is, typed in English, a note in the knowledge base, or English checked in the card (practice). */
export type DictationMode = 'type' | 'english' | 'note' | 'check'

/** What is done with a finished screenshot: copied, saved to a file, or its text read. */
export type ShotAction = 'copy' | 'save' | 'text'

/** The pointer as it was at the press: a patch of the monitor with it drawn in, at the patch's place in the monitor's own pixels. */
export type ShotPointer = Box & { rgba: Uint8Array }

/** A screenshot in the Screenshots window: its size, when it was taken, whether it was saved or copied since it changed, and a small picture of it. */
export type ShotsItem = { id: number; width: number; height: number; at: number; handled: boolean; thumb: string }

/** What the Screenshots window does with the screenshots ticked (or the one open). */
export type ShotsAction = 'copy' | 'save' | 'text' | 'delete'

/** A button on a recording's strip: Stop, delete what is being recorded; on the finished file, open it, show its folder, copy it, delete it, or close the strip. */
export type RecordAction = 'stop' | 'cancel' | 'open' | 'folder' | 'copy' | 'delete' | 'dismiss'

/** The menu on one key: its groups of items by letter and name, the one lit, and the one just picked (-1 for none); both count through all the groups. */
export type MenuView = { groups: { letter: string; label: string }[][]; lit: number; fired: number }

export type ToHost =
  | { type: 'lookup'; word: string }
  | { type: 'ready' }
  | { type: 'speak'; id: number; items: string[]; lang: string; separator: string }
  /** Reads `items` in a natural voice; `naturalAt` says which of them started playing, so the next ones get made. */
  /** `ahead`: sentences to make after `items` and keep, not to read (what a step forward will want). */
  | { type: 'speakNatural'; id: number; items: string[]; voice: string; rate: number; ahead?: string[] }
  | { type: 'naturalAt'; id: number; index: number }
  | { type: 'downloadNatural' }
  /** The person closed the offer of the natural voice. */
  | { type: 'dismissNatural' }
  | { type: 'stop' }
  | { type: 'openSpeechSettings' }
  /** Windows Settings → Language, where text recognition for a language is added. */
  | { type: 'openLanguageSettings' }
  /** The card's content is this tall, in CSS pixels; the window follows. */
  | { type: 'height'; px: number }
  /** A pinned card stays open when another window is clicked. */
  | { type: 'pin'; on: boolean }
  /** The card fills the screen, or goes back to where and how big it was. */
  | { type: 'maximize'; on: boolean }
  | { type: 'close' }
  /** Translate the last text again, after a failure. */
  | { type: 'retry' }
  /** Translate card `id`'s text again with the level's model, however long it takes (Fast did it, the model too slow just now). */
  | { type: 'waitForModel'; id: number }
  /** Translate a text card's text (as it stands, maybe edited) from one language into another, by codes. */
  | { type: 'translateText'; id: number; text: string; from: string; to: string }
  /** Check a check card's English (as it stands, maybe edited). */
  | { type: 'checkText'; id: number; text: string }
  | { type: 'copyText'; text: string }
  /** Paste a translation (or a checked text set right) over the selection it was made from, in the window it was selected in. */
  | { type: 'pasteText'; id: number; text: string }
  /** Put a word into the notebook, with the sentence it was met in, or take it out. */
  | { type: 'saveWord'; word: string; sentence: string }
  | { type: 'unsaveWord'; word: string }
  // The app window.
  | { type: 'appReady' }
  | { type: 'saveSettings'; patch: Partial<Settings> }
  | { type: 'removeWord'; id: number }
  /** Save the notebook as a file for Anki, or copy it as text. */
  | { type: 'exportWords' }
  | { type: 'copyWords' }
  /** Open one of the About tab's links in the browser. */
  | { type: 'openLink'; url: string }
  /** The app window's own buttons: it has no Windows frame. Close hides it, as Kryakl lives in the tray. */
  | { type: 'window'; action: 'minimize' | 'maximize' | 'close' }
  /** A key field waits for a key, or no longer: the keyboard thread reads the keys first (Ctrl+Esc, Shift+Caps Lock, Alt) and sends them as `keyEvent`. */
  | { type: 'recordKeys'; on: boolean }
  /** The Transcribe page's microphone recording (or Talk's listening) began or ended: the tray shows it. */
  | { type: 'micRecording'; on: boolean }
  /** Talk (talk.ts), from the talk window: a new talk on a topic, a line said or typed, the duck's answer under way dropped, New talk; `talkListen`: it began listening, so the model loads meanwhile. */
  | { type: 'talkStart'; topic: string }
  | { type: 'talkSay'; text: string }
  | { type: 'talkInterrupt' }
  | { type: 'talkClear' }
  | { type: 'talkListen' }
  /**
   * The talk window's page is ready for its snapshot; its pin; its bar's buttons: closed, maximized or put back, its settings (the app
   * window's Talk page) or its model (Models › Check my English) asked for; from its history, a talk put away continued or removed, every one forgotten.
   */
  | { type: 'talkReady' }
  | { type: 'talkPin'; on: boolean }
  | { type: 'talkWindow'; action: 'close' | 'maximize' | 'settings' | 'model' }
  | { type: 'talkContinue'; id: string }
  | { type: 'talkDelete'; id: string }
  | { type: 'talksClear' }
  /** From the app window's Talk page: open the talk window. */
  | { type: 'talkOpen' }
  // The menu on one key (menuwindow.ts): its page is ready; its content is this tall, in CSS pixels; the pointer is on an item, or clicked one (counted through all the groups).
  | { type: 'menuReady' }
  | { type: 'menuHeight'; px: number }
  | { type: 'menuHover'; index: number }
  | { type: 'menuPick'; index: number }
  // A screenshot (shotwindow.ts): its page is ready; it has drawn the frozen screen; a frame was begun on it; Esc; the look of what is drawn; the finished picture, as a PNG, and what to do with it.
  | { type: 'shotReady' }
  | { type: 'shotShown' }
  | { type: 'shotBegan' }
  /** The pointer came onto this monitor before a frame: the others let go of what they lit. */
  | { type: 'shotHover' }
  | { type: 'shotCancel' }
  | { type: 'shotStyle'; style: ShotStyle }
  /** A tool was picked, to be in hand next time. */
  | { type: 'shotTool'; tool: Tool }
  | { type: 'shotDone'; action: ShotAction; png: ArrayBuffer }
  /** Record this frame: `window`, the window the frame still is, by its place in the page's list; else a piece of the monitor or the whole of it. */
  | { type: 'shotRecord'; frame: Box; window?: number; sound: VideoSound }
  /** The parts of the window at this place of the page's list under the pointer (picture pixels). */
  | { type: 'shotProbe'; window: number; x: number; y: number }
  /** Rings or zooming were switched in the bar, to be remembered. */
  | { type: 'shotEffects'; effects: VideoEffects }
  /** The sound was switched in the bar, to be remembered. */
  | { type: 'shotSound'; sound: VideoSound }
  /** The pointer was put on the picture or taken off, to be remembered. */
  | { type: 'shotCursor'; on: boolean }
  /** Into the Screenshots window: the frame's picture as taken (`png`, with the pointer when it is on), the same with what is drawn (`flat`), what is drawn in the picture's own pixels, and the screen's pixels in one CSS pixel. */
  | { type: 'shotKeep'; png: ArrayBuffer; flat: ArrayBuffer; shapes: Shape[]; ink: number }
  // The Screenshots window (shotseditor.ts): its page is ready; it wants a screenshot's picture; one was changed (its frame, its drawings and the flat result); do this with these; they are being dragged out; its bar's buttons.
  | { type: 'shotsReady' }
  | { type: 'shotsWant'; id: number }
  | { type: 'shotsEdit'; id: number; frame: Box; shapes: Shape[]; flat: ArrayBuffer }
  | { type: 'shotsAction'; action: ShotsAction; ids: number[] }
  | { type: 'shotsDrag'; ids: number[] }
  | { type: 'shotsWindow'; command: 'minimize' | 'maximize' | 'close' }
  // A recording's strip (recordwindow.ts): its page is ready; how big it wants to be; the first picture is going out; a piece of the file, in order; everything is handed over; a button.
  | { type: 'recordReady' }
  | { type: 'recordSize'; width: number; height: number }
  | { type: 'recordRolling' }
  | { type: 'recordChunk'; seq: number; extension: 'mp4' | 'webm'; data: ArrayBuffer }
  | { type: 'recordEnded'; seconds: number; trouble?: string }
  | { type: 'recordAct'; action: RecordAction }
  // The tray's panel.
  | { type: 'trayReady' }
  /** The panel's content is this tall, in CSS pixels; the window follows. */
  | { type: 'trayHeight'; px: number }
  | { type: 'tray'; command: TrayCommand }
  /** The tray's "Keep a word as typed…" field: add it to Kept as typed (the panel stays). */
  | { type: 'keepWord'; word: string }
  /** A dictated phrase in the tray clicked: onto the clipboard as the person's own copy, then the panel goes. */
  | { type: 'trayCopy'; at: string }
  /** Esc, or a click outside it. */
  | { type: 'trayClose' }
  // The speech engine; `models` are downloaded once the service runs (the setup's picks).
  | { type: 'installSpeech'; parts: SpeechPart[]; models?: string[] }
  /** The first-run setup: the translator for the person's language and its word dictionary, downloaded ahead of use. */
  | { type: 'prepareTranslator' }
  /** The translation level picked on the Translate page (a model: the one model, for Check too): saved, and its models downloaded. */
  | { type: 'translationLevel'; level: TranslationLevel }
  /** The one model picked on the Check page (translation too, when it is not Fast): saved and downloaded. */
  | { type: 'useModel'; model: LlmModel }
  /** Forget one kept mistake (by its time), or all of them. */
  | { type: 'forgetMistake'; at: string }
  | { type: 'clearMistakes' }
  | { type: 'prepareDictionary' }
  /** Run the speed test (the person agreed), or not now. */
  | { type: 'testSpeech' }
  | { type: 'declineSpeechTest' }
  /** A speech model downloaded now, ahead of its use. */
  | { type: 'downloadSpeechModel'; model: string }
  | { type: 'restartSpeech' }
  | { type: 'showInFolder'; path: string }
  | { type: 'openPath'; path: string }
  /** The folder recordings of the screen go to, made if it is not there yet. */
  | { type: 'recordFolder' }
  /** The Screenshots window in front, from the Screenshots page. */
  | { type: 'openShots' }
  /** Forget the phrases dictated lately; the texts translated lately. */
  | { type: 'clearDictation' }
  | { type: 'clearTranslations' }
  /** One phrase or one translation forgotten, by when it was kept. */
  | { type: 'forgetPhrase'; at: string }
  | { type: 'forgetTranslation'; at: string }
  /** What Kryakl learned from the person's typing: one word out of a list, or everything. */
  | { type: 'unlearn'; list: 'alwaysFix' | 'myWords'; word: string }
  | { type: 'forgetLearned' }
  /** A backup of the settings and the libraries saved as a file, imported from one (the person picks it), or the settings all back to how they came. */
  | { type: 'exportBackup' }
  | { type: 'importBackup' }
  | { type: 'resetSettings' }
  /** Every key back to how it came (after a question). */
  | { type: 'resetKeys' }
  /** Report a problem (report.ts): the zip made and shown in its folder, then the email or the GitHub issue opened with `text` in it; or Kryakl's folder with the logs opened. */
  | { type: 'reportProblem'; via: 'email' | 'github'; text: string }
  | { type: 'openLogs' }
  /**
   * Measure what Kryakl keeps (the Models or Storage page opened). Remove one part (a language model: Fast in its place
   * when it translated; the speech engine whole, or its graphics card's or speakers' part); each downloads again when
   * wanted. Clean up removes every part nothing uses. Use recommended: the models advised for this computer, and their downloads.
   */
  | { type: 'storage' }
  | { type: 'removeStored'; id: StorageId; item?: string }
  | { type: 'cleanUp' }
  | { type: 'useRecommended' }
  /** What is left in the old folders moved into Kryakl's: the engine and the model's server stopped first, Kryakl started again after. */
  | { type: 'moveToKryakl' }
  // The dictation badge.
  | { type: 'dictationReady' }
  /** A phrase to type: the whole recording, as webm (an engine without sessions). */
  | { type: 'dictationAudio'; mode: DictationMode; audio: Uint8Array }
  /** A phrase to type, recognized while it was spoken: its text, the language the engine heard ("" when it does not say) and how sure it is. */
  | { type: 'dictationText'; mode: DictationMode; text: string; language: string; sure: number }
  /** A note was recorded into the engine as this transcript. */
  | { type: 'dictationNote'; id: string }
  /** The badge's content is this tall, in CSS pixels; the window follows, its bottom edge kept. */
  | { type: 'dictationHeight'; px: number }
  /** The person folded the badge away for this phrase; `fly`: into the tray, or at once where motion is reduced. */
  | { type: 'dictationTuck'; fly: boolean }
  | { type: 'dictationCancelled' }
  | { type: 'dictationFailed'; message: string }

/** Calls a page makes and waits for (ipcMain.handle), through `window.tutorHost.call`. */
export type HostCall =
  /** One call to the speech engine's HTTP API. */
  | { call: 'speech'; method: string; route: string; body?: unknown }
  | { call: 'pickFolder'; title: string; current: string }
  /** Save a transcript: a Save dialog, then the engine writes the file. */
  | { call: 'exportTranscript'; id: string; format: string; name: string }
  | { call: 'copy'; text: string }
  /** Open a page of Chrome's own (the extensions, their keys, one extension's card), which a link cannot: answers chrome.ts `ChromeOpened` (typed, opened, missing, refused). */
  | { call: 'openChrome'; url: string }
  /** The programs with a window open now, by .exe name, for the Programs page: answers string[]. */
  | { call: 'runningApps' }

/** What every page has as `window.tutorHost` (preload.ts). */
export type TutorHost = {
  post(message: ToHost): void
  call(request: HostCall): Promise<unknown>
  /** A dropped or picked file's path on disk. */
  pathOf(file: File): string
}
