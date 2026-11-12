"""What the microphone hears in different places, made from a clean phrase.

Every condition starts as dictation does: a little before the speech (the key is pressed,
then one starts) and after it (one stops, then lets go), never digital silence (a
microphone always hears a floor of noise). The same phrase always gets the same noise.

clean   the phrase as read
fan     a fan or a laptop's cooler: low, steady noise, 10 dB under the voice
babble  other people talking around, 5 dB under the voice
far     a laptop's microphone across the table: a room's echo, 25 dB quieter
quiet   a microphone set low: 30 dB quieter
"""

from __future__ import annotations

import zlib

import numpy as np

from audio import RATE

CONDITIONS = ("clean", "fan", "babble", "far", "quiet")
BEFORE, AFTER = 0.5, 0.7  # seconds around the speech
FLOOR_DB = -70.0


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) or 1e-9


def _db(db: float) -> float:
    return 10 ** (db / 20)


def _rng(key: str) -> np.random.Generator:
    return np.random.default_rng(zlib.crc32(key.encode()))


def _brown(n: int, rng: np.random.Generator) -> np.ndarray:
    """Noise heavy in the low tones, as a fan's: white noise falling 6 dB an octave above 50 Hz."""
    spectrum = np.fft.rfft(rng.standard_normal(n))
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    out = np.fft.irfft(spectrum / np.maximum(freqs, 50.0), n)
    return out - out.mean()


def _room(n_tail: float, rng: np.random.Generator) -> np.ndarray:
    """A room's impulse response: the direct sound, then echoes dying out over about 0.6 s."""
    n = int(n_tail * RATE)
    t = np.arange(n) / RATE
    tail = rng.standard_normal(n) * np.exp(-6.9 * t / 0.6) * 0.35
    tail[: int(0.005 * RATE)] = 0.0
    tail[0] = 1.0
    return tail


def make(clean: np.ndarray, condition: str, key: str, others: list[np.ndarray] | None = None) -> np.ndarray:
    """The phrase as heard in `condition`; `others` are other people's phrases, for babble."""
    rng = _rng(f"{condition}:{key}")
    speech = clean.astype(np.float64)
    voice = _rms(speech)
    if condition == "far":
        speech = np.convolve(speech, _room(0.6, rng))[: len(speech) + int(0.3 * RATE)]
        speech *= voice / _rms(speech) * _db(-25)
    elif condition == "quiet":
        speech = speech * _db(-30)
    out = np.concatenate([np.zeros(int(BEFORE * RATE)), speech, np.zeros(int(AFTER * RATE))])
    voice_now = _rms(speech)
    if condition == "fan":
        noise = _brown(len(out), rng)
        out += noise / _rms(noise) * voice_now * _db(-10)
    elif condition == "babble":
        crowd = np.zeros(len(out))
        for other in (others or [])[:4]:
            start = int(rng.integers(0, max(1, len(other) // 3)))
            piece = np.resize(other[start:].astype(np.float64), len(out))
            crowd += piece / _rms(piece)
        if crowd.any():
            out += crowd / _rms(crowd) * voice_now * _db(-5)
    out += rng.standard_normal(len(out)) * _db(FLOOR_DB)
    return np.clip(out, -1.0, 1.0).astype(np.float32)
