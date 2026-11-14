"""A vocabulary hint must not teach Whisper to omit sentence marks."""

import numpy as np
import pytest

import asr


def test_context_keeps_whole_words_and_shares_a_token_budget():
    encode = lambda text: list(text.encode("utf-8"))
    prompt, hint = asr.dictation_context("an extraordinarilylongword tail words", "First, Second, Third.", encode, 32)
    assert prompt == "tail words"
    assert hint == "First, Second."
    assert len(encode(" " + prompt)) + len(encode(" " + hint)) <= 32
    assert asr.dictation_context("x" * 200, "Name", encode)[0] is None


def test_empty_context_stays_empty():
    assert asr.dictation_context("", "", list) == (None, None)


@pytest.mark.parametrize("hint,expected", [
    ("Kryakl, Claude, Visual Studio", "Kryakl, Claude, Visual Studio."),
    (".NET, C++, Node.js", ".NET, C++, Node.js."),
    ("Kryakl.", "Kryakl."),
    ("Name?", "Name?"),
    ("Name!", "Name!"),
    ("Name…", "Name…"),
    ("  Крякл  ", "Крякл."),
    ("", ""),
    ("   ", ""),
])
@pytest.mark.parametrize("fallback", [False, True])
@pytest.mark.parametrize("name", ["large-v3-turbo", "small"])
def test_hint_is_closed_on_both_paths_without_formatting_the_result(monkeypatch, hint, expected, fallback, name):
    samples = np.ones(1600, dtype=np.float32)
    monkeypatch.setattr(asr, "_speech_only", lambda sound: sound)
    transcriber = asr.Transcriber()
    transcriber.name = name
    calls = []

    def one_pass(sound, language, languages, hotwords, beam, before, strict):
        assert before == "Начало фразы без знака"  # actual context is never rewritten
        if fallback:
            raise TypeError("simulate an incompatible one-pass API")
        calls.append(hotwords)
        return "фрагмент текста", "ru", 1.0

    def two_passes(sound, language, hotwords, beam, languages, strict):
        calls.append(hotwords)
        return "Это вопрос?", "ru", 1.0

    monkeypatch.setattr(transcriber, "_one_pass", one_pass)
    monkeypatch.setattr(transcriber, "_two_passes", two_passes)
    result = transcriber.dictate(samples, "ru", ["ru", "en"], hint, before="Начало фразы без знака", strict=True)
    assert calls == [expected]
    assert result[0] == ("Это вопрос?" if fallback else "фрагмент текста")


@pytest.mark.parametrize("name", ["tiny", "base", "large-v3", None])
def test_other_models_keep_their_hint_until_the_change_is_validated(monkeypatch, name):
    monkeypatch.setattr(asr, "_speech_only", lambda sound: sound)
    transcriber = asr.Transcriber()
    transcriber.name = name
    seen = []

    def recognize(sound, language, languages, hotwords, beam, before, strict):
        seen.append(hotwords)
        return "Текст.", "ru", 1.0

    monkeypatch.setattr(transcriber, "_one_pass", recognize)
    transcriber.dictate(np.ones(1600, dtype=np.float32), hotwords="Codex, Gemma")
    assert seen == ["Codex, Gemma"]
