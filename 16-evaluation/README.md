# 16 — Evaluation

A browser mini-eval harness for Chrome's built-in AI (Gemini Nano), built on the
raw `Summarizer`, `Translator`, and `LanguageModel` globals. No frameworks, no
build step, no dependencies — plain browser JavaScript, inline in `index.html`.
Pick a golden-set case, run it many times, and read the stability rate.

Lesson: **[Evaluation](https://danduh.me/courses/chrome-built-in-ai/evaluation)**
Hosted demo: **[windowai.danduh.me/evaluation](https://windowai.danduh.me/evaluation)**
(with the [API walkthrough](https://windowai.danduh.me/evaluation/docs)).

## What it shows

- A tiny **golden set** (four cases) mirroring the shipped `EVAL_CASES`: each is a
  trusted input, a plain-language rule, and a deterministic `check(output)` — a
  Summarizer `tl;dr` (`≤ 40 words`), a Summarizer `key-points` (`≥ 2 lines`), a
  Translator (non-empty and different from the English input), and a Prompt case
  (`exactly yes/no`) the small model often fails.
- **Rule-based scoring** — regular code, no second model — so the whole demo is
  reproducible and runs for everyone on-device.
- A **stability rate**: run each case 5×, 8×, or 10×, score each output, and
  report `passed / scored`. Because Gemini Nano is non-deterministic, one run
  tells you nothing.
- **ERROR kept separate from FAIL.** A run that throws (the harness broke) is an
  ERROR and is excluded from the denominator; a wrong answer is a FAIL. Counting
  infra errors as failures makes a good model look bad.
- Each API gated on `availability()` before `create()`, with a `monitor` download
  progress bar (`e.loaded` is a 0..1 fraction), and `destroy()` after each run and
  on `beforeunload`.
- The Prompt case surfacing as **ERROR** (not FAIL) when the Prompt API isn't
  executable on this browser — which is the ERROR-vs-FAIL point in action.
- Graceful degradation when no built-in AI globals exist, with links to Setup and
  the hosted demo.

There is deliberately **no LLM-as-judge** here — that needs a second, bigger
model (a local Ollama or a cloud model behind a flag). The lesson covers it.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic, including the
  `EvalCase` and `CheckResult` types. Reference only; not built or loaded by the page.

## Running it

Open `index.html` in **desktop Chrome**. That's usually enough.

If the page reports the API is unavailable, serve the folder over `localhost`
(the APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in desktop Chrome.

The Summarizer and Translator cases run on stable Chrome. The Prompt (`yes/no`)
case needs the Prompt API executable — on stable builds that may mean Chrome
Canary or flags; where it isn't, the demo reports those runs as ERROR, not FAIL.

## Requirements

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- ~22 GB free disk (Chrome stores the ~4 GB model and purges it below that), a
  GPU with more than 4 GB of VRAM (or a 16 GB-RAM tier machine), and a
  non-metered connection for the one-time download.
- Built-in AI enabled. The Summarizer and Translator APIs are stable since Chrome
  138 and need no flags on current builds; the core Prompt API (`LanguageModel`)
  is stable on Chrome 148+ and may still need Canary or flags on older builds. If
  the demo says the APIs are missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first run on a fresh machine triggers the model download and can take a
while; the status line shows progress. Later runs are instant — which is when you
watch the stability rate settle.
