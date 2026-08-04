# 10 — The Proofreader API

An on-device grammar, spelling, and punctuation checker built on Chrome's
built-in `Proofreader` (Gemini Nano). It returns positioned corrections —
`startIndex`, `endIndex`, `correction`, and a `types` array — which the demo
renders as an inline diff and a list of suggestions. No frameworks, no build
step, no dependencies — plain browser JavaScript, inline in `index.html`.

Lesson: **[The Proofreader API](https://danduh.me/courses/chrome-built-in-ai/proofreader)**
Hosted demo: **[windowai.danduh.me/proofreader/proofreader-demo](https://windowai.danduh.me/proofreader/proofreader-demo)**
(with the [API walkthrough](https://windowai.danduh.me/proofreader/proofreader-api-documentation)).

## What it shows

- Feature-detecting `Proofreader` and gating on `availability({ expectedInputLanguages })` before `create()`.
- Degrading gracefully when the API is missing or `unavailable` — with the exact flag to enable (`#proofreader-api`) and links to Setup and the hosted demo.
- Showing first-run adapter download progress with a `monitor` (`e.loaded` is a 0..1 fraction).
- Creating a language-scoped session with `includeCorrectionTypes`, `includeCorrectionExplanations`, and `correctionExplanationLanguage`.
- Calling `proofread()` and reading the `ProofreadResult` — `correctedInput` plus a `corrections` array.
- Slicing each original span from the input with `startIndex`/`endIndex`, and rendering a highlighted inline diff (`<del>` / `<ins>`).
- Listing every correction with its original slice, the suggestion, its `types`, and its `explanation`.
- Caching one session per language, recreating on a language switch, and calling `destroy()` on `beforeunload`.
- Handling `QuotaExceededError`, `NotSupportedError`, `InvalidStateError`, and `AbortError`.

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

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- ~22 GB free disk (Chrome stores the ~4 GB model and purges it below that), a
  GPU with more than 4 GB of VRAM (or a 16 GB-RAM tier machine), and a
  non-metered connection for the one-time download.
- **The Proofreader API is flag-gated** (a lapsed origin trial), so on most
  machines it reports `unavailable`. Enable `#proofreader-api` in
  `chrome://flags`, then restart Chrome. If it's still missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The Proofreader ships adapters for five languages — `en`, `es`, `ja`, `de`,
`fr` — and each one downloads its adapter on the first proofread in that
language; the status line shows progress. Later proofreads are instant.
