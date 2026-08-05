# Chrome Built-in AI — course demos

Runnable, framework-free demos for the course
**[Chrome's Built-in AI — from 0 to superhero](https://danduh.me/courses/chrome-built-in-ai/introduction)**
on [danduh.me](https://danduh.me).

Every demo runs **on-device** against Chrome's built-in Gemini Nano — no backend,
no API keys, nothing leaves your machine. Each lesson has a hosted version too,
at **[windowai.danduh.me](https://windowai.danduh.me/)**.

## What's here

One folder per lesson. Each folder is self-contained and runs on its own:

- **`index.html`** — the runnable demo. Plain browser JavaScript, inline, no
  frameworks, no build step, no dependencies. Open it and it runs.
- **`demo.ts`** — a TypeScript reference mirror of the same logic (types added).
  Reference only; it is not built or loaded by the page.
- **`README.md`** — what the demo shows and how to run it.

| # | Folder | Lesson |
|---|--------|--------|
| 1 | [`01-introduction/`](./01-introduction/) | [Introduction: AI in the browser](https://danduh.me/courses/chrome-built-in-ai/introduction) |
| 2 | [`02-setup-and-availability/`](./02-setup-and-availability/) | [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability) |
| 3 | [`03-prompt-api/`](./03-prompt-api/) | [The Prompt API (LanguageModel)](https://danduh.me/courses/chrome-built-in-ai/prompt-api) |
| 4 | [`04-structured-output-and-tools/`](./04-structured-output-and-tools/) | [Structured output & tool calling](https://danduh.me/courses/chrome-built-in-ai/structured-output-and-tools) |
| 5 | [`05-multimodal/`](./05-multimodal/) | [Multimodal: image input](https://danduh.me/courses/chrome-built-in-ai/multimodal) |
| 6 | [`06-summarizer/`](./06-summarizer/) | [The Summarizer API](https://danduh.me/courses/chrome-built-in-ai/summarizer) |
| 7 | [`07-translator-and-language-detector/`](./07-translator-and-language-detector/) | [Translator + Language Detector](https://danduh.me/courses/chrome-built-in-ai/translator-and-language-detector) |
| 8 | [`08-live-voice-translation/`](./08-live-voice-translation/) | [Live voice translation](https://danduh.me/courses/chrome-built-in-ai/live-voice-translation) |
| 9 | [`09-writer-and-rewriter/`](./09-writer-and-rewriter/) | [Writer & Rewriter](https://danduh.me/courses/chrome-built-in-ai/writer-and-rewriter) |
| 10 | [`10-proofreader/`](./10-proofreader/) | [The Proofreader API](https://danduh.me/courses/chrome-built-in-ai/proofreader) |
| 11 | [`11-embeddings/`](./11-embeddings/) | [Embeddings (SemanticEmbedder)](https://danduh.me/courses/chrome-built-in-ai/embeddings) |
| 12 | [`12-webmcp/`](./12-webmcp/) | [WebMCP: your page as a tool surface](https://danduh.me/courses/chrome-built-in-ai/webmcp) |
| 13 | [`13-generative-ui/`](./13-generative-ui/) | [Generative UI (MCP Apps)](https://danduh.me/courses/chrome-built-in-ai/generative-ui) |
| 14 | [`14-mcp-client/`](./14-mcp-client/) | [An MCP client in the browser](https://danduh.me/courses/chrome-built-in-ai/mcp-client) |
| 15 | [`15-observability-and-tracing/`](./15-observability-and-tracing/) | [Observability & tracing](https://danduh.me/courses/chrome-built-in-ai/observability-and-tracing) |
| 16 | [`16-evaluation/`](./16-evaluation/) | [Evaluation](https://danduh.me/courses/chrome-built-in-ai/evaluation) |

The [shipping & compatibility](https://danduh.me/courses/chrome-built-in-ai/shipping-and-compatibility)
lesson is prose-only — the per-API status matrix — so it has no demo folder.

## Requirements

- **Desktop Chrome** on Windows 10/11, macOS 13+, Linux, or ChromeOS
  (Platform 16389.0.0+) on Chromebook Plus devices — no Android or iOS.
- **22 GB free disk** to start the download; the model is purged if free space
  later falls below **10 GB**. A **GPU with > 4 GB VRAM**, or a CPU-only path
  with **16 GB RAM and 4+ CPU cores**. And a non-metered connection for the
  one-time model download.
- Built-in AI enabled. On current stable Chrome the core Prompt API needs no
  flags — the model downloads on first use. If a demo reports the API is
  missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

## Running a demo

The APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts).
Opening `index.html` directly works in most cases; if a demo says the API is
unavailable, serve the folder over `localhost` instead:

```bash
cd 03-prompt-api        # any lesson folder
npx serve .             # then open the printed http://localhost:… URL
# or: python3 -m http.server
```

Then open the page in desktop Chrome and follow the on-screen steps.

## License

MIT.
