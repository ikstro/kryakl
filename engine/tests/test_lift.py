import numpy as np

import audio


def test_lift_turned_off_leaves_sound_alone(monkeypatch):
    monkeypatch.setattr(audio, "LIFT_BELOW", None)
    quiet = np.full(1000, 0.001, dtype=np.float32)
    assert audio.lift(quiet) is quiet


def test_silence_stays_silence():
    silence = np.zeros(1000, dtype=np.float32)
    assert audio.lift(silence) is silence


def test_lift_raises_only_quiet_sound_and_by_a_limit(monkeypatch):
    monkeypatch.setattr(audio, "LIFT_BELOW", -20.0)
    monkeypatch.setattr(audio, "LIFT_TO", -6.0)
    monkeypatch.setattr(audio, "LIFT_MOST", 30.0)
    loud = np.full(1000, 0.5, dtype=np.float32)
    assert audio.lift(loud) is loud
    quiet = np.full(1000, 0.01, dtype=np.float32)  # -40 dBFS: raised 30 dB at most, to about -10
    assert np.max(audio.lift(quiet)) == np.float32(0.01 * 10 ** 1.5)
    soft = np.full(1000, 0.05, dtype=np.float32)  # -26 dBFS: raised to -6
    assert abs(20 * np.log10(np.max(audio.lift(soft))) + 6.0) < 0.01
