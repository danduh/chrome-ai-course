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
  outputLanguage?: string;
  initialPrompts?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

interface LanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
  readonly inputUsage: number;
  readonly inputQuota: number;
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
const LESSON_URL =
  'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_URL = 'https://windowai.danduh.me/status';

const statusEl = document.getElementById('status') as HTMLDivElement;
const paramsEl = document.getElementById('params') as HTMLDivElement;
const progressWrap = document.getElementById('progress-wrap') as HTMLDivElement;
const progressEl = document.getElementById('progress') as HTMLProgressElement;
const downloadBtn = document.getElementById('download') as HTMLButtonElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const recheckBtn = document.getElementById('recheck') as HTMLButtonElement;
const outputEl = document.getElementById('output') as HTMLDivElement;

let session: LanguageModelSession | null = null;
let busy = false;

function setStatus(html: string, kind?: 'ok' | 'warn' | 'err'): void {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.innerHTML = html;
}

// The unavailable / no-global path: never throw into a blank page.
function degrade(reason: string): void {
  setStatus(
    reason +
      ' Work through <a href="' +
      LESSON_URL +
      '">Setup &amp; the availability lifecycle</a>, or check your browser live at <a href="' +
      LIVE_URL +
      '">windowai.danduh.me/status</a>.',
    'err',
  );
  downloadBtn.hidden = true;
  runBtn.hidden = true;
  progressWrap.hidden = true;
}

// Show LanguageModel.params() when the runtime exposes it (feature-detected).
async function showParams(): Promise<void> {
  if (typeof LanguageModel === 'undefined') {
    paramsEl.textContent = '';
    return;
  }
  if (typeof LanguageModel.params !== 'function') {
    paramsEl.textContent = 'LanguageModel.params() is not exposed on this build.';
    return;
  }
  try {
    const p = await LanguageModel.params();
    if (p) {
      paramsEl.innerHTML =
        'params(): defaultTopK <code>' +
        p.defaultTopK +
        '</code>, maxTopK <code>' +
        p.maxTopK +
        '</code>, defaultTemperature <code>' +
        p.defaultTemperature +
        '</code>, maxTemperature <code>' +
        p.maxTemperature +
        '</code>';
    }
  } catch (e) {
    paramsEl.textContent = 'params() is present but threw: ' + errName(e) + '.';
  }
}

function guidance(state: Availability): string {
  if (state === 'available')
    return 'The model is on disk. Click "Run a test prompt".';
  if (state === 'downloadable')
    return 'Supported, but the model is not on disk yet. Click "Download the model" (~4 GB, one time).';
  if (state === 'downloading')
    return 'The model is already downloading. Click "Download the model" to attach and watch progress.';
  return '';
}

// Feature-detect + availability() gate, then map each of the four states to UI.
async function init(): Promise<void> {
  outputEl.textContent = '';
  downloadBtn.hidden = true;
  runBtn.hidden = true;

  if (typeof LanguageModel === 'undefined') {
    degrade(
      'This browser has no built-in <code>LanguageModel</code>. You need desktop Chrome over https or localhost.',
    );
    return;
  }

  await showParams();

  let state: Availability;
  try {
    state = await LanguageModel.availability({ outputLanguage: 'en' });
  } catch (e) {
    degrade('<code>availability()</code> threw: ' + errName(e) + '.');
    return;
  }

  setStatus(
    'availability() reports <span class="badge">' +
      state +
      '</span>. ' +
      guidance(state),
    state === 'available' ? 'ok' : state === 'unavailable' ? 'err' : 'warn',
  );

  if (state === 'unavailable') {
    degrade(
      'Gemini Nano is <span class="badge">unavailable</span> here — under the hardware bar, switched off in Settings &rarr; System, or this page is on http://.',
    );
    return;
  }

  if (state === 'available') {
    runBtn.hidden = false;
  } else {
    downloadBtn.hidden = false;
  }
}

// Create the session lazily, wiring the download monitor for the first run.
async function ensureSession(): Promise<LanguageModelSession> {
  if (session) return session;

  progressWrap.hidden = false;
  progressEl.value = 0;
  setStatus('Preparing Gemini Nano…', 'warn');

  session = await LanguageModel.create({
    outputLanguage: 'en', // always — this is load-bearing
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        // e.loaded is a 0..1 fraction — there is no e.total in current builds.
        progressEl.value = e.loaded;
        setStatus(
          'Downloading Gemini Nano… ' + Math.round(e.loaded * 100) + '%',
          'warn',
        );
      });
    },
  });

  progressWrap.hidden = true;
  return session;
}

async function download(): Promise<void> {
  if (busy) return;
  busy = true;
  downloadBtn.disabled = true;
  recheckBtn.disabled = true;
  try {
    await ensureSession();
    setStatus('Model ready. Click "Run a test prompt" to prove it works.', 'ok');
    downloadBtn.hidden = true;
    runBtn.hidden = false;
  } catch (e) {
    setStatus('Download failed: ' + errName(e) + '. ' + errMessage(e), 'err');
  } finally {
    busy = false;
    downloadBtn.disabled = false;
    recheckBtn.disabled = false;
  }
}

async function runTest(): Promise<void> {
  if (busy) return;
  busy = true;
  runBtn.disabled = true;
  recheckBtn.disabled = true;
  outputEl.textContent = '';
  setStatus('Running a one-word test prompt…', 'warn');

  try {
    const s = await ensureSession();
    const reply: string = await s.prompt('Reply with the single word: ready');
    outputEl.textContent = reply;
    setStatus('Round trip works. Gemini Nano answered on-device.', 'ok');
  } catch (e) {
    outputEl.textContent = 'Error: ' + errMessage(e);
    setStatus('Prompt failed: ' + errName(e) + '.', 'err');
  } finally {
    busy = false;
    runBtn.disabled = false;
    recheckBtn.disabled = false;
  }
}

// Re-check availability without tearing down a working session.
async function recheck(): Promise<void> {
  if (busy) return;
  setStatus('Re-checking availability…', 'warn');
  await init();
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

downloadBtn.addEventListener('click', () => void download());
runBtn.addEventListener('click', () => void runTest());
recheckBtn.addEventListener('click', () => void recheck());

// Free GPU memory on teardown.
window.addEventListener('beforeunload', () => {
  if (session) session.destroy();
});

void init();
