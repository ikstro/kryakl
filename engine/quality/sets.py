"""The bench's phrases: FLEURS read speech (Google, CC BY 4.0) and, when recorded, the owner's own.

FLEURS: the test split of ru_ru, uk_ua and en_us. Its archives are 280–410 MB each, so only
their first suitable phrases are read out of the download as it comes, and the rest is
never fetched: 3 to 20 seconds long (a dictated phrase), no digits (numbers would count as
mistakes for the way they are written, not heard). Kept in .cache/speech-quality/fleurs/.

The owner's own: .cache/speech-quality/own/<lang>-<name>.wav (or any sound file) with
<lang>-<name>.txt beside it, the text as meant; never in git.
"""

from __future__ import annotations

import csv
import io
import json
import re
import tarfile
import urllib.request
from pathlib import Path

import numpy as np

from audio import RATE, decode

ROOT = Path(__file__).resolve().parents[2] / ".cache" / "speech-quality"
FLEURS = {"ru": "ru_ru", "uk": "uk_ua", "en": "en_us"}
BASE = "https://huggingface.co/datasets/google/fleurs/resolve/main/data/{config}/{path}"
SHORTEST, LONGEST = 3.0, 20.0


def _get(url: str):
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "speech-bench"}), timeout=120)


def _index(lang: str) -> Path:
    return ROOT / "fleurs" / lang / "index.json"


def fetch_fleurs(lang: str, n: int) -> list[dict]:
    """At least `n` phrases of a language on the disk (fetched once), as [{id, file, text, lang, seconds}]."""
    index = _index(lang)
    have = json.loads(index.read_text("utf-8")) if index.exists() else []
    if len(have) >= n:
        return have[:n]
    config = FLEURS[lang]
    folder = index.parent
    folder.mkdir(parents=True, exist_ok=True)
    rows = {}
    with _get(BASE.format(config=config, path="test.tsv")) as response:
        for row in csv.reader(io.TextIOWrapper(response, "utf-8"), delimiter="\t", quoting=csv.QUOTE_NONE):
            if len(row) >= 6:
                rows[row[1]] = {"text": row[2], "seconds": int(row[5]) / RATE}
    got = {p["file"]: p for p in have}
    speakers_seen: set[str] = set()
    with _get(BASE.format(config=config, path="audio/test.tar.gz")) as response:
        with tarfile.open(fileobj=response, mode="r|gz") as tar:
            for member in tar:
                if len(got) >= n:
                    break
                name = Path(member.name).name
                row = rows.get(name)
                if not member.isfile() or not row or name in got:
                    continue
                if re.search(r"\d", row["text"]) or not SHORTEST <= row["seconds"] <= LONGEST:
                    continue
                # The same sentence is read by several people: one reading each, for more sentences.
                key = row["text"].strip().lower()
                if key in speakers_seen:
                    continue
                data = tar.extractfile(member).read()
                (folder / name).write_bytes(data)
                speakers_seen.add(key)
                got[name] = {"id": f"{lang}-{Path(name).stem}", "file": name, "text": row["text"], "lang": lang, "seconds": round(row["seconds"], 2)}
    phrases = list(got.values())
    index.write_text(json.dumps(phrases, ensure_ascii=False, indent=1), "utf-8")
    return phrases[:n]


def own(langs: list[str]) -> list[dict]:
    """The owner's recordings, if any: <lang>-<name>.<sound> with <lang>-<name>.txt."""
    folder = ROOT / "own"
    out = []
    for text in sorted(folder.glob("*.txt")) if folder.exists() else []:
        lang = text.stem.split("-", 1)[0]
        sound = next((p for p in folder.glob(text.stem + ".*") if p.suffix != ".txt"), None)
        if sound and lang in langs:
            out.append({"id": f"own-{text.stem}", "path": str(sound), "text": text.read_text("utf-8").strip(), "lang": lang})
    return out


def load(phrase: dict) -> np.ndarray:
    """A phrase's sound as float32 at 16 kHz."""
    return decode(phrase["path"] if "path" in phrase else _index(phrase["lang"]).parent / phrase["file"])
