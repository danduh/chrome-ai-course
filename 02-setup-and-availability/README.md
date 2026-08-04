# 02 — Setup & the availability lifecycle

A "check your setup" panel for Chrome's built-in AI. It feature-detects the
`LanguageModel` global, reads its `availability()` state, downloads Gemini Nano
if needed (with a live progress bar), and runs one prompt to prove the on-device
round trip works. No frameworks, no build step, no dependencies — plain browser
JavaScript, inline in `index.html`.

Lesson: **[Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability)**
Hosted browser check: **[windowai.danduh.me/status](https://windowai.danduh.me/status)**

## What it shows

- Feature-detecting `LanguageModel` and gating on `availability()` before `create()`.
- A colored status line for each of the four states: `unavailable`, `downloadable`, `downloading`, `available` — with clear guidance for each.
- The `unavailable` path degrading gracefully with links to the lesson and the live browser check (never a blank page).
- First-run download progress from a `monitor` (`e.loaded` is a 0..1 fraction, fed straight into `<progress max="1">`).
- Creating the session with `expectedInputs`/`expectedOutputs` declaring its languages.
- A one-word test `prompt()` once the model is `available`, to prove it answers on-device.
- `LanguageModel.params()` output when the runtime exposes it (feature-detected first).
- A "Re-check" button, and `destroy()` on `beforeunload` to free GPU memory.

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
- Around 22 GB of free disk (Chrome stores the ~4 GB model and purges it below
  that, or after 30 days idle), a GPU with more than 4 GB of VRAM (or a 16 GB-RAM
  tier machine), and a non-metered connection for the one-time download.
- Built-in AI enabled. On current stable Chrome the core Prompt API needs no
  flags — the model downloads on first `create()`. If the panel reports
  `unavailable`, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first download on a fresh machine can take a while; the progress bar shows
where it's up to. Once the model is on disk, `create()` and the test prompt are
near-instant.
