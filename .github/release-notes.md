## What's new in 0.17.0

**Screenshots (new).** Give it a key, Print Screen if you like, and the screen freezes. Draw right on it: a frame, an oval, an arrow, a line, a pencil, a marker, a label, a number, a blur or pixels. Each tool has one letter, and the one you used last is in hand next time. Ctrl+C copies the picture with your drawings, Text reads its words to copy or translate, Save writes a PNG. A blur replaces what was under it, so it cannot be read back. Kryakl asks once before it takes Print Screen, and never changes Windows' own setting.

**Screen recording (new).** The same frame has a Video switch. Record a window, a monitor or a piece of the screen, with your microphone, the system's sound or both, into an MP4 in Videos\Kryakl. Nothing to download. Pick the microphone by the arrow beside it. After Stop, a strip gives Open, Folder, Delete and Copy.

**Clicks and zoom in a video (new, off by default).** Rings show your clicks, and the video moves in where you click or press a key of your own, following the pointer. Both go straight into the file.

**Panels inside a window.** In programs with real panels, such as Total Commander, the frame lights one panel and a click takes it; the wheel goes wider. Programs drawn by a web engine (VS Code, Chrome) have none, so a click takes the window.

**Text from the screen.** Ctrl+Alt+S and Ctrl+Alt+T now open Kryakl's own frame. Over a full-screen game they still open Windows' snipping tool.

**Smaller things.** The layout switch now asks the field you type in as well as the window.

Screenshots and recording are new, and not every setup has been tried yet: several monitors with different scaling, sleep, a full disk. If something breaks, use Report a problem in Kryakl.

## Install and update

**Install:** download `Kryakl-Setup-<version>.exe` and run it. The installer is not signed, so Windows warns: **More info → Run anyway**. Kryakl starts with Windows and lives in the tray.

**Update:** Kryakl does not update itself. Download the new installer from here and run it: it installs over the old version, and your settings, words and downloads stay.

**Krya is now Kryakl (0.15):** install over Krya as usual. At its first start Kryakl moves Krya's settings, words, models and transcripts into its own folders; nothing downloads again. Quit Krya first if it still runs. 0.15.1 fixes 0.15.0, whose speech engine did not start after the move (dictation said "The speech engine is starting" at every press): it sets itself right at the first start, and nothing downloads again.

**Updating from 0.11.0 or earlier, with Chrome's meeting recorder:** the extension now has a fixed id, and Kryakl takes recordings only from it. Once: on `chrome://extensions` press **Remove** on the meeting recorder, then **Load unpacked** from Kryakl's folder again (the Google Meet page in Kryakl shows the steps).
