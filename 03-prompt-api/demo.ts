// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The @types/dom-chromium-ai package ships fuller
// declarations; the minimal ambient surface below keeps this file self-contained.

// --- Minimal ambient surface for Chrome's built-in Prompt API (current stable) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface LanguageModelParams {
  readonly defaultTopK: number;
  readonly maxTopK: number;
  readonly defaultTemperature: number;
  readonly maxTemperature: number;
}

interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: ProgressEvent) => void,
  ): void;
}

interface LanguageModelCreateOptions {
  expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
  expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
  temperature?: number;
  topK?: number;
  initialPrompts?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

interface LanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  promptStreaming(
    input: string,
    options?: { signal?: AbortSignal },
  ): ReadableStream<string>;
  clone(options?: { signal?: AbortSignal }): Promise<LanguageModelSession>;
  destroy(): void;
  readonly contextUsage?: number;
  readonly contextWindow?: number;
  readonly temperature: number;
  readonly topK: number;
}

declare const LanguageModel: {
  availability(
    options?: Partial<LanguageModelCreateOptions>,
  ): Promise<Availability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
  // Runtime-absent on some builds — feature-detect before calling.
  params?: () => Promise<LanguageModelParams>;
};

// --- Demo logic (typed mirror of the inline script in index.html) ---
const LESSON_URL = 'https://danduh.me/courses/chrome-built-in-ai/prompt-api';
const SETUP_URL =
  'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/chat/chat-demo';
const DEFAULT_SYSTEM = 'You are a concise, friendly assistant.';

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const systemEl = document.getElementById('system') as HTMLInputElement;
const tempEl = document.getElementById('temp') as HTMLInputElement;
const topkEl = document.getElementById('topk') as HTMLInputElement;
const promptEl = document.getElementById('prompt') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const resetBtn = document.getElementById('reset') as HTMLButtonElement;
const tokensEl = document.getElementById('tokens') as HTMLDivElement;
const outputEl = document.getElementById('output') as HTMLDivElement;

let session: LanguageModelSession | null = null;
let busy = false;

function setStatus(html: string, kind?: 'ok' | 'warn' | 'err'): void {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.innerHTML = html;
}

function degrade(reason: string): void {
  setStatus(
    reason +
      ' Work through <a href="' +
      SETUP_URL +
      '">Setup &amp; availability</a>, or try the <a href="' +
      LIVE_DEMO_URL +
      '">hosted demo</a>.',
    'err',
  );
  sendBtn.disabled = true;
  resetBtn.disabled = true;
}

function updateTokens(): void {
  if (session) {
    tokensEl.textContent =
      (session.contextUsage ?? 0) + ' / ' +
      (session.contextWindow ?? 0) + ' input tokens';
  }
}

// Feature-detect + availability() gate before anything else.
async function init(): Promise<void> {
  if (typeof LanguageModel === 'undefined') {
    degrade(
      'This browser has no built-in <code>LanguageModel</code>. You need desktop Chrome with built-in AI.',
    );
    return;
  }

  let status: Availability;
  try {
    status = await LanguageModel.availability();
  } catch (e) {
    degrade('<code>availability()</code> threw: ' + errName(e) + '.');
    return;
  }

  if (status === 'unavailable') {
    degrade('Built-in AI reports <code>unavailable</code> on this device.');
    return;
  }

  // Seed temperature/topK from params() when the runtime exposes it.
  if (typeof LanguageModel.params === 'function') {
    try {
      const params = await LanguageModel.params();
      if (params) {
        tempEl.value = String(params.defaultTemperature);
        tempEl.max = String(params.maxTemperature);
        topkEl.value = String(params.defaultTopK);
        topkEl.max = String(params.maxTopK);
      }
    } catch {
      // params() present but threw — keep the input defaults.
    }
  }

  if (status === 'available') {
    setStatus('Model ready. Type a prompt and hit Send.', 'ok');
  } else {
    setStatus(
      'Model needs a one-time download (a few GB). It starts on your first prompt.',
      'warn',
    );
  }
  sendBtn.disabled = false;
  resetBtn.disabled = false;
}

// Create the session lazily, wiring a download monitor for the first run.
async function ensureSession(): Promise<LanguageModelSession> {
  if (session) return session;

  const systemText = systemEl.value.trim() || DEFAULT_SYSTEM;
  const temperature = Number(tempEl.value);
  const topK = Number(topkEl.value);

  dlEl.hidden = false;
  dlEl.value = 0;
  setStatus('Preparing the model…', 'warn');

  session = await LanguageModel.create({
    expectedInputs:  [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    temperature: Number.isFinite(temperature) ? temperature : undefined,
    topK: Number.isFinite(topK) ? topK : undefined,
    initialPrompts: [{ role: 'system', content: systemText }],
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // 0..1 fraction, no e.total in current builds
        setStatus(
          'Downloading model… ' + Math.round(e.loaded * 100) + '%',
          'warn',
        );
      });
    },
  });

  dlEl.hidden = true;
  setStatus('Model ready.', 'ok');
  return session;
}

async function send(): Promise<void> {
  const text = promptEl.value.trim();
  if (!text || busy) return;

  busy = true;
  sendBtn.disabled = true;
  resetBtn.disabled = true;
  outputEl.textContent = '';

  try {
    const s = await ensureSession();
    const stream = s.promptStreaming(text);
    for await (const chunk of stream) {
      outputEl.textContent += chunk; // deltas — append, never replace
    }
    updateTokens();
    setStatus('Done. Ask a follow-up, or Reset to start over.', 'ok');
  } catch (e) {
    const name = errName(e);
    if (name === 'QuotaExceededError') {
      outputEl.textContent =
        'Context window is full (QuotaExceededError). Reset the session, then try a shorter prompt.';
    } else if (name === 'InvalidStateError') {
      outputEl.textContent = 'That session was destroyed. Resetting…';
      session = null;
    } else {
      outputEl.textContent = 'Error: ' + errMessage(e);
    }
    setStatus('Error: ' + name + '.', 'err');
  } finally {
    busy = false;
    sendBtn.disabled = false;
    resetBtn.disabled = false;
  }
}

// Reset = destroy + recreate with the current system prompt / temperature / topK.
async function reset(): Promise<void> {
  if (busy) return;
  if (session) {
    session.destroy();
    session = null;
  }
  outputEl.textContent = '';
  tokensEl.textContent = '';
  try {
    await ensureSession();
    updateTokens();
    setStatus('Session reset with the current settings. History cleared.', 'ok');
  } catch (e) {
    setStatus('Could not recreate the session: ' + errName(e) + '.', 'err');
  }
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

sendBtn.addEventListener('click', () => void send());
resetBtn.addEventListener('click', () => void reset());
promptEl.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void send();
});

// Free GPU memory on teardown.
window.addEventListener('beforeunload', () => {
  if (session) session.destroy();
});

void init();
