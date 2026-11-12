from quality.wer import edits, normalize, score, wrong_language


def test_normalize_ignores_case_punctuation_yo_and_apostrophes():
    assert normalize("Ёлка, «привет»! Don’t—stop.") == ["елка", "привет", "don't", "stop"]
    assert normalize("п'ять і п’ять") == ["п'ять", "і", "п'ять"]
    assert normalize(" 'quoted' ") == ["quoted"]


def test_edits_counts_each_kind_once():
    assert edits(["a", "b", "c"], ["a", "b", "c"]) == 0
    assert edits(["a", "b", "c"], ["a", "x", "c"]) == 1
    assert edits(["a", "b", "c"], ["a", "c"]) == 1
    assert edits(["a", "b"], ["a", "b", "c"]) == 1
    assert edits([], ["a"]) == 1


def test_score_is_errors_over_words_said():
    assert score("Привет, мир.", "привет мир") == (0, 2)
    assert score("hello world", "") == (2, 2)


def test_wrong_language_catches_a_translation_not_a_word():
    assert wrong_language("Hello, how are you today?", "ru") == "latin"
    assert wrong_language("Привет, глянь pull request.", "ru") == ""
    assert wrong_language("Привіт, як справи? Я сьогодні їду додому.", "ru") == "uk"
    assert wrong_language("Привет, как дела? Мы сегодня едем, ты тоже?", "uk") == "ru"
    assert wrong_language("Привет как дела", "en") == "cyrillic"
    assert wrong_language("", "ru") == ""
