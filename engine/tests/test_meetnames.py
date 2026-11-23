import meetnames


def w(start, end):
    return {"word": " x", "start": start, "end": end}


def span(name, start, end):
    return {"name": name, "start": start, "end": end}


def test_clean_makes_unsafe_input_safe():
    raw = [
        span("  Anna‮ Lee \n", 5, 9),
        span("Bob", 3, 3),                      # no length
        span("Cara", 4, 2),                     # ends before it starts
        span("Dan", "1", 2),                    # not a number
        span("Eve", True, 4),                   # a bool is no number
        span("Fay", float("nan"), 4),
        span("Gus", 1, float("inf")),
        span("", 1, 2),
        span("\x00\x07", 1, 2),                 # nothing left of the name
        {"name": 42, "start": 1, "end": 2},
        "not a span",
        span("H" * 200, 1, 2),
        span("Ivy", -3, 1),                     # before the recording: from its start
    ]
    out = meetnames.clean(raw)
    assert out == [
        span("Ivy", 0.0, 1),
        span("H" * 80, 1, 2),
        span("Anna Lee", 5, 9),
    ]
    assert meetnames.clean(None) == []
    assert meetnames.clean({"name": "x"}) == []


def test_clean_sorts_and_keeps_at_most_5000():
    raw = [span("A", i, i + 0.5) for i in range(6000, 0, -1)]
    out = meetnames.clean(raw)
    assert len(out) == 5000
    assert out[0]["start"] == 1 and out == sorted(out, key=lambda s: s["start"])


def test_lag_moves_a_span_earlier():
    # The caption for Anna was noted at 10 s; her voice began a second earlier.
    spans = [span("Anna", 10, 14)]
    words = [w(9.0, 9.4)]
    assert meetnames.assign(words, spans, lag=1.2) == ["Anna"]
    # With no lag the word is still near enough (0.6 s), so it takes her as the nearest.
    assert meetnames.assign(words, spans, lag=0.0) == ["Anna"]
    # Far before any span: no one.
    assert meetnames.assign([w(4.0, 4.5)], spans, lag=1.2) == [None]


def test_the_span_that_overlaps_most_wins():
    spans = [span("Anna", 0, 5.3), span("Bob", 5.2, 10)]
    # 5.0–5.6 overlaps Anna by 0.3 and Bob (from 4.0 with the lag) by 0.6.
    assert meetnames.assign([w(5.0, 5.6)], spans) == ["Bob"]
    assert meetnames.assign([w(5.0, 5.6)], spans, lag=0.0) == ["Bob"]
    assert meetnames.assign([w(1.0, 2.0)], spans) == ["Anna"]


def test_nearest_within_two_seconds():
    spans = [span("Anna", 0, 3), span("Bob", 10, 12)]
    words = [w(4.0, 4.5), w(6.0, 6.5), w(7.8, 8.2)]
    # 4.0 is 1 s after Anna; 6.0 is 3 s from Anna and 2.8 s from Bob (8.8 with the lag); 7.8–8.2 is 0.6 s before Bob.
    assert meetnames.assign(words, spans) == ["Anna", None, "Bob"]


def test_unnamed_words_between_one_name_take_it():
    # 3.1–3.3 is 2.1 s from the first span and 2.2 s from the second: no one by itself; 3.4–3.6 is 1.9 s from the
    # second, so Anna; the word between Anna at 1.0 and Anna at 3.4 (2.4 s apart) takes her too.
    spans = [span("Anna", 0, 1), span("Anna", 5.5, 6)]
    words = [w(0.5, 1.0), w(3.1, 3.3), w(3.4, 3.6)]
    assert meetnames.assign(words, spans, lag=0.0) == ["Anna", "Anna", "Anna"]


def test_no_filling_across_a_long_gap():
    spans = [span("Anna", 0, 1), span("Anna", 8, 9)]
    words = [w(0.2, 0.6), w(3.5, 3.7), w(4.0, 4.2), w(8.2, 8.5)]
    # Anna's two words are 7.6 s apart: the two between them stay unnamed.
    assert meetnames.assign(words, spans, lag=0.0) == ["Anna", None, None, "Anna"]


def test_no_filling_between_two_names():
    spans = [span("Anna", 0, 1), span("Bob", 7, 8)]
    words = [w(0.2, 0.6), w(4.0, 4.4), w(7.2, 7.6)]
    assert meetnames.assign(words, spans, lag=0.0) == ["Anna", None, "Bob"]


def test_words_out_of_order_keep_their_places():
    spans = [span("Anna", 0, 2), span("Bob", 5, 7)]
    words = [w(5.5, 6.0), w(0.5, 1.0)]
    assert meetnames.assign(words, spans, lag=0.0) == ["Bob", "Anna"]


def test_no_spans_no_names():
    assert meetnames.assign([w(0, 1), w(1, 2)], []) == [None, None]
    assert meetnames.assign([], [span("A", 0, 1)]) == []


def test_usable_needs_sixty_percent():
    words = [w(i, i + 0.5) for i in range(10)]
    assert meetnames.usable(words, ["A"] * 6 + [None] * 4)
    assert not meetnames.usable(words, ["A"] * 5 + [None] * 5)
    assert not meetnames.usable([], [])
    assert not meetnames.usable(words, ["A"] * 3)  # a list that does not match the words


def test_turns_leave_out_the_person_and_need_enough_names():
    words = [w(0, 1), w(1, 2), w(2, 3), w(10, 11)]
    spans = [span("You", 0, 3.5), span("Anna", 9, 12)]
    # Only "Anna" is left, over one word of four: too few to replace the voice model.
    assert meetnames.turns(words, spans) is None
    spans = [span("Вы", 0, 1), span("Anna", 1, 3.5), span("Bob", 9, 12)]
    turns = meetnames.turns(words, spans, )
    assert {label for _, _, label in turns} == {"Anna", "Bob"}
    assert turns[-1] == (10.0, 11.0, "Bob")
    assert meetnames.turns([], spans) is None
    assert meetnames.turns(words, []) is None


def test_names_become_the_speakers_names():
    import merge

    utterances = [
        {"speaker": "me", "text": "hi"},
        {"speaker": "Anna", "text": "hello"},
        {"speaker": "Bob", "text": "hey"},
        {"speaker": "Anna", "text": "so"},
    ]
    speakers = merge.renumber(utterances, {"Anna", "Bob"})
    assert speakers == {"me": {"name": "Me"}, "S1": {"name": "Anna"}, "S2": {"name": "Bob"}}
    assert [u["speaker"] for u in utterances] == ["me", "S1", "S2", "S1"]
    plain = [{"speaker": "SPEAKER_01", "text": "a"}]
    assert merge.renumber(plain) == {"S1": {"name": "Speaker 1"}}
