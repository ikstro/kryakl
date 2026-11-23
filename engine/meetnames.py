"""Who spoke when in a Google Meet call, as Meet's captions name them.

The Chrome extension watches Meet's captions while it records and notes only the
name beside each caption line and when it changed, never the caption's text; it
sends that timeline with the recording's finish. Here it is made safe and laid
over the tab track's words, so a meeting can carry real names without the
diarization model.
"""

from __future__ import annotations

import bisect
import math
import re

MOST_SPANS = 5000
LONGEST_NAME = 80
NEAR = 2.0     # seconds: a word with no span over it takes the nearest one this close
GAP = 3.0      # seconds: unnamed words between two words of one name take it when they are this close
ENOUGH = 0.6   # the share of words named for the names to replace the model's speakers

# Control characters, and the bidirectional overrides and isolates that could turn a name around on screen.
_UNSAFE = re.compile("[\x00-\x1f\x7f-\x9f​-‏‪-‮⁠-⁩﻿]")
_SPACES = re.compile(r"\s+")


def _number(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    value = float(value)
    return value if math.isfinite(value) else None


def _name(value) -> str:
    if not isinstance(value, str):
        return ""
    name = _SPACES.sub(" ", _UNSAFE.sub("", value)).strip()
    return name[:LONGEST_NAME].strip()


def clean(raw) -> list[dict]:
    """The timeline as the extension sent it, made safe: a list of {"name", "start", "end"}; names trimmed, at most 80 chars, control characters removed, spans with end <= start or non-numbers dropped, sorted, at most 5000."""
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    # A body is at most a few hundred kilobytes; looking at ten times the spans kept is plenty.
    for item in raw[: MOST_SPANS * 10]:
        if not isinstance(item, dict):
            continue
        name = _name(item.get("name"))
        start, end = _number(item.get("start")), _number(item.get("end"))
        if not name or start is None or end is None:
            continue
        start = max(start, 0.0)
        if end <= start:
            continue
        out.append({"name": name, "start": start, "end": end})
    out.sort(key=lambda s: (s["start"], s["end"], s["name"]))
    return out[:MOST_SPANS]


def assign(words: list[dict], spans: list[dict], *, lag: float = 1.2) -> list[str | None]:
    """For each word ({"start","end",...} in the tab track's seconds) the name speaking then, or None where no span is near. Captions appear later than the voice, so a span is taken as starting `lag` seconds earlier than noted; a word takes the span that overlaps it most, else the nearest span within 2 s; a run of unnamed words between two words of the same name takes that name when the gap is under 3 s."""
    shifted = sorted(((s["start"] - lag, s["end"], s["name"]) for s in spans), key=lambda s: (s[0], s[1]))
    starts = [s[0] for s in shifted]
    # The latest end among the spans up to each one: every span before the first that reaches a time ends before it.
    reach: list[float] = []
    for _, end, _ in shifted:
        reach.append(max(end, reach[-1]) if reach else end)

    names: list[str | None] = []
    for w in words:
        a, b = float(w["start"]), float(w["end"])
        if b < a:
            a, b = b, a
        lo = bisect.bisect_left(reach, a - NEAR)
        hi = bisect.bisect_right(starts, b + NEAR)
        best, best_overlap, best_distance = None, 0.0, NEAR
        for start, end, name in shifted[lo:hi]:
            overlap = min(end, b) - max(start, a)
            if overlap > best_overlap:
                best, best_overlap = name, overlap
            elif best_overlap == 0.0 and overlap <= 0.0:
                distance = max(start - b, a - end, 0.0)
                if distance <= best_distance and (best is None or distance < best_distance):
                    best, best_distance = name, distance
        names.append(best)

    # Unnamed words between two words of one name, close in time, are that name's.
    order = sorted(range(len(words)), key=lambda i: (words[i]["start"], words[i]["end"]))
    last = None  # the position in `order` of the last named word
    for k, i in enumerate(order):
        if names[i] is None:
            continue
        if last is not None and k - last > 1:
            before = order[last]
            if names[before] == names[i] and float(words[i]["start"]) - float(words[before]["end"]) < GAP:
                for j in order[last + 1:k]:
                    names[j] = names[i]
        last = k
    return names


def usable(words, names) -> bool:
    """Whether the names cover enough to replace the model's speakers: at least 60 % of the words named."""
    if not words or len(names) != len(words):
        return False
    return sum(n is not None for n in names) >= ENOUGH * len(words)


# Meet names the person's own captions so; their voice is the microphone's track ("Me"), never the tab's.
SELF = {"you", "вы", "ви", "ты", "ти"}


def own(name: str) -> bool:
    return name.casefold() in SELF


def turns(words: list[dict], spans: list[dict]) -> list[tuple[float, float, str]] | None:
    """The tab track's speaker turns by Meet's names, one per named word, or None when the names cover too little."""
    spans = [s for s in spans if not own(s["name"])]
    if not spans or not words:
        return None
    names = assign(words, spans)
    if not usable(words, names):
        return None
    return [(float(w["start"]), float(w["end"]), n) for w, n in zip(words, names) if n is not None]
