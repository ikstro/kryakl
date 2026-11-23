# Text from a screenshot: Windows' reader against PP-OCRv5

2026-11-12. The owner asked how to read text from the screen better. This compares the reader Kryakl uses now (Windows.Media.Ocr, the Russian and English engines this computer has, each line picked by `ocrpick.ts`) with PP-OCRv5 mobile (Baidu's open models, Apache 2.0, run by onnxruntime-node on the processor), on pictures whose text is known.

How: `scripts/ocr-bench.ts` (run with Electron, see its head). Seven pictures drawn offscreen at 100 % (no ClearType): the 30 lines of `.cache/speech-quality/own/script.txt` in a VS Code-like editor, dark and light at 14 px, dark at 12 px; Ukrainian prose light (15 px) and dark (13 px); English prose (Georgia 16 px); a settings list mixing Russian and English (13 px, dark). And one real screenshot: the owner's VS Code with the same file (dark, ClearType), its text written by hand. Every reader's lines go through `screenText`. Scores: characters and words wrong (edit distance, spaces collapsed) and the share of lines read exactly. i9-9900K, processor only, models already loaded.

## Results

| Picture | Windows now: chars / words wrong, lines right | PP-OCRv5 East Slavic + script fix | seconds, Windows / PP |
|---|---|---|---|
| editor dark 14 px | 0.6 % / 3.4 %, 63 % | 0.3 % / 0.6 %, 93 % | 1.0 / 1.2 |
| editor light 14 px | 0.1 % / 0.9 %, 90 % | 0.2 % / 0.9 %, 90 % | 1.1 / 1.1 |
| editor dark 12 px | 2.3 % / 5.0 %, 47 % | 0.6 % / 1.1 %, 87 % | 0.8 / 0.7 |
| Ukrainian prose light | 30.5 % / 43.3 %, 0 % | 0.5 % / 3.3 %, 67 % | 0.7 / 0.2 |
| Ukrainian prose dark 13 px | 33.5 % / 43.3 %, 0 % | 0.5 % / 3.3 %, 67 % | 0.6 / 0.2 |
| English prose | 0.3 % / 1.6 %, 80 % | 0.3 % / 1.6 %, 80 % | 0.6 / 0.2 |
| settings, Russian and English | 12.5 % / 28.9 %, 17 % | 1.0 % / 10.5 %, 83 % | 0.6 / 0.1 |
| **real: the owner's VS Code** | 1.1 % / 5.8 %, 45 % | 0.7 % / 1.9 %, 85 % | 1.0 / 1.2 |

On the real screenshot Windows got 18 of 33 lines wrong, PP-OCRv5 3: Windows' Russian engine drops the capital letter of a line's start ("встреча", "давай", "купи": 14 lines), writes "C1aude", "REAYE", "1." as "4."; PP-OCRv5 read a light bulb icon as "8" and "README" with Cyrillic letters (now set right by the script fix).

## What was tried and dropped

- **A dark picture turned light** before Windows reads it: no better, a little worse (dark editor 0.8 % against 0.6 %).
- **PP-OCRv5's English reader beside the East Slavic one, the better line taken**: worse (a line of Russian with one English word is "better" in neither). **Word by word** (`mergeLine`): better words, but it once swapped a whole Russian stretch for English nonsense ("o, noxay, o pull requet").
- What works instead is `ocrpick.ts fixScripts`: a word written in two scripts, or in Cyrillic look-alikes between English words, put into one script letter by letter, a spelling in the word lists winning ("риll rеqиеst" → "pull request", "Fідта" → "Figma", "yвiмкни" → "увімкни"). On Windows' output it changes nothing (Windows already picks lines across its engines).

## Why Windows fails on Ukrainian here

This computer has Windows' Russian and English text recognition only; a Ukrainian text is read by the Russian engine, which drops і, ї, є and whole words ("Модель на працюЕ ШВИДШе"). PP-OCRv5's East Slavic model reads Russian, Ukrainian, Belarusian, Bulgarian and English in one.

## What adopting it would take

- Download 12.7 MB once (detector 4.8 MB, East Slavic reader 7.9 MB), pinned by size and SHA-256 like the other models; onnxruntime-node is in Kryakl already (the natural voice). Other languages: a Latin reader (7.9 MB) for German, French, Polish…; Greek and Arabic have their own; Hebrew, Georgian, Armenian have none, so Windows stays for them.
- Not measured yet: the models' first load, a 4K screenshot, ClearType at 125–150 %, two columns, a table.

Models: `PaddlePaddle/PP-OCRv5_mobile_det_onnx` (sha256 a431985659dc…), `monkt/paddleocr-onnx` `languages/{eslav,english,latin}` at commit 7b02d0a.

## 2026-11-23: Groq vision against Windows

Question: does Groq's vision model (the owner's own free key) read a screenshot's text better than Windows' reader as Kryakl uses it (`recognize`, then `pickLines`, then `screenText`; Russian, Ukrainian, English engines)? Groq's model list holds one model that sees images: `qwen/qwen3.8-27b` (no Llama 4 vision on the free plan), asked at temperature 0, thinking off, "transcribe all text line by line, do not translate or fix".

How: `scripts/ocr-groq-bench.ts` (Electron) draws 8 pictures with known text into `.cache/ocr-quality/groq/` (out of git) and reads them with Windows; Groq's answers come from the Groq script of the session; `scripts/ocr-groq-score.mjs` scores both (characters and words wrong by edit distance with spaces collapsed, lines read exactly). Pictures: a dark editor with 30 numbered lines at 100 % and at 150 %; English, Russian and Ukrainian prose (15 px; Ukrainian with ї є ґ and ’); a dark UI list in Latin and Cyrillic at 11 px; a table of 4 columns; a dark chat in English and Russian. All drawn offscreen without ClearType, so real screenshots may differ.

| Picture | Windows: chars / words wrong, lines right | Groq qwen3.8-27b | seconds, Windows / Groq |
|---|---|---|---|
| editor dark 100 % | 9.4 % / 35.1 %, 10/30 | 0.0 % / 0.0 %, 30/30 | 0.97 / 1.57 |
| editor dark 150 % | 10.4 % / 41.2 %, 9/30 | 0.0 % / 0.0 %, 30/30 | 1.30 / 1.07 |
| English prose | 0.2 % / 1.2 %, 5/6 | 0.0 % / 0.0 %, 6/6 | 0.73 / 0.74 |
| Russian prose | 0.7 % / 6.1 %, 4/6 | 0.0 % / 0.0 %, 6/6 | 0.82 / 0.90 |
| Ukrainian prose | 28.8 % / 48.4 %, 0/6 | 1.9 % / 12.5 %, 2/6 | 0.90 / 0.97 |
| UI, mixed, 11 px | 19.9 % / 35.3 %, 0/8 | 0.7 % / 3.9 %, 7/8 | 0.98 / 0.99 |
| table, 4 columns | 17.0 % / 38.9 %, 2/6 | 9.3 % / 0.0 %, 0/6 (one cell a line) | 0.94 / 0.77 |
| chat, English and Russian | 8.2 % / 27.9 %, 6/12 | 0.0 % / 0.0 %, 12/12 | 0.86 / 1.01 |
| **all 8** | **10.8 % / 30.3 %, 36/104** | **0.7 % / 1.6 %, 93/104** | 0.94 / 1.00 |

Where each loses. Windows: Light-on-dark text (the editor, the chat, the UI list: "1astTupns", "Ctrt+C", "Pacxnaaxa", "Gemma 4 ИВ"), small text, the Ukrainian letters (`і ї є ґ` read as "i", "1", "€", "Ј"; a line wholly lost), arrows and the Cyrillic of a mixed UI, and the table's Cyrillic cells ("E "AeoGPTa"). It drops nothing at 100 % but invents characters. Groq: the typographic apostrophe ’ came back as ' (4 places), two Ukrainian letters or words slipped ("іжак" for "їжак", "подивимосся", "голос" for "вголос"), "·" came back as "-" once, and the table was one cell a line, so its row structure is gone (the words are all right). It added nothing and skipped nothing; indents of code kept, blank lines kept, no hallucinated lines, no markdown fences.

Limits found (free plan, `qwen/qwen3.8-27b`): 7000 input tokens a minute, and a picture of this size costs about 1500-2100, so 3 pictures a minute, a fourth is refused (429, "Used 6429, Requested 2117"); 1000 output tokens a minute, so a full editor page (a request asking for 4000 tokens of room was refused once as "too large"; 800 passed). A real 4K screenshot would cost far more input tokens than these. The speech days' limits are separate. 15 requests were used (8 of them refused by the minute's limit, 1 by the output limit).

Verdict: on pictures drawn with no ClearType Groq reads the text almost exactly where Windows loses a third of its words, and it wins hardest on light-on-dark text, small text and Ukrainian; it is no slower (about 1 s). It loses the table's rows, the ’ and a few Ukrainian letters, and sends the picture to Groq (a fourth exception to "offline", the person's own key), with 3 pictures a minute on the free plan. So it is a better Text for the Screenshots button and the Translate card where the person turned Groq on; Windows stays the default and the fallback (Groq's limit, no network). Not measured: real screenshots with ClearType, a 4K one, long pages (the output limit), photographs, a language Windows has an engine for and the model does not.
