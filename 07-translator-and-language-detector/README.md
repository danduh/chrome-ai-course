# 07 — Translator + Language Detector

Detect a language on-device, then translate it — built on Chrome's built-in
`LanguageDetector` and `Translator` globals. No frameworks, no build step, no
dependencies — plain browser JavaScript, inline in `index.html`.

Lesson: **[Translator + Language Detector](https://danduh.me/courses/chrome-built-in-ai/translator-and-language-detector)**
Hosted demo: **[windowai.danduh.me/translate/translate-demo](https://windowai.danduh.me/translate/translate-demo)**
(with the [API walkthrough](https://windowai.danduh.me/translate/translate-api-documentation)).

## What it shows

- Feature-detecting both `LanguageDetector` and `Translator` before any call.
- Detecting the language with `LanguageDetector.detect()` and rendering the
  ranked results with confidence percentages — including the trailing `und`
  (unknown) entry and the low-confidence fallback.
- Probing `Translator.availability({ sourceLanguage, targetLanguage })` **per
  language pair**, because packs download per pair.
- Creating a translator behind that gate, showing first-run pack download
  progress with a `monitor` (`e.loaded` is a 0..1 fraction).
- Chaining detect into translate: the top detected language is fed in as the
  source (guarded by a confidence floor).
- Streaming the result with `translateStreaming()` and appending the deltas.
- Caching the translator by pair and rebuilding it when the pair changes.
- `destroy()` on both instances at `beforeunload`, plus graceful degradation
  when either global is missing or the pair is `unavailable`.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic. Reference only; not built or loaded by the page.

## Running it

Open `index.html` in **desktop Chrome**. That's usually enough.

If the page reports the API is unavailable, serve the folder over `localhost`
(the APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in desktop Chrome.

## Requirements

- **Desktop Chrome** on Windows, macOS, Linux, or ChromeOS (Chromebook Plus).
  The docs say these APIs run on desktop, not on mobile — so no Android or iOS.
- The Translator and Language Detector are stable in Chrome since 138, so on
  current stable they need no flags. Each `(source, target)` language pair
  downloads its own pack (tens of megabytes) on first use; the status line
  shows progress. A non-metered connection helps for that first download.
- Built-in AI enabled. If the demo says the API is missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first translation of a new pair triggers its pack download and can take a
moment; the status line shows progress. Later translations of the same pair are
instant and fully offline.
