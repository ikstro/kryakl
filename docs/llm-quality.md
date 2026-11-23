# Language models: Groq's free models against Gemma 4 E4B (2026-11-23)

Kryakl's two text jobs, Check my English and translation, run through Kryakl's own code (`checker.ts`
`createChecker`, `llmtranslator.ts` `createLlmTranslators`, `remote/llm.ts` `createRemoteTranslator`,
`remote/groq.ts` `Groq`, `translate.ts translatePairs`), so the prompts, the JSON schemas, the guards
(`lostWords`, the unchanged-text rule) and Groq's settings (`reasoning_effort` none on qwen, low on
gpt-oss; strict `json_schema`; +512 completion tokens) are the app's. Each Groq model was pinned (no
falling over to the next one).

- **Local**: Gemma 4 E4B q4_0 (Accurate), llama.cpp b11929 Vulkan, the app's options
  (`-c 8192 -np 4 --kv-unified --no-webui --no-slots`, llama.cpp's own fit), on the owner's laptop
  (GTX 1660 Ti, 6 GB; about 50 tokens a second). One warm-up request first, not counted. The
  2026-10-30 numbers were on the RTX 2080 SUPER, about twice as quick.
- **Groq**: `openai/gpt-oss-120b`, `qwen/qwen3.8-27b`, `openai/gpt-oss-20b` (the names Groq lists),
  free plan, the owner's key. Times are the request's own: the bench's pacing (one request every
  2.3 s a model) is taken out; Groq's own short waits after a 429 (`Groq.send`, up to 12 s) are not,
  as the app waits them too.
- **Sets**: recovered from session a1cbbd60 (`.stversions` copy of its transcript): the 44 check texts
  of 2026-10-30 (32 with a mistake, 12 right; `checkbench/set.json`, the set behind "31 of 32"), and
  the 14 translation texts of `transbench/texts.json` (the owner's 9 of 2026-10-27 and 5 short hard
  ones). Each check text was asked with Russian as the person's language; ten of the mistaken ones
  again with Ukrainian.

Raw outputs, the bench and the sets: `.cache/llm-quality/` (out of git): `raw/check-*.json`,
`raw/translate-*.json`, `raw/side.txt` (every translation side by side), `raw/faults-translate.json`,
`bench/bench.ts`.

## Check my English

Grading as on 2026-10-30: caught when every expected fix is there and every wrong form gone; partly
when some are; a right text changed is a false fix.

| Model | Caught (of 32) | Partly | Missed | False fixes (of 12) | Note in Russian | Note in Ukrainian | Median s a text |
|---|---|---|---|---|---|---|---|
| Gemma 4 E4B (here) | **31** | 1 | 0 | **0** | 32 of 32 | 10 of 10 | 1.21 |
| gpt-oss-120b | 29 | 2 | 1 | **0** | 30 of 31 (1 English) | 10 of 10 | 0.47 |
| qwen3.8-27b | 29 | 2 | 1 | **0** | 32 of 32 | 10 of 10 | 0.37 |
| gpt-oss-20b | 28 | 1 | 3 | **0** | 12 of 31 (19 English) | **0 of 9** (all English) | 0.31 |

- No model changed a right text. The local result is the 2026-10-30 one again (31, 1 partly on
  "tupe… my my mistake", 0 false), on slower hardware.
- gpt-oss-120b missed "send me the files until Friday" (by Friday) and left "can we make tutor
  option" without "a"; one note in English ("is → are: after a plural subject…").
- qwen missed "then write me" and instead removed "the" before "dark mode", its note explaining that
  change: a fix nobody needed, explained as the main mistake.
- gpt-oss-20b writes the note in English nearly always, in Ukrainian every time, which breaks the
  rule that the note is in the person's language; it also missed "I want that you check", "I'm
  working… for five years" (changed "in" to "at", with a wrong Russian rule) and "Da our engine lets
  this to us".

## Translation

| Model | Median s a text | Errors | Accuracy (judged against the source) |
|---|---|---|---|
| Gemma 4 E4B (here) | 1.21 | 0 | Good on short and business texts; weak on a long informal post, where each sentence is translated alone: list items lose their subject ("изучаю", "скажи мне", "присылайте мне"), one sentence turns round ("it doesn't post for me" → «У меня не публикуется»), capitals come back; "новий збірку" in Ukrainian |
| gpt-oss-120b | 0.62 | 0 | **Best overall**: meaning kept everywhere, the lowercase tone of the post kept, "lol" kept, "build" → сборка/збірка, names, @handles, e-mail, GPX and clause numbers kept; small slips: «чтобы я не «перешагнул» его» (step on it), left "Yevhen" in Latin |
| qwen3.8-27b | 1.12 (run 1), 1.53 (runs 2, 3) | **4, 0, 2 of 14** | When it answers, the most natural wording ("билд", «так себе», «Евген», «zipper» for молния, chest buttons read right); but "lol" → «ха», "mockups" → "layouts", and Groq's strict JSON fails it: `400 json_validate_failed` (its output stopped at `{"items":[{"`) in 6 of 42 texts over three runs |
| gpt-oss-20b | 0.37 | 0 | Fast but loose: meaning changed several times (round trips → «Обычные», "the points you drop" → «которые вы уберете», "the hour you leave" → «за час до вашего отъезда», "take another pass" → «сделать ещё один вариант», "build" → «версію»), names transliterated («Грок-бот»), the post's lowercase tone lost, «оптимизированных ветром», «пошагал» |

### Examples

The long informal post (en → ru), one list item and a line of the story:

| | "it doesn't post for me." | "- tells me when a post is still hot so i don't step on it" |
|---|---|---|
| E4B | У меня не публикуется. | - скажи мне, когда пост еще "горячий", чтобы я не "засветил" его |
| gpt-oss-120b | он не публикует за меня. | - сообщает, когда пост всё ещё «горячий», чтобы я не «перешагнул» его |
| qwen | он не публикует за меня. | - говорит мне, когда пост всё ещё в тренде, чтобы я не наступил на него |
| gpt-oss-20b | Он не публикует за меня. | - сообщает мне, когда пост всё ещё горячий, чтобы я не «пошагал» по нему |

The chat (en → ru): "lol no worries, I'll swing by after lunch. if the build's still broken we can just
roll it back and call it a day."

| | |
|---|---|
| E4B | лол, без проблем, заеду после обеда. если сборка всё ещё сломана, мы можем просто откатиться и считать, что день окончен. |
| gpt-oss-120b | лол, не переживай, зайду после обеда. если сборка всё ещё сломана, мы можем просто откатить её и закончить. |
| qwen (run 2; run 1 failed with 400) | ха, не переживай, загляну после обеда. если билд всё ещё сломан, просто откатим и закончим на этом. |
| gpt-oss-20b | лол, не переживай, я зайду после обеда. если сборка всё ещё сломана, мы просто откатим её и закончим день. |

The feature list (en → ru): "Drag any route to reshape it — the points you drop become waypoints"

| | |
|---|---|
| E4B | …точки, которые вы опускаете, становятся промежуточными точками. |
| gpt-oss-120b | …точки, которые вы ставите, становятся путевыми точками |
| qwen | …точки, которые вы добавите, станут контрольными точками |
| gpt-oss-20b | …точки, которые вы уберете, станут контрольными точками (the opposite) |

The short ones: «Кнопки сундука и молнии поменять местами.» → "Swap the chest and lightning buttons"
from E4B and both gpt-oss, "Swap the chest and zipper buttons" from qwen (still ambiguous without
context). «Сборка опять упала.» → "The build failed / crashed again" from all four (TranslateGemma's
"The assembly figures have fallen" of 2026-10-30 is not repeated by any).

## Limits seen on the free plan

- **qwen3.8-27b allows 1,000 output tokens a minute** (Groq's 429 says "output tokens per minute
  (OTPM): Limit 1000"), and Groq counts the request's `max_completion_tokens` against it. The app asks
  for the answer's cap + 512 (`remoteComplete`, and 512 + 2× the text in `remote/llm.ts`), about
  500–700 tokens a request, so qwen takes about two requests a minute before a 429; a Talk answer
  (220 + 512) about one. Every 429 seen in this bench was qwen's; gpt-oss had none at the same
  pace. Qwen reasons not at all here (`reasoning_effort: none`), so the +512 buys it nothing.
- **qwen's strict JSON fails** now and then (`400 json_validate_failed`), which `Groq.send` takes as a
  server fault: the job ends and Fast's translation stands; the next model is not tried.
- Requests used today by the bench (successful + refused): gpt-oss-120b 69, gpt-oss-20b 74,
  qwen3.8-27b about 120 (95 answered, at least 19 refused by the limit, 6 by JSON); tokens 30.4K, 28.1K,
  26.3K of the 200K a day.

## What follows

- **Check my English**: gpt-oss-120b (first in `CHAT_MODELS.check` already): as safe as the local
  model (no false fix), notes in the person's language, 2.5× quicker than E4B on this laptop, two
  mistakes fewer. qwen is equal on the counts and its notes are all in Russian/Ukrainian, a sound
  second; gpt-oss-20b should not check (notes in English).
- **Translation**: gpt-oss-120b, clearly; qwen reads best when it answers but fails one text in
  seven with strict JSON and is throttled by its token minute, so it is a poor second for
  translation; gpt-oss-20b changes meaning and should not be a fallback for translation either.
- **Talk and text editing** (not measured, a guess from the above): qwen writes the most natural
  Russian and English, which suits Talk, but its 1,000-token minute allows about one Talk answer a
  minute with the app's +512 cap, so as Talk's first model it will fall over to gpt-oss-120b often;
  either lower the cap for qwen or put gpt-oss-120b first. For editing a dictated phrase, gpt-oss-20b
  (first today) is quick, but it changed meaning in translation and ignored the language rule for
  notes, the two things editing must not do; gpt-oss-120b is the safer first choice.
