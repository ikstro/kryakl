## What's new in 0.18.0

**Meetings in Chrome (new).** On Google Meet, Microsoft Teams, Zoom, Jitsi and Whereby in the browser, Kryakl now offers to record once a call starts: a small plate in the page, and its icon on Chrome's bar lights up. Press Alt+Shift+M or click the icon, and the recording goes into Recordings as before. It stops by itself 15 seconds after you leave the call. Chrome allows no recording without a press, so nothing ever records by itself. The offers can be turned off in the extension's window.

**The meeting recorder no longer gets lost.** The Chrome extension now lives in Kryakl's own folder, which updates do not move, and takes new versions by itself, never during a recording. The Meetings in Chrome page reads your Chrome profiles and says for each one what is left to do: turn Developer mode on, remove an old copy, set the key.

**Kryakl at rest leaves the processor alone.** After the first dictated phrase, the hidden dictation panel went on drawing its waiting mark, and Kryakl took about a tenth of one processor core until it was quit. A window out of sight now draws nothing. Kryakl also checks itself once a minute and writes to its log when it takes the processor with nothing to do.

**Dictation.** The last moment of a phrase is no longer cut off. Phrases end with a full stop or a question mark again when you have Names and terms. Long dictation on the graphics card misses fewer words. Ordinary words are no longer turned into a name from your list that sounds alike.

**The switch key.** A layout key on a modifier tapped alone (Left Ctrl, a double Shift) could stop working until Kryakl was restarted, after a number-pad key and Shift were pressed together. It now recovers by itself.

**Known issues.** Long English dictation can still drop a sentence. The offer to record a meeting is new and not every service has been tried in a real call yet, Teams, Zoom and Whereby least of all. If something breaks, use Report a problem in Kryakl.

## Install and update

**Install:** download `Kryakl-Setup-<version>.exe` and run it. The installer is not signed, so Windows warns: **More info → Run anyway**. Kryakl starts with Windows and lives in the tray.

**Update:** Kryakl does not update itself. Download the new installer from here and run it: it installs over the old version, and your settings, words and downloads stay.

**Updating with Chrome's meeting recorder:** once, load the extension from Kryakl's own folder. Open Recordings › Meetings in Chrome in Kryakl: it shows the steps for each Chrome profile, with a button that opens the right Chrome page. After that the extension updates itself.

**Krya is now Kryakl (0.15):** install over Krya as usual. At its first start Kryakl moves Krya's settings, words, models and transcripts into its own folders; nothing downloads again. Quit Krya first if it still runs.
