"""The owner's reading of a script, cut into phrases for the bench.

    uv run --no-sync python -m quality.own <recording> [--script .cache/speech-quality/own/script.txt]

The script is numbered lines ("1. text"); the reading is one recording, the lines in order.
Whisper turbo hears the whole recording with the time of every word; its words are lined up
with the script's (an edit alignment, so a misheard word still finds its place), and each line
is cut from its first word to its last, never into the next line's words, so a remark between
lines or a "повтор" stays out. A line read twice keeps its last reading only when the alignment
lands there; a line too far from what was heard is left out. Saved as own/<lang>-NN.wav with
own/<lang>-NN.txt, the script's line: the bench scores against the script, never against what
any model heard.
"""

from __future__ import annotations

import argparse
import re
import sys
import wave
from pathlib import Path

import numpy as np

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

from quality.sets import ROOT  # noqa: E402
from quality import run as bench  # noqa: E402  (the test home and the models' folders)
from quality.wer import edits, normalize, script_of  # noqa: E402

import asr  # noqa: E402
from audio import RATE, decode  # noqa: E402

OWN = ROOT / "own"
MARGIN = 0.3  # seconds kept before a line's first word and after its last


def lines_of(script: Path) -> list[str]:
    out = []
    for line in script.read_text("utf-8").splitlines():
        m = re.match(r"\s*\d+[.)]\s*(.+)", line)
        if m:
            out.append(m.group(1).strip())
    return out


def align(script: list[str], heard: list[str]) -> list[int | None]:
    """For each script word, the heard word it lines up with (a match or a substitution), else None."""
    n, m = len(script), len(heard)
    cost = np.zeros((n + 1, m + 1), dtype=np.int32)
    cost[:, 0] = np.arange(n + 1)
    cost[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost[i, j] = min(cost[i - 1, j] + 1, cost[i, j - 1] + 1, cost[i - 1, j - 1] + (script[i - 1] != heard[j - 1]))
    out: list[int | None] = [None] * n
    i, j = n, m
    while i and j:
        if cost[i, j] == cost[i - 1, j - 1] + (script[i - 1] != heard[j - 1]):
            out[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif cost[i, j] == cost[i - 1, j] + 1:
            i -= 1
        else:
            j -= 1
    return out


def main(argv: list[str]) -> None:
    p = argparse.ArgumentParser(prog="quality.own")
    p.add_argument("recording")
    p.add_argument("--script", default=str(OWN / "script.txt"))
    p.add_argument("--device", default="cuda")
    a = p.parse_args(argv)
    lines = lines_of(Path(a.script))
    samples = decode(a.recording)

    name = "large-v3-turbo"
    bench.place(name)
    rec = asr.recognizer(name)
    rec.load(name, a.device, None, 0)
    segments, _ = rec.transcribe(samples, language="ru")
    # The heard words with their times, normalized one by one as the script's are.
    heard: list[tuple[str, float, float]] = []
    for seg in segments:
        for w in seg["words"]:
            for word in normalize(w["word"]):
                heard.append((word, w["start"], w["end"]))
    script: list[tuple[str, int]] = [(word, k) for k, line in enumerate(lines) for word in normalize(line)]
    mapping = align([w for w, _ in script], [w for w, _, _ in heard])
    print(f"{len(lines)} lines, {len(samples) / RATE:.0f} s, {len(heard)} words heard")

    for old in OWN.glob("??-[0-9][0-9].*"):
        old.unlink()
    cuts: dict[int, tuple[float, float, float]] = {}
    for k, line in enumerate(lines):
        found = [mapping[i] for i, (_, line_of) in enumerate(script) if line_of == k and mapping[i] is not None]
        if not found:
            continue
        first, last = min(found), max(found)
        start, end = heard[first][1] - MARGIN, heard[last][2] + MARGIN
        # Never into the neighbours' words.
        if first > 0:
            start = max(start, (heard[first - 1][2] + heard[first][1]) / 2)
        if last + 1 < len(heard):
            end = min(end, (heard[last][2] + heard[last + 1][1]) / 2)
        said = " ".join(w for w, _, _ in heard[first : last + 1])
        d = edits(normalize(line), said.split()) / max(1, len(normalize(line)))
        if d <= 0.5:
            cuts[k] = (start, end, d)
    # A line the whole recording's language hid (English heard as Russian): the gap between its
    # neighbours, heard on its own as dictation hears a phrase.
    for k, line in enumerate(lines):
        if k in cuts:
            continue
        start = cuts[k - 1][1] if k - 1 in cuts else 0.0
        end = cuts[k + 1][0] if k + 1 in cuts else len(samples) / RATE
        text, _, _ = rec.dictate(samples[int(start * RATE) : int(end * RATE)], None, ["ru", "en"], "", 5, "", strict=True)
        d = edits(normalize(line), normalize(text)) / max(1, len(normalize(line)))
        if d <= 0.5:
            cuts[k] = (start, end, d)
        else:
            print(f"  line {k + 1}: left out, {d:.0%} away from what was heard between its neighbours")
    saved = 0
    for k, line in enumerate(lines):
        if k not in cuts:
            continue
        start, end, d = cuts[k]
        lang = "en" if script_of(line) == "latin" else "ru"
        stem = f"{lang}-{k + 1:02d}"
        clip = samples[max(0, int(start * RATE)) : int(end * RATE)]
        with wave.open(str(OWN / f"{stem}.wav"), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(RATE)
            w.writeframes((np.clip(clip, -1, 1) * 32767).astype("<i2").tobytes())
        (OWN / f"{stem}.txt").write_text(line, "utf-8")
        saved += 1
        print(f"  line {k + 1}: {start:.1f}–{end:.1f} s, {d:.0%} heard differently")
    print(f"{saved} of {len(lines)} lines saved in {OWN}")


if __name__ == "__main__":
    main(sys.argv[1:])
