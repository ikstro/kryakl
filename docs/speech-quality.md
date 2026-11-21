# Dictation quality

What each speech model gets right when Kryakl dictates, measured by `engine/quality` (`npm run quality:speech -- --help`).

**The phrases**: FLEURS read speech (Google, CC BY 4.0), the test split, the first 40 phrases of each language that are 3–20 s long and have no digits: Russian, Ukrainian, English. The person dictating is one whose own language is the phrase's (an English phrase: a Russian speaker's), so dictation expects that language and English, strictly, as Kryakl sends it.

**Where the microphone is** (`engine/quality/conditions.py`; 0.5 s before the speech and 0.7 s after it, as a key press leaves; a noise floor at −70 dBFS):

- clean: the phrase as read
- fan: low, steady noise 10 dB under the voice (a fan, a laptop's cooler)
- babble: four other people talking, 5 dB under the voice
- far: a room's echo (0.6 s), 25 dB quieter (a laptop's microphone across the table)
- quiet: 30 dB quieter (a microphone set low; dictation has no gain control since 2026-11-10)

**The numbers**: word errors in percent (substitutions, deletions and insertions over the words said; lower case, no punctuation, ё as е, so only words count); "wrong lang": phrases that came out in another language (another script, or Ukrainian for Russian and back); seconds a phrase, as `/dictate` takes it, with the model loaded and warm. "cpu 8t": the processor with 8 threads (an i9-9900K); "card": an RTX 2080 SUPER, shared with Kryakl running. Raw results with the texts are in `.cache/speech-quality/runs/`, out of git.

Since 2026-11-14, new tables also show **case errors** (the first letter's case differs from the reference) and **end errors** (the final sentence mark differs, including missing punctuation, a question turned into a statement, or a fragment given a full stop). Closing quotes and brackets are ignored. These are counts of phrases, separate from WER; they do not measure punctuation or capitalization inside a phrase. The older tables below measured neither. Always include a nonempty vocabulary when testing dictation formatting: in faster-whisper, it is part of the previous-text prompt and can change the output's style.

## Vocabulary hint: a missing full stop (2026-11-14)

The installed app used Whisper turbo on CUDA with eight vocabulary entries and text editing off. The vocabulary was sent as a comma-separated list with no final mark. After the style sentence was removed on 2026-11-12, that list could be the only previous-text context. In the last 30 unedited type phrases inspected on 2026-11-14, 24 had no terminal mark. This is an observation of current use, not a before/after comparison.

**Controlled test:** the same model, audio, vocabulary and decode settings, changing only whether the vocabulary hint ends in a full stop. 56 clean cases: the owner's 27 Russian and 3 English clips, 8 cached FLEURS clips per language (ru, uk, en), and 2 three-sentence takes joined from the owner's Russian clips. Processing is local; no downloads, app settings or installed files were changed. Raw outputs remain outside git in `.cache/speech-quality/punctuation-ab.json`.

| Measurement | Unfinished vocabulary hint | Hint closed with a full stop |
| --- | --- | --- |
| Final sentence mark matches the reference | 31 / 56 | 56 / 56 |
| First letter uppercase (not a reference-based case score) | 53 / 56 | 55 / 56 |
| Owner's Russian clips with final marks | 9 / 27 | 27 / 27 |
| Owner's Russian clips starting uppercase | 25 / 27 | 27 / 27 |
| Questions kept as questions | 3 / 3 | 3 / 3 |
| Word errors, all cases | 4.70 % | 4.57 % |
| Word errors, ru / uk / en | 4.61 / 6.72 / 3.54 % | 4.39 / 6.72 / 3.54 % |
| Median recognition, warm model | 0.241 s | 0.241 s |

Also compared on those cases: separating every name with a full stop, a punctuation-only initial prompt, the previous style sentence, and no vocabulary. All restored final marks on this set; the old style sentence had more word errors (5.08 %). The chosen change only closes the existing hint: it retains names and adds no example words that a recognizer might reproduce. `Transcriber.dictate` applies it to **large-v3-turbo only**, before both recognition paths; it never appends punctuation to the result, alters the actual previous dictated text, enables text editing, or changes Parakeet. Unit tests cover questions and fragments returned unchanged, empty hints and the fallback path. A subsequent six-model sweep found word regressions for tiny/base, so this is not a global Whisper setting; see [the wider research](dictation-research-2026-11-14.md).

**Stream check:** 10 three-phrase takes from the owner's ru/en clips, through `stream.Session`, fed at 4× real time, with the same eight terms. Final-mark errors 4 → 0 of 10; initial-case errors 0 → 0. Word errors were 11 → 12 over 289 reference words (3.81 → 4.15 %), one additional error in `own-ru-18+3`, so this check does not establish a word-accuracy improvement. Feeding faster than real time also changes recognition/guess scheduling. Raw outputs: `.cache/speech-quality/punctuation-stream-ab.json`. All 249 engine tests passed, including the new hint and formatting regressions.

This test establishes the vocabulary interaction on these recordings; it does not establish perfect punctuation in arbitrary live speech, inside sentences, on every model or under all five noise conditions.

## What came of it (2026-11-11)

Kept: no style sentence in dictation, quiet sound raised, Parakeet's floor, lone murmurs cut (CLAUDE.md, "Since 2026-11-12: dictation quality"). Words wrong in a hundred, all five conditions, before → after:

| Model | read speech | the owner's reading | streamed dictation | wrong language (read) |
|---|---|---|---|---|
| Whisper turbo · card | 29.8 → 27.2 | 17.2 → 15.4 | 41.5 → 37.9 | 0 → 0 |
| Whisper large · card | 27.3 → 26.0 | — → 16.8 | | 1 → 0 |
| Whisper small · card | 42.7 → 40.2 | 31.6 → 29.6 | | 0 → 1 |
| Whisper small · cpu | 44.2 → 41.8 | 33.2 → 33.2 | | 0 → 1 |
| Parakeet · cpu | 43.6 → 42.2 | 33.8 → 34.6 | 42.9 → 43.7 | 55 → 5 |
| Whisper base · card | 61.0 → 57.5 | | | 5 → 6 |
| Whisper tiny · card | 71.8 → 69.4 | | | 13 → 4 |

Times: within the spread of runs. The processor's after-cpu run (2026-11-12 0708) came out slower everywhere (Parakeet 0.52 s a phrase, small 2.12) with the very words of combo-cpu, the same settings the day before (0.37, 1.87): another load on the computer, not the change. Parakeet's own reading and streamed numbers stayed level: its gain is the wrong language, its made-up English on faint speech gone.

## Runs

### baseline-card · 2026-11-11 1713 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper base · card | 59.9 | 72.8 | 52.1 | 29.2 | 34.4 | 69.7 | 92.8 | 79.1 | **61.0** | 5 / 600 | 0.28 | 0.39 |
| Whisper large · card | 22.3 | 25.0 | 34.0 | 6.3 | 6.5 | 20.9 | 57.3 | 45.8 | **27.3** | 1 / 600 | 0.77 | 1.26 |
| Whisper turbo · card | 26.1 | 26.5 | 35.9 | 6.5 | 7.7 | 24.8 | 62.2 | 47.7 | **29.8** | 0 / 600 | 0.30 | 0.43 |
| Whisper small · card | 39.7 | 47.9 | 41.0 | 15.2 | 17.0 | 42.2 | 78.4 | 60.5 | **42.7** | 0 / 600 | 0.32 | 0.52 |
| Whisper tiny · card | 69.8 | 84.6 | 62.9 | 46.8 | 48.6 | 83.5 | 93.6 | 86.5 | **71.8** | 13 / 600 | 0.28 | 0.84 |

### baseline-cpu · 2026-11-11 1752 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper base · cpu 8t | 60.8 | 74.2 | 53.2 | 31.4 | 36.0 | 72.2 | 90.8 | 80.2 | **62.1** | 8 / 600 | 0.86 | 2.22 |
| Parakeet · cpu 8t | 42.1 | 43.4 | 45.3 | 11.8 | 13.0 | 49.7 | 84.8 | 58.9 | **43.6** | 55 / 600 | 0.40 | 0.64 |
| Whisper small · cpu 8t | 41.1 | 48.8 | 43.1 | 16.0 | 18.3 | 45.5 | 79.8 | 61.4 | **44.2** | 0 / 600 | 1.67 | 2.09 |
| Whisper tiny · cpu 8t | 73.4 | 91.1 | 64.9 | 49.3 | 53.2 | 89.3 | 95.9 | 91.0 | **75.7** | 21 / 600 | 0.77 | 2.44 |

### card-no-style · 2026-11-11 1800 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.STYLE_PROMPT': False}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 26.2 | 25.6 | 35.2 | 6.3 | 7.8 | 22.5 | 62.6 | 47.2 | **29.3** | 0 / 600 | 0.27 | 0.38 |
| Whisper small · card | 39.7 | 46.9 | 41.4 | 14.5 | 16.7 | 42.7 | 78.0 | 60.7 | **42.5** | 0 / 600 | 0.29 | 0.47 |

### card-ends-only · 2026-11-11 1806 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.INNER_SILENCE': False}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 25.8 | 26.6 | 35.2 | 6.5 | 7.7 | 23.7 | 61.7 | 47.7 | **29.5** | 0 / 600 | 0.28 | 0.39 |
| Whisper small · card | 39.8 | 48.2 | 41.4 | 15.0 | 17.2 | 43.3 | 78.4 | 60.8 | **42.9** | 0 / 600 | 0.29 | 0.45 |

### card-lift · 2026-11-11 1814 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'audio.LIFT_BELOW': -20}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 20.9 | 26.1 | 34.5 | 6.5 | 7.4 | 22.4 | 56.4 | 44.4 | **27.4** | 7 / 600 | 0.31 | 0.40 |
| Whisper small · card | 36.2 | 46.3 | 39.6 | 13.8 | 16.2 | 40.5 | 75.7 | 56.4 | **40.5** | 1 / 600 | 0.31 | 0.47 |

### card-beam1 · 2026-11-11 1820 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; beam 1

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 26.7 | 29.4 | 36.1 | 6.8 | 8.5 | 25.4 | 64.2 | 49.7 | **30.9** | 0 / 600 | 0.27 | 0.36 |
| Whisper small · card | 42.5 | 50.5 | 43.6 | 16.8 | 19.4 | 47.0 | 80.9 | 62.6 | **45.3** | 0 / 600 | 0.27 | 0.41 |

### cpu-lift · 2026-11-11 1842 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'audio.LIFT_BELOW': -20}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t | 37.1 | 41.4 | 43.4 | 10.1 | 12.5 | 47.4 | 82.3 | 51.0 | **40.7** | 32 / 600 | 0.33 | 0.52 |
| Whisper small · cpu 8t | 38.1 | 47.4 | 41.1 | 15.1 | 16.5 | 42.4 | 78.7 | 57.4 | **42.0** | 0 / 600 | 1.75 | 2.02 |

### cpu-ends-only · 2026-11-11 1904 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.INNER_SILENCE': False}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t | 41.9 | 43.2 | 45.2 | 11.8 | 13.0 | 49.0 | 84.8 | 58.7 | **43.5** | 53 / 600 | 0.33 | 0.52 |
| Whisper small · cpu 8t | 41.0 | 49.0 | 43.2 | 15.9 | 18.3 | 46.6 | 79.4 | 60.9 | **44.2** | 0 / 600 | 1.70 | 2.15 |

### cpu-no-style · 2026-11-11 1922 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.STYLE_PROMPT': False}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper small · cpu 8t | 40.7 | 48.2 | 43.0 | 16.1 | 17.4 | 45.0 | 79.0 | 61.7 | **43.8** | 0 / 600 | 1.79 | 2.26 |

### cpu-beam1 · 2026-11-11 1940 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; beam 1

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper small · cpu 8t | 43.4 | 50.8 | 44.0 | 17.4 | 19.3 | 47.8 | 81.0 | 63.9 | **45.9** | 0 / 600 | 1.73 | 2.07 |

### cpu-beam5 · 2026-11-11 1959 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; beam 5

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper small · cpu 8t | 39.8 | 47.6 | 42.4 | 15.6 | 16.9 | 44.5 | 78.1 | 60.5 | **43.1** | 0 / 600 | 1.83 | 2.58 |

### cpu-fp32 · 2026-11-11 2028 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.CPU_COMPUTE': 'float32'}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper small · cpu 8t | 40.5 | 49.2 | 42.7 | 15.5 | 18.5 | 44.3 | 79.7 | 61.8 | **44.0** | 1 / 600 | 2.83 | 3.93 |

### own-card · 2026-11-11 1917 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper large · card | 14.2 | 37.9 | 6.2 | 7.3 | 17.3 | 38.1 | 13.8 | **16.5** | 6 / 150 | 0.60 | 0.66 |
| Whisper turbo · card | 17.1 | 18.6 | 5.2 | 5.9 | 25.6 | 40.1 | 9.3 | **17.2** | 1 / 150 | 0.25 | 0.26 |
| Whisper small · card | 32.9 | 20.0 | 10.7 | 13.8 | 44.3 | 64.7 | 24.6 | **31.6** | 2 / 150 | 0.23 | 0.26 |

### parakeet-floor · 2026-11-11 2033 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.PARAKEET_FLOOR': -0.5}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t | 42.4 | 44.4 | 46.0 | 12.0 | 13.7 | 51.3 | 85.8 | 58.9 | **44.3** | 7 / 600 | 0.41 | 0.69 |

### combo-card · 2026-11-11 2041 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.STYLE_PROMPT': False, 'audio.LIFT_BELOW': -20}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 21.1 | 25.3 | 34.5 | 6.5 | 7.5 | 21.0 | 56.7 | 44.4 | **27.2** | 7 / 600 | 0.30 | 0.41 |
| Whisper small · card | 36.1 | 45.6 | 39.4 | 13.4 | 15.9 | 39.2 | 76.4 | 56.1 | **40.2** | 2 / 600 | 0.33 | 0.51 |

### combo-cpu · 2026-11-11 2105 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.STYLE_PROMPT': False, 'audio.LIFT_BELOW': -20, 'asr.PARAKEET_FLOOR': -0.5}

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t | 39.2 | 43.2 | 44.1 | 10.3 | 13.2 | 49.5 | 86.1 | 51.8 | **42.2** | 5 / 600 | 0.37 | 0.57 |
| Whisper small · cpu 8t | 38.0 | 47.5 | 40.6 | 14.0 | 16.2 | 42.4 | 78.6 | 58.0 | **41.8** | 1 / 600 | 1.87 | 2.20 |

### own-cpu · 2026-11-11 2110 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t | 35.3 | 20.7 | 9.7 | 10.4 | 54.0 | 76.1 | 19.0 | **33.8** | 12 / 150 | 0.25 | 0.31 |
| Whisper small · cpu 8t | 34.2 | 24.8 | 9.7 | 13.5 | 46.4 | 67.8 | 28.7 | **33.2** | 2 / 150 | 1.66 | 1.72 |

### own-combo-card · 2026-11-11 2111 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.STYLE_PROMPT': False, 'audio.LIFT_BELOW': -20}

| Model | ru | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 16.1 | 9.7 | 4.8 | 5.2 | 25.3 | 34.6 | 7.3 | **15.4** | 0 / 150 | 0.24 | 0.26 |
| Whisper small · card | 31.6 | 11.0 | 12.1 | 12.1 | 42.2 | 56.4 | 24.9 | **29.6** | 0 / 150 | 0.19 | 0.20 |

### own-combo-cpu · 2026-11-11 2117 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.STYLE_PROMPT': False, 'audio.LIFT_BELOW': -20, 'asr.PARAKEET_FLOOR': -0.5}

| Model | ru | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t | 35.9 | 22.8 | 9.7 | 10.4 | 54.0 | 79.2 | 19.7 | **34.6** | 0 / 150 | 0.26 | 0.34 |
| Whisper small · cpu 8t | 35.0 | 23.4 | 11.8 | 12.8 | 47.1 | 71.3 | 26.3 | **33.8** | 2 / 150 | 1.88 | 1.77 |

### own-terms-card · 2026-11-11 2118 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 15.9 | 9.7 | 4.8 | 4.8 | 23.2 | 34.9 | 8.7 | **15.3** | 0 / 150 | 0.24 | 0.25 |
| Whisper small · card | 29.5 | 20.0 | 7.3 | 10.0 | 39.8 | 63.0 | 22.8 | **28.6** | 2 / 150 | 0.19 | 0.21 |

### own-terms-combo-card · 2026-11-11 2120 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet; levers {'asr.STYLE_PROMPT': False, 'audio.LIFT_BELOW': -20}

| Model | ru | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 16.0 | 2.8 | 5.5 | 4.8 | 20.1 | 35.3 | 7.6 | **14.7** | 0 / 150 | 0.25 | 0.27 |
| Whisper small · card | 30.6 | 19.3 | 7.6 | 9.0 | 53.3 | 55.4 | 22.1 | **29.5** | 4 / 150 | 0.24 | 0.24 |

### stream-cpu · 2026-11-11 2133 · 675a047

stream, 8 phrases a language, clean, fan, far

| Model | ru | uk | en | clean | fan | far | all | wrong lang | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t · stream | 35.5 | 54.2 | 39.8 | 9.6 | 27.6 | 91.6 | **42.9** | 5 / 36 | 2.79 | 3.44 | 0.22 | 3.87 |

### stream-cpu-combo-whole · 2026-11-11 2147 · 675a047

stream, 8 phrases a language, clean, fan, far; levers {'asr.STYLE_PROMPT': False, 'audio.LIFT_BELOW': -20, 'asr.PARAKEET_FLOOR': -0.5, 'stream.WHOLE_AT_END': "{('parakeet', 'cpu'): 60.0}"}

| Model | ru | uk | en | clean | fan | far | all | wrong lang | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t · stream | 38.2 | 58.2 | 48.5 | 24.4 | 28.7 | 91.8 | **48.3** | 1 / 36 | 2.53 | 4.22 | 0.39 | 1.27 |

### stream-card · 2026-11-11 2200 · 675a047

stream, 8 phrases a language, clean, fan, far

| Model | ru | uk | en | clean | fan | far | all | wrong lang | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 28.2 | 48.0 | 46.9 | 21.6 | 26.9 | 75.9 | **41.5** | 0 / 36 | 2.40 | 3.48 | 0.02 | 0.13 |

### stream-card-combo-whole · 2026-11-11 2214 · 675a047

stream, 8 phrases a language, clean, fan, far; levers {'asr.STYLE_PROMPT': False, 'audio.LIFT_BELOW': -20, 'stream.WHOLE_AT_END': "{('whisper', 'cuda'): 28.0}"}

| Model | ru | uk | en | clean | fan | far | all | wrong lang | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 22.1 | 42.5 | 46.9 | 18.2 | 26.4 | 69.0 | **37.9** | 0 / 36 | 2.59 | 3.45 | 0.02 | 0.39 |

### after-stream-card · 2026-11-11 2233 · 675a047

stream, 8 phrases a language, clean, fan, far

| Model | ru | uk | en | clean | fan | far | all | wrong lang | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 22.1 | 42.5 | 46.9 | 18.2 | 26.4 | 69.0 | **37.9** | 0 / 36 | 2.58 | 3.55 | 0.01 | 0.04 |

### after-stream-card-whole · 2026-11-11 2246 · 675a047

stream, 8 phrases a language, clean, fan, far; levers {'stream.WHOLE_AT_END': "{('whisper', 'cuda'): 28.0}"}

| Model | ru | uk | en | clean | fan | far | all | wrong lang | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 22.1 | 42.5 | 46.9 | 18.2 | 26.4 | 69.0 | **37.9** | 0 / 36 | 2.60 | 3.37 | 0.01 | 0.06 |

### after-stream-cpu · 2026-11-11 2300 · 675a047

stream, 8 phrases a language, clean, fan, far

| Model | ru | uk | en | clean | fan | far | all | wrong lang | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t · stream | 37.5 | 54.0 | 40.4 | 10.0 | 29.2 | 91.8 | **43.7** | 1 / 36 | 2.04 | 3.02 | 0.00 | 0.02 |

### after-own-card · 2026-11-11 2302 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper large · card | 14.4 | 38.6 | 6.9 | 6.6 | 20.8 | 40.1 | 9.7 | **16.8** | 5 / 150 | 0.48 | 0.53 |
| Whisper turbo · card | 16.1 | 9.7 | 4.8 | 5.2 | 25.3 | 34.6 | 7.3 | **15.4** | 0 / 150 | 0.23 | 0.24 |
| Whisper small · card | 31.6 | 11.0 | 12.1 | 12.1 | 42.2 | 56.4 | 24.9 | **29.6** | 0 / 150 | 0.19 | 0.21 |

### after-own-cpu · 2026-11-11 2309 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Parakeet · cpu 8t | 35.9 | 22.8 | 9.7 | 10.4 | 54.0 | 79.2 | 19.7 | **34.6** | 0 / 150 | 0.27 | 0.34 |
| Whisper small · cpu 8t | 34.3 | 23.4 | 11.8 | 12.8 | 46.0 | 69.2 | 26.3 | **33.2** | 2 / 150 | 2.02 | 2.13 |

### after-card · 2026-11-11 2332 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper base · card | 56.9 | 68.6 | 48.8 | 26.0 | 31.0 | 65.9 | 91.9 | 72.7 | **57.5** | 6 / 600 | 0.29 | 0.39 |
| Whisper large · card | 19.9 | 23.5 | 33.7 | 5.8 | 6.2 | 20.2 | 54.1 | 43.7 | **26.0** | 0 / 600 | 0.82 | 1.26 |
| Whisper turbo · card | 21.1 | 25.3 | 34.5 | 6.5 | 7.5 | 21.0 | 56.7 | 44.4 | **27.2** | 0 / 600 | 0.31 | 0.42 |
| Whisper small · card | 36.0 | 45.6 | 39.4 | 13.4 | 15.9 | 39.1 | 76.3 | 56.1 | **40.2** | 1 / 600 | 0.34 | 0.52 |
| Whisper tiny · card | 70.1 | 81.9 | 58.1 | 41.8 | 43.7 | 81.3 | 95.5 | 84.5 | **69.4** | 4 / 600 | 0.31 | 1.02 |

### after-cpu · 2026-11-12 0708 · 675a047

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper base · cpu 8t | 59.9 | 71.0 | 49.6 | 27.8 | 32.8 | 68.1 | 95.5 | 73.6 | **59.6** | 6 / 600 | 1.07 | 2.90 |
| Parakeet · cpu 8t | 39.2 | 43.2 | 44.1 | 10.3 | 13.2 | 49.5 | 86.1 | 51.8 | **42.2** | 5 / 600 | 0.52 | 0.84 |
| Whisper small · cpu 8t | 38.0 | 47.3 | 40.5 | 14.0 | 16.2 | 42.6 | 78.1 | 57.9 | **41.8** | 1 / 600 | 2.12 | 2.35 |
| Whisper tiny · cpu 8t | 71.2 | 88.6 | 60.5 | 45.2 | 47.3 | 85.6 | 98.7 | 86.6 | **72.7** | 9 / 600 | 0.99 | 3.06 |

## 2026-11-14: точка после списка имён для small и base, длина кусков для turbo

Четыре прогона ниже. Стенд запущен с восемью именами (`run.py NAMES`).

**Точка после списка имён** (`names-open` — список как есть, `names-closed` — закрыт точкой), на процессоре, где эти модели и работают. small: неверных слов 16,6 → 16,3 %, фраз с неверным конечным знаком 21 → 0 из 180, неверная заглавная 6 → 2. base: 31,5 → 31,4 %, конечный знак 4 → 0, заглавная 15 → 2. **Решение:** точка включена для small (и осталась для turbo). Для base и tiny не включена: на карте они с ней теряли слова (исследование 14.11: base 40,6 → 43,3 %, tiny 56,0 → 61,8 %), а выигрывать base почти нечего. large-v3 в своём режиме не мерили.

**Длина кусков** для Whisper на карте, поток в реальном темпе, 30 диктовок по три предложения, 1709 слов. 10–25 с: 248 неверных слов (ru 27, uk 70, en 151). 6–20 с: 158 (ru 28, uk 45, en 85). Скорость и ожидание после клавиши те же. **Решение:** 6–20 с. Одно русское слово из 565 — в пределах шума; английский всё ещё заметно хуже чтения целой фразы (13,4 % против 6,4 %), пропуски длинной речи не закрыты.

### names-open · 2026-11-14 2030 · ef334f7

phrase, 30 phrases a language, clean, fan

| Model | ru | uk | en | clean | fan | all | wrong lang | case errors | end errors | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper base · cpu 8t | 23.7 | 54.4 | 20.0 | 28.4 | 34.6 | **31.5** | 0 / 180 | 15 / 180 | 4 / 180 | 0.63 | 0.64 |
| Whisper small · cpu 8t | 12.3 | 26.2 | 12.6 | 15.6 | 17.5 | **16.6** | 0 / 180 | 6 / 180 | 21 / 180 | 1.71 | 1.95 |

### names-closed · 2026-11-14 2037 · ef334f7

phrase, 30 phrases a language, clean, fan

| Model | ru | uk | en | clean | fan | all | wrong lang | case errors | end errors | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper base · cpu 8t | 23.1 | 55.5 | 19.5 | 29.1 | 33.7 | **31.4** | 0 / 180 | 2 / 180 | 0 / 180 | 0.66 | 0.74 |
| Whisper small · cpu 8t | 12.4 | 26.6 | 11.5 | 14.7 | 17.9 | **16.3** | 0 / 180 | 2 / 180 | 0 / 180 | 1.74 | 1.96 |

### pieces-10-25 · 2026-11-14 2054 · ef334f7

stream, 30 phrases a language, clean

| Model | ru | uk | en | clean | all | wrong lang | case errors | end errors | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 4.8 | 13.8 | 23.8 | 14.5 | **14.5** | 0 / 30 | 1 / 30 | 0 / 30 | 5.24 | 6.00 | 0.03 | 0.14 |

### pieces-6-20 · 2026-11-14 2111 · ef334f7

stream, 30 phrases a language, clean; levers {'stream.PIECES': "{('whisper', 'cpu'): (4.0, 25.0), ('whisper', 'cuda'): (6.0, 20.0), ('parakeet', 'cpu'): (1.5, 20.0)}"}

| Model | ru | uk | en | clean | all | wrong lang | case errors | end errors | s / phrase | p90 s | tail s | tail max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 5.0 | 8.8 | 13.4 | 9.2 | **9.2** | 0 / 30 | 1 / 30 | 0 / 30 | 5.12 | 5.92 | 0.02 | 0.15 |

## 2026-11-20: многоточие на месте паузы

**Что было.** Владелец: «В какой-то момент... я увидел», и так часто. Диктовка режется на куски по паузам от 0,6 с; кусок, оборванный посреди предложения, для Whisper — оборванная строка субтитров, и он заканчивает её многоточием (а следующую иногда открывает им же: «От создания рассылки... ...по сценарию»). В 200 фразах владельца за сутки многоточие было в 22: в 9 посреди фразы перед строчной буквой, в 5 посреди перед заглавной («у меня останется... Закрытый лимит»), в 9 в самом конце (фраза отпущена на полуслове). С 14.11 куски на карте короче (6–20 с), швов стало больше.

**Что сделано.** `phantoms.pauses`: многоточие, после которого предложение идёт дальше со строчной (или с английского «I»), убирается, в тексте куска и на шве кусков (`stream.joined`); перед заглавной и в конце фразы остаётся (в конце — решение владельца). `stream.OPEN_PROMPT`: следующему куску текст до него даётся без многоточия на конце, чтобы он продолжал предложение, а не открывал новое.

**Замер.** Стенд с флагом `--hesitate`: в каждую фразу вставлено 0,9 с тишины в самом тихом месте её второй половины. Turbo на карте, поток вдвое быстрее реального темпа, 21 диктовка по три предложения (63 паузы, 1172 слова). Три прогона ниже: как было, с правилом, с правилом и подсказкой без многоточия. Многоточий посреди текста 4 → 1 → 0; оставшееся после правила было перед заглавной («как они... Выглядели изначально»), подсказка без многоточия дала «как они выглядели изначально». Неверных слов 154 → 154 → 154 (ru 30 → 30 → 31, uk 45 → 45 → 46, en 79 → 79 → 77): правило слов не трогает, подсказка поменяла текст в 4 диктовках из 21, в сумме ноль. Время распознавания 80,5 → 81,2 → 85,0 с на все диктовки. **Решение:** оба включены. Оговорка: начитанный текст с вставленной тишиной даёт многоточие реже живой речи (4 на 63 паузы), так что выборка мала; столбец «sentences opened» (лишние начала предложений против образца) почти не изменился, 14 → 14 → 13, — он больше про точки, которые Whisper ставит на паузе, это отдельная задача.

### pauses-before · 2026-11-20 1012 · 91c3d88

stream, 21 phrases a language, clean; a pause in the middle of every phrase; levers {'phantoms.MEND_PAUSES': False, 'stream.OPEN_PROMPT': False}

| Model | ru | uk | en | clean | all | wrong lang | case errors | end errors | s / phrase | p90 s | tail s | tail max | … inside | sentences opened |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 8.5 | 12.6 | 17.2 | 13.1 | **13.1** | 0 / 21 | 1 / 21 | 0 / 21 | 3.83 | 4.28 | 0.04 | 0.23 | 4 / 21 | 14 / 21 |

### pauses-mended · 2026-11-20 1018 · 91c3d88

stream, 21 phrases a language, clean; a pause in the middle of every phrase; levers {'stream.OPEN_PROMPT': False}

| Model | ru | uk | en | clean | all | wrong lang | case errors | end errors | s / phrase | p90 s | tail s | tail max | … inside | sentences opened |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 8.5 | 12.6 | 17.2 | 13.1 | **13.1** | 0 / 21 | 1 / 21 | 0 / 21 | 3.86 | 4.17 | 0.03 | 0.12 | 1 / 21 | 14 / 21 |

### pauses-mended-open-prompt · 2026-11-20 1024 · 91c3d88

stream, 21 phrases a language, clean; a pause in the middle of every phrase

| Model | ru | uk | en | clean | all | wrong lang | case errors | end errors | s / phrase | p90 s | tail s | tail max | … inside | sentences opened |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 8.7 | 12.9 | 16.7 | 13.1 | **13.1** | 0 / 21 | 1 / 21 | 0 / 21 | 4.05 | 4.73 | 0.03 | 0.25 | 0 / 21 | 13 / 21 |

## 2026-11-21: формат чисел на карте, GTX 16xx

**Что было.** На ноутбуке владельца (GTX 1660 Ti, 6 ГБ) turbo на карте писал фразу 4,2–4,7 с при 0,2–0,3 с на RTX 2080 SUPER. Дело не в памяти и не в мощности: карта медленно считает половинную точность. Одно 30-секундное окно turbo (кодировщик), по четыре повтора:

| Формат | GTX 1660 Ti | RTX 2080 SUPER | Память карты |
|---|---|---|---|
| float16 (так грузился) | 3,93 с | 0,16 с | 2,2 ГБ |
| int8_float16 | 0,96 с | 0,16 с | 1,2 ГБ |
| int8 | 0,96 с | 0,16 с | 1,2 ГБ |
| float32 | 0,94 с | (фраза 0,94 с против 0,26) | 4,1 ГБ |
| процессор, int8 | около 8 с (шло обновление Windows) | | |

Формат выбирался только по объёму памяти карты (`speechplan.ts cudaCompute`), скорость формата никто не мерил.

**Качество форматов.** Turbo на RTX 2080 SUPER, стенд с именами, FLEURS и чтение владельца, пять условий, 750 фраз; потом поток, 78 диктовок по три фразы (вчетверо быстрее реального темпа, чисто и вентилятор). Три прогона по фразам и два потоковых ниже. int8_float16 против float16: 26,4 против 25,7 неверных слов на сотню (ru 20,8 / 19,6, uk 25,9 / 25,2, en 33,5 / 33,2), по фразам хуже в 102, лучше в 55, одинаково в 494 (знаковый критерий: случайность меньше 0,001); в потоке 16,0 против 15,6, хуже в 21 диктовке, лучше в 10. float32 равен float16 (25,6), но на RTX фраза в нём 0,94 с. Один клип на 39 с, на котором тексты форматов совпали слово в слово, ничего не доказывал.

**Решение.** float16 остаётся там, где он быстрый: сжатый формат на таких картах ничего не ускоряет и теряет слова, он по-прежнему запасной для занятой карты. На карте, медленной на половинной точности, план берёт int8_float16 (`slowHalf`): вчетверо быстрее, 3–6 % слов хуже в русском и украинском, но это всё ещё вдвое точнее Parakeet на процессоре. Карту узнаём по замеру: тест скорости один раз меряет модель в обоих форматах (кроме RTX, где ответ известен), вывод делается только по его собственным числам (`tested`), разница от двух раз; пока замера нет — по имени (GTX 16xx). float32 не взят: 4,1 ГБ на карте в 6 ГБ не помещаются рядом с программами человека. Настройки нет.

**Записи, а не диктовка: первый взгляд.** Стенд мерил только диктовку. Тот же FLEURS, склеенный в одну запись на язык (40 фраз разных людей, 6,6–8,1 мин; чтение владельца 2,5 мин), через `asr.Transcriber.transcribe`, как читает «Записи и встречи». Скрипты и журналы вне git, `.cache/speech-quality/2026-11-21-formats/`. По одной записи на язык, результат гуляет на 2–3 пункта, так что это повод для настоящего стенда, а не итог:

- Тихий голос рядом с громким не записывается. Записи, в отличие от диктовки, громкость не трогают. Все фразы на одном уровне: 5,2 % неверных слов, не записана 1 фраза из 120. Каждая вторая на 20 дБ тише: 7,8 %, не записаны 3. Каждая вторая на 30 дБ тише: 27,9 %, не записаны 28 (все тихие). Вся запись на 30 дБ тише: 9,6 %, не записаны 2. Черновое выравнивание (каждые полсекунды поднимаются до уровня самого громкого звука в двух секундах вокруг, не больше 30 дБ): 6,2 / 4,7 / 7,8 / 9,8 % — лечит разницу голосов, но обычную запись чуть портит, его надо доводить.
- Какие фразы пропадут, зависит от посторонних настроек: без списка имён, без подсказки стиля, без текста перед окном пропадают другие тихие фразы. Правило тишины, пороги сомнения и повторные попытки не меняют ничего.
- large-v3 против turbo: 482 против 401 неверного слова из 2581, 160 с против 36 с. Не точнее и в 4,4 раза медленнее.
- Несколько окон сразу (`BatchedInferencePipeline`, по 4): turbo 36 → 26 с, 401 → 409 неверных слов; large-v3 160 → 62 с, 482 → 445. Время каждого слова есть, порядок цел. На склеенном 16 раз клипе было втрое, на настоящей речи в 1,4 раза.

### format-float16 · 2026-11-21 0857 · 2aeddc9

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | case errors | end errors | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 19.6 | 25.2 | 33.2 | 6.2 | 7.0 | 21.3 | 53.7 | 40.1 | **25.7** | 8 / 750 | 83 / 750 | 78 / 750 | 0.26 | 0.34 |

### format-int8_float16 · 2026-11-21 0901 · 2aeddc9

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | case errors | end errors | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 20.8 | 25.9 | 33.5 | 6.5 | 7.4 | 22.1 | 54.8 | 41.2 | **26.4** | 8 / 750 | 82 / 750 | 78 / 750 | 0.29 | 0.38 |

### format-float32 · 2026-11-21 0937 · 2aeddc9

phrase, 40 phrases a language, clean, fan, babble, far, quiet

| Model | ru | uk | en | clean | fan | babble | far | quiet | all | wrong lang | case errors | end errors | s / phrase | p90 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card | 19.5 | 25.2 | 33.1 | 6.1 | 7.0 | 21.1 | 53.7 | 40.0 | **25.6** | 8 / 750 | 81 / 750 | 77 / 750 | 0.94 | 1.22 |

### format-stream-float16 · 2026-11-21 0912 · 2aeddc9

stream, 40 phrases a language, clean, fan

| Model | ru | uk | en | clean | fan | all | wrong lang | case errors | end errors | s / phrase | p90 s | tail s | tail max | … inside | sentences opened |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 6.0 | 16.3 | 23.7 | 8.4 | 22.7 | **15.6** | 0 / 78 | 2 / 78 | 0 / 78 | 3.46 | 4.50 | 0.16 | 0.85 | 0 / 78 | 21 / 78 |

### format-stream-int8_float16 · 2026-11-21 0924 · 2aeddc9

stream, 40 phrases a language, clean, fan

| Model | ru | uk | en | clean | fan | all | wrong lang | case errors | end errors | s / phrase | p90 s | tail s | tail max | … inside | sentences opened |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Whisper turbo · card · stream | 6.2 | 17.5 | 23.7 | 9.2 | 22.8 | **16.0** | 0 / 78 | 2 / 78 | 0 / 78 | 3.16 | 4.14 | 0.12 | 0.42 | 0 / 78 | 18 / 78 |
