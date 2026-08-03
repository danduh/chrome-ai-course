# 12 — WebMCP: your page as a tool surface

A tiny page that owns a cart, exposes three actions as WebMCP tools on
`document.modelContext`, and lets an in-page `LanguageModel` (Gemini Nano) agent
drive that cart by calling them. No frameworks, no build step, no dependencies —
plain browser JavaScript, inline in `index.html`.

Lesson: **[WebMCP: your page as a tool surface](https://danduh.me/courses/chrome-built-in-ai/webmcp)**
Hosted demo: **[windowai.danduh.me/webmcp](https://windowai.danduh.me/webmcp)**
(with the [API walkthrough](https://windowai.danduh.me/webmcp/docs)).

## What it shows

- Resolving the entry point across versions: `document.modelContext ?? navigator.modelContext` (`navigator.modelContext` is deprecated in Chrome 150).
- Registering three tools (`addItem`, `removeItem`, `listItems`) with `registerTool({ name, description, inputSchema, annotations, execute })`, each under one `AbortController`.
- Tearing down every registration with a single `controller.abort()` on `beforeunload` (portable across Chrome 146–150; no `unregisterTool` needed).
- **One definition, two consumers:** the same `CART_TOOLS` array is registered on `document.modelContext` (for external agents) and dispatched into by the in-page agent loop.
- Wiring an in-page `LanguageModel` agent that actually calls the tools: a session with `responseFormat: INTENT_SCHEMA` and a system prompt that lists the tools, looping prompt → parse → run the tool → feed the result back, logging every call.
- Coercing a WebMCP `execute` result (`Promise<unknown>`) to the string the agent loop feeds back.
- Feature-detecting **both** `document.modelContext` and `LanguageModel`, degrading gracefully when either is missing (flag guidance + Setup + hosted-demo links) — the cart stays usable either way.
- Passing `outputLanguage: 'en'` to `create()`, showing first-run download progress with a `monitor` (`e.loaded` is a 0..1 fraction), and `destroy()` on teardown.

The in-page agent uses the intent loop (a `responseFormat` JSON schema plus a
prompt/parse/run/feed cycle) rather than `LanguageModel.create({ tools })`,
because that native tool-calling codepath was unreliable on recent Canary. The
loop leans only on `responseFormat`, which is stable — and it dispatches into the
exact same tool descriptors that are registered on `document.modelContext`.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic, with self-contained ambient declarations for `document.modelContext` and `LanguageModel`. Reference only; not built or loaded by the page.

## Running it

Open `index.html` in **desktop Chrome**.

WebMCP is not a default-on API yet. To register tools and run the agent end to
end you need the WebMCP flag (or an origin-trial token on a deployed origin):

1. Open `chrome://flags/#enable-webmcp-testing` and enable it, then relaunch Chrome.
2. Open `index.html`. If the page reports the API is unavailable, serve the folder
   over `localhost` (the APIs need a
   [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

   ```bash
   npx serve .
   # or: python3 -m http.server
   ```

   Then open the printed `http://localhost:…` URL in desktop Chrome.

Without the flag, the cart and the tool list still render — the tools just aren't
registered and the agent is disabled. That is the intended graceful-degradation
path.

## Requirements

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- WebMCP enabled via `chrome://flags/#enable-webmcp-testing` (Chrome 149+ ships it as a public origin trial; Chrome 146–148 Canary used `chrome://flags/#WebMCP for testing`). `navigator.modelContext` is deprecated in Chrome 150 — the demo prefers `document.modelContext`.
- Built-in AI available for the agent: ~22 GB free disk (Chrome stores the ~4 GB model), a GPU with more than 4 GB of VRAM (or a 16 GB-RAM tier machine), and a non-metered connection for the one-time download. If the demo says the model is missing, work through [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

## Caveat — don't ship this to production

WebMCP is a W3C Draft Community Group Report, not a stable standard, and the
surface is still moving (targeted to stabilize mid-to-late 2026). Build with it
to learn; don't bet a product on it yet. Most users won't have it enabled, so any
page that uses it must stay useful without it — exactly what the degraded path
here does.
