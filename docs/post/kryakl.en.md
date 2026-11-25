There are a couple of services on my computer that I pay for and that don't work the way I want.

The first is Everylang, an all-in-one tool in the spirit of Punto Switcher.
The second is WhisperTyping, a dictation app.

For a long time I wanted to put all of this into one program and, along the way, improve my English. Languages are very hard for me.

And of course I didn't want to pay for subscriptions.

Also, under my desk there is an old but still decent PC with an i9 and an RTX 2080. In practice I use about 20% of its power.

So, with the help of Claude and GLM, I put together this thing.

Kryakl (')> — local AI for Windows 10 and 11

A small app (about 12 GB with its models :)))) in the tray, instead of four things: a layout switcher, a translator tab, a grammar checker and a screenshot tool. Everything runs on your computer until you connect the cloud Groq yourself. No subscription, no Kryakl account.

What it does

⌨️ Keyboard layout. Basically Punto Switcher: it fixes text typed in the wrong keyboard layout.

🎙 Dictation. A plain dictation app on a hotkey. Start it, speak, and the text is already typed. You can speak your own language and get the text in English.

🧑‍💻 Audio transcripts. I wanted transcripts of my Google Meet calls, so Kryakl has a separate plugin for Chrome. Start it during a call, and it turns everything you said into text. With the extra "Who spoke when" model, it also tells who said what. That model needs a free Hugging Face account, once.

🌍 Translation. Select text, press a hotkey, and the translation appears next to it. Press Paste, and it replaces the original. You can also translate text from any screenshot. 32 languages.

📸 Screenshots and screen recording. Press a hotkey and choose what to capture: a window, the whole screen or a region. On the screenshot you can draw a rectangle around something, blur what nobody should see, add a label or recognise the text. From the same window you can start a screen recording with sound from the microphone or from the system.

✍️ Check my English. Write in your broken English, and the duck shows where you got it wrong.

🎧 Read aloud. This was my main wish. I just wanted to copy a text, hear Kryakl read it, and learn to understand spoken English. Press Ctrl+C twice, and Kryakl reads the English text aloud and shows the translation under it. Click a word to see its meaning and pronunciation. Press the star to save the word for Anki.

🦆 Talk to the duck. I try to practise English with ChatGPT, but I miss one thing: my mistakes underlined right during the conversation. Here you speak, the duck answers aloud, and your mistakes are highlighted in the text. You can choose level A2, B1 or B2.

Gemma 4, Whisper and Parakeet run on your graphics card or processor. Open source (MIT). Free.

A gaming PC is best. On a laptop with an i7 and a GTX 1660 Ti, everything runs on medium settings. For the most accurate settings, of course, you want a graphics card with 9 GB of memory or more. No such PC? Connect the cloud Groq with your own key, and dictation, translation, Check my English and Talk fly on any laptop. Groq's free plan is enough for a working day.

🎙 Along the way, I tuned dictation. It now makes 6–9% fewer mistakes. I dictated the Ukrainian original of this post and fixed nothing. So it more or less works :)

ikstro.com/kryakl
