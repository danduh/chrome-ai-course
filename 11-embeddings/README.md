# 11 — Embeddings (SemanticEmbedder)

An on-device semantic search built on Chrome's built-in `SemanticEmbedder`
(`embeddinggemma-300m`). Edit a short list of documents, type a query, and the
documents re-rank by cosine similarity — computed in plain JavaScript, with
nothing sent over the network. No frameworks, no build step, no dependencies —
inline in `index.html`.

Lesson: **[Embeddings (SemanticEmbedder)](https://danduh.me/courses/chrome-built-in-ai/embeddings)**
Hosted demo: **[windowai.danduh.me/embeddings/embeddings-cross-lingual](https://windowai.danduh.me/embeddings/embeddings-cross-lingual)**
(with the [API walkthrough](https://windowai.danduh.me/embeddings/embeddings-api-documentation)).

> **Early Preview API.** `SemanticEmbedder` is not on stable Chrome. It ships in
> the Early Preview Program on **Chrome Canary 152+**, behind the
> `chrome://flags/#semantic-embedder-api` flag. On any other browser the demo
> reports `unavailable` and points you here — it never breaks into a blank page.

## What it shows

- Feature-detecting `SemanticEmbedder` and gating on `availability()` before `create()`.
- Polling `availability()` until `available` instead of wiring a download monitor — `SemanticEmbedder` has no `downloadprogress` event yet, so an indeterminate "preparing…" bar stands in.
- Creating a session with `create()` (which takes **no arguments**) and reusing one embedder for the whole run.
- Embedding the corpus as a batch with `taskType: 'retrieval-document'` and the query with `taskType: 'retrieval-query'` — `taskType` is an option on `embed()`, not on `create()`.
- Reading back `{ embeddings: [{ values: Float32Array }] }` in positional order (768 dims).
- Ranking documents by a plain-JS `cosineSimilarity()` and rendering them best-match-first.
- Calling `destroy()` in a `finally` (and again on `beforeunload`) so the model is always released.
- Graceful degradation when the API is missing or `unavailable`, plus handling for `QuotaExceededError` and `NotSupportedError`.

## Files

- `index.html` — the runnable demo (open it and it runs).
- `demo.ts` — a TypeScript reference mirror of the same logic. Reference only; not built or loaded by the page. Type-check it with `tsc --noEmit --strict --lib dom,es2020 --target es2020 demo.ts`.

## Running it

Open `index.html` in **desktop Chrome Canary (152+)** with the flags below set.

If the page reports the API is unavailable, serve the folder over `localhost`
(the APIs need a [secure context](https://developer.mozilla.org/docs/Web/Security/Secure_Contexts)):

```bash
npx serve .
# or: python3 -m http.server
```

Then open the printed `http://localhost:…` URL in Chrome Canary.

## Requirements

- **Desktop Chrome Canary 152+** (Windows, macOS, or Linux). Not on stable Chrome, and not on Android, iOS, or ChromeOS.
- Two flags, then relaunch:
  - `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement**
  - `chrome://flags/#semantic-embedder-api` → **Enabled**
- The `embeddinggemma-300m` model (~200 MB) downloads on first use. There is no
  progress event yet, so the first search shows an indeterminate "preparing…"
  state while the model provisions; check `chrome://on-device-internals` if it
  stalls. Later searches are instant.
- Roughly 22 GB free on the volume holding your Chrome profile, and a
  non-metered connection for the one-time download.

If the demo says the API is missing or `unavailable`, work through
[Setup & the availability lifecycle](https://danduh.me/courses/chrome-built-in-ai/setup-and-availability).
Most browsers will land there, and that's expected for an Early Preview API.
