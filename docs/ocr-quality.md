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
