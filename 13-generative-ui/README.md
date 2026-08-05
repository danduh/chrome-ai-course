# 13 — Generative UI (MCP Apps)

A tool that returns interactive UI instead of text, on top of Chrome's built-in
`LanguageModel` (Gemini Nano). The model runs an intent loop; when it calls
`renderForm`, that tool returns an HTML document, the host renders it inside a
sandboxed iframe, and the iframe posts its submitted values back over
`postMessage`. No frameworks, no build step, no dependencies — plain browser
JavaScript, inline in `index.html`.

Lesson: **[Generative UI (MCP Apps)](https://danduh.me/courses/chrome-built-in-ai/generative-ui)**
Hosted demo: **[windowai.danduh.me/generative-ui/generative-ui-demo](https://windowai.danduh.me/generative-ui/generative-ui-demo)**
(with the [API walkthrough](https://windowai.danduh.me/generative-ui/generative-ui-api-documentation)).

## What it shows

- Feature-detecting `LanguageModel` and gating on `availability()` before `create()`.
- Showing first-run download progress with a `monitor` (`e.loaded` is a 0..1 fraction).
- **A UI-returning tool.** `renderForm` answers with the MCP Apps shape —
  `{ content, _meta: { ui: { resourceUri } } }` — not a string. The nested
  `_meta.ui` is an `McpUiToolMeta`; the old flat `_meta["ui/resourceUri"]` (with a
  slash) is deprecated. The markup is stored in a `ui://` registry, mirroring the
  shipped `recipeCarouselRegistry` pattern.
- **Rendering in a sandbox.** The host resolves `_meta.ui.resourceUri` to the
  markup and drops it into `<iframe sandbox="allow-scripts">` via `srcdoc` — never
  `innerHTML` into the host DOM. Untrusted fields are HTML-escaped, and the inner
  document ships a locked-down `Content-Security-Policy`.
- **Keeping `ui://` out of the model.** After the tool runs, only `{ content }` is
  fed back to `session.prompt()`; the `ui://` URI is stripped. A guard throws if
  `ui://` ever slips into the prompt (`console.assert` only logs — it never halts).
- **The postMessage channel home.** The iframe posts a JSON-RPC 2.0 message.
  `ui/submit` here is the demo's own message name — the MCP Apps spec defines no
  `ui/submit`; there the view posts a `tools/call` back. The host validates `event.source === uiFrame.contentWindow`
  before trusting it (sandboxed `srcdoc` frames report `event.origin === "null"`,
  so an origin string check is useless).
- Declaring the session languages with `expectedInputs`/`expectedOutputs` on every `create()`, and `destroy()` on `beforeunload`.
- Graceful degradation when the API is missing or `unavailable` — the **canned
  example** button renders the same tool output and runs the full iframe +
  postMessage round-trip with no model at all.

Generative UI / MCP Apps (SEP-1865) shipped as the first official MCP extension
(released 2026-01-26) — a standalone MCP extension, not something layered on
WebMCP. The demo still simplifies the shipped double-iframe
relay down to a single sandboxed iframe to keep the mechanics visible, and it
targets Chrome's on-device `LanguageModel` rather than a real MCP host, so treat
it as a teaching model, not production code.

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

Then open the printed `http://localhost:…` URL in desktop Chrome. The canned
example works regardless — it needs no model.

## Requirements

- **Desktop Chrome** on Windows 10/11, macOS 13+, Linux, or ChromeOS (Platform
  16389.0.0+) on Chromebook Plus devices — no Android or iOS.
- 22 GB free disk to start the one-time download (Chrome purges the model if free
  space later falls below 10 GB), a GPU with more than 4 GB of VRAM — or the CPU
  path, which needs 16 GB RAM and 4+ CPU cores — and a non-metered connection.
- Built-in AI enabled. On current stable Chrome the core Prompt API needs no
  flags — the model downloads on first `create()`. If the demo says the API is
  missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

The first Run on a fresh machine triggers the model download and can take a
while; the status line shows progress. Everything after that is instant, and the
tool, the sandbox, and the postMessage round-trip run entirely offline.
