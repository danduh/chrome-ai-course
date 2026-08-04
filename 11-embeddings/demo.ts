// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. SemanticEmbedder is a bare global (like
// LanguageModel), and the canonical @types/dom-chromium-ai package
// does not ship it yet — so the minimal ambient surface below keeps this file
// self-contained.

// --- Minimal ambient surface for Chrome's Semantic Embedder API (Chrome 152 Canary, EPP flag) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

// taskType is an option on embed(), NOT on create(). create() takes no arguments.
type TaskType =
  | 'semantic-similarity'
  | 'retrieval-query'
  | 'retrieval-document'
  | 'classification'
  | 'clustering';

interface EmbedOptions {
  taskType?: TaskType;
  signal?: AbortSignal;
}

// Each embedding is { values: Float32Array }; batch results are positional.
interface SemanticEmbedding {
  values: Float32Array;
}

interface EmbedResult {
  embeddings: SemanticEmbedding[];
}

interface SemanticEmbedderInstance {
  embed(input: string | string[], options?: EmbedOptions): Promise<EmbedResult>;
  destroy(): void;
}

interface SemanticEmbedderConstructor {
  availability(): Promise<Availability>;
  create(): Promise<SemanticEmbedderInstance>; // NO arguments
}

declare const SemanticEmbedder: SemanticEmbedderConstructor;

// --- Demo logic (typed mirror of the inline script in index.html) ---
const LESSON_URL = 'https://danduh.me/courses/chrome-built-in-ai/embeddings';
const SETUP_URL = 'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/embeddings';

const DOC_TASK: TaskType = 'retrieval-document';
const QUERY_TASK: TaskType = 'retrieval-query';

const statusEl = document.getElementById('status') as HTMLDivElement;
const prepEl = document.getElementById('prep') as HTMLProgressElement;
const docsEl = document.getElementById('docs') as HTMLTextAreaElement;
const queryEl = document.getElementById('query') as HTMLInputElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const outputEl = document.getElementById('output') as HTMLDivElement;

interface Ranked {
  text: string;
  score: number;
}

let embedder: SemanticEmbedderInstance | null = null;
let busy = false;

function setStatus(html: string, kind?: 'ok' | 'warn' | 'err'): void {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.innerHTML = html;
}

function degrade(reason: string): void {
  setStatus(
    reason +
      ' This is an Early Preview API — enable <code>#semantic-embedder-api</code> in ' +
      'Chrome 152+ Canary. Work through <a href="' +
      SETUP_URL +
      '">Setup &amp; availability</a>, or try the <a href="' +
      LIVE_DEMO_URL +
      '">hosted demo</a>.',
    'err',
  );
  runBtn.disabled = true;
}

// Escape every interpolated dynamic value before it lands in innerHTML —
// the ranked rows carry the user's own document lines (untrusted text).
function esc(s: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return s.replace(/[&<>"']/g, (c) => map[c] ?? c);
}

// Cosine similarity: dot(a, b) / (‖a‖ · ‖b‖). Returns a value in [-1, 1].
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('length mismatch');
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// No downloadprogress event exists for SemanticEmbedder yet, and create() throws if
// the model isn't ready — so poll availability() until 'available', then create().
async function waitUntilAvailable(): Promise<void> {
  const timeoutMs = 5 * 60 * 1000;
  const start = Date.now();
  let state: Availability = await SemanticEmbedder.availability();
  while (state !== 'available') {
    if (state === 'unavailable') {
      throw new Error('SemanticEmbedder is not available on this device.');
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('The embedding model is still preparing — try again shortly.');
    }
    prepEl.hidden = false; // indeterminate bar (no percentage available)
    setStatus('Preparing the on-device model (first-run download can take a minute)…', 'warn');
    await new Promise((r) => setTimeout(r, 1500));
    state = await SemanticEmbedder.availability();
  }
  prepEl.hidden = true;
}

// Feature-detect + availability() gate before anything else.
async function init(): Promise<void> {
  if (typeof SemanticEmbedder === 'undefined') {
    degrade('This browser has no built-in <code>SemanticEmbedder</code>.');
    return;
  }

  let status: Availability;
  try {
    status = await SemanticEmbedder.availability();
  } catch (e) {
    degrade('<code>availability()</code> threw: ' + errMessage(e) + '.');
    return;
  }

  if (status === 'unavailable') {
    degrade('Built-in embeddings report <code>unavailable</code> on this browser.');
    return;
  }

  if (status === 'available') {
    setStatus('Model ready. Edit the documents or query and hit Embed &amp; search.', 'ok');
  } else {
    setStatus('Model needs a one-time download (~200 MB). It starts on your first search.', 'warn');
  }
  runBtn.disabled = false;
}

function render(ranked: Ranked[]): void {
  if (ranked.length === 0) {
    outputEl.textContent = 'No documents to rank. Add a line or two above.';
    return;
  }
  outputEl.innerHTML = ranked
    .map(
      (row, i) =>
        '<div class="row' +
        (i === 0 ? ' top' : '') +
        '">' +
        '<span class="rank">' +
        (i + 1) +
        '</span>' +
        '<span class="score">' +
        row.score.toFixed(3) +
        '</span>' +
        '<span class="doc">' +
        esc(row.text) +
        '</span>' +
        '</div>',
    )
    .join('');
}

async function run(): Promise<void> {
  const documents = docsEl.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const query = queryEl.value.trim();
  if (busy) return;
  if (documents.length === 0) {
    setStatus('Add at least one document line.', 'warn');
    return;
  }
  if (!query) {
    setStatus('Type a query to rank against.', 'warn');
    return;
  }

  busy = true;
  runBtn.disabled = true;
  outputEl.textContent = '';

  try {
    // Poll until the model is ready, THEN create() (no arguments) — see waitUntilAvailable.
    await waitUntilAvailable();
    // One embedder for the whole run; destroyed in finally.
    embedder = await SemanticEmbedder.create();

    setStatus('Embedding ' + documents.length + ' documents and the query…', 'warn');

    // Batch the corpus (retrieval-document); results are positional.
    const docRes = await embedder.embed(documents, { taskType: DOC_TASK });
    // The user's query (retrieval-query) — the asymmetric pair beats matching sides.
    const queryRes = await embedder.embed(query, { taskType: QUERY_TASK });
    const queryVec = queryRes.embeddings[0].values;

    const ranked: Ranked[] = documents
      .map((text, i) => ({
        text,
        score: cosineSimilarity(queryVec, docRes.embeddings[i].values),
      }))
      .sort((a, b) => b.score - a.score);

    render(ranked);
    setStatus(
      'Ranked ' + documents.length + ' documents by cosine similarity. Edit and run again.',
      'ok',
    );
  } catch (e) {
    const name = errName(e);
    if (name === 'QuotaExceededError') {
      outputEl.textContent =
        'An input is over the model quota (QuotaExceededError). Shorten the longest line and retry.';
    } else if (name === 'NotSupportedError') {
      outputEl.textContent = 'That input or option is not supported in this build (NotSupportedError).';
    } else {
      outputEl.textContent = 'Error: ' + errMessage(e);
    }
    setStatus('Error: ' + name + '.', 'err');
  } finally {
    // Free the model even if embed() threw. create() per run keeps the lifecycle obvious;
    // in production you can hold ONE embedder and reuse it across searches instead.
    if (embedder) {
      embedder.destroy();
      embedder = null;
    }
    prepEl.hidden = true;
    busy = false;
    runBtn.disabled = false;
  }
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

runBtn.addEventListener('click', () => void run());

// Free the model on teardown so a closed tab doesn't strand a session.
window.addEventListener('beforeunload', () => {
  if (embedder) embedder.destroy();
});

void init();
