# 15 — Observability & tracing

A ~30-line client-side tracer for Chrome's built-in AI, built on the raw
`Summarizer` and `LanguageModel` globals (Gemini Nano). No frameworks, no build
step, no dependencies — plain browser JavaScript, inline in `index.html`. Run one
on-device call and see the single captured span three ways at once.

Lesson: **[Observability & tracing](https://danduh.me/courses/chrome-built-in-ai/observability-and-tracing)**
Hosted demo: **[windowai.danduh.me/observability/observability-demo](https://windowai.danduh.me/observability/observability-demo)**
(with the [API walkthrough](https://windowai.danduh.me/observability/observability-api-documentation)).

## What it shows

- A tiny tracer that mirrors the shipped one: `newSpan`, `addSink` (returns an
  unsubscribe), `emit`, and a `traceStream` wrapper.
- `traceStream` returns a **pass-through** `ReadableStream`, so the summary still
  renders chunk by chunk while the span captures TTFT and output chars; the span
  emits once the stream ends, errors, or is cancelled.
- Two sinks registered up front — a `console.log` sink and an in-page log sink —
  both receiving every span.
- The one captured `AiSpan` rendered three ways side by side: the `console.log`
  line, the structured JSON object, and the OpenTelemetry `gen_ai.*` attributes
  (an `INTERNAL` span; `gen_ai.request.model` is `'gemini-nano'` because Chrome
  exposes no version).
- Feature-detecting the global and gating on `availability()` before `create()`,
  with a `monitor` download progress bar (`e.loaded` is a 0..1 fraction).
- Context reading via `session.contextUsage` / `session.contextWindow` —
  which is why `contextUsage` shows up on the **Prompt API** and is absent on the
  Summarizer.
- `destroy()` after each run and on `beforeunload` to free GPU memory, plus a
  synthesized error span when `create()` fails (error observability too).
- Privacy by default: the tracer logs sizes and timings, never the prompt or the
  response. Nothing leaves the browser.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic, including the
  `AiSpan` type. Reference only; not built or loaded by the page.

## Running it

Open `index.html` in **desktop Chrome**. That's usually enough.

If the page reports the API is unavailable, serve the folder over `localhost`
(the APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in desktop Chrome.

To watch the tracer wrap a call in DevTools, open the Console before you hit
**Run & trace** — the `console.log` sink prints the same span you see on the page.

## Requirements

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- ~22 GB free disk (Chrome stores the ~4 GB model and purges it below that), a
  GPU with more than 4 GB of VRAM (or a 16 GB-RAM tier machine), and a
  non-metered connection for the one-time download.
- Built-in AI enabled. The Summarizer API is stable since Chrome 138 and needs no
  flags on current builds; the core Prompt API (`LanguageModel`) is stable on
  Chrome 148+ and may still need Canary or flags on older builds — which is why
  this demo defaults to the Summarizer. If the demo says the API is missing, work
  through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first run on a fresh machine triggers the model download and can take a
while; the status line shows progress. Later runs are instant, and the trace is
where you watch the latency drop.
