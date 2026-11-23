"""The bench's Groq recognizer: asked as the app's dictation asks, with Groq's answers made up."""

import io
import json
import wave

import numpy as np

from quality.groqrec import GroqRecognizer, wav


def answer(text, language="russian"):
    body = {"text": text, "language": language, "segments": [{"avg_logprob": -0.2, "no_speech_prob": 0.01}]}
    return 200, {}, json.dumps(body).encode()


def make(replies, monkeypatch):
    monkeypatch.setenv("GROQ_BENCH_KEY", "gsk_test")
    calls = []

    def post(key, fields, audio, name, mime):
        calls.append(dict(fields))
        return replies.pop(0)

    rec = GroqRecognizer(post=post, sleep=lambda s: None, clock=lambda: 1000.0 * (len(calls) + 1))
    rec.load("groq:whisper-large-v3")
    return rec, calls


SOUND = np.full(16000, 0.1, dtype=np.float32)


def test_wav_is_16k_mono():
    with wave.open(io.BytesIO(wav(SOUND))) as f:
        assert (f.getframerate(), f.getnchannels(), f.getnframes()) == (16000, 1, 16000)


def test_several_languages_sets_none_and_counts_billing(monkeypatch):
    rec, calls = make([answer("привет мир")], monkeypatch)
    text, lang, _ = rec.dictate(SOUND, None, ["ru", "en"], "Kryakl, Figma")
    assert (text, lang) == ("привет мир", "ru")
    assert "language" not in calls[0] and calls[0]["model"] == "whisper-large-v3" and calls[0]["prompt"] == "Kryakl, Figma."
    assert rec.requests == 1 and rec.billed == 10.0


def test_a_language_the_person_does_not_use_is_asked_again_in_their_own(monkeypatch):
    rec, calls = make([answer("privet", "polish"), answer("привет")], monkeypatch)
    text, _, _ = rec.dictate(SOUND, None, ["ru", "en"], "")
    assert text == "привет" and calls[1]["language"] == "ru" and rec.requests == 2


def test_one_language_is_sent_and_a_sign_off_is_cut(monkeypatch):
    rec, calls = make([answer("Hello there. Thank you for watching!", "english")], monkeypatch)
    text, _, _ = rec.dictate(SOUND, None, ["en"], "")
    assert calls[0]["language"] == "en" and text == "Hello there."


def test_a_limit_waits_for_retry_after(monkeypatch):
    waits = []
    rec, _ = make([(429, {"retry-after": "7"}, b"{}"), answer("да")], monkeypatch)
    rec._sleep = waits.append
    assert rec.dictate(SOUND, None, ["ru", "en"], "")[0] == "да"
    assert 8.0 in waits
