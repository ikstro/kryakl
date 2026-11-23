"""What Whisper writes where nobody spoke: cut when off the sound, kept when said."""

import pytest

from phantoms import Sound, clean, clean_segment, open_ended, pauses

HEARD = Sound(seconds=3.0, no_speech=0.02, logprob=-0.2)  # the sound carries the text
SILENT = Sound(seconds=1.0, no_speech=0.7, logprob=-0.4)  # a breath, a pause


@pytest.mark.parametrize("said, written", [
    ("Привет, буду через десять минут. Субтитры сделал DimaTorzok", "Привет, буду через десять минут."),
    ("Купи хлеба. Субтитры создавал DimaTorzok.", "Купи хлеба."),
    ("Субтитры сделал DimaTorzok", ""),
    ("Сделай отчёт к пятнице. Редактор субтитров А.Синецкая Корректор А.Егорова", "Сделай отчёт к пятнице."),
    ("Окей. Субтитры подогнал «Симон»!", "Окей."),
    ("Добре, домовились. Субтитри зроблені спільнотою Amara.org", "Добре, домовились."),
    ("Send it today. Subtitles by the Amara.org community", "Send it today."),
    ("Субтитры сделал DimaTorzok. Начнём с первого пункта.", "Начнём с первого пункта."),
])
def test_credits_go_always(said, written):
    assert clean(said, HEARD, dictation=True) == written
    assert clean(said, HEARD, dictation=False) == written


@pytest.mark.parametrize("said, written", [
    ("Скинь мне файл. Продолжение следует...", "Скинь мне файл."),
    ("Встреча в три. Спасибо за просмотр! Подписывайтесь на канал!", "Встреча в три."),
    ("Ставьте лайки и подписывайтесь на канал.", ""),
    ("Надішли адресу. Дякую за перегляд!", "Надішли адресу."),
    ("I'll call you back. Thanks for watching!", "I'll call you back."),
])
def test_sign_offs_of_a_video_end_no_dictation(said, written):
    assert clean(said, HEARD, dictation=True) == written


@pytest.mark.parametrize("said", [
    "Спасибо за просмотр!",
    "На сегодня всё. Продолжение следует.",
    "Thanks for watching, see you next week. Thank you for watching.",
])
def test_a_recording_keeps_the_sign_offs_its_sound_carries(said):
    assert clean(said, HEARD, dictation=False) == said


def test_a_recording_drops_a_sign_off_over_silence():
    assert clean("Продолжение следует...", SILENT, dictation=False) == ""


def test_a_recording_drops_a_sign_off_too_long_for_its_sound():
    quick = Sound(seconds=0.8, no_speech=0.05, logprob=-0.3)
    assert clean("Да. Спасибо за просмотр!", quick, dictation=False) == "Да."


@pytest.mark.parametrize("said", [
    "Спасибо.",
    "Спасибо большое!",
    "Thank you.",
    "Дякую.",
    "Спасибо за внимание.",
])
def test_thanks_said_are_kept(said):
    assert clean(said, HEARD, dictation=True) == said


@pytest.mark.parametrize("said", ["Спасибо.", "Thank you.", "Спасибо за внимание."])
def test_thanks_over_silence_go(said):
    assert clean(said, SILENT, dictation=True) == ""


@pytest.mark.parametrize("said", ["you", "You.", "Come on."])
def test_a_murmur_alone_is_never_a_dictated_phrase(said):
    assert clean(said, HEARD, dictation=True) == ""


def test_a_murmur_in_a_recording_goes_only_over_silence():
    assert clean("You.", HEARD, dictation=False) == "You."
    assert clean("You.", SILENT, dictation=False) == ""


@pytest.mark.parametrize("said", ["I told you.", "Come on, let's go.", "You and me."])
def test_you_in_a_sentence_stays(said):
    assert clean(said, HEARD, dictation=True) == said


@pytest.mark.parametrize("said", [
    "Всё готово, спасибо.",
    "Хорошо. Спасибо.",  # thanks after a text: said, whatever the sound
    "Посмотри субтитры к фильму, там опечатка.",
    "Продолжение следует читать во второй главе.",
    "Подписывайтесь на канал Пети, он классный, и спасибо за просмотр моего отчёта.",
    "We need captions by Friday.",
])
def test_ordinary_text_is_left_alone(said):
    assert clean(said, SILENT, dictation=True) == said


def test_a_segment_loses_the_words_of_what_it_cut():
    segment = {
        "start": 10.0, "end": 14.0, "text": "До завтра. Субтитры сделал DimaTorzok",
        "words": [
            {"start": 10.0, "end": 10.3, "word": " До"},
            {"start": 10.3, "end": 10.9, "word": " завтра."},
            {"start": 11.0, "end": 11.6, "word": " Субтитры"},
            {"start": 11.6, "end": 12.0, "word": " сделал"},
            {"start": 12.0, "end": 14.0, "word": " DimaTorzok"},
        ],
    }
    kept = clean_segment(segment, HEARD)
    assert kept["text"] == "До завтра."
    assert [w["word"] for w in kept["words"]] == [" До", " завтра."]
    assert (kept["start"], kept["end"]) == (10.0, 10.9)


def test_a_segment_of_nothing_but_credits_is_gone():
    segment = {"start": 0.0, "end": 2.0, "text": "Субтитры сделал DimaTorzok", "words": []}
    assert clean_segment(segment, HEARD) is None


def test_a_clean_segment_is_the_same_object():
    segment = {"start": 0.0, "end": 2.0, "text": "Начинаем.", "words": []}
    assert clean_segment(segment, HEARD) is segment


# The shapes of the 14 ellipses inside the owner's 200 phrases of 2026-11-19..20, with other words.
@pytest.mark.parametrize("said, written", [
    ("Там отчёт по складу. В какой-то момент... я увидел, что цифры другие.", "Там отчёт по складу. В какой-то момент я увидел, что цифры другие."),
    ("если там много снега... допустим, метр", "если там много снега допустим, метр"),
    ("От создания списка... ...по плану, который она же и написала.", "От создания списка по плану, который она же и написала."),
    ("не добавился в... нашу таблицу?", "не добавился в нашу таблицу?"),
    ("коли у тебе… є групи", "коли у тебе є групи"),
    ("перемикатися на інший тип... де показано дорогу.", "перемикатися на інший тип де показано дорогу."),
    ("слово ... и ещё слово", "слово и ещё слово"),
    ("он сказал... «ладно», и ушёл", "он сказал «ладно», и ушёл"),
    ("...и тогда всё заработало.", "и тогда всё заработало."),
    ("… и тогда всё заработало.", "и тогда всё заработало."),
    ("At some point... I saw the numbers change.", "At some point I saw the numbers change."),
    ("so then... I'm not sure it works", "so then I'm not sure it works"),
    ("we could... maybe try again", "we could maybe try again"),
])
def test_an_ellipsis_a_sentence_goes_on_after_was_a_pause(said, written):
    assert pauses(said) == written


@pytest.mark.parametrize("said", [
    "А как мы будем...",  # let go of mid-thought: it says so (the owner, 2026-11-20)
    "Если пользователь говорит…",
    "у меня останется... Закрытый лимит на всю неделю.",  # Whisper heard a new sentence
    "Например... Отправить письмо может бот.",
    "I was thinking... It does not matter.",
    "It was... Ivan who called.",
    "около... 100 рублей",
    "Что?.. а, понял.",
    "Конец. Начало.",
    "версия 1..5 подойдёт",
    "მე ვფიქრობ... ეს კარგია",  # no capitals to go by
])
def test_other_ellipses_stay(said):
    assert pauses(said) == said


def test_the_next_piece_is_told_the_text_without_the_ellipsis_it_was_cut_at():
    assert open_ended("Там отчёт. В какой-то момент...") == "Там отчёт. В какой-то момент"
    assert open_ended("коли у тебе…") == "коли у тебе"
    assert open_ended("Там отчёт.") == "Там отчёт."
    assert open_ended("Что?..") == "Что?.."


def test_thanks_at_the_end_over_a_weak_last_piece_go_in_dictation():
    # Groq wrote "…сделать. Спасибо." over a phrase's trailing silence (2026-11-23)
    tail = Sound(5.0, 0.6, -0.3, end_weak=True)
    assert clean("Надо выпадайку сделать. Спасибо.", tail, dictation=True) == "Надо выпадайку сделать."
    assert clean("Send it today. Thank you.", tail, dictation=True) == "Send it today."


def test_thanks_at_the_end_heard_as_speech_stay():
    assert clean("Хорошо. Спасибо.", Sound(5.0, 0.6, -0.3, end_weak=False), dictation=True) == "Хорошо. Спасибо."
    # a recording keeps them: someone may thank at the end of a talk
    assert clean("Хорошо. Спасибо.", Sound(5.0, 0.6, -0.3, end_weak=True), dictation=False) == "Хорошо. Спасибо."
