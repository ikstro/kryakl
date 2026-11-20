import pytest

from quality.wer import edits, format_errors, normalize, pause_marks, score, wrong_language


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


@pytest.mark.parametrize("ref,hyp,errors", [
    ("Привет, мир.", "привет мир", (1, 1)),
    ("Як справи?", "Як справи.", (0, 1)),
    ("How are you?", "How are you?", (0, 0)),
    ("«Готово!»", '"Готово!"', (0, 0)),
    ("Ещё…", "Ещё.", (0, 1)),
    ("имя файла", "Имя файла.", (1, 1)),
    ("Новая фраза.", "", (1, 1)),
    ("", "", (0, 0)),
])
def test_format_errors_catch_what_word_errors_ignore(ref, hyp, errors):
    assert format_errors(ref, hyp) == errors


def test_wrong_language_catches_a_translation_not_a_word():
    assert wrong_language("Hello, how are you today?", "ru") == "latin"
    assert wrong_language("Привет, глянь pull request.", "ru") == ""
    assert wrong_language("Привіт, як справи? Я сьогодні їду додому.", "ru") == "uk"
    assert wrong_language("Привет, как дела? Мы сегодня едем, ты тоже?", "uk") == "ru"
    assert wrong_language("Привет как дела", "en") == "cyrillic"
    assert wrong_language("", "ru") == ""


@pytest.mark.parametrize("ref,hyp,marks", [
    ("В какой-то момент я увидел это. Потом ушёл.", "В какой-то момент... я увидел это. Потом ушёл.", (1, 0)),
    ("У меня останется закрытый лимит.", "У меня останется... Закрытый лимит.", (1, 1)),
    ("У меня останется закрытый лимит.", "У меня останется. Закрытый лимит.", (0, 1)),
    ("Первое. Второе.", "Первое. Второе...", (0, 0)),
    ("Первое. Второе.", "Первое второе.", (0, 0)),
])
def test_pause_marks_count_what_a_pause_left_in_the_text(ref, hyp, marks):
    assert pause_marks(ref, hyp) == marks
