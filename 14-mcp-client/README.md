# 14 — An MCP client in the browser

The inverse of WebMCP: instead of the page exposing tools, the page is the MCP
**client**. It runs the JSON-RPC handshake (`initialize` → `tools/list`) against
an MCP server over Streamable HTTP, then hands the discovered tools to Chrome's
built-in `LanguageModel` (Gemini Nano), which drives them through a
`responseConstraint` intent loop — each tool call becomes a `tools/call` request to
the server. No frameworks, no SDK, no build step — plain browser JavaScript,
inline in `index.html`.

Lesson: **[An MCP client in the browser](https://danduh.me/courses/chrome-built-in-ai/mcp-client)**
Hosted demo: **[windowai.danduh.me/mcp-client/mcp-client-demo](https://windowai.danduh.me/mcp-client/mcp-client-demo)**
(with the [API walkthrough](https://windowai.danduh.me/mcp-client/mcp-client-api-documentation)).

## What it shows

- **A mock MCP server, in-page (default).** An object that answers `initialize`,
  `tools/list`, and `tools/call` for three demo tools (`add`, `multiply`,
  `echo`), so the full connect → discover → agent-loop path runs offline — no
  network, no CORS, no server to install.
- **A raw Streamable HTTP transport.** Switch to "Remote MCP server (URL)" and
  the same client code POSTs JSON-RPC 2.0 to a real endpoint via `fetch`, sending
  `Accept: application/json, text/event-stream`, capturing the `Mcp-Session-Id`
  from the initialize response, and parsing either a JSON or an SSE reply.
- **The handshake, by hand:** `initialize` → `notifications/initialized` →
  `tools/list`, then `tools/call` on demand — the exact JSON-RPC an SDK would
  send, written out so you can see the wire.
- **The bridge to Gemini Nano:** a session created with a system prompt listing
  the server's tools; each turn prompts with `responseConstraint: INTENT_SCHEMA`
  (`{ toolName, args, reply }`), parses (fence-stripping guard), dispatches the
  named tool as `tools/call`, feeds the flattened result back, and repeats —
  capped at 8 turns.
- Feature-detecting `LanguageModel` and gating on `availability()` before
  `create()`, showing first-run download progress with a `monitor` (`e.loaded` is
  a 0..1 fraction), passing `outputLanguage: 'en'`, and `destroy()` on teardown.
- Graceful degradation: connecting and browsing tools works without Gemini Nano;
  only the agent step needs the Prompt API, so it's gated on its own.

The intent loop is the reliable path because native `tools` was unreliable on the
Chrome build this was written against; the loop leans only on `responseConstraint`.
The lesson covers both.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic. Reference only; not built or loaded by the page.

## Running it

Open `index.html` in **desktop Chrome**. The default mock server needs nothing
else — connect, then ask "What is 21 plus 21, then multiply the result by 2?" and
watch the loop call `add`, then `multiply`, then reply.

If the page reports the API is unavailable, serve the folder over `localhost`
(the APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in desktop Chrome.

## Connecting to a real MCP server (and the CORS caveat)

A native MCP client (Claude Desktop, an IDE) reaches servers over stdio or from a
trusted process. A **browser** MCP client is bound by the same-origin policy:
every request to a remote server is a cross-origin `fetch`, and the browser
enforces CORS. For a real connection to succeed, the server must:

- send `Access-Control-Allow-Origin` for this page's origin (or `*`);
- list `Mcp-Session-Id` in `Access-Control-Expose-Headers` (the Streamable HTTP
  transport reads the session id from that response header — if the browser can't
  see it, follow-up requests fail with "missing session ID");
- allow `Authorization`, `Content-Type`, `Mcp-Session-Id`, and
  `Mcp-Protocol-Version` in `Access-Control-Allow-Headers`;
- answer the `OPTIONS` preflight for `POST`, `GET`, and `DELETE`.

Most public MCP servers assume a native client and send none of these — they
won't connect from a browser. Two ways around it:

1. **Run a server you control** with permissive CORS.
2. **Run a small CORS proxy** and point the demo at it. A proxy is a dependency-
   free Node relay: `browser → http://localhost:PORT → target server`
   (server-to-server, no CORS), injecting the CORS headers on the way back and
   exposing `Mcp-Session-Id`. There are two shapes:
   - **Baked-in target** (like the repo's `mcp-cors-proxy.mjs`): the proxy is
     started with the target URL in an env var, so you put the *proxy's own*
     address in the demo's Server URL field and leave the proxy-prefix blank —
     e.g. `TARGET='https://example.com/mcp' node ./mcp-cors-proxy.mjs`, then
     connect to `http://localhost:9340/`.
   - **Prefix style** (like `cors-anywhere`): the proxy forwards to whatever URL
     you append. Put the proxy address in the **CORS proxy prefix** field and the
     real server URL in **Server URL**; the demo prepends the prefix to the URL.

The **bearer token** rides as `Authorization: Bearer <token>` on requests to the
one endpoint you entered. It's held in memory only — never written to storage,
never logged. Still, use a scoped, revocable, low-privilege token, not a
long-lived admin credential.

## Requirements

- **Desktop Chrome** (Windows 10+, macOS 13+, or Linux). No Android, iOS, or ChromeOS.
- ~22 GB free disk (Chrome stores the ~4 GB model and purges it below that), a
  GPU with more than 4 GB of VRAM (or a 16 GB-RAM tier machine), and a
  non-metered connection for the one-time download.
- Built-in AI enabled. On current stable Chrome the core Prompt API needs no
  flags — the model downloads on first `create()`. If the demo says the API is
  missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

Connecting to the mock server and browsing its tools works in any browser with
`fetch`. Only the agent chat needs Gemini Nano; the first Ask on a fresh machine
triggers the model download and can take a while, with progress on the status
line. Everything after that runs on-device.
