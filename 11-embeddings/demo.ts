// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. SemanticEmbedder is a bare global (like
// LanguageModel), and the canonical @types/dom-chromium-ai package
// does not ship it yet — so the minimal ambient surface below keeps this file
// self-contained.

// --- Minimal ambient surface for Chrome's Semantic Embedder API (Chrome Canary, #semantic-embedder-api) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

// taskType is an option on embed(), NOT on create(). It is strictly an optional
// hint the browser can ignore if its model doesn't support it.
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

// create() accepts { signal, monitor }. The monitor's downloadprogress event
// carries e.loaded (0..1); e.total is always 1.
interface DownloadProgressEvent extends Event {
  readonly loaded: number;
  readonly total: number;
}

interface CreateMonitorEventMap {
  downloadprogress: DownloadProgressEvent;
}

interface CreateMonitor extends EventTarget {
  addEventListener<K extends keyof CreateMonitorEventMap>(
    type: K,
    listener: (this: CreateMonitor, ev: CreateMonitorEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
}

type CreateMonitorCallback = (monitor: CreateMonitor) => void;

interface CreateOptions {
  signal?: AbortSignal;
  monitor?: CreateMonitorCallback;
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
  create(options?: CreateOptions): Promise<SemanticEmbedderInstance>;
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
const indexBtn = document.getElementById('index') as HTMLButtonElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const outputEl = document.getElementById('output') as HTMLDivElement;

interface Ranked {
  text: string;
  score: number;
}

interface DocVector {
  text: string;
  values: Float32Array;
}

// One embedder, reused across searches. docVectors caches the indexed corpus so a
// search only has to embed the query — never re-embed every document.
let embedder: SemanticEmbedderInstance | null = null;
let docVectors: DocVector[] | null = null;
let busy = false;

function setStatus(html: string, kind?: 'ok' | 'warn' | 'err'): void {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.innerHTML = html;
}

function setBusy(on: boolean): void {
  busy = on;
  indexBtn.disabled = on;
  // Search stays disabled until there's an index to search.
  runBtn.disabled = on || !docVectors;
}

function degrade(reason: string): void {
  setStatus(
    reason +
      ' This is an experimental API (Intent to Prototype) — enable ' +
      '<code>#semantic-embedder-api</code> in Chrome Canary. Work through <a href="' +
      SETUP_URL +
      '">Setup &amp; availability</a>, or try the <a href="' +
      LIVE_DEMO_URL +
      '">hosted demo</a>.',
    'err',
  );
  indexBtn.disabled = true;
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

// One embedder for the whole page. create() accepts { signal, monitor }; the monitor's
// downloadprogress event carries e.loaded (0..1). Starting the DOWNLOAD needs a user
// gesture, so this only ever runs from a button click.
async function ensureEmbedder(): Promise<SemanticEmbedderInstance> {
  if (embedder) return embedder;
  embedder = await SemanticEmbedder.create({
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        prepEl.hidden = false;
        prepEl.value = e.loaded; // 0..1; e.total is always 1
        setStatus('Downloading the on-device model… ' + Math.round(e.loaded * 100) + '%', 'warn');
      });
    },
  });
  prepEl.hidden = true;
  return embedder;
}

function readDocs(): string[] {
  return docsEl.value
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function handleError(e: unknown): void {
  const name = errName(e);
  if (name === 'QuotaExceededError') {
    outputEl.textContent =
      'An input was too long for the model (QuotaExceededError). Shorten the longest line and retry.';
  } else if (name === 'NotSupportedError') {
    outputEl.textContent = 'That input or option is not supported in this build (NotSupportedError).';
  } else {
    outputEl.textContent = 'Error: ' + errMessage(e);
  }
  setStatus('Error: ' + name + '.', 'err');
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
    setStatus('Model ready. Index the documents, then search.', 'ok');
  } else {
    setStatus('Model needs a one-time download. It starts, with a progress bar, when you index.', 'warn');
  }
  indexBtn.disabled = false; // search unlocks after the first index
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

// INDEX STEP — embed the corpus once (retrieval-document) and cache the vectors.
async function indexDocuments(): Promise<void> {
  if (busy) return;
  const documents = readDocs();
  if (documents.length === 0) {
    setStatus('Add at least one document line.', 'warn');
    return;
  }

  setBusy(true);
  outputEl.textContent = '';
  try {
    await ensureEmbedder(); // create() (with monitor) — first click starts the download
    setStatus('Embedding ' + documents.length + ' documents (retrieval-document)…', 'warn');
    // Batch the corpus; results are positional, so embeddings[i] matches documents[i].
    const res = await embedder!.embed(documents, { taskType: DOC_TASK });
    docVectors = documents.map((text, i) => ({ text, values: res.embeddings[i].values }));
    setStatus('Indexed ' + documents.length + ' documents. Type a query and search.', 'ok');
  } catch (e) {
    docVectors = null;
    handleError(e);
  } finally {
    prepEl.hidden = true;
    setBusy(false);
  }
}

// SEARCH STEP — embed ONLY the query (retrieval-query), reuse the cached corpus + session.
async function search(): Promise<void> {
  if (busy) return;
  if (!docVectors) {
    setStatus('Index the documents first.', 'warn');
    return;
  }
  const query = queryEl.value.trim();
  if (!query) {
    setStatus('Type a query to rank against.', 'warn');
    return;
  }

  setBusy(true);
  outputEl.textContent = '';
  try {
    await ensureEmbedder(); // same session — no re-create, no re-embedding the corpus
    setStatus('Embedding the query (retrieval-query)…', 'warn');
    const res = await embedder!.embed(query, { taskType: QUERY_TASK });
    const queryVec = res.embeddings[0].values;

    const ranked: Ranked[] = docVectors
      .map((d) => ({ text: d.text, score: cosineSimilarity(queryVec, d.values) }))
      .sort((a, b) => b.score - a.score);

    render(ranked);
    setStatus('Ranked ' + docVectors.length + ' documents by cosine similarity.', 'ok');
  } catch (e) {
    handleError(e);
  } finally {
    prepEl.hidden = true;
    setBusy(false);
  }
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

indexBtn.addEventListener('click', () => void indexDocuments());
runBtn.addEventListener('click', () => void search());

// Editing the corpus invalidates the cached index — re-index before searching again.
docsEl.addEventListener('input', () => {
  if (!docVectors) return;
  docVectors = null;
  runBtn.disabled = true;
  setStatus('Documents changed — re-index before searching.', 'warn');
});

// Free the model on teardown so a closed tab doesn't strand a session.
window.addEventListener('beforeunload', () => {
  if (embedder) embedder.destroy();
});

void init();
