## What's new in 0.17.3

**Saving a screenshot.** Save on the frame's bar now opens Windows' usual Save As window once the frame is gone: type a name and pick a folder. Before, a folder picker opened over the frame, and the whole computer seemed stuck. Save As starts in the folder set on the Screenshots page, Pictures\Kryakl by default. In the Screenshots window, one screenshot is saved the same way, and several go into a folder you pick.

**Dictation and translation share the graphics card.** After a translation with Accurate, dictated phrases no longer move to the processor and take 12–14 seconds. When the card has too little room for the speech model, Kryakl lets go of the resting translation model first. The next translation loads it again, and Fast's translation shows meanwhile. Accurate is no longer called busy on a free graphics card.

**The fix key on selected text.** After the fix key changes the layout of selected text, nothing stays selected, and the cursor is at the end of the text. Press the key again right away to go on to the next layout.

## Install and update

**Install:** download `Kryakl-Setup-<version>.exe` and run it. The installer is not signed, so Windows warns: **More info → Run anyway**. Kryakl starts with Windows and lives in the tray.

**Update:** Kryakl does not update itself. Download the new installer from here and run it: it installs over the old version, and your settings, words and downloads stay.

**Krya is now Kryakl (0.15):** install over Krya as usual. At its first start Kryakl moves Krya's settings, words, models and transcripts into its own folders; nothing downloads again. Quit Krya first if it still runs. 0.15.1 fixes 0.15.0, whose speech engine did not start after the move (dictation said "The speech engine is starting" at every press): it sets itself right at the first start, and nothing downloads again.

**Updating from 0.11.0 or earlier, with Chrome's meeting recorder:** the extension now has a fixed id, and Kryakl takes recordings only from it. Once: on `chrome://extensions` press **Remove** on the meeting recorder, then **Load unpacked** from Kryakl's folder again (the Google Meet page in Kryakl shows the steps).
