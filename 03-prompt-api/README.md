# 03 — The Prompt API (LanguageModel)

A minimal, on-device chat built on Chrome's built-in `LanguageModel` (Gemini
Nano). No frameworks, no build step, no dependencies — plain browser JavaScript,
inline in `index.html`.

Lesson: **[The Prompt API (LanguageModel)](https://danduh.me/courses/chrome-built-in-ai/prompt-api)**
Hosted demo: **[windowai.danduh.me/chat/chat-demo](https://windowai.danduh.me/chat/chat-demo)**
(with the [API walkthrough](https://windowai.danduh.me/chat/chat-api-documentation)).

## What it shows

- Feature-detecting `LanguageModel` and gating on `availability()` before `create()`.
- Showing first-run download progress with a `monitor` (`e.loaded` is a 0..1 fraction).
- Creating a session with `initialPrompts` (a `system` message at index 0) and `outputLanguage: 'en'`.
- Seeding the `temperature` and `topK` inputs from `LanguageModel.params()` when the runtime exposes it.
- Streaming the reply with `promptStreaming()` and appending the deltas (`text += chunk`).
- A live `inputUsage / inputQuota` token readout after each turn.
- A "Reset session" button that calls `destroy()` and recreates the session with the current settings.
- `destroy()` on `beforeunload`, plus graceful degradation when the API is missing or `unavailable`.

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
- Built-in AI enabled. On current stable Chrome the core Prompt API needs no
  flags — the model downloads on first `create()`. If the demo says the API is
  missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first prompt on a fresh machine triggers the model download and can take a
while; the status line shows progress. Later prompts are instant.
