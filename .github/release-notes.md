## What's new in 0.17.1

**A window for your screenshots (new).** Press Ctrl+E on the frame's bar: the screenshot goes to the Screenshots window and the frame closes, so you can take the next one at once. Collect up to 50, then pick the ones you need: draw on them, copy, save, or drag them into another program. Kryakl asks before it closes with any you have not saved or copied.

**A precise frame.** A magnifier by the pointer shows each pixel. The arrow keys move the frame or a shape by one pixel (ten with Shift). Shift draws squares and keeps lines at 45°.

**The pointer in the picture (off by default).** A button on the bar puts the mouse pointer into the screenshot.

**More can be taken.** The taskbar, open menus, tooltips, the tray menu and Kryakl's own card are now in the picture, and a click takes just them. Press Print Screen again while the frame is open to take a picture of the frame itself. In Chrome and other programs that show a web page, a click takes the page alone, and the mouse wheel the whole window.

**The frame.** Its line is dashed and moves while you choose, and turns solid once the frame is fixed. A camera sound plays when the frame is fixed; a switch on the Screenshots page turns it off.

**Dictated phrases.** The page shows every phrase Kryakl keeps (up to 200, for 30 days), with a search. The tray menu shows the last three: a click copies one.

**Dictation hears more words.** The microphone now goes to recognition as it is. In our tests the browser's noise and echo handling made recognition lose words. The wave in the dictation panel now shows a quiet voice too.

**Sharing the graphics card.** When other programs leave too little room on the card for a speech model, Kryakl uses a lighter model on the card before it moves to the processor, and the transcript says so, with Transcribe again. Kryakl's own speech model now frees the card for Accurate translation, instead of Kryakl calling the card busy.

**Fixes.** Letters like g, y and p are no longer cut in the window's left menu. The speech engine no longer gets stuck at "starting" when another program uses its port.

## Install and update

**Install:** download `Kryakl-Setup-<version>.exe` and run it. The installer is not signed, so Windows warns: **More info → Run anyway**. Kryakl starts with Windows and lives in the tray.

**Update:** Kryakl does not update itself. Download the new installer from here and run it: it installs over the old version, and your settings, words and downloads stay.

**Krya is now Kryakl (0.15):** install over Krya as usual. At its first start Kryakl moves Krya's settings, words, models and transcripts into its own folders; nothing downloads again. Quit Krya first if it still runs. 0.15.1 fixes 0.15.0, whose speech engine did not start after the move (dictation said "The speech engine is starting" at every press): it sets itself right at the first start, and nothing downloads again.

**Updating from 0.11.0 or earlier, with Chrome's meeting recorder:** the extension now has a fixed id, and Kryakl takes recordings only from it. Once: on `chrome://extensions` press **Remove** on the meeting recorder, then **Load unpacked** from Kryakl's folder again (the Google Meet page in Kryakl shows the steps).
