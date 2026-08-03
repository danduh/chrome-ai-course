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
| 1 | [`01-introduction/`](./01-introduction/) | [Introduction: AI in the browser, on-device](https://danduh.me/courses/chrome-built-in-ai/introduction) |
| 2 | [`02-setup-and-availability/`](./02-setup-and-availability/) | [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability) |
| 3 | [`03-prompt-api/`](./03-prompt-api/) | [The Prompt API (LanguageModel)](https://danduh.me/courses/chrome-built-in-ai/prompt-api) |
| 4 | [`04-structured-output-and-tools/`](./04-structured-output-and-tools/) | [Structured output & tool calling](https://danduh.me/courses/chrome-built-in-ai/structured-output-and-tools) |
| 5 | [`05-multimodal/`](./05-multimodal/) | [Multimodal: image input](https://danduh.me/courses/chrome-built-in-ai/multimodal) |

More lessons land as the course fills in.

## Requirements

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- ~**22 GB free disk** (Chrome stores the ~4 GB model and purges it below that),
  a **GPU with > 4 GB VRAM** (or a 16 GB-RAM tier machine), and a non-metered
  connection for the one-time model download.
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
