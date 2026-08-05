# 04 — Structured output & tool calling

Two on-device tricks on top of Chrome's built-in `LanguageModel` (Gemini Nano):
force JSON with a schema, and drive local tools with an intent loop. No
frameworks, no build step, no dependencies — plain browser JavaScript, inline in
`index.html`.

Lesson: **[Structured output & tool calling](https://danduh.me/courses/chrome-built-in-ai/structured-output-and-tools)**
Hosted demo: **[windowai.danduh.me/tool-calling/tool-calling-demo](https://windowai.danduh.me/tool-calling/tool-calling-demo)**
(with the [API walkthrough](https://windowai.danduh.me/tool-calling/tool-calling-api-documentation)).

## What it shows

- Feature-detecting `LanguageModel` and gating on `availability()` before `create()`.
- Showing first-run download progress with a `monitor` (`e.loaded` is a 0..1 fraction).
- **Part 1 — structured output:** passing a JSON Schema as `responseConstraint` on `prompt()` so the reply is constrained to `{ sentiment, topics, summary }`, then parsing it with a fence-stripping guard (the model sometimes wraps JSON in a fence).
- **Part 2 — tool calling via the intent loop:** a session created with a system prompt that lists the tools, then each turn prompts with `responseConstraint: INTENT_SCHEMA` (`{ toolName, args, reply }`), parses, runs a local JS tool (`getWeather` / `calculate`), feeds the result back, and repeats — capped at 8 steps, with every step logged.
- Declaring the session languages with `expectedInputs`/`expectedOutputs` on every `create()`, and `destroy()` on `beforeunload`.
- Graceful degradation when the API is missing or `unavailable`.

The intent loop is the tool-calling pattern that runs today. The Prompt API
explainer sketches a native `tools` option on `create()`, but Chrome hasn't wired
it up on-device — pass it and the model ignores your functions or the on-device
process crashes — so the loop, which leans only on the shipped `responseConstraint`,
is the real path. This lesson teaches it.

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
  (Platform 16389.0.0+) on Chromebook Plus devices. No Android or iOS.
- ~22 GB free disk to start the download (Chrome removes the model if free space
  later drops below 10 GB), a GPU with more than 4 GB of VRAM — or, on the CPU
  path, 16 GB of RAM and 4-plus CPU cores — and a non-metered connection for the
  one-time download.
- Built-in AI enabled. On current stable Chrome the core Prompt API needs no
  flags — the model downloads on first `create()`. If the demo says the API is
  missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first Extract or Run on a fresh machine triggers the model download and can
take a while; the status line shows progress. Everything after that is instant,
and the tools run entirely offline.
