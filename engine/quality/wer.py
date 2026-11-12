"""Scoring a recognized text against what was said: word errors and a wrong language.

Both sides are normalized alike first (lower case, no punctuation, ё as е, one kind of
apostrophe), so capitals and commas never count as mistakes: dictation is judged by its
words. Numbers are not spelled out: the bench's phrases have none (sets.py).
"""

from __future__ import annotations

import re
import unicodedata

APOSTROPHES = "’ʼ`´‘"
UKRAINIAN = set("іїєґ")
RUSSIAN = set("ыэъё")


def normalize(text: str) -> list[str]:
    """The words of a text, as both sides are compared."""
    text = unicodedata.normalize("NFC", text).lower().replace("ё", "е")
    for a in APOSTROPHES:
        text = text.replace(a, "'")
    # A hyphen or a dash between words is a space; an apostrophe stays inside a word only.
    text = re.sub(r"[^\w']+", " ", text)
    text = re.sub(r"(?<!\w)'|'(?!\w)", " ", text)
    return [w for w in text.split() if w]


def edits(ref: list[str], hyp: list[str]) -> int:
    """Word-level Levenshtein distance: substitutions, deletions and insertions."""
    if not ref:
        return len(hyp)
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def script_of(text: str) -> str:
    """'cyrillic', 'latin' or '' by the letters most of the text is written in."""
    cyr = sum(1 for c in text if "Ѐ" <= c <= "ӿ")
    lat = sum(1 for c in text if c.isascii() and c.isalpha())
    if not cyr and not lat:
        return ""
    return "cyrillic" if cyr >= lat else "latin"


def wrong_language(text: str, said: str) -> str:
    """The language a text came out in when it is not the one said ('' when it is right or cannot tell).

    By the script, then by the letters only Ukrainian or only Russian has: Whisper told the
    wrong language writes a translation, which these catch; a word or two of the other
    language inside a phrase does not count."""
    words = normalize(text)
    if not words:
        return ""
    script = script_of(text)
    if said == "en":
        return "cyrillic" if script == "cyrillic" else ""
    if said in ("ru", "uk"):
        if script == "latin":
            return "latin"
        letters = set("".join(words))
        if said == "ru" and len(letters & UKRAINIAN) >= 1 and sum(any(c in UKRAINIAN for c in w) for w in words) >= max(2, len(words) // 5):
            return "uk"
        if said == "uk" and sum(any(c in RUSSIAN for c in w) for w in words) >= max(2, len(words) // 5):
            return "ru"
    return ""


def score(ref: str, hyp: str) -> tuple[int, int]:
    """(word errors, words said)."""
    r = normalize(ref)
    return edits(r, normalize(hyp)), len(r)
