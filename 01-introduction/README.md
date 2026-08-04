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

- Desktop Chrome (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- ~22 GB free disk (Chrome stores the ~4 GB model and purges it below that), a
  GPU with over 4 GB VRAM (or a 16 GB-RAM tier machine), and a non-metered
  connection for the one-time download.
- Built-in AI enabled. If `availability()` returns `unavailable`, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

## What to expect

On first run, Gemini Nano downloads (~4 GB) and the progress bar tracks it —
`create()` does not resolve until the download finishes. After that, sessions
warm up in about 300 ms and the answer streams in. The session is destroyed as
soon as the answer completes.
