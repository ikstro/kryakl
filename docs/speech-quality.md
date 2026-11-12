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
