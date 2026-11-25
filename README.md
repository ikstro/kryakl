# Kryakl

*Talk to the duck.* (Formerly Altype and 2Talker.) Website: [ikstro.com/kryakl](https://ikstro.com/kryakl/), where you can try it in the browser.

Select any text, press your key, and hear it in English. A small Windows app for people learning English: it translates what you picked, reads the English aloud, and shows the translation under it; or, with another key, just translates it, like DeepL. Everything runs on your computer: nothing you read leaves it. Or, if you choose, the heavy models run on Groq's servers with your own Groq key, free on Groq's free plan: quick on any laptop, with nothing to download ([below](#models-by-your-own-key-groq)).

![A card with an English text on top, its translation under it, and a word's meanings](docs/card.png)

- **Any text.** Select it in any program and press the key you gave it, **Ctrl+C twice** if you like. A card opens by the pointer: the English on top, read aloud at once, your language under it. An English text shows up before its translation is in; a text in your language is translated into English first.
- **A piece of the screen.** Press **Ctrl+Alt+S** and draw a box over the words: a picture, a video with subtitles, a game. Kryakl reads the text with the OCR built into Windows.
- **Translate.** A key of your own (Shift twice, say) for the selection, **Ctrl+Alt+T** for a piece of the screen: the text as it is and its translation, from the language it is in into yours, from yours into English. **Paste** (Enter; Shift+Enter is a new line) puts the translation over the selected text; change either language, swap them, copy either side. Your clipboard is left as it was.
- **Keyboard layout** (off at first, in Settings). A key that switches the layout (a tap of Left Ctrl, Caps Lock, any key); a fix key (Pause) that types again, in the right layout, what you just typed in the wrong one, or the selected text; words typed in the wrong layout fixed as you type, for English, Russian and Ukrainian; a badge with the layout by the cursor.
- **Voice typing** (a download, when you want it). Say a phrase and Kryakl types it where the cursor is, on your computer. Text editing, off at first, puts it right by the local model before it is typed: remove filler words, a business tone, a clear request for an AI, a list, or an instruction of your own.
- **Screenshots.** Give it a key, Print Screen if you like. The screen freezes and you draw on it: a frame, an arrow, a number, a blur that cannot be read back. Ctrl+C copies the picture with your drawings. Text reads the words in it, to copy or translate.
- **Screen recording.** The same frame, switched to Video: a window, a monitor or a piece of the screen, with your microphone, the system's sound or both, into an MP4 in `Videos\Kryakl`. Nothing to download. Clicks and a zoom that follows them can go into the video; both are off at first.
- **Words.** Click an English word for its meanings, how it is said, and a star that keeps it in your word list. A dotted line marks the words outside the 3000 most common ones. Export the list for Anki.
- **Voice.** A natural English voice (Kokoro, 170 MB, offline) or a Windows voice, at the speed you choose, with the spoken word highlighted.

## Install

Download `Kryakl-Setup-<version>.exe` from the [releases](https://github.com/ikstro/kryakl/releases) and run it. The installer is not signed (Kryakl is a free app), so Windows warns once: **More info → Run anyway**. Kryakl starts with Windows and lives in the tray. It installs over Altype and 2Talker and takes their words, settings and downloads along.

**New versions.** Kryakl does not update itself: download the new installer from the [releases](https://github.com/ikstro/kryakl/releases) and run it. It installs over the version you have; your settings, words and downloads stay. Once a day Kryakl asks GitHub for the newest version's number and tells you when one is out (in the tray, on Home and in About); nothing about you is sent, and a switch in About turns it off.

The first translation downloads the translator for your language (about 85 MB for Russian ↔ English), once.

## Use

| | |
|---|---|
| **Ctrl+C, Ctrl+C** | listen to the selected text |
| your keys | listen to, or translate, the selection (set them in the settings: a combination, Ctrl or Shift twice, Pause, a mouse side button…) |
| **Ctrl+Alt+S** | listen to a piece of the screen (changeable in the settings) |
| **Ctrl+Alt+T** | translate a piece of the screen |
| your screenshot key | freeze the screen, draw, **Ctrl+C** to copy (Print Screen if you agree to it) |
| your recording key | record the screen; the same key stops it |
| your switch key | the next keyboard layout (set it in Settings → Hotkeys) |
| your fix key | what you just typed, or the selection, in the next layout |
| your fix key right after a fix | take the fix back; the word is kept as typed. Backspace only erases, so you can set the ending right |
| **Esc** | close the card and stop the voice |
| **Space** · **←** **→** | play or stop · the previous or next sentence |
| One by one | Listen reads one sentence and waits |
| ▶ in the margin | read one paragraph |
| click a word | its meanings · say it · save it |
| click a sentence | mark its translation |
| drag an edge | make the card wider or taller; it keeps the size |
| **RU** (your language's code) | hide or show the translation |
| pin | keep the card open when another window is clicked |

A click on the tray icon opens the window, a right click Windows' own menu: the actions, then Keyboard layout (its switches), Your words, Dictated phrases and, while anything goes to Groq, the day's use of Groq. The window has Home with Kryakl's state and your keys, then Translate, English, Voice typing, Recordings and meetings, Keyboard layout, Settings, Models, Disk space and About. One key can also open Kryakl's menu by the cursor, where a letter picks the action (Settings › Keys).

From a launcher or a mouse button: `Kryakl.exe --clipboard` listens to the copied text and `--translate` translates it; `--snip` snips to listen, `--text` to translate.

The keyboard helper looks only at the keys of what you are typing, since your last click; it keeps nothing and sends nothing anywhere. Turn off another layout switcher (EveryLang, Punto Switcher) while it runs, or words get fixed twice.

## Report a problem

Right-click the tray icon and pick **Report a problem…** (or open Kryakl › Report a problem), write what happened, then pick **Email** or **GitHub issue**. Kryakl saves `Kryakl report <date>.zip` in `Documents\Kryakl\Reports`, shows it in File Explorer and opens the message with your text in it: attach the zip and send it. Kryakl sends nothing by itself.

The zip holds Kryakl's logs (Kryakl's own, the speech engine's, the translation model's), the processor, memory, graphics card and versions, and your settings with your own lists only counted. It never holds your texts, words, mistakes, translations, dictated phrases, transcripts, your Groq key or your Hugging Face key; your Windows name and the computer's name are replaced. Open it before sending if you like: it is plain text.

One exception, and only when you ask for it: when dictation types something wrong, turn on **Record dictation for the report** on that page and dictate again. Kryakl then keeps the next phrases (20 at most, for a day at most) with their sound, lists them on the page so you can hear each one and remove any, and puts the ones left into the zip.

## Models by your own key: Groq

You choose where the models run: on this computer (up to 12 GB to download, quick with a graphics card of 4 GB or more), or on [Groq](https://groq.com)'s servers with a key of your own (quick on any computer, but it needs the internet). The first run asks; **Models › Groq** (the key, a switch per part, the day's use) and each choice on the **Models** page change it later, one action at a time:

- **Voice typing** by Groq's Whisper large-v3, about a second a phrase;
- **Recordings and meetings** by Groq's Whisper turbo; who spoke when stays on your computer;
- **Accurate translation, Check my English, Talk and text editing** by Groq's language models. Fast translation, the voice and notes stay on your computer;
- **Text from screenshots** by Groq's vision model, a switch of its own, as a screenshot may show anything: it reads dark code and small or Ukrainian text far better than Windows (2 words wrong in a hundred against 30). Without a connection Windows reads it.

Getting a key: open [console.groq.com/keys](https://console.groq.com/keys), sign in (no card is asked for), press **Create API Key**, name it **Kryakl**, copy it and paste it into Kryakl. Groq has a free plan, and it is enough for a working day: 8 hours of speech a day on each speech model, and a thousand requests a day on each language model; Models › Groq and the tray menu show the day's use. While no card is linked to your Groq account, nothing is charged: past the limit Groq only pauses until it lifts, and Kryakl uses this computer's models meanwhile. If you move to a paid Groq plan, Groq bills what you use.

What leaves your computer: the sound of your phrases and recordings, and the texts you translate, check or say to the duck, only for the actions you turn on. Groq does not train on them and by default does not keep them ([its privacy policy](https://groq.com/privacy-policy)). A cloud icon marks everything Groq did. With no connection, or once the free day is spent, Kryakl uses the model on your computer if it is downloaded, and translation falls back to Fast.

The key is encrypted by Windows for your account and stays on this computer; Kryakl shows only its last four letters and never puts it into a log, a problem report or a backup. A program running under your own Windows account could still read it, as it could your browser's saved passwords: make a key just for Kryakl, and delete it on Groq's site if in doubt. On the free plan no card is linked, so a stolen key cannot cost money.

**Meetings with names.** On Google Meet, the extension also notes who is speaking from Meet's captions (only the name and when, never the words) and turns the captions on for the call if they were off. The transcript then carries the real names, and the voice model is not needed.

## Who spoke when: the Hugging Face key

Telling speakers apart in a transcript uses pyannote's model, which Hugging Face hands out for free once you accept its terms. Kryakl asks for a key once, on the Who spoke when page (Recordings and meetings), and shows these steps there too:

1. Sign up at [huggingface.co/join](https://huggingface.co/join), free.
2. Open [the model's page](https://huggingface.co/pyannote/speaker-diarization-community-1) and fill in its form: Company or university, anything (your own name will do); Use case: **Meeting note taker**. Then **Agree and access repository**.
3. Open [Access Tokens](https://huggingface.co/settings/tokens) → **Create new token** → type **Read** → copy the `hf_…` key.
4. Paste it into Kryakl and press **Save**. The model downloads once; after that everything works offline, and the key is no longer needed. Kryakl keeps it encrypted, only on your computer, and never shows it again.

## Meetings in Chrome: the extension

Kryakl records calls in Chrome with its own extension, loaded by hand once (Recordings and meetings › Meetings in Chrome shows the same steps, with buttons):

1. Open `chrome://extensions` and turn on **Developer mode** at the top right. Chrome turns off hand-loaded extensions while it is off.
2. Press **Load unpacked** and pick `%LOCALAPPDATA%\Kryakl\chrome-extension`. Kryakl keeps its copy there: no update or reinstall touches that folder, and the extension takes a new version by itself.
3. Allow the microphone once, on the page Kryakl opens; without it only the others' voices are recorded.

On Google Meet, Microsoft Teams, Zoom, Jitsi and Whereby in Chrome, a plate in the page offers to record once the call connects: press **Alt+Shift+M** or the duck icon on Chrome's toolbar. The recording stops by itself about 15 s after you leave the call, at once when you close the tab, or when you press the icon or the key again. While Kryakl makes the transcript, the icon shows how far it is ("42%") and a ✓ when it is done; the extension's window says the same, and Kryakl shows a Windows notification once the transcript is ready (a click opens it). Any other tab: the icon › **Record**. The extension's own window has a switch to turn the offers off. Calls in desktop apps (Zoom, Teams, Telegram) are not recorded yet.

The page also reads Chrome's own files and says, per profile, what is wrong: Developer mode off, an old copy (its ID does not start with `phokhlmn`), the key held by another extension, a copy loaded from a folder that updates wipe.

## Languages

English is the language you learn. Your own language: one of 31 with a Firefox translator in both directions (Russian, Ukrainian, German, French, Spanish, Italian, Portuguese, Polish, Czech, Dutch, Swedish, Norwegian, Danish, Finnish, Greek, Turkish, Romanian, Hungarian, Bulgarian, Serbian, Croatian, Arabic, Hebrew, Persian, Hindi, Chinese, Japanese, Korean, Vietnamese, Thai, Indonesian). Word meanings: English → Russian ships inside; most others download on first use.

The translator is the one Firefox uses offline. It is good with whole sentences and weaker with very short ones out of context.

Text recognition reads the languages whose OCR is installed in Windows: Settings → Time & language → Language & region → the language → Language options → Optical character recognition.

## Build

```
npm install
npm test
npm run typecheck
npm start            # builds and runs from source
npm run dist         # release/Kryakl-Setup-<version>.exe
npm run icons        # build/icon.svg → build/icon.png, media/icon.png
npm run models       # refreshes src/mt-manifest.json and vendor/bergamot from Mozilla
node scripts/build-words.mjs  # refreshes media/layout/*.txt, the layout fixer's word lists
```

A tag `v<version>` builds the installer in GitHub Actions and publishes the release. See [CLAUDE.md](CLAUDE.md) for how it is put together.

## Author

Yevhen Peshynskyi, design automation engineer — [ikstro.com](https://ikstro.com). MIT License; third-party parts in [NOTICE](NOTICE).
