# 09 — Writer & Rewriter

An on-device drafting playground built on Chrome's built-in `Writer` and
`Rewriter` (Gemini Nano). No frameworks, no build step, no dependencies — plain
browser JavaScript, inline in `index.html`.

Lesson: **[Writer & Rewriter](https://danduh.me/courses/chrome-built-in-ai/writer-and-rewriter)**
Hosted demo: **[windowai.danduh.me/writer/writer-demo](https://windowai.danduh.me/writer/writer-demo)**
(with the [API walkthrough](https://windowai.danduh.me/writer/writer-api-documentation)).

## Heads up: these APIs are flag-gated

Unlike the Summarizer, `Writer` and `Rewriter` are **not stable** — they're still
origin-trial / behind a flag as of Chrome 150, and off by default. On most
machines `availability()` returns `unavailable`, and the demo will tell you so.
To try them for real, enable both flags and restart Chrome:

- `chrome://flags/#writer-api-for-gemini-nano`
- `chrome://flags/#rewriter-api-for-gemini-nano`
- `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**

Each panel degrades on its own, so if only one flag is set, the other panel still
points you at the flag it needs.

## What it shows

- Two panels on one page — a **Writer** (draft from a brief) and a **Rewriter** (reshape existing text).
- Feature-detecting each bare global and gating on its own `availability()` before `create()`.
- Showing first-run download progress with a `monitor` (`e.loaded` is a 0..1 fraction).
- Writer options `tone` / `format` / `length` plus an optional `sharedContext` frame.
- Rewriter options `tone` / `length` / `format` (each defaulting to `as-is`) plus a per-call `context`.
- Streaming with `writeStreaming()` / `rewriteStreaming()` and appending the deltas (`text += chunk`).
- Recreating the instance per run (options can change) and calling `destroy()` on `beforeunload`.
- Graceful degradation when an API is missing or `unavailable`, plus handling for `QuotaExceededError`, `NotSupportedError`, and `InvalidStateError`.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic. Reference only; not built or loaded by the page.

## Running it

Open `index.html` in **desktop Chrome**. That's usually enough.

If the page reports an API is unavailable, first check the flags above. The APIs
also need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts),
so if you're opening the file directly and it still won't run, serve the folder
over `localhost`:

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in desktop Chrome.

## Requirements

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- The two flags above enabled (Writer and Rewriter are prototype-only, not stable).
- ~22 GB free disk (Chrome stores the ~4 GB model and purges it below that), a
  GPU with more than 4 GB of VRAM (or a 16 GB-RAM tier machine), and a
  non-metered connection for the one-time download.
- Built-in AI enabled. If the demo says an API is missing even with the flags on,
  work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first run on a fresh machine triggers the model download and can take a
while; the status line shows progress. Later runs are instant.
