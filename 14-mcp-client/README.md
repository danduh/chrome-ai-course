# 14 — An MCP client in the browser

The inverse of WebMCP: instead of the page exposing tools, the page is the MCP
**client**. It runs the modern JSON-RPC flow (`server/discover` → `tools/list`)
against an MCP server over Streamable HTTP, then hands the discovered tools to Chrome's
built-in `LanguageModel` (Gemini Nano), which drives them through a
`responseConstraint` intent loop — each tool call becomes a `tools/call` request to
the server. No frameworks, no SDK, no build step — plain browser JavaScript,
inline in `index.html`.

Lesson: **[An MCP client in the browser](https://danduh.me/courses/chrome-built-in-ai/mcp-client)**
Hosted demo: **[windowai.danduh.me/mcp-client/mcp-client-demo](https://windowai.danduh.me/mcp-client/mcp-client-demo)**
(with the [API walkthrough](https://windowai.danduh.me/mcp-client/mcp-client-api-documentation)).

## What it shows

- **A mock MCP server, in-page (default).** An object that answers
  `server/discover`, `tools/list`, and `tools/call` for three demo tools (`add`,
  `multiply`, `echo`), so the full connect → discover → agent-loop path runs
  offline — no network, no CORS, no server to install.
- **A raw Streamable HTTP transport.** Switch to "Remote MCP server (URL)" and
  the same client code POSTs JSON-RPC 2.0 to a real endpoint via `fetch`, sending
  `Accept: application/json, text/event-stream`, the per-request `_meta` and the
  `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` mirror headers, and parsing
  either a JSON or an SSE reply.
- **The modern flow, by hand:** `server/discover` → `tools/list`, then
  `tools/call` on demand — no `initialize` handshake and no session, since MCP
  revision `2026-07-28` conveys the protocol version and client identity in each
  request's `_meta` instead. Written out so you can see the wire.
- **The bridge to Gemini Nano:** a session created with a system prompt listing
  the server's tools; each turn prompts with `responseConstraint: INTENT_SCHEMA`
  (`{ toolName, args, reply }`), parses (fence-stripping guard), dispatches the
  named tool as `tools/call`, feeds the flattened result back, and repeats —
  capped at 8 turns.
- Feature-detecting `LanguageModel` and gating on `availability()` before
  `create()`, showing first-run download progress with a `monitor` (`e.loaded` is
  a 0..1 fraction), declaring the session languages with `expectedInputs`/`expectedOutputs`, and `destroy()` on teardown.
- Graceful degradation: connecting and browsing tools works without Gemini Nano;
  only the agent step needs the Prompt API, so it's gated on its own.

The intent loop is the pattern because there is no native `tools` array to reach
for: passing tools to `LanguageModel.create()` isn't a supported browser feature,
so the loop leans only on `responseConstraint`, which ships. The lesson walks
through it.

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
- allow `Content-Type`, `Authorization`, `MCP-Protocol-Version`, `Mcp-Method`,
  and `Mcp-Name` in `Access-Control-Allow-Headers` (these non-simple request
  headers trigger a preflight the server has to answer, or the real POST never
  goes out);
- answer the `OPTIONS` preflight for `POST` — modern Streamable HTTP is
  POST-only, since revision `2026-07-28` removed the `GET` stream and `DELETE`
  teardown.

(A legacy, handshake-era server needs one extra: it mints an `Mcp-Session-Id`
response header the browser only surfaces if it's listed in
`Access-Control-Expose-Headers`.)

Most public MCP servers assume a native client and send none of these — they
won't connect from a browser. Two ways around it:

1. **Run a server you control** with permissive CORS.
2. **Run a small CORS proxy** and point the demo at it. A proxy is a dependency-
   free Node relay: `browser → http://localhost:PORT → target server`
   (server-to-server, no CORS), injecting the CORS headers on the way back —
   allowing the `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` request headers
   (and, for a legacy server, exposing `Mcp-Session-Id`). There are two shapes:
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

- **Desktop Chrome** on Windows 10/11, macOS 13+, Linux, or ChromeOS (Platform
  16389.0.0+) on Chromebook Plus devices — no Android or iOS.
- ~22 GB free disk gates the download; Chrome removes the model if free space
  later drops below 10 GB. Either a GPU with more than 4 GB of VRAM, or a CPU-only
  machine with 16 GB of RAM and 4+ cores, plus a non-metered connection for the
  one-time download.
- Built-in AI enabled. On current stable Chrome the core Prompt API needs no
  flags — the model downloads on first `create()`. If the demo says the API is
  missing, work through
  [Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).

Connecting to the mock server and browsing its tools works in any browser with
`fetch`. Only the agent chat needs Gemini Nano; the first Ask on a fresh machine
triggers the model download and can take a while, with progress on the status
line. Everything after that runs on-device.
