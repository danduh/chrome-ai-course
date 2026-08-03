# 08 — Live voice translation

Speak, and the page transcribes with the browser's Web Speech API and translates
each sentence on-device with Chrome's `Translator`. No frameworks, no build step,
no dependencies — plain browser JavaScript, inline in `index.html`.

Lesson: **[Live voice translation](https://danduh.me/courses/chrome-built-in-ai/live-voice-translation)**
Hosted demo: **[windowai.danduh.me/live-translate](https://windowai.danduh.me/live-translate)**
(with the [API walkthrough](https://windowai.danduh.me/live-translate/docs)).

## What it shows

- Feature-detecting **both** `SpeechRecognition` (via the `window.SpeechRecognition || window.webkitSpeechRecognition` prefix dance) and `Translator` before any call.
- Wiring `SpeechRecognition` with `continuous`, `interimResults`, and a BCP-47 `lang`, then reading `onresult` / `onerror` / `onend`.
- Splitting interim guesses (shown muted) from finalized sentences (committed), iterating from `event.resultIndex`.
- Bridging the two APIs on language tags: `speechLang.split('-')[0]` turns the recognizer's `en-US` into the Translator's `en`.
- Translating each final sentence on-device through `Translator.availability({ sourceLanguage, targetLanguage })` → `create()` (with pack-download `monitor`, `e.loaded` a 0..1 fraction) → `translate()`.
- Reusing one cached translator per language pair, rebuilt only when the pair changes.
- A rolling interim translation preview — debounced (~300 ms) and cancelled with an `AbortController` so stale previews can't land out of order.
- An optional "Speak translation" toggle using `speechSynthesis`.
- Graceful degradation when either global is missing, and cleanup on `beforeunload`: `recognition.stop()` plus `translator.destroy()`.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic. Reference only; not built or loaded by the page. Web Speech types aren't in the DOM lib on every toolchain, so it declares a small ambient shape and stays self-contained.

## Running it

Open `index.html` in **desktop Chrome**. That's usually enough.

If the page reports the API is unavailable, serve the folder over `localhost`
(the APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in desktop Chrome. Hit **Start
listening** and allow the microphone when prompted.

## Requirements

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS. Firefox and iOS Safari don't ship the Web Speech API.
- **A microphone**, and permission to use it. The first Start triggers Chrome's permission prompt — allow it from the address bar if you dismissed it.
- The `Translator` is stable in Chrome since 138, so on current stable it needs no flags. Each `(source, target)` language pair downloads its own pack (typically 10–50 MB) on first use; the status line shows progress.
- Built-in AI enabled. If the demo says the API is missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

## On-device vs. cloud — the honest split

Only half of this pipeline is local. The **translation** runs on-device: open the
network tab and watch it make zero requests. The **transcription** does not —
Chrome's Web Speech API sends your microphone audio to a Google speech service and
gets text back, which is why `SpeechRecognition` fails with `error: 'network'`
when you're offline. Chrome is rolling out an on-device speech mode, but it isn't
guaranteed on every machine, so assume the audio can leave until you've checked.
Don't sell this as "nothing leaves your device" — the translation stays; the audio
goes out and comes back as text.
