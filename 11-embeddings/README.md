# 11 — Embeddings (SemanticEmbedder)

An on-device semantic search built on Chrome's built-in `SemanticEmbedder`
(`embeddinggemma-300m`). Edit a short list of documents, type a query, and the
documents re-rank by cosine similarity — computed in plain JavaScript, with
nothing sent over the network. No frameworks, no build step, no dependencies —
inline in `index.html`.

Lesson: **[Embeddings (SemanticEmbedder)](https://danduh.me/courses/chrome-built-in-ai/embeddings)**
Hosted demo: **[windowai.danduh.me/embeddings/embeddings-cross-lingual](https://windowai.danduh.me/embeddings/embeddings-cross-lingual)**
(with the [API walkthrough](https://windowai.danduh.me/embeddings/embeddings-api-documentation)).

> **Experimental API (Intent to Prototype).** `SemanticEmbedder` is not on stable
> Chrome — it's a Developer Trial, **Chrome Canary only**, behind the
> `chrome://flags/#semantic-embedder-api` flag, not yet approved to ship. On any
> other browser the demo reports `unavailable` and points you here — it never
> breaks into a blank page.

## What it shows

- Feature-detecting `SemanticEmbedder` and gating on `availability()` before `create()`.
- Creating the session with `create({ monitor })` and rendering the `downloadprogress` fraction (`e.loaded` is `0..1`) as a real progress bar — starting the download needs a user gesture, so it runs from a click.
- Holding **one** embedder for the whole page and reusing it across searches.
- An **index** step that embeds the corpus once (`taskType: 'retrieval-document'`) and caches the vectors, and a **search** step that embeds only the query (`taskType: 'retrieval-query'`) — `taskType` is an option on `embed()`, not on `create()`, and only a hint the model may ignore.
- Reading back `{ embeddings: [{ values: Float32Array }] }` in positional order (768 dims).
- Ranking documents by a plain-JS `cosineSimilarity()` and rendering them best-match-first.
- Calling `destroy()` on `beforeunload` so the model is released on teardown.
- Graceful degradation when the API is missing or `unavailable`, plus handling for `QuotaExceededError` and `NotSupportedError`.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic. Reference only; not built or loaded by the page. Type-check it with `tsc --noEmit --strict --lib dom,es2020 --target es2020 demo.ts`.

## Running it

Open `index.html` in **desktop Chrome Canary** with the flags below set.

If the page reports the API is unavailable, serve the folder over `localhost`
(the APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in Chrome Canary.

## Requirements

- **Desktop Chrome Canary** on Windows 10/11, macOS 13+, Linux, or ChromeOS
  (Platform 16389.0.0+) on Chromebook Plus devices — not stable Chrome, and not
  Android or iOS.
- Two flags, then relaunch:
  - `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
  - `chrome://flags/#semantic-embedder-api` → **Enabled**
- The `embeddinggemma-300m` model (a couple hundred megabytes) downloads on first
  index. `create({ monitor })` reports `downloadprogress`, so you get a real
  progress bar; check `chrome://on-device-internals` if it stalls. Later runs are
  instant.
- Enough free disk for the one-time model download (a couple hundred megabytes —
  far less than Gemini Nano's multi-gigabyte gate), and a non-metered connection.

If the demo says the API is missing or `unavailable`, work through
[Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).
Most browsers will land there, and that's expected for an experimental,
Canary-only API.
