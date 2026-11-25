# The owner's post about Kryakl

The owner's own story of Kryakl: why he made it and what it does, in his voice. Use it as the base text for posts, for messages to people and for anything that tells Kryakl in the first person.

- `kryakl.uk.md`: the original. He dictated it in Ukrainian.
- `kryakl.ru.md`, `kryakl.en.md`: translations. They keep his voice and his jokes, and the same order.
- The three files are only the post text, ready to copy. Each one links to the landing in its own language.
- `kryakl.uk.threads.md`: the Ukrainian post as a Threads thread of 7 (500 characters a post).
- `kryakl-posts.md`: the hub. Where the videos and texts are, and the posts for LinkedIn (EN, 2321 characters) and X (EN, a thread of 7, 280 a post).

## Checked against 0.18.0 (2026-11-18)

The landing (`site/index.html`) is the source of truth for facts. These changes were made to the dictated draft:

| Draft | Now | Source |
|---|---|---|
| 6–12 GB | about 12 GB with its models | landing, lead and "What your computer needs" |
| instead of three things | instead of four: + a screenshot tool | landing, lead |
| "a plugin" for Meet | a plugin for Chrome | README, call transcripts |
| "with a good model it tells who said what" | the separate "Who spoke when" model; a free Hugging Face account, once | README, speakers |
| laptop with i7 and "1060 Ti" (no such card) | i7 and GTX 1660 Ti (the owner, 2026-11-18) | the owner |
| a newer card with 8 GB | 9 GB for the most accurate settings | landing, "Most accurate" |
| 6% fewer errors | 6–9% fewer errors | `docs/speech-quality.md`, "What came of it": Whisper small −6%, turbo −9% |
| link ikstro.com/kryakl | per language: /kryakl/uk, /kryakl/ru, /kryakl | live pages |

## Checked against 0.19.0 (2026-11-25)

| Was | Now | Source |
|---|---|---|
| Everything runs on your computer. No cloud, no subscription, no account | Everything runs on your computer until you connect the cloud Groq yourself. No subscription, no Kryakl account | landing, the proofs under Download (the owner, 2026-11-25) |
| a gaming PC is best (nothing for a weak one) | + no such PC: the cloud Groq with your own key; Groq's free plan is enough for a working day | landing, `#where` |

"Free" is said of Groq's free plan only, never of the key (the owner, 2026-11-23). In the X thread and on Threads the Groq line is shorter, to stay within 280 and 500 characters a post.

## Recheck on each release

- Disk size and graphics memory: landing, "What your computer needs".
- 32 languages: landing, Translate.
- Model names (Gemma 4, Whisper, Parakeet): landing. The post leaves out Kokoro (the natural voice), the offline Fast translator and pyannote (speakers); that is a choice, not a mistake.
- Default keys: most keys are empty until the person sets them (Ctrl+C twice, Print Screen, Check, Talk); dictation is Ctrl+Alt+D. The post says "a hotkey" on purpose.
- Call transcripts: the Chrome plugin also offers to record on Teams, Zoom, Jitsi and Whereby; only Meet is confirmed in real calls.
- Groq: which actions go there and the free plan's limits (landing, `#where`).
