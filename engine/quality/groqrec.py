"""Groq's Whisper as a recognizer for the bench (`--models groq:whisper-large-v3`), the way the app's dictation
path asks it (src/remote/dictate.ts): the phrase as a WAV, `verbose_json`, no language when the person uses
several (one only when the phrase's languages are one), the names as the prompt, a phrase heard as a language
the person does not use asked again in their own, and what nobody said cut (phantoms).

The key is read from the environment (`GROQ_BENCH_KEY`) and goes nowhere but the request's header.
Pacing: Groq's free plan allows about 20 requests a minute; a 429 waits for its retry-after.
"""

from __future__ import annotations

import io
import json
import os
import time
import wave

import numpy as np

import asr
import phantoms
from audio import RATE

PREFIX = "groq:"
MIN_GAP = 3.1  # seconds between requests (20 a minute)
KEY_ENV = "GROQ_BENCH_KEY"


def is_groq(name: str) -> bool:
    return name.startswith(PREFIX)


def wav(samples: np.ndarray) -> bytes:
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(pcm)
    return out.getvalue()


def _code(raw: dict) -> str:
    name = str(raw.get("language", "")).lower()
    return asr.LANGUAGE_NAMES.get(name, name[:2])


class GroqRecognizer:
    compute = "cloud"

    def __init__(self, post=None, sleep=time.sleep, clock=time.monotonic):
        self._post = post or asr.groq_post
        self._sleep, self._clock = sleep, clock
        self.name = ""
        self.requests = 0
        self.billed = 0.0  # seconds, each request at least 10
        self._last = -1e9

    def load(self, name: str, device: str = "cpu", compute=None, threads: int = 0) -> None:
        self.name = name[len(PREFIX):]

    def warm(self) -> None:
        pass

    def pace(self) -> None:
        """Wait out the gap between requests; the bench calls it before its timer starts, so a phrase's time is the round trip."""
        wait = self._last + MIN_GAP - self._clock()
        if wait > 0:
            self._sleep(wait)

    def unload(self) -> None:
        pass

    def _ask(self, key: str, body: bytes, seconds: float, language: str | None, prompt: str) -> dict:
        fields = [("model", self.name), ("temperature", "0"), ("response_format", "verbose_json"), ("timestamp_granularities[]", "segment")]
        if language:
            fields.append(("language", language))
        if prompt:
            fields.append(("prompt", prompt))
        for attempt in range(8):
            wait = self._last + MIN_GAP - self._clock()
            if wait > 0:
                self._sleep(wait)
            self._last = self._clock()
            try:
                status, headers, content = self._post(key, fields, body, "phrase.wav", "audio/wav")
            except OSError:
                self._sleep(2.0 * (attempt + 1))
                continue
            if status == 200:
                self.requests += 1
                self.billed += max(10.0, seconds)
                return json.loads(content.decode("utf-8"))
            if status == 429:
                try:
                    pause = float(headers.get("retry-after", "") or 60)
                except ValueError:
                    pause = 60.0
                self._sleep(min(pause, 300.0) + 1.0)
                continue
            if status >= 500:
                self._sleep(2.0 * (attempt + 1))
                continue
            raise RuntimeError(f"Groq answered {status}")
        raise RuntimeError("Groq did not answer")

    def dictate(self, samples: np.ndarray, language=None, expected=(), hotwords: str = "", beam: int = 0, before: str = "", strict: bool = False) -> tuple[str, str, float]:
        key = os.environ.get(KEY_ENV, "")
        if not key:
            raise SystemExit(f"{KEY_ENV} is not set")
        if len(samples) == 0:
            return "", language or "", 0.0
        body, seconds = wav(samples), len(samples) / RATE
        prompt = asr.groq_prompt(hotwords)
        expected = list(expected)
        own = expected[0] if expected else ""
        only = own if len(expected) == 1 else (language or None)
        raw = self._ask(key, body, seconds, only, prompt)
        heard = _code(raw)
        if not only and own and heard and heard not in expected:
            raw = self._ask(key, body, seconds, own, prompt)
            heard = _code(raw)
        segments = raw.get("segments") or []
        sound = phantoms.Sound(
            seconds=seconds,
            no_speech=max((float(s.get("no_speech_prob", 0)) for s in segments), default=0.0),
            logprob=min((float(s.get("avg_logprob", 0)) for s in segments), default=0.0),
        )
        text = phantoms.clean(str(raw.get("text", "")).strip(), sound, True)
        return phantoms.pauses(text).strip(), heard if heard in expected else "", 1.0
