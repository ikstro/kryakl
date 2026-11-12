"""The dictation quality bench.

    cd engine
    uv run --no-sync python -m quality.run --models parakeet-tdt-0.6b-v3,small --device cpu --threads 4
    uv run --no-sync python -m quality.run --models large-v3-turbo --device cuda --label beam5
    uv run --no-sync python -m quality.run --models small --set audio.LIFT_BELOW=None --label no-lift
    uv run --no-sync python -m quality.run --mode stream --models parakeet-tdt-0.6b-v3 --n 12
    uv run --no-sync python -m quality.run compare <baseline.json> <other.json>

Every phrase goes through the engine's own code: a whole phrase as /dictate takes it
(`asr.Transcriber.dictate`, `asr.Parakeet.dictate`), or a take of several phrases with pauses
fed as the badge sends it, a quarter of a second at a time in real time (`stream.Session`).
`--threads 2` or `4` imitates a weaker processor: the times are this computer's with fewer
threads, not a real laptop's. `--set module.NAME=value` changes one of the engine's constants
for the run (a lever to try), so a lever is measured against the same phrases and noise.

Raw results (with the texts heard) go to .cache/speech-quality/runs/; `--report` appends the
table, never a text, to docs/speech-quality.md.
"""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import gc
import importlib
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

ENGINE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINE))

from quality.sets import ROOT, fetch_fleurs, load, own  # noqa: E402

# Settings of a test home, never the person's (asr imports settings).
os.environ.setdefault("KRYA_SPEECH_HOME", str(ROOT / "home"))

import numpy as np  # noqa: E402

import asr  # noqa: E402
import settings  # noqa: E402
from audio import RATE  # noqa: E402
from quality import conditions  # noqa: E402
from quality.wer import score, wrong_language  # noqa: E402

REPORT = ENGINE.parent / "docs" / "speech-quality.md"
REAL_MODELS = settings.MODELS_DIR
BENCH_MODELS = ROOT / "models"
ALIASES = {"parakeet": "parakeet-tdt-0.6b-v3", "turbo": "large-v3-turbo", "large": "large-v3"}


def _use(models_dir: Path) -> None:
    asr.MODELS_DIR = models_dir
    asr.WHISPER_DIR = models_dir / "whisper"


def place(name: str) -> str:
    """Kryakl's own copy of a model when it has one; else the bench's (downloaded once into .cache)."""
    _use(REAL_MODELS)
    if asr.downloaded(name):
        return "Kryakl's"
    _use(BENCH_MODELS)
    return "bench's"


def expected_for(lang: str, given: list[str] | None) -> list[str]:
    """Who dictates: a person whose own language is the phrase's (an English phrase: a Russian speaker's)."""
    if given:
        return given
    return [lang, "en"] if lang != "en" else ["ru", "en"]


def apply_levers(pairs: list[str]) -> dict:
    """`module.NAME=value` → the engine's constant set for this run."""
    done = {}
    for pair in pairs:
        target, _, raw = pair.partition("=")
        module, _, name = target.rpartition(".")
        mod = importlib.import_module(module)
        if not hasattr(mod, name):
            raise SystemExit(f"{module} has no {name}")
        try:
            value = ast.literal_eval(raw)
        except (ValueError, SyntaxError):
            value = raw
        setattr(mod, name, value)
        done[target] = value
    return done


def default_beam(name: str, device: str) -> int:
    """The plan's beam (speechplan.ts): 5 on the card, 2 on the processor; Parakeet has none."""
    if asr.backend(name) != "whisper":
        return 0
    return 5 if device == "cuda" else 2


def phrases_of(lang: str, n: int, sets: str) -> list[dict]:
    """`sets`: fleurs, own (the owner's reading), or both."""
    out = fetch_fleurs(lang, n) if "fleurs" in sets and lang in ("ru", "uk", "en") else []
    if "own" in sets:
        out += own([lang])
    return out


def run_phrases(rec, name, device, threads, beam, langs, conds, n, expected, sets, hotwords) -> list[dict]:
    items = []
    for lang in langs:
        phrases = phrases_of(lang, n, sets)
        sounds = [load(p) for p in phrases]
        for cond in conds:
            for i, p in enumerate(phrases):
                others = [sounds[(i + k) % len(sounds)] for k in range(1, 5)]
                x = conditions.make(sounds[i], cond, p["id"], others)
                started = time.perf_counter()
                text, heard_as, _sure = rec.dictate(x, None, expected_for(lang, expected), hotwords, beam, "", strict=True)
                took = time.perf_counter() - started
                e, w = score(p["text"], text)
                items.append({"model": name, "device": device, "threads": threads, "mode": "phrase", "lang": lang, "cond": cond, "id": p["id"],
                              "seconds": round(len(x) / RATE, 2), "took": round(took, 3), "errors": e, "words": w,
                              "wrong": wrong_language(text, lang), "heard_as": heard_as, "ref": p["text"], "hyp": text})
            last = [it for it in items if it["lang"] == lang and it["cond"] == cond]
            print(f"  {name} {lang} {cond}: {100 * sum(i['errors'] for i in last) / max(1, sum(i['words'] for i in last)):.1f} % "
                  f"({statistics.mean(i['took'] for i in last):.2f} s)", flush=True)
    return items


def takes_of(phrases: list[dict], sounds: list[np.ndarray], size: int, key: str) -> list[tuple[str, str, np.ndarray]]:
    """Phrases joined into takes of `size`, with pauses of 0.3–1.5 s between them (the same for every run)."""
    rng = np.random.default_rng(len(key))
    out = []
    for start in range(0, len(phrases) - size + 1, size):
        parts, refs = [], []
        for k in range(start, start + size):
            parts.append(sounds[k])
            parts.append(np.zeros(int(rng.uniform(0.3, 1.5) * RATE), dtype=np.float32))
            refs.append(phrases[k]["text"])
        out.append((f"{phrases[start]['id']}+{size}", " ".join(refs), np.concatenate(parts[:-1])))
    return out


def run_stream(rec, name, device, threads, beam, langs, conds, n, expected, sets, hotwords, size, speed) -> list[dict]:
    import stream

    items = []
    kind = (asr.backend(name), device)
    chunk = RATE // 4
    for lang in langs:
        phrases = phrases_of(lang, n, sets)
        sounds = [load(p) for p in phrases]
        for cond in conds:
            for take_id, ref, clean in takes_of(phrases, sounds, size, lang):
                x = conditions.make(clean, cond, take_id, sounds[:4])
                pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
                recognize = lambda s, language, exp, before: rec.dictate(s, language, exp, hotwords, beam, before, strict=True)  # noqa: E731
                session = stream.Session(recognize, kind, expected_for(lang, expected))
                started = time.perf_counter()
                step = chunk * 2
                for seq, at in enumerate(range(0, len(pcm), step)):
                    session.add(seq, pcm[at : at + step])
                    wait = started + (seq + 1) * 0.25 / speed - time.perf_counter()
                    if wait > 0:
                        time.sleep(wait)
                pending = session.status()["pending"]
                t0 = time.perf_counter()
                out = session.finish(b"")
                tail = time.perf_counter() - t0
                e, w = score(ref, out["text"])
                items.append({"model": name, "device": device, "threads": threads, "mode": "stream", "lang": lang, "cond": cond, "id": take_id,
                              "seconds": round(len(x) / RATE, 2), "took": round(out["took"], 3), "tail": round(tail, 3), "pending": pending,
                              "errors": e, "words": w, "wrong": wrong_language(out["text"], lang), "heard_as": out["language"], "ref": ref, "hyp": out["text"]})
                print(f"  {name} {lang} {cond} {take_id}: {100 * e / max(1, w):.1f} %, tail {tail:.2f} s", flush=True)
    return items


# ------------------------------------------------------------------ tables


def _wer(items) -> float:
    return 100 * sum(i["errors"] for i in items) / max(1, sum(i["words"] for i in items))


def _rows(items):
    keys = sorted({(i["model"], i["device"], i["threads"], i["mode"]) for i in items}, key=lambda k: (k[3], k[1], -k[2], k[0]))
    for key in keys:
        yield key, [i for i in items if (i["model"], i["device"], i["threads"], i["mode"]) == key]


def _label(key) -> str:
    model, device, threads, mode = key
    where = "card" if device == "cuda" else f"cpu {threads}t" if threads else "cpu"
    return f"{asr._MODELS.get(model, {}).get('label', model)} · {where}" + (" · stream" if mode == "stream" else "")


def table(items: list[dict]) -> str:
    langs = [lang for lang in ("ru", "uk", "en") if any(i["lang"] == lang for i in items)]
    conds = [c for c in conditions.CONDITIONS if any(i["cond"] == c for i in items)]
    head = ["Model"] + langs + conds + ["all", "wrong lang", "s / phrase", "p90 s"]
    if any(i["mode"] == "stream" for i in items):
        head += ["tail s", "tail max"]
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for key, group in _rows(items):
        took = sorted(i["took"] for i in group)
        cells = [_label(key)]
        cells += [f"{_wer([i for i in group if i['lang'] == lang]):.1f}" for lang in langs]
        cells += [f"{_wer([i for i in group if i['cond'] == c]):.1f}" for c in conds]
        cells += [f"**{_wer(group):.1f}**", f"{sum(1 for i in group if i['wrong'])} / {len(group)}",
                  f"{statistics.mean(took):.2f}", f"{took[int(0.9 * (len(took) - 1))]:.2f}"]
        if "tail s" in head:
            tails = [i["tail"] for i in group if "tail" in i]
            cells += [f"{statistics.mean(tails):.2f}", f"{max(tails):.2f}"] if tails else ["", ""]
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines)


def detail(items: list[dict]) -> str:
    """Word errors per language and condition, one block per model."""
    out = []
    for key, group in _rows(items):
        langs = sorted({i["lang"] for i in group})
        conds = [c for c in conditions.CONDITIONS if any(i["cond"] == c for i in group)]
        out.append(f"{_label(key)}\n| | " + " | ".join(conds) + " |\n|" + "---|" * (len(conds) + 1))
        for lang in langs:
            out.append(f"| {lang} | " + " | ".join(f"{_wer([i for i in group if i['lang'] == lang and i['cond'] == c]):.1f}" for c in conds) + " |")
        out.append("")
    return "\n".join(out)


def compare(base_file: str, other_file: str) -> str:
    """The second run against the first, on the phrases both have: word errors and time, per model, language and condition."""
    base = json.loads(Path(base_file).read_text("utf-8"))
    other = json.loads(Path(other_file).read_text("utf-8"))
    key = lambda i: (i["model"], i["device"], i["threads"], i["mode"], i["lang"], i["cond"], i["id"])  # noqa: E731
    b = {key(i): i for i in base["items"]}
    pairs = [(b[key(i)], i) for i in other["items"] if key(i) in b]
    lines = [f"{other['label']} against {base['label']} ({len(pairs)} phrases; word errors %, then seconds a phrase)", "",
             "| Model | part | before | after | change | s before | s after |", "|---|---|---|---|---|---|---|"]
    groups: dict = {}
    for x, y in pairs:
        for part in ("all", x["lang"], x["cond"]):
            groups.setdefault((x["model"], x["device"], x["threads"], x["mode"], part), []).append((x, y))
    for (model, device, threads, mode, part), group in sorted(groups.items(), key=lambda kv: (kv[0][:4], kv[0][4] != "all")):
        before, after = _wer([x for x, _ in group]), _wer([y for _, y in group])
        change = f"{100 * (after - before) / before:+.0f} %" if before else ""
        lines.append(f"| {_label((model, device, threads, mode))} | {part} | {before:.1f} | {after:.1f} | {change} | "
                     f"{statistics.mean(x['took'] for x, _ in group):.2f} | {statistics.mean(y['took'] for _, y in group):.2f} |")
    return "\n".join(lines)


def commit() -> str:
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ENGINE, capture_output=True, text=True, timeout=10).stdout.strip()
    except OSError:
        return ""


def main(argv: list[str]) -> None:
    if argv and argv[0] == "compare":
        print(compare(argv[1], argv[2]))
        return
    if argv and argv[0] == "report":
        for file in argv[1:]:
            record = json.loads(Path(file).read_text("utf-8"))
            report(record)
            print(f"{record['label']} written to {REPORT}")
        return
    p = argparse.ArgumentParser(prog="quality.run")
    p.add_argument("--models", default="parakeet-tdt-0.6b-v3,tiny,base,small")
    p.add_argument("--device", default="cpu", choices=("cpu", "cuda"))
    p.add_argument("--threads", default="0", help="processor threads, comma-separated (0: the engine's default)")
    p.add_argument("--langs", default="ru,uk,en")
    p.add_argument("--conditions", default=",".join(conditions.CONDITIONS))
    p.add_argument("--n", type=int, default=40, help="phrases per language")
    p.add_argument("--mode", default="phrase", choices=("phrase", "stream"))
    p.add_argument("--take", type=int, default=4, help="phrases in a take (stream)")
    p.add_argument("--speed", type=float, default=1.0, help="how much faster than real time the sound is fed (stream)")
    p.add_argument("--beam", type=int, default=0, help="Whisper's beam (0: the plan's)")
    p.add_argument("--expected", default="", help="the languages expected, for every phrase (default: the phrase's own and English)")
    p.add_argument("--sets", default="fleurs", help="fleurs, own (the owner's reading in .cache/speech-quality/own), or fleurs,own")
    p.add_argument("--hotwords", default="")
    p.add_argument("--set", action="append", default=[], help="module.NAME=value")
    p.add_argument("--label", default="baseline")
    p.add_argument("--report", action="store_true", help="append the table to docs/speech-quality.md")
    p.add_argument("--detail", action="store_true")
    a = p.parse_args(argv)

    levers = apply_levers(a.set)
    langs = a.langs.split(",")
    conds = a.conditions.split(",")
    expected = a.expected.split(",") if a.expected else None
    items: list[dict] = []
    for raw in a.models.split(","):
        name = ALIASES.get(raw, raw)
        where = place(name)
        for threads in [int(t) for t in a.threads.split(",")]:
            if a.device == "cuda" and threads:
                continue
            rec = asr.recognizer(name)
            started = time.perf_counter()
            rec.load(name, a.device, None, threads)
            rec.warm()
            print(f"{name} on {a.device} ({rec.compute}, {threads or 'default'} threads, {where} copy) loaded in {time.perf_counter() - started:.1f} s", flush=True)
            beam = a.beam or default_beam(name, a.device)
            args = (rec, name, a.device, threads, beam, langs, conds, a.n, expected, a.sets, a.hotwords)
            items += run_stream(*args, a.take, a.speed) if a.mode == "stream" else run_phrases(*args)
            rec.unload()
            del rec
            gc.collect()

    stamp = dt.datetime.now().strftime("%Y-%m-%d %H%M")
    plain = {k: v if isinstance(v, (str, int, float, bool, type(None))) else repr(v) for k, v in levers.items()}
    record = {"label": a.label, "at": stamp, "commit": commit(), "args": vars(a), "levers": plain, "items": items}
    runs = ROOT / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    out = runs / f"{stamp} {a.label}.json"
    out.write_text(json.dumps(record, ensure_ascii=False, indent=1), "utf-8")
    text = table(items)
    print("\n" + text + "\n")
    if a.detail:
        print(detail(items))
    print(f"raw results: {out}")
    if a.report:
        report(record)


def report(record: dict) -> None:
    """A run's table, never its texts, appended to docs/speech-quality.md."""
    a = record["args"]
    head = (f"\n### {record['label']} · {record['at']} · {record['commit']}\n\n"
            f"{a['mode']}, {a['n']} phrases a language, {a['conditions'].replace(',', ', ')}"
            + (f"; levers {record['levers']}" if record["levers"] else "") + (f"; beam {a['beam']}" if a["beam"] else "") + "\n\n")
    with REPORT.open("a", encoding="utf-8") as f:
        f.write(head + table(record["items"]) + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
