"""A CPU Parakeet fallback must use its own loader, never Whisper's."""
import pytest

from asr import CudaFailed
from jobs import Worker


@pytest.mark.parametrize("failure", ["busy", "driver"])
def test_whisper_falls_back_to_the_actual_parakeet_backend(failure):
    class Model:
        loaded = False
        device = None
        name = None
        compute = None

        def __init__(self, whisper=False):
            self.calls = []
            self.whisper = whisper

        def load(self, name, device, compute, threads):
            self.calls.append((name, device, compute, threads))
            assert not (self.whisper and name.startswith("parakeet"))
            if self.whisper and failure == "driver":
                raise CudaFailed("driver refused")
            self.name, self.device, self.compute, self.loaded = name, device, compute, True

    w = Worker.__new__(Worker)
    w.dictator = Model(whisper=True)
    w.transcriber = Model(whisper=True)
    w.parakeet = Model()
    w.gave_way = {}
    w.threads = lambda: 4
    w._card_full = lambda *args: "busy" if failure == "busy" else None
    w._smaller = lambda *args: None
    w.entry = lambda feature, device=None: ("cpu", {"model": "parakeet-tdt-0.6b-v3"}) if device == "cpu" else ("cuda", {"model": "large-v3-turbo" if feature == "dictation" else "small"})
    actual, entry = w.dictation_model()
    assert actual is w.parakeet
    assert entry["model"] == "parakeet-tdt-0.6b-v3"
    assert w.parakeet.calls == [(entry["model"], "cpu", None, 4)]
    assert w.gave_way["dictation"] == "processor"
