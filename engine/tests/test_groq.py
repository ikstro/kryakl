"""A recording's words from Groq's Whisper with the person's key: the keys held in memory only, the pieces
sent and their times put back, Groq's limits waited out, a failure falling back to this computer.

Nothing here reaches the network: Groq's answers are made up (asr.groq_post is replaced).
"""

import json

import numpy as np
import pytest

import app as engine
import asr
import audio
import jobs
import settings as settings_module
from asr import RATE
from store import Store
from test_security import KEY, Client

GROQ = "gsk_secret_groq_key_123"
HF = "hf_secret_token_456"


# ------------------------------------------------------------ the keys

def test_keys_from_the_environment_are_used_and_never_written(tmp_path, monkeypatch):
    file = tmp_path / "speech.json"
    # An older Kryakl saved the Hugging Face key in the file.
    file.write_text(json.dumps({"hfToken": "hf_old_saved"}), "utf-8")
    monkeypatch.setenv("KRYA_HF_TOKEN", HF)
    monkeypatch.setenv("KRYA_GROQ_KEY", GROQ)
    s = settings_module.Settings(file)
    assert s["hfToken"] == HF and s.secret("groqKey") == GROQ and s.get()["hfToken"] == HF
    assert "groqKey" not in s.get()
    # The one Kryakl holds now leaves the file at once.
    assert "hf_old_saved" not in file.read_text("utf-8")
    s.update({"remoteTranscribe": True, "hfToken": "hf_plain_from_an_older_app"})
    text = file.read_text("utf-8")
    assert GROQ not in text and HF not in text and "hf_plain_from_an_older_app" not in text
    assert json.loads(text)["hfToken"] == "" and json.loads(text)["remoteTranscribe"] is True
    assert s["hfToken"] == "hf_plain_from_an_older_app"


def test_a_key_saved_by_an_older_kryakl_is_still_read(tmp_path, monkeypatch):
    monkeypatch.delenv("KRYA_HF_TOKEN", raising=False)
    file = tmp_path / "speech.json"
    file.write_text(json.dumps({"hfToken": "hf_old_saved"}), "utf-8")
    s = settings_module.Settings(file)
    assert s["hfToken"] == "hf_old_saved" and s.secret("hfToken") == "hf_old_saved" and s.secret("groqKey") == ""
    # An older app's plain hfToken is saved as it always was.
    s.update({"hfToken": "hf_new_plain"})
    assert json.loads(file.read_text("utf-8"))["hfToken"] == "hf_new_plain"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    for variable in settings_module.SECRETS.values():
        monkeypatch.delenv(variable, raising=False)
    s = settings_module.Settings(tmp_path / "speech.json")
    s.update({"dataDir": str(tmp_path / "Transcripts")})
    monkeypatch.setattr(engine, "settings", s)
    monkeypatch.setattr(engine.state, "store", None)
    started = []
    monkeypatch.setattr(engine.setup, "start", started.append)
    c = Client()
    c.started, c.file = started, tmp_path / "speech.json"
    return c


def test_keys_put_in_settings_stay_in_memory(client):
    r = client.put("/settings", headers=KEY, json={"secrets": {"hfToken": HF, "groqKey": GROQ}, "remoteTranscribe": True})
    assert r.status_code == 200
    body = r.json()
    assert body["hasToken"] is True and body["hasGroqKey"] is True and body["remoteTranscribe"] is True
    assert "secrets" not in body and "groqKey" not in body and "hfToken" not in body
    # The Hugging Face key given so is checked at once, as a saved one is.
    assert client.started == [HF]
    text = client.file.read_text("utf-8")
    assert HF not in text and GROQ not in text
    assert client.get("/health", headers=KEY).json()["remote"] == {"transcribe": True}
    got = client.get("/settings", headers=KEY).json()
    assert got["hasGroqKey"] is True and got["remoteTranscribe"] is True
    # '' removes one.
    r = client.put("/settings", headers=KEY, json={"secrets": {"groqKey": ""}})
    assert r.json()["hasGroqKey"] is False and r.json()["hasToken"] is True
    assert client.get("/health", headers=KEY).json()["remote"] == {"transcribe": False}
    # Saving anything later writes no key either.
    client.put("/settings", headers=KEY, json={"kbInbox": "Notes"})
    text = client.file.read_text("utf-8")
    assert HF not in text and GROQ not in text


def test_an_older_app_s_plain_token_still_works(client):
    r = client.put("/settings", headers=KEY, json={"hfToken": "hf_plain"})
    assert r.json()["hasToken"] is True and client.started == ["hf_plain"]
    assert client.get("/health", headers=KEY).json()["remote"] == {"transcribe": False}


# ------------------------------------------------------------ the pieces

def tone(seconds: float, at: list[tuple[float, float]]) -> np.ndarray:
    """Silence with a loud tone where `at` says (seconds), as speech for the cutter."""
    samples = np.zeros(int(seconds * RATE), dtype=np.float32)
    for a, b in at:
        n = np.arange(int(a * RATE), int(b * RATE))
        samples[n] = 0.5 * np.sin(n / 5)
    return samples


def chunk(a: float, b: float) -> dict:
    return {"start": int(a * RATE), "end": int(b * RATE)}


def test_the_silence_between_speech_is_left_out_and_times_come_back():
    samples = tone(20, [(1, 3), (10, 12)])
    [piece] = asr.pieces_of(samples, [chunk(1, 3), chunk(10, 12)], most=600)
    assert piece.seconds == pytest.approx(4.0)
    assert piece.original(0.5) == pytest.approx(1.5)
    assert piece.original(2.5) == pytest.approx(10.5)
    # A word that ends on the join ends where its part ends, not where the next begins.
    assert piece.original(2.0, end=True) == pytest.approx(3.0)
    assert piece.original(2.0) == pytest.approx(10.0)


def test_speech_longer_than_a_piece_goes_in_several():
    samples = tone(30, [(1, 3), (10, 12), (20, 22)])
    pieces = asr.pieces_of(samples, [chunk(1, 3), chunk(10, 12), chunk(20, 22)], most=4.5)
    assert [round(p.seconds, 2) for p in pieces] == [4.0, 2.0]
    assert pieces[1].original(1.0) == pytest.approx(21.0)


def test_an_unbroken_stretch_is_cut_at_a_pause_never_mid_word():
    # 8 s of "speech" with a short pause at 2.5 s: a piece of 3 s is cut there.
    samples = tone(10, [(1, 3.4), (3.6, 9)])
    pieces = asr.pieces_of(samples, [chunk(1, 9)], most=3.0)
    first_end = pieces[0].spans[-1][1] + pieces[0].spans[-1][2]
    assert 3.4 <= first_end <= 3.6
    assert all(p.seconds <= 3.0 + 1e-6 for p in pieces)
    assert sum(p.seconds for p in pieces) == pytest.approx(8.0)


def test_the_prompt_takes_the_spellings_within_224_tokens_and_ends_in_a_full_stop():
    assert asr.groq_prompt("") == ""
    assert asr.groq_prompt("Kryakl, Groq") == "Kryakl, Groq."
    assert asr.groq_prompt("Kryakl, ikstro.") == "Kryakl, ikstro."
    # "abcdef" costs 2 tokens: 112 of them fit, the 113th does not.
    words = ", ".join(f"abcde{chr(65 + n % 26)}" for n in range(150))
    prompt = asr.groq_prompt(words)
    assert prompt.endswith(".") and len(prompt[:-1].split(", ")) == 112
    # A long word costs its letters over three, rounded up.
    assert asr.groq_prompt("a" * 672) == "a" * 672 + "."
    assert asr.groq_prompt("a" * 673) == ""


def test_groq_s_language_name_becomes_a_code():
    assert asr.language_code("Russian") == "ru" and asr.language_code("uk") == "uk"
    assert asr.language_code(None) is None and asr.language_code("") is None


# ------------------------------------------------------------ Groq's answers

def answer(words: list[tuple[str, float, float]], text: str, language="russian") -> tuple[int, dict, bytes]:
    body = {
        "text": text, "language": language, "duration": words[-1][2] if words else 0,
        "segments": [{"start": words[0][1], "end": words[-1][2], "text": " " + text, "avg_logprob": -0.2, "no_speech_prob": 0.01, "compression_ratio": 1.2}],
        "words": [{"word": w, "start": a, "end": b} for w, a, b in words],
    }
    return 200, {}, json.dumps(body).encode()


class FakeGroq:
    """Answers in turn; records what was asked (never the network)."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.asked = []

    def __call__(self, key, fields, data, filename, mime, timeout):
        self.asked.append({"key": key, "fields": fields, "bytes": len(data)})
        a = self.answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a


def groq(post, **kw) -> asr.GroqWhisper:
    return asr.GroqWhisper(GROQ, post=post, encode=lambda s: (b"x" * 10, "piece.flac", "audio/flac"), **kw)


@pytest.fixture()
def speech(monkeypatch):
    """The VAD replaced: speech where the test says."""
    found = []
    monkeypatch.setattr(asr, "speech_chunks", lambda samples: found)
    return found


def test_words_land_at_their_real_times_across_silence_and_pieces(speech, monkeypatch):
    monkeypatch.setattr(asr, "GROQ_PIECE", 4.5)
    speech[:] = [chunk(1, 3), chunk(10, 12), chunk(20, 22)]
    post = FakeGroq(
        # Piece 1: 1–3 s then 10–12 s of the recording, joined at 2.0 s.
        answer([("Привет", 0.2, 0.8), ("мир", 1.0, 1.6), ("как", 2.2, 2.6), ("дела", 2.7, 3.4)], "Привет, мир! Как дела?"),
        # Piece 2: 20–22 s.
        answer([("Хорошо", 0.1, 0.9)], "Хорошо."),
    )
    segments, language = groq(post).transcribe(tone(30, []), None, "Kryakl, Groq")
    assert language == "ru"
    words = [w for s in segments for w in s["words"]]
    assert [w["word"] for w in words] == [" Привет,", " мир!", " Как", " дела?", " Хорошо."]
    assert [(w["start"], w["end"]) for w in words] == [(1.2, 1.8), (2.0, 2.6), (10.2, 10.6), (10.7, 11.4), (20.1, 20.9)]
    assert segments[0]["start"] == 1.2 and segments[-1]["end"] == 20.9
    fields = dict(post.asked[0]["fields"])
    assert fields["model"] == "whisper-large-v3-turbo" and fields["response_format"] == "verbose_json"
    assert fields["temperature"] == "0" and fields["prompt"] == "Kryakl, Groq." and "language" not in fields
    assert [v for k, v in post.asked[0]["fields"] if k == "timestamp_granularities[]"] == ["word", "segment"]


def test_a_fixed_language_is_sent(speech):
    speech[:] = [chunk(0, 2)]
    post = FakeGroq(answer([("Hello", 0.1, 0.5)], "Hello.", language=None))
    _, language = groq(post).transcribe(tone(3, []), "en", "")
    assert dict(post.asked[0]["fields"])["language"] == "en" and language == "en"
    assert "prompt" not in dict(post.asked[0]["fields"])


def test_a_credit_nobody_said_is_cut_as_from_a_local_model(speech):
    speech[:] = [chunk(0, 4)]
    post = FakeGroq(answer([("Да", 0.1, 0.4), ("Субтитры", 1.0, 1.5), ("сделал", 1.5, 1.9), ("DimaTorzok", 1.9, 2.6)], "Да. Субтитры сделал DimaTorzok"))
    segments, _ = groq(post).transcribe(tone(5, []), None, "")
    assert [w["word"] for s in segments for w in s["words"]] == [" Да."]


def test_the_limit_is_waited_out_and_the_work_goes_on(speech):
    speech[:] = [chunk(0, 2)]
    slept, told = [], []
    post = FakeGroq((429, {"retry-after": "7"}, b"{}"), answer([("Hello", 0.1, 0.5)], "Hello."))
    g = groq(post, sleep=slept.append, clock=lambda: 1000.0, on_wait=told.append)
    segments, _ = g.transcribe(tone(3, []), None, "")
    assert slept == [7.0] and told == [1007.0, None]
    assert segments[0]["text"] == "Hello." and g.stats["waited"] == 7.0 and g.stats["requests"] == 2


def test_a_key_groq_refuses_fails_with_the_message(speech):
    speech[:] = [chunk(0, 2)]
    with pytest.raises(asr.GroqRejected, match="Groq did not accept the saved key."):
        groq(FakeGroq((401, {}, b'{"error": "Invalid API Key"}'))).transcribe(tone(3, []), None, "")


def test_no_connection_is_tried_three_more_times(speech):
    speech[:] = [chunk(0, 2)]
    slept = []
    post = FakeGroq(OSError("down"), (503, {}, b""), OSError("down"), OSError(f"down {GROQ}"))
    with pytest.raises(asr.GroqUnreachable, match="No connection to Groq.") as error:
        groq(post, sleep=slept.append).transcribe(tone(3, []), None, "")
    assert len(post.asked) == 4 and slept == list(asr.GROQ_RETRIES)
    assert GROQ not in str(error.value)


# ------------------------------------------------------------ a whole job

class FakeLocal:
    """A local Whisper that is never loaded: its words say they are this computer's."""

    name, device, compute = "large-v3-turbo", "cpu", "int8"

    def transcribe(self, samples, language, hotwords, progress):
        return [{"start": 0.5, "end": 1.0, "text": "Local.", "words": [{"start": 0.5, "end": 1.0, "word": " Local."}]}], "en"


@pytest.fixture()
def job(tmp_path, monkeypatch, speech):
    for variable in settings_module.SECRETS.values():
        monkeypatch.delenv(variable, raising=False)
    s = settings_module.Settings(tmp_path / "speech.json")
    s.update({"dataDir": str(tmp_path / "Transcripts"), "remoteTranscribe": True})
    s.set_secrets({"groqKey": GROQ})
    store = Store(tmp_path / "Transcripts")
    w = jobs.Worker(s, lambda: store)
    monkeypatch.setattr(audio, "decode", lambda path, progress=None: tone(5, [(1, 3)]))
    monkeypatch.setattr(audio, "save_opus", lambda samples, path, **kw: path.write_bytes(b"ogg"))
    monkeypatch.setattr(w, "_speakers", lambda *a: (None, "no-part"))
    monkeypatch.setattr(w, "words_model", lambda: FakeLocal())
    monkeypatch.setattr(asr, "GROQ_RETRIES", (0.0, 0.0, 0.0))
    speech[:] = [chunk(1, 3)]
    source = tmp_path / "call.wav"
    source.write_bytes(b"wav")
    id = store.create("Call", "file", "queued", {"kind": "file", "inputs": [{"path": str(source), "track": "main", "offset": 0, "temp": False}]})

    def run(post, local_here=True):
        monkeypatch.setattr(asr, "groq_post", post)
        monkeypatch.setattr(asr, "downloaded", lambda name: local_here)
        try:
            w._process(id)
        except Exception as error:
            w._failed(id, str(error))
        return store.row(id), store.transcript(id)

    run.store, run.id = store, id
    return run


def test_a_job_by_groq_says_so_in_its_transcript_and_the_library(job):
    row, t = job(FakeGroq(answer([("Hello", 0.1, 0.5)], "Hello.", language="english")))
    assert row["status"] == "done" and t["by"] == "groq" and row["by"] == "groq"
    assert t["utterances"][0]["text"] == "Hello." and t["words"][0]["start"] == 1.1 and t["language"] == "en"
    assert job.store.list()[0]["by"] == "groq" and "ran" not in row["job"]


def test_no_connection_recognizes_the_whole_job_here(job):
    row, t = job(FakeGroq(*[OSError("down")] * 4))
    assert row["status"] == "done" and "by" not in t and "by" not in row
    assert t["utterances"][0]["text"] == "Local."
    assert row["job"]["ran"] == {"model": "large-v3-turbo", "why": "offline"}


def test_no_connection_and_no_local_model_fails(job):
    row, t = job(FakeGroq(*[OSError("down")] * 4), local_here=False)
    assert row["status"] == "failed" and row["error"] == "No connection to Groq." and t is None


def test_a_refused_key_fails_the_job(job):
    row, _ = job(FakeGroq((403, {}, b"")))
    assert row["status"] == "failed" and row["error"] == "Groq did not accept the saved key."


def test_the_limit_shows_on_the_job_while_it_waits(job, monkeypatch):
    seen = []
    real = asr.GroqWhisper._wait

    def wait(self, seconds):
        self._sleep = lambda s: seen.append((job.store.row(job.id)["stage"], job.store.row(job.id)["job"].get("until")))
        real(self, seconds)

    monkeypatch.setattr(asr.GroqWhisper, "_wait", wait)
    row, t = job(FakeGroq((429, {"retry-after": "3"}, b""), answer([("Hello", 0.1, 0.5)], "Hello.")))
    [(stage, until)] = seen
    assert stage == "waiting" and isinstance(until, int)
    assert row["status"] == "done" and t["by"] == "groq"


# ------------------------------------------------------------ what the app reads

def test_the_app_reads_who_recognized_it_and_until_when_it_waits(client):
    store = engine.state.get_store()
    by_groq = store.create("Call", "file", "done", {"kind": "file"})
    store.save(by_groq, {"id": by_groq, "title": "Call", "by": "groq", "utterances": [], "speakers": {}})
    here = store.create("Note", "file", "done", {"kind": "file"})
    store.save(here, {"id": here, "title": "Note", "utterances": [], "speakers": {}})
    listed = {r["id"]: r for r in client.get("/transcripts", headers=KEY).json()}
    assert listed[by_groq]["by"] == "groq" and "by" not in listed[here] and "remote" not in listed[here]
    one = client.get(f"/transcripts/{by_groq}", headers=KEY).json()
    assert one["row"]["by"] == "groq" and one["transcript"]["by"] == "groq"
    assert "by" not in client.get(f"/transcripts/{here}", headers=KEY).json()["row"]
    waiting = store.create("Long", "file", "working", {"kind": "file", "until": 1_800_000_000})
    store.update(waiting, stage="waiting")
    assert client.get(f"/transcripts/{waiting}", headers=KEY).json()["row"]["until"] == 1_800_000_000


def test_a_library_made_before_gains_the_column(tmp_path):
    import sqlite3

    root = tmp_path / "lib"
    root.mkdir()
    con = sqlite3.connect(str(root / "index.db"))
    con.execute("create table transcripts(id text primary key, title text not null, source text not null, created text not null, duration real default 0, status text not null, stage text default '', progress real default 0, error text default '', language text default '', speakers_status text default '', job text default '{}', touched text default '')")
    con.execute("insert into transcripts(id, title, source, created, status) values('a', 'Old', 'file', '2026-01-01T00:00:00', 'done')")
    con.commit()
    con.close()
    s = Store(root)
    assert s.row("a")["title"] == "Old" and "by" not in s.row("a") and "by" not in s.list()[0]
