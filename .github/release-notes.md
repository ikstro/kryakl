## Kryakl 0.17.4

**Experimental prerelease for testing the dictation changes.** This build has known text-integrity issues listed below and is not ready to replace the normal release for everyday use.

### Changes

- Dictation flushes the final audio buffer before stopping, handles cancellation during microphone startup, and finishes only once on repeated Stop.
- The panel says the microphone is starting until sound reaches the audio processor.
- Punctuation hints are closed for Whisper turbo and small. GPU Whisper sessions use shorter pieces; the new piece lengths were measured on turbo.
- Streaming sessions track the model and device actually used, including the Parakeet fallback. Initial model preparation runs once per session.
- Fuzzy name correction protects ordinary English, Ukrainian and Russian words while preserving explicit pronunciation aliases.
- Whisper context has a shared token budget. The optional local text editor accepts spoken corrections and number formatting.

### Known issues

- Long English dictation can still omit complete sentences.
- **Text editing:** the current experimental checks can accept changes to decimal points, number signs and negations such as "no". Text editing is off by default; check edited results carefully if you enable it.
- **Audio capture failure:** dictation can return only the sound captured before a processor failure, with no visible warning that the recording is incomplete. The missing part is not necessarily limited to the final 100 ms.
- The small punctuation change was measured on CPU, and shorter GPU pieces were measured on turbo. Other affected model/device combinations still need acceptance testing.
- Live microphone testing in the packaged app, installation/rollback, noisy or quiet microphones and behavior under the user's normal workload remain open.

### Download and test

For an isolated test, extract `Kryakl-0.17.4.zip` completely, quit the installed Kryakl from its tray menu, then run `Start-Isolated-Test.cmd`. It uses separate settings and downloads in `%LOCALAPPDATA%\Kryakl-Dictation-Test`, with speech port 8797. Engine and model downloads may be needed. The normal and test versions cannot run together.

The ZIP includes `TESTING.md`. Starting `Kryakl.exe` directly uses normal application data. **The installer replaces the installed Kryakl** and keeps its settings and downloads; use the ZIP launcher for a separate test. The installer is unsigned.

The source, measurements and remaining checks are in [`docs/dictation-test-plan.md`](https://github.com/ikstro/kryakl/blob/v0.17.4/docs/dictation-test-plan.md) and [`docs/speech-quality.md`](https://github.com/ikstro/kryakl/blob/v0.17.4/docs/speech-quality.md). Kryakl processes dictated audio and text locally. Updates are installed manually.
