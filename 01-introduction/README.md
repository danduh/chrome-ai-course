# 01 — Introduction: hello, on-device model

The smallest possible Chrome built-in AI demo. It feature-detects the
`LanguageModel` global, checks `availability()`, and on a click creates a
session (declaring languages via `expectedInputs`/`expectedOutputs`, plus a download-progress monitor), streams
the answer to one prompt, then calls `destroy()`.

Prompt: _"In one sentence, explain on-device AI to a web developer."_

- Lesson: [Introduction: AI in the browser](https://danduh.me/courses/chrome-built-in-ai/introduction)
- Hosted demo: [windowai.danduh.me](https://windowai.danduh.me/)

## Files

- `index.html` — the runnable demo. Plain inline browser JS, no build step, no
  dependencies. Open it in desktop Chrome.
- `demo.ts` — a TypeScript reference mirror of the same logic (types added). Not
  built or loaded by the page; read it, or compile it with `tsc` if you like.

## Run it

Open `index.html` in desktop Chrome. That's usually enough.

The APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts).
If the page reports the API is unavailable, serve the folder over `localhost`
instead:

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in desktop Chrome.

## Requirements

- Desktop Chrome on Windows 10/11, macOS 13+, Linux, or ChromeOS (Platform
  16389.0.0+) on Chromebook Plus. No Android or iOS.
- 22 GB free disk to start the one-time download (the model is purged if free
  space later falls below 10 GB). Either a GPU with more than 4 GB of VRAM, or
  16 GB of RAM and 4+ CPU cores for the CPU path. A non-metered connection for
  the download.
- Built-in AI enabled. If `availability()` returns `unavailable`, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

## What to expect

On first run, Gemini Nano downloads (a few GB) and the progress bar tracks it —
`create()` does not resolve until the download finishes. After that, a session
warms up in a fraction of a second and the answer streams in. The session is
destroyed as soon as the answer completes.
