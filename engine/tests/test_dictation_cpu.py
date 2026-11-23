"""A dictation session on the processor whatever the card: Kryakl's preview while Groq dictates.

The route is called through the real app; the worker is a fake that says which device each call asked for.
"""

import time

import numpy as np

import app as engine
from jobs import Worker
from test_security import KEY, Client


class FakeModel:
    compute, loaded = None, True

    def __init__(self, name, device):
        self.name, self.device = name, device

    def dictate(self, sound, language, expected, hotwords, beam, before, strict=False):
        return "Привет", "ru", 0.9

    def warm(self):
        pass


class FakeWorker:
    """The card's plan dictates with turbo, the processor's with Parakeet."""

    def __init__(self):
        self.loads = []
        self.activity = 0
        self.bench = type("Bench", (), {"phrase": lambda *a: None})()

    def entry(self, feature, device=None):
        return ("cpu", {"model": "parakeet-tdt-0.6b-v3"}) if device == "cpu" else ("cuda", {"model": "large-v3-turbo"})

    def dictation_model(self, on=None):
        self.loads.append(on)
        device, entry = self.entry("dictation", on)
        return FakeModel(entry["model"], device), entry


def opened(client: Client, body: dict):
    r = client.post("/dictate/sessions", headers=KEY, json=body)
    assert r.status_code == 200
    answer = r.json()
    s = engine.sessions.get(answer["id"])
    # The model is prepared on the session's own thread as it opens.
    for _ in range(200):
        if s.execution:
            break
        time.sleep(0.01)
    return answer, s


def test_device_cpu_runs_the_session_on_the_processor_s_plan(monkeypatch):
    fake = FakeWorker()
    monkeypatch.setattr(engine, "worker", fake)
    client = Client()
    answer, s = opened(client, {"expected": ["ru", "en"], "strict": True, "device": "cpu"})
    assert answer["model"]["device"] == "cpu" and answer["model"]["name"] == "parakeet-tdt-0.6b-v3"
    assert s.kind == ("parakeet", "cpu") and s.execution["device"] == "cpu"
    # Each piece asks for the processor's model too, never the card's.
    s._recognize(np.zeros(1600, dtype=np.float32), None, ["ru"], "")
    assert fake.loads and set(fake.loads) == {"cpu"}
    # Thrown away, never finished.
    assert client.request("DELETE", f"/dictate/sessions/{answer['id']}", headers=KEY).status_code == 204
    assert engine.sessions.get(answer["id"]) is None


def test_without_device_the_session_follows_the_plan_as_before(monkeypatch):
    fake = FakeWorker()
    monkeypatch.setattr(engine, "worker", fake)
    client = Client()
    answer, s = opened(client, {"expected": ["ru"]})
    assert answer["model"]["device"] == "cuda" and s.kind == ("whisper", "cuda")
    s._recognize(np.zeros(1600, dtype=np.float32), None, ["ru"], "")
    assert set(fake.loads) == {None}
    client.request("DELETE", f"/dictate/sessions/{answer['id']}", headers=KEY)
    # Anything but "cpu" is no device of its own.
    answer, _ = opened(client, {"device": "cuda"})
    assert answer["model"]["device"] == "cuda"
    client.request("DELETE", f"/dictate/sessions/{answer['id']}", headers=KEY)


def test_the_processor_s_whisper_never_takes_the_transcripts_model_off_the_card():
    class Model:
        def __init__(self, name=None, device=None):
            self.name, self.device, self.compute, self.loaded = name, device, None, bool(name)
            self.calls = []

        def load(self, name, device, compute, threads):
            self.calls.append((name, device))
            self.name, self.device, self.loaded = name, device, True

    w = Worker.__new__(Worker)
    # A recording on the card with small; the processor's plan dictates with small too.
    w.transcriber = Model("small", "cuda")
    w.dictator = Model()
    w.parakeet = Model()
    w.gave_way = {}
    w.threads = lambda: 4
    w.entry = lambda feature, device=None: ("cpu", {"model": "small"}) if device == "cpu" else ("cuda", {"model": "small"})
    actual, entry = w.dictation_model("cpu")
    assert actual is w.dictator and w.dictator.calls == [("small", "cpu")]
    assert w.transcriber.calls == [] and w.transcriber.device == "cuda"
