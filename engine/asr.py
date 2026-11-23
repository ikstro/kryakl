"""The words: faster-whisper, on an NVIDIA card when the gpu part is there, else on the CPU.

A long recording gets times for every word; a dictated phrase just its text, fast.
Which model runs where is Kryakl's plan (settings.py `plan`); this module loads
what it is told and says when the card cannot take it (`CudaFailed`).
A recording's words may come from Groq's Whisper instead, with the person's key (`GroqWhisper`).
"""

from __future__ import annotations

import importlib.util
import json
import logging
import os
import sys
import threading
from pathlib import Path
from typing import Callable

import numpy as np

import phantoms
from audio import RATE, lift
from settings import CATALOG, MODELS_DIR

log = logging.getLogger("kryakl.asr")

# Whisper writes in the style of the text before it; without one it sometimes
# drops capitals and full stops for a whole recording. Recordings only, never a dictated
# phrase (measured 2026-11-11, docs/speech-quality.md): given it, turbo kept only the last
# sentence of a 20 s dictation of three, and small models wrote it as the phrase on quiet sound.
STYLE = {
    "ru": "Здравствуйте. Давайте начнём, у нас сегодня несколько вопросов.",
    "uk": "Добрий день. Давайте почнемо, у нас сьогодні кілька питань.",
    "en": "Hello, everyone. Let's get started, we have a few things to discuss today.",
}

# A language Whisper hears that is neither of the ones expected (the person's own,
# English) is taken only when it is this sure; else the likelier expected one.
SURE_OTHER = 0.7
# Speech heard as neither English nor an expected language is taken for English only when
# English is this likely: told to expect English, Whisper writes any other speech as an
# English translation (2026-10-31: Russian dictated with Ukrainian and English expected came
# out in English). The person's own language is closer.
PLAUSIBLE_ENGLISH = 0.2
# Among the expected ones the person's own language (the first) gives way only to one this many
# times as likely: told the wrong language Whisper writes a translation, and no later step can
# bring the words back. Measured 2026-11-05 with turbo on clips of read speech: a breath alone
# and the first 0.3 s of Russian read as English 2 to 4 times likelier than Russian; a whole
# second of English reads at least 19 times likelier, a second of Russian never the other way.
OWN_LEAN = 5

# Parakeet's text is dropped when its tokens' mean log-probability is under this (None: never).
# On faint speech it makes up English ("Yeah, I don't know" for distant Russian); measured on the
# bench's phrases (2026-11-11): under -0.5 were 45 of its 52 phrases in a wrong language and none
# of its 206 good ones; the phrases in the right language it dropped had 82 % of their words wrong.
PARAKEET_FLOOR: float | None = -0.5


def _cuda_dirs() -> list[Path]:
    """Where cuBLAS 12 and cuDNN 9 are: the gpu part's nvidia wheels, or torch's CUDA build (speakers-gpu)."""
    site = Path(sys.prefix) / "Lib" / "site-packages"
    dirs = [d for d in (site / "nvidia").glob("*/bin") if d.is_dir()]
    torch = importlib.util.find_spec("torch")
    if torch and torch.origin:
        lib = Path(torch.origin).parent / "lib"
        if (lib / "cudnn64_9.dll").exists():
            dirs.append(lib)
    return dirs


_dlls_added = False


def _cuda_dlls() -> None:
    global _dlls_added
    if _dlls_added:
        return
    for d in _cuda_dirs():
        os.add_dll_directory(str(d))
        os.environ["PATH"] = str(d) + os.pathsep + os.environ.get("PATH", "")
    _dlls_added = True


def torch_cuda() -> bool:
    """torch's CUDA build is installed (the speakers-gpu part): speakers run on the card."""
    torch = importlib.util.find_spec("torch")
    return bool(torch and torch.origin and (Path(torch.origin).parent / "lib" / "cudnn64_9.dll").exists())


def gpu() -> bool:
    """An NVIDIA card and the CUDA libraries to use it (the gpu or speakers-gpu part)."""
    if not _cuda_dirs():
        return False
    try:
        import ctranslate2

        return ctranslate2.get_cuda_device_count() > 0
    except Exception:
        return False


def card_free_mb() -> int | None:
    """The NVIDIA cards' free memory now, in MB, all together (nvidia-smi, which the driver puts in
    System32); None when it cannot say."""
    exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32" / "nvidia-smi.exe"
    if not exe.is_file():
        return None
    import subprocess

    try:
        out = subprocess.run([str(exe), "--query-gpu=memory.free", "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=10, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return None
    values = [int(v) for v in out.stdout.split() if v.isdigit()]
    return sum(values) if values else None


WHISPER_DIR = MODELS_DIR / "whisper"
_MODELS = {m["name"]: m for m in CATALOG["models"]}
_WHISPER = {name: m for name, m in _MODELS.items() if m["backend"] == "whisper"}
# What a model weighs, to tell how far its first download is.
SIZES = {name: m["bytes"] for name, m in _MODELS.items()}
# Parakeet's files as onnx-asr reads them, int8, its features computed by numpy (no preprocessor model).
PARAKEET_FILES = ("config.json", "vocab.txt", "encoder-model.int8.onnx", "decoder_joint-model.int8.onnx")


def backend(name: str) -> str:
    return _MODELS.get(name, {}).get("backend", "")


def _cache_dir(name: str) -> Path:
    """Where a model's files are: Hugging Face's models--<owner>--<repo> for Whisper, a folder of its own for Parakeet."""
    if backend(name) == "whisper":
        return WHISPER_DIR / ("models--" + _WHISPER[name]["repo"].replace("/", "--"))
    return MODELS_DIR / name


def downloaded(name: str) -> bool:
    if backend(name) == "whisper":
        return any(_cache_dir(name).glob("snapshots/*/model.bin"))
    if backend(name) == "parakeet":
        return all((_cache_dir(name) / f).is_file() for f in PARAKEET_FILES)
    return False


fetching: set[str] = set()


def model_state(name: str) -> dict:
    """ready, missing, or downloading with a share done (the files that arrived over the model's size)."""
    if downloaded(name):
        return {"name": name, "state": "ready"}
    if name in fetching:
        got = sum(f.stat().st_size for f in _cache_dir(name).glob("**/*") if f.is_file()) if name in _MODELS else 0
        return {"name": name, "state": "downloading", "progress": round(min(got / SIZES.get(name, max(got, 1)), 0.99), 3)}
    return {"name": name, "state": "missing"}


def fetch(name: str) -> str:
    """The model's folder, downloaded first when it is not here (once; `fetching` shows it meanwhile)."""
    here = downloaded(name)
    if not here:
        fetching.add(name)
    try:
        if backend(name) == "parakeet":
            if not here:
                from huggingface_hub import snapshot_download

                snapshot_download(_MODELS[name]["repo"], local_dir=str(_cache_dir(name)), allow_patterns=list(PARAKEET_FILES))
            return str(_cache_dir(name))
        from faster_whisper.utils import download_model

        return download_model(name, cache_dir=str(WHISPER_DIR), local_files_only=here)
    finally:
        fetching.discard(name)


class CudaFailed(Exception):
    """The card would not take the model (too small, busy, a driver too old): the processor's plan applies."""


def _speech_only(samples: np.ndarray) -> np.ndarray | None:
    """The phrase with its silences cut out (Silero VAD, inside faster-whisper); None when nobody spoke."""
    from faster_whisper.vad import VadOptions, collect_chunks, get_speech_timestamps

    samples = lift(samples)
    chunks = get_speech_timestamps(samples, VadOptions(min_silence_duration_ms=500, speech_pad_ms=300))
    if not chunks:
        return None
    pieces, _ = collect_chunks(samples, chunks)
    speech = np.concatenate(pieces) if pieces else np.array([], dtype=np.float32)
    return speech if len(speech) >= RATE // 4 else None


def pick_language(probs: dict[str, float], expected: tuple[str, ...] | list[str], strict: bool = False) -> str:
    """Whisper's likeliest language, unless it is an unexpected one it is not sure of: then the likelier expected one.

    `strict`: the caller knows only the expected ones are spoken (Ukrainian heard in Russian
    speech is a mistake there, however sure), so the likeliest of them, the first
    of them winning a close call (OWN_LEAN)."""
    top = max(probs, key=probs.get)
    pool = [c for c in expected if c in probs]
    if top != "en" and top not in pool and probs.get("en", 0.0) < PLAUSIBLE_ENGLISH and any(c != "en" for c in pool):
        pool = [c for c in pool if c != "en"]
    if strict:
        if pool:
            best = max(pool, key=lambda c: probs[c])
            own = expected[0]
            return own if own in pool and probs[best] < OWN_LEAN * probs[own] else best
        log.warning("strict language asked, but Whisper knows none of %s", list(expected))
    if not pool or top in pool or probs[top] >= SURE_OTHER:
        return top
    return max(pool, key=lambda c: probs[c])


def _log_pick(language: str, probs: dict[str, float], expected, speech: np.ndarray) -> None:
    """Why a phrase came out in its language, should it be the wrong one; never its words."""
    heard = ", ".join(f"{c} {probs.get(c, 0.0):.3f}" for c in dict.fromkeys([language, *expected]))
    log.info("language %s on %.1f s of speech (%s)", language, len(speech) / RATE, heard)


def _said(segments, speech: np.ndarray) -> str:
    """A dictated phrase's text, without the credits and sign-offs Whisper adds from its subtitles (phantoms.py)."""
    segments = list(segments)
    text = " ".join(s.text.strip() for s in segments).strip()
    if not segments:
        return text
    sound = phantoms.Sound(
        len(speech) / RATE,
        max(s.no_speech_prob for s in segments),
        min(s.avg_logprob for s in segments),
        len(segments) > 1 and phantoms.Sound(no_speech=segments[-1].no_speech_prob, logprob=segments[-1].avg_logprob).weak,
    )
    return phantoms.pauses(phantoms.clean(text, sound, dictation=True))


# The Whisper models whose names hint is closed with a full stop (`Transcriber.dictate`).
CLOSED_HINT = frozenset({"large-v3-turbo", "small"})


def dictation_context(before: str, hotwords: str, encode, budget: int = 216) -> tuple[str | None, str | None]:
    """Share Whisper's previous-text token space; keep whole words and whole names."""
    tail: list[str] = []
    for word in reversed(before.split()):
        candidate = " ".join([word, *tail])
        if len(candidate) > 150 or len(encode(" " + candidate)) > min(96, budget):
            break
        tail.insert(0, word)
    prompt = " ".join(tail)
    remaining = budget - len(encode(" " + prompt)) if prompt else budget
    names = hotwords.split(",") if hotwords else []
    while names and len(encode(" " + ",".join(names))) > remaining:
        names.pop()
    hint = ",".join(names).strip()
    if hint and hotwords.rstrip().endswith(".") and not hint.endswith("."):
        hint += "."
        if len(encode(" " + hint)) > remaining:
            hint = ""
    return prompt or None, hint or None


class Transcriber:
    def __init__(self, workers: int = 1):
        self._model = None
        self._key: tuple | None = None
        self._warm: tuple | None = None
        self._lock = threading.Lock()
        self.workers = workers
        self.name: str | None = None
        self.device: str | None = None
        self.compute: str | None = None

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, name: str, device: str = "cpu", compute: str | None = None, threads: int = 0) -> None:
        """The model on that device: on the card in `compute` (float16 first, then int8_float16), raising
        CudaFailed when neither fits; on the processor in int8 with `threads` threads (0: CTranslate2's 4)."""
        with self._lock:
            key = (name, device, compute, threads)
            if self._model is not None and self._key == key:
                return
            self._model = None
            self._key = None
            self._warm = None
            path = fetch(name)
            from faster_whisper import WhisperModel

            if device == "cuda":
                _cuda_dlls()
                first = compute or "float16"
                tries = [first, "int8_float16"] if first == "float16" else [first]
                problem: Exception | None = None
                for kind in tries:
                    try:
                        self._model = WhisperModel(path, device="cuda", compute_type=kind, num_workers=self.workers)
                        self.compute = kind
                        break
                    except Exception as error:  # out of memory, a driver too old, no card after all
                        problem = error
                        log.warning("%s in %s on the GPU failed: %s", name, kind, error)
                if self._model is None:
                    raise CudaFailed(str(problem) or type(problem).__name__)
            else:
                self._model = WhisperModel(path, device="cpu", compute_type="int8", cpu_threads=threads, num_workers=self.workers)
                self.compute = "int8"
            self.name = name
            self.device = device
            self._key = key

    def unload(self, name: str | None = None) -> None:
        """Out of memory; with `name`, only while it still holds that model (a job may have loaded another meanwhile)."""
        with self._lock:
            if name is not None and self.name != name:
                return
            self._model = None
            self._key = None
            self._warm = None
            self.name = None

    def transcribe(
        self,
        samples: np.ndarray,
        language: str | None = None,
        hotwords: str = "",
        progress: Callable[[float], None] | None = None,
    ) -> tuple[list[dict], str]:
        """Segments as {start, end, text, words: [{start, end, word}]} and the language spoken (the model loaded first)."""
        total = max(len(samples) / RATE, 0.01)
        if language is None:
            try:
                language = self._model.detect_language(samples, vad_filter=True)[0]
            except Exception:  # nothing but silence: Whisper finds no speech either way
                language = None
        segments, info = self._model.transcribe(
            samples,
            language=language,
            initial_prompt=STYLE.get(language),
            beam_size=5,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 700},
            # The previous text keeps punctuation going from window to window; the VAD and the
            # silence threshold keep it from looping on long recordings.
            condition_on_previous_text=True,
            hallucination_silence_threshold=2.0,
            hotwords=hotwords or None,
        )
        out = []
        for segment in segments:
            if progress:
                progress(min(segment.end / total, 1.0))
            words = [
                {"start": round(w.start, 2), "end": round(w.end, 2), "word": w.word}
                for w in (segment.words or [])
                if w.word.strip()
            ]
            kept = phantoms.clean_segment(
                {"start": round(segment.start, 2), "end": round(segment.end, 2), "text": segment.text.strip(), "words": words},
                phantoms.Sound(segment.end - segment.start, segment.no_speech_prob, segment.avg_logprob),
            )
            if kept:
                out.append(kept)
        return out, info.language

    def dictate(
        self,
        samples: np.ndarray,
        language: str | None = None,
        expected: tuple[str, ...] | list[str] = (),
        hotwords: str = "",
        beam: int = 5,
        before: str = "",
        strict: bool = False,
    ) -> tuple[str, str, float]:
        """A short phrase's text, its language and how sure Whisper is of it (0…1): no word times.

        The sound is encoded once: the language is read from the same pass the words
        come from (faster-whisper's own way encodes it twice), among the `expected`
        ones unless Whisper is sure of another (never another with `strict`).
        `before`: the text said just before (a dictation's earlier pieces), so this
        one goes on in its style.
        """
        speech = _speech_only(samples)
        if speech is None:
            return "", language or "", 0.0
        # faster-whisper puts hotwords in the previous-text prompt. An unfinished list
        # makes dictation follow its style: with the owner's eight terms, only 9 of 27
        # Russian phrases ended in punctuation; closing the hint made that 27 of 27.
        # Punctuate the hint, never the recognized text. For turbo and small, where
        # it costs no words: small on the processor, 180 phrases with eight names,
        # 21 phrases with a wrong end mark became none, wrong words 16.6 and 16.3 %.
        # Not for tiny and base: on the card they lost words with it (base on the
        # processor did not, 31.5 and 31.4 %, but had only 4 wrong end marks to win),
        # nor large-v3, not measured as it runs (docs/speech-quality.md, 2026-11-14).
        if self.name in CLOSED_HINT:
            hotwords = hotwords.strip()
            if hotwords and hotwords[-1] not in ".!?…":
                hotwords += "."
        try:
            return self._one_pass(speech, language, expected, hotwords, beam, before, strict)
        except (AttributeError, TypeError, KeyError) as error:  # faster-whisper changed underneath
            log.warning("one-pass dictation failed (%s); using faster-whisper's own way", error)
            return self._two_passes(speech, language, hotwords, beam, expected, strict)

    def _one_pass(self, speech: np.ndarray, language: str | None, expected, hotwords: str, beam: int, before: str = "", strict: bool = False) -> tuple[str, str, float]:
        from faster_whisper.audio import pad_or_trim
        from faster_whisper.tokenizer import Tokenizer

        model = self._model
        extractor = model.feature_extractor
        features = extractor(speech)
        encoded = model.encode(pad_or_trim(features[:, : extractor.nb_max_frames]))
        sure = 1.0
        if language is None:
            if model.model.is_multilingual:
                probs = {token[2:-2]: p for token, p in model.model.detect_language(encoded)[0]}
                language = pick_language(probs, expected, strict)
                sure = float(probs[language])
                _log_pick(language, probs, expected, speech)
            else:
                language = "en"
        # The options as faster-whisper fills them (thresholds, suppressed tokens…), from a call
        # that only prepares: its segments are a generator that is never run.
        tokenizer = Tokenizer(model.hf_tokenizer, model.model.is_multilingual, task="transcribe", language=language)
        prompt, hint = dictation_context(before, hotwords, tokenizer.encode, max(1, model.max_length // 2 - 8))
        _, info = model.transcribe(
            speech[:RATE],
            language=language,
            beam_size=beam,
            initial_prompt=prompt,
            without_timestamps=True,
            condition_on_previous_text=False,
            vad_filter=False,
            hotwords=hint,
        )
        segments = model.generate_segments(features, tokenizer, info.transcription_options, False, encoded)
        return _said(segments, speech), language, sure

    def _two_passes(self, speech: np.ndarray, language: str | None, hotwords: str, beam: int, expected=(), strict: bool = False) -> tuple[str, str, float]:
        sure = 1.0
        if language is None:
            try:
                top, sure, every = self._model.detect_language(speech)
                # Every language's chance, so the expected ones are preferred here as in one pass.
                probs = dict(every) if every else {top: sure}
                language = pick_language(probs, expected, strict)
                sure = probs.get(language, sure)
                _log_pick(language, probs, expected, speech)
            except Exception:
                language = None
        segments, info = self._model.transcribe(
            speech,
            language=language,
            initial_prompt=None,
            beam_size=beam,
            vad_filter=False,
            condition_on_previous_text=False,
            hotwords=hotwords or None,
        )
        return _said(segments, speech), info.language, float(sure)

    def warm(self) -> None:
        """Runs the loaded model once (once per load: a card's first run sets itself up for seconds;
        again, on the processor, it would only take a second from the phrase being spoken)."""
        if self._warm == self._key:
            return
        noise = (np.random.default_rng(0).standard_normal(RATE) * 0.01).astype(np.float32)
        list(self._model.transcribe(noise, language="en", vad_filter=False, without_timestamps=True)[0])
        self._warm = self._key


class Parakeet:
    """NVIDIA's Parakeet TDT 0.6B v3 through onnx-asr, int8 on the processor: 25 European languages, with
    their punctuation and capitals. It costs what the sound lasts (Whisper pads every phrase to a 30 s
    window), so a phrase takes a third of a second on a desktop processor. It does not say which
    language it heard: the caller finds out from the text."""

    def __init__(self):
        self._model = None
        self._key: tuple | None = None
        self._warm: tuple | None = None
        self._lock = threading.Lock()
        self.name: str | None = None
        self.device = "cpu"
        self.compute = "int8"

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def load(self, name: str, device: str = "cpu", compute: str | None = None, threads: int = 0) -> None:
        with self._lock:
            key = (name, threads)
            if self._model is not None and self._key == key:
                return
            self._model = None
            self._key = None
            self._warm = None
            path = fetch(name)
            import onnx_asr
            import onnxruntime as rt

            options = rt.SessionOptions()
            if threads:
                options.intra_op_num_threads = threads
            self._model = onnx_asr.load_model(_MODELS[name]["onnx"], path, quantization="int8", sess_options=options, providers=["CPUExecutionProvider"])
            self.name = name
            self._key = key

    def unload(self, name: str | None = None) -> None:
        with self._lock:
            if name is not None and self.name != name:
                return
            self._model = None
            self._key = None
            self._warm = None
            self.name = None

    def dictate(self, samples: np.ndarray, language: str | None = None, expected=(), hotwords: str = "", beam: int = 0, before: str = "", strict: bool = False) -> tuple[str, str, float]:
        """The phrase's text; its language is unknown here ("", sure 0), so `strict` has nothing to hold."""
        speech = _speech_only(samples)
        if speech is None:
            return "", language or "", 0.0
        if PARAKEET_FLOOR is None:
            return phantoms.pauses(str(self._model.recognize(speech)).strip()), language or "", 0.0
        heard = self._model.with_timestamps().recognize(speech)
        logprobs = heard.logprobs or []
        mean = float(np.mean(logprobs)) if logprobs else 0.0
        if logprobs and mean < PARAKEET_FLOOR:
            log.info("parakeet: dropped %.1f s it was not sure of (%.2f)", len(speech) / RATE, mean)
            return "", language or "", 0.0
        return phantoms.pauses(heard.text.strip()), language or "", 0.0

    def warm(self) -> None:
        if self._warm == self._key:
            return
        noise = (np.random.default_rng(0).standard_normal(RATE) * 0.01).astype(np.float32)
        self._model.recognize(noise)
        self._warm = self._key


def recognizer(name: str):
    """A fresh, unloaded recognizer for this model: Whisper's or Parakeet's."""
    return Parakeet() if backend(name) == "parakeet" else Transcriber()


# Groq ---------------------------------------------------------------------
#
# A recording's words from Groq's Whisper with the person's own key (2026-11-23), so a computer with no
# graphics card gets an hour's transcript in minutes. Only the speech is sent, cut at pauses into pieces of
# at most GROQ_PIECE seconds (the free plan: 20 requests a minute, 7,200 seconds of sound an hour, each
# request billed at least 10 s, 25 MB a file); every word gets its time in the recording back. What comes
# back is cleaned as a local recording's segments are, so jobs.py goes on as with a local model.

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
GROQ_MODEL = "whisper-large-v3-turbo"
GROQ_PIECE = 600.0          # seconds of speech a request at most
GROQ_FILE_MOST = 24 << 20   # bytes a file at most (Groq's limit is 25 MB)
GROQ_PROMPT_TOKENS = 224    # Whisper's prompt, as Groq counts it
GROQ_TIMEOUT = 300          # seconds for one request: ten minutes of speech uploaded and recognized
GROQ_RETRIES = (2.0, 5.0, 10.0)  # pauses before each retry of a piece after a network error or a 5xx
GROQ_LIMIT_WAIT = 60.0      # seconds waited on a 429 without retry-after
GROQ_SILENCE_MS = 1000      # a pause this long is left out of what is sent
GROQ_PAD_MS = 400           # speech kept on each side of it
CUT_WINDOW = 60.0           # an unbroken stretch longer than a piece is cut at its quietest moment in the piece's last minute

# Groq names the language it heard in English ("russian"); Kryakl keeps codes.
LANGUAGE_NAMES = {
    "english": "en", "russian": "ru", "ukrainian": "uk", "belarusian": "be", "german": "de", "french": "fr",
    "spanish": "es", "italian": "it", "portuguese": "pt", "polish": "pl", "czech": "cs", "slovak": "sk",
    "dutch": "nl", "swedish": "sv", "norwegian": "no", "danish": "da", "finnish": "fi", "estonian": "et",
    "latvian": "lv", "lithuanian": "lt", "hungarian": "hu", "romanian": "ro", "bulgarian": "bg", "serbian": "sr",
    "croatian": "hr", "bosnian": "bs", "slovenian": "sl", "macedonian": "mk", "greek": "el", "turkish": "tr",
    "georgian": "ka", "armenian": "hy", "azerbaijani": "az", "kazakh": "kk", "uzbek": "uz", "hebrew": "he",
    "arabic": "ar", "persian": "fa", "hindi": "hi", "chinese": "zh", "japanese": "ja", "korean": "ko",
    "vietnamese": "vi", "thai": "th", "indonesian": "id", "malay": "ms", "catalan": "ca", "galician": "gl",
    "basque": "eu", "icelandic": "is", "irish": "ga", "welsh": "cy", "albanian": "sq", "tagalog": "tl",
}


class GroqRejected(Exception):
    """Groq did not accept the key (401, 403): the job fails, nothing local is tried."""


class GroqUnreachable(Exception):
    """No answer from Groq that could be used (no connection, 5xx after the retries, a piece refused):
    jobs.py recognizes the whole job here instead, when the local model is downloaded."""


def groq_post(key: str, fields: list[tuple[str, str]], audio_bytes: bytes, filename: str, mime: str, timeout: float = GROQ_TIMEOUT) -> tuple[int, dict, bytes]:
    """One multipart POST to Groq's transcriptions: (status, headers in lower case, body). A network
    error raises OSError. The key goes in the header alone, never into the address or an error's text."""
    import urllib.error
    import urllib.request

    boundary = "kryakl" + os.urandom(12).hex()
    body = bytearray()
    for name, value in fields:
        body += f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
        body += value.encode("utf-8") + b"\r\n"
    body += f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{filename}"\r\nContent-Type: {mime}\r\n\r\n'.encode()
    body += audio_bytes + b"\r\n" + f"--{boundary}--\r\n".encode()
    request = urllib.request.Request(GROQ_URL, data=bytes(body), method="POST", headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "User-Agent": "Kryakl",
    })
    try:
        with urllib.request.urlopen(request, timeout=timeout) as answer:
            return answer.status, {k.lower(): v for k, v in answer.headers.items()}, answer.read()
    except urllib.error.HTTPError as error:
        try:
            content = error.read()
        except OSError:
            content = b""
        return error.code, {k.lower(): v for k, v in (error.headers or {}).items()}, content


def groq_prompt(hotwords: str, most: int = GROQ_PROMPT_TOKENS) -> str:
    """The vocabulary's spellings (vocab.hotwords, comma separated) as Groq's prompt: the words in order while
    they fit `most` tokens, a word counted as ceil(letters / 3), closed with a full stop; '' for none."""
    words: list[str] = []
    used = 0
    for word in (w.strip() for w in (hotwords or "").split(",")):
        if not word:
            continue
        cost = -(-len(word) // 3)
        if used + cost > most:
            break
        words.append(word)
        used += cost
    if not words:
        return ""
    prompt = ", ".join(words)
    return prompt if prompt[-1] in ".!?…" else prompt + "."


class Piece:
    """Speech joined from parts of a recording, with where each part was: `spans` of (at, was, seconds), `at`
    in the piece and `was` in the recording, so a time Groq gives in the piece is put back (`original`)."""

    def __init__(self, samples: np.ndarray, spans: list[tuple[float, float, float]]):
        self.samples = samples
        self.spans = spans

    @property
    def seconds(self) -> float:
        return len(self.samples) / RATE

    def original(self, t: float, end: bool = False) -> float:
        """The recording's time of the piece's `t`; an `end` on a join stays with the part before it."""
        import bisect

        starts = [s[0] for s in self.spans]
        i = (bisect.bisect_left(starts, t) if end else bisect.bisect_right(starts, t)) - 1
        i = min(max(i, 0), len(self.spans) - 1)
        at, was, length = self.spans[i]
        return was + min(max(t - at, 0.0), length)


def _quietest(samples: np.ndarray, lo: int, hi: int) -> int:
    """The sample in [lo, hi) at the middle of its quietest 50 ms: a pause between words, where there is one."""
    frame = RATE // 20
    best, where = None, (lo + hi) // 2
    for start in range(lo, max(lo + 1, hi - frame), frame // 2):
        energy = float(np.mean(np.square(samples[start:start + frame]))) if start + frame <= len(samples) else None
        if energy is not None and (best is None or energy < best):
            best, where = energy, start + frame // 2
    return where


def pieces_of(samples: np.ndarray, chunks: list[dict], most: float = GROQ_PIECE) -> list[Piece]:
    """The speech `chunks` ({start, end} in samples, in order) joined into pieces of at most `most` seconds,
    the silence between them left out; a chunk longer than a piece is cut at its quietest moment near the end."""
    limit = int(most * RATE)
    parts: list[tuple[int, int]] = []
    for c in chunks:
        a, b = int(c["start"]), min(int(c["end"]), len(samples))
        while b - a > limit:
            cut = _quietest(samples, a + max(limit - int(CUT_WINDOW * RATE), limit // 2), a + limit)
            parts.append((a, cut))
            a = cut
        if b > a:
            parts.append((a, b))
    pieces: list[Piece] = []
    group: list[tuple[int, int]] = []

    def close() -> None:
        spans, at = [], 0
        for a, b in group:
            spans.append((at / RATE, a / RATE, (b - a) / RATE))
            at += b - a
        pieces.append(Piece(np.concatenate([samples[a:b] for a, b in group]).astype(np.float32, copy=False), spans))

    for a, b in parts:
        if group and sum(y - x for x, y in group) + (b - a) > limit:
            close()
            group = []
        group.append((a, b))
    if group:
        close()
    return pieces


def speech_chunks(samples: np.ndarray) -> list[dict]:
    """Where someone speaks in a recording ({start, end} in samples), by the Silero VAD faster-whisper brings."""
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    return get_speech_timestamps(samples, VadOptions(min_silence_duration_ms=GROQ_SILENCE_MS, speech_pad_ms=GROQ_PAD_MS))


def language_code(name) -> str | None:
    """Groq's language ("russian", or a code) as Kryakl's code; None when it does not say."""
    if not isinstance(name, str) or not name.strip():
        return None
    name = name.strip().lower()
    if name in LANGUAGE_NAMES:
        return LANGUAGE_NAMES[name]
    return name if 2 <= len(name) <= 3 and name.isalpha() else None


def _spread(text: str, start: float, end: float) -> list[dict]:
    """A segment's words when Groq gave it none: its text's words over its time, evenly."""
    tokens = text.split()
    step = (end - start) / max(len(tokens), 1)
    return [{"start": start + n * step, "end": start + (n + 1) * step, "word": " " + t} for n, t in enumerate(tokens)]


def _dress(text: str, words: list[dict]) -> list[dict]:
    """Groq's bare words given what the segment's text has around them, as a local Whisper's words come:
    " Hello," with its space and its punctuation, so merge.py's utterances read as the text does."""
    out, at, low = [], 0, text.casefold()
    for w in words:
        bare = str(w.get("word", "")).strip()
        if not bare:
            continue
        found = low.find(bare.casefold(), at)
        if found < 0:
            out.append({**w, "word": " " + bare})
            continue
        end = found + len(bare)
        while end < len(text) and not text[end].isspace() and not text[end].isalnum():
            end += 1
        out.append({**w, "word": " " + text[at:end].strip()})
        at = end
    rest = text[at:].strip()
    if out and rest and not any(ch.isalnum() for ch in rest):
        out[-1]["word"] += rest
    return out


def segments_of(answer: dict) -> list[dict]:
    """Groq's verbose_json as Whisper's segments in the piece's time ({start, end, text, words, no_speech_prob,
    avg_logprob}): each word to the segment it falls in, by its middle."""
    segments = [s for s in answer.get("segments") or [] if isinstance(s, dict)]
    words = sorted((w for w in answer.get("words") or [] if isinstance(w, dict) and "start" in w and "end" in w), key=lambda w: float(w["start"]))
    if not segments and (answer.get("text") or "").strip():
        segments = [{"start": words[0]["start"] if words else 0.0, "end": words[-1]["end"] if words else float(answer.get("duration") or 0.0), "text": answer["text"]}]
    held: list[list[dict]] = [[] for _ in segments]
    j = 0
    for w in words:
        middle = (float(w["start"]) + float(w["end"])) / 2
        while j + 1 < len(segments) and middle >= float(segments[j + 1].get("start", 0.0)):
            j += 1
        if segments:
            held[j].append({"start": float(w["start"]), "end": float(w["end"]), "word": str(w.get("word", ""))})
    out = []
    for segment, mine in zip(segments, held):
        text = str(segment.get("text") or "").strip()
        start, end = float(segment.get("start", 0.0)), float(segment.get("end", 0.0))
        dressed = _dress(text, mine) if mine else _spread(text, start, end)
        out.append({
            "start": start, "end": end, "text": text, "words": dressed,
            "no_speech_prob": float(segment.get("no_speech_prob") or 0.0),
            "avg_logprob": float(segment.get("avg_logprob") or 0.0),
        })
    return out


def _hide(text: str, key: str) -> str:
    """An error's text with the key cut out, should it ever be in it."""
    return text.replace(key, "<key>") if key else text


class GroqWhisper:
    """Groq's whisper-large-v3-turbo with the person's key, in place of a local Transcriber for a recording.

    `post` stands for groq_post (the tests' fake); `sleep` and `clock` for time's; `on_wait(until)` is told
    when a job waits for Groq's limit (until: epoch seconds) and `on_wait(None)` when it goes on."""

    name = GROQ_MODEL
    device = "groq"
    compute = None

    def __init__(self, key: str, post=None, sleep=None, clock=None, on_wait=None, encode=None):
        import time as _time

        self._key = key
        self._post = post
        self._sleep = sleep or _time.sleep
        self._clock = clock or _time.time
        self.on_wait = on_wait
        self._encode = encode
        # For speech.log's one line a job: never the words, never the key.
        self.stats = {"pieces": 0, "sent": 0.0, "waited": 0.0, "requests": 0}

    def summary(self) -> str:
        s = self.stats
        return f"{s['pieces']} piece(s), {s['sent']:.0f} s of speech sent, {s['requests']} request(s), {s['waited']:.0f} s waited for Groq's limits"

    def _file(self, samples: np.ndarray) -> tuple[bytes, str, str]:
        """The piece as FLAC (WAV should PyAV fail), within Groq's size."""
        import audio as audio_module

        if self._encode:
            return self._encode(samples)
        try:
            data = audio_module.to_flac(samples)
            if len(data) <= GROQ_FILE_MOST:
                return data, "piece.flac", "audio/flac"
        except Exception as error:
            log.warning("groq: FLAC failed (%s), sending WAV", type(error).__name__)
        return audio_module.to_wav(samples), "piece.wav", "audio/wav"

    def _wait(self, seconds: float) -> None:
        until = self._clock() + seconds
        if self.on_wait:
            self.on_wait(until)
        self._sleep(seconds)
        self.stats["waited"] += seconds
        if self.on_wait:
            self.on_wait(None)

    def _ask(self, piece: Piece, language: str | None, prompt: str) -> dict:
        """One piece recognized: Groq's answer, after waiting out its limits and retrying what failed on the way."""
        fields = [("model", GROQ_MODEL), ("temperature", "0"), ("response_format", "verbose_json"),
                  ("timestamp_granularities[]", "word"), ("timestamp_granularities[]", "segment")]
        if language:
            fields.append(("language", language))
        if prompt:
            fields.append(("prompt", prompt))
        data, filename, mime = self._file(piece.samples)
        post = self._post or groq_post
        failures = 0
        while True:
            self.stats["requests"] += 1
            try:
                status, headers, body = post(self._key, fields, data, filename, mime, GROQ_TIMEOUT)
            except OSError as error:
                status, headers, body, problem = 0, {}, b"", _hide(f"{type(error).__name__}: {error}", self._key)
            else:
                problem = f"HTTP {status}"
            if status == 200:
                try:
                    return json.loads(body)
                except ValueError:
                    raise GroqUnreachable("Groq's answer could not be read") from None
            if status in (401, 403):
                raise GroqRejected("Groq did not accept the saved key.")
            if status == 429:
                wait = _retry_after(headers.get("retry-after"))
                log.info("groq: the limit is reached, waiting %.0f s", wait)
                self._wait(wait)
                continue
            if status and status < 500:
                # 400, 413 and the like: the piece is refused, and another try would be refused too.
                raise GroqUnreachable(f"Groq refused a piece of the recording ({problem})")
            if failures >= len(GROQ_RETRIES):
                log.warning("groq: no answer after %d tries (%s)", failures + 1, problem)
                raise GroqUnreachable("No connection to Groq.")
            log.info("groq: %s, trying again in %.0f s", problem, GROQ_RETRIES[failures])
            self._sleep(GROQ_RETRIES[failures])
            failures += 1

    def transcribe(
        self,
        samples: np.ndarray,
        language: str | None = None,
        hotwords: str = "",
        progress: Callable[[float], None] | None = None,
    ) -> tuple[list[dict], str]:
        """Segments as {start, end, text, words: [{start, end, word}]} in the recording's time, cleaned as a local
        recording's are (phantoms.clean_segment), and the language spoken (the most spoken piece's, '' when Groq does not say)."""
        pieces = pieces_of(samples, speech_chunks(samples), GROQ_PIECE)
        total = sum(p.seconds for p in pieces) or 1.0
        prompt = groq_prompt(hotwords)
        out: list[dict] = []
        heard: dict[str, float] = {}
        done = 0.0
        for piece in pieces:
            answer = self._ask(piece, language, prompt)
            self.stats["pieces"] += 1
            self.stats["sent"] += piece.seconds
            code = language_code(answer.get("language"))
            if code:
                heard[code] = heard.get(code, 0.0) + piece.seconds
            for segment in segments_of(answer):
                kept = phantoms.clean_segment(
                    {k: segment[k] for k in ("start", "end", "text", "words")},
                    phantoms.Sound(segment["end"] - segment["start"], segment["no_speech_prob"], segment["avg_logprob"]),
                )
                if not kept or not kept["words"]:
                    continue
                words = []
                for w in kept["words"]:
                    start = piece.original(w["start"])
                    end = max(piece.original(w["end"], end=True), start)
                    words.append({"start": round(start, 2), "end": round(end, 2), "word": w["word"]})
                out.append({"start": words[0]["start"], "end": words[-1]["end"], "text": kept["text"], "words": words})
            done += piece.seconds
            if progress:
                progress(min(done / total, 1.0))
        spoken = language or (max(heard, key=heard.get) if heard else "")
        return out, spoken


def _retry_after(value) -> float:
    """Groq's retry-after in seconds (a number; a date is not expected), GROQ_LIMIT_WAIT when absent or unreadable."""
    try:
        seconds = float(str(value).strip())
    except (TypeError, ValueError):
        return GROQ_LIMIT_WAIT
    return max(seconds, 1.0) if seconds == seconds else GROQ_LIMIT_WAIT
