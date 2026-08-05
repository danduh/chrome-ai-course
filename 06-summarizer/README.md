# 06 — The Summarizer API

An on-device text summarizer built on Chrome's built-in `Summarizer` (Gemini
Nano). No frameworks, no build step, no dependencies — plain browser JavaScript,
inline in `index.html`.

Lesson: **[The Summarizer API](https://danduh.me/courses/chrome-built-in-ai/summarizer)**
Hosted demo: **[windowai.danduh.me/summary/summary-demo](https://windowai.danduh.me/summary/summary-demo)**
(with the [API walkthrough](https://windowai.danduh.me/summary/summary-api-documentation)).

## What it shows

- Feature-detecting `Summarizer` and gating on `availability()` before `create()`.
- Showing first-run download progress with a `monitor` (`e.loaded` is a 0..1 fraction).
- Creating a summarizer with `type`, `format`, and `length` — including the `tldr` type (no semicolon; `tl;dr` throws a `TypeError`).
- An optional `sharedContext` field that frames every summary the instance produces.
- Streaming the summary with `summarizeStreaming()` and appending the deltas (`text += chunk`).
- Recreating the summarizer per run (options can change) and calling `destroy()` on `beforeunload`.
- Graceful degradation when the API is missing or `unavailable`, plus handling for `QuotaExceededError`, `NotSupportedError`, `TypeError`, and `AbortError` (calling a method after `destroy()`).

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

- **Desktop Chrome** on Windows 10/11, macOS 13+, Linux, or ChromeOS (Platform
  16389.0.0+) on Chromebook Plus devices. No Android or iOS.
- At least 22 GB free disk gates the initial download; the model is purged if free
  space later falls below 10 GB. Plus either a GPU with more than 4 GB of VRAM, or
  16 GB of RAM and 4+ CPU cores (the model can run CPU-only), and a non-metered
  connection for the one-time download.
- Built-in AI enabled. The Summarizer API is stable since Chrome 138 and needs
  no flags on current builds — the model downloads on first `create()`. If the
  demo says the API is missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first summary on a fresh machine triggers the model download and can take a
while; the status line shows progress. Later summaries are instant.
