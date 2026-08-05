# 10 — The Proofreader API

An on-device grammar, spelling, and punctuation checker built on Chrome's
built-in `Proofreader` (Gemini Nano). It returns positioned corrections —
`startIndex`, `endIndex`, and `correction` — which the demo renders as an inline
diff and a list of suggestions. No frameworks, no build step, no dependencies —
plain browser JavaScript, inline in `index.html`.

Lesson: **[The Proofreader API](https://danduh.me/courses/chrome-built-in-ai/proofreader)**
Hosted demo: **[windowai.danduh.me/proofreader/proofreader-demo](https://windowai.danduh.me/proofreader/proofreader-demo)**
(with the [API walkthrough](https://windowai.danduh.me/proofreader/proofreader-api-documentation)).

## What it shows

- Feature-detecting `Proofreader` and gating on `availability({ expectedInputLanguages })` before `create()`.
- Degrading gracefully when the API is missing or `unavailable` — with the exact flag to enable (`#proofreader-api`) and links to Setup and the hosted demo.
- Showing first-run adapter download progress with a `monitor` (`e.loaded` is a 0..1 fraction; `e.total` is always 1).
- Creating a language-scoped session — the shipped `create()` options are just `expectedInputLanguages` and a download `monitor`.
- Calling `proofread()` and reading the `ProofreadResult` — `correctedInput` plus a `corrections` array.
- Slicing each original span from the input with `startIndex`/`endIndex`, and rendering a highlighted inline diff (`<del>` / `<ins>`).
- Listing every correction with its original slice and the suggestion.
- Caching one session per language, recreating on a language switch, and calling `destroy()` on `beforeunload`.
- Handling `QuotaExceededError`, `NotSupportedError`, and `AbortError` (a destroyed session rejects with `AbortError`).

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

- **Desktop Chrome** on Windows 10/11, macOS 13+, Linux, or ChromeOS
  (Platform 16389.0.0+) on Chromebook Plus devices — no Android or iOS.
- 22 GB free disk to start the download (Chrome purges the model if free space
  later drops below 10 GB), a GPU with more than 4 GB of VRAM — or a CPU-only
  path with 16 GB RAM and 4+ cores — and a non-metered connection for the
  one-time download.
- **The Proofreader API is flag-gated** — it shipped as an origin trial in
  Chrome 141–145 and is otherwise off by default, so on most machines it reports
  `unavailable`. Enable `#proofreader-api` in `chrome://flags`, then restart
  Chrome. If it's still missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The Proofreader ships adapters for a small set of languages — `en`, `es`, and
`ja` are the ones Chrome accepts today — and each one downloads its adapter on
the first proofread in that language; the status line shows progress. Later
proofreads are instant.
