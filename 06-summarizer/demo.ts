// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The @types/dom-chromium-ai package ships fuller
// declarations; the minimal ambient surface below keeps this file self-contained.

// --- Minimal ambient surface for Chrome's built-in Summarizer API (stable since Chrome 138) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

// NOTE: the TL;DR value is 'tl;dr' — with the semicolon. Not 'tldr'.
type SummaryType = 'key-points' | 'tl;dr' | 'teaser' | 'headline';
type SummaryFormat = 'markdown' | 'plain-text';
type SummaryLength = 'short' | 'medium' | 'long';

interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: ProgressEvent) => void,
  ): void;
}

interface SummarizerCreateOptions {
  type?: SummaryType;
  format?: SummaryFormat;
  length?: SummaryLength;
  sharedContext?: string;
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

// Per-call options: a `context` refines a single input without a new instance.
interface SummarizeOptions {
  context?: string;
  signal?: AbortSignal;
}

interface SummarizerInstance {
  summarize(input: string, options?: SummarizeOptions): Promise<string>;
  summarizeStreaming(
    input: string,
    options?: SummarizeOptions,
  ): ReadableStream<string>;
  destroy(): void;
}

declare const Summarizer: {
  availability(options?: SummarizerCreateOptions): Promise<Availability>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerInstance>;
};

// --- Demo logic (typed mirror of the inline script in index.html) ---
const LESSON_URL = 'https://danduh.me/courses/chrome-built-in-ai/summarizer';
const SETUP_URL =
  'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/summary/summary-demo';

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const sourceEl = document.getElementById('source') as HTMLTextAreaElement;
const typeEl = document.getElementById('type') as HTMLSelectElement;
const formatEl = document.getElementById('format') as HTMLSelectElement;
const lengthEl = document.getElementById('length') as HTMLSelectElement;
const sharedEl = document.getElementById('shared') as HTMLInputElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const outputEl = document.getElementById('output') as HTMLDivElement;

let summarizer: SummarizerInstance | null = null;
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
  runBtn.disabled = true;
}

// Feature-detect + availability() gate before anything else.
async function init(): Promise<void> {
  if (typeof Summarizer === 'undefined') {
    degrade(
      'This browser has no built-in <code>Summarizer</code>. You need desktop Chrome with built-in AI.',
    );
    return;
  }

  let status: Availability;
  try {
    status = await Summarizer.availability();
  } catch (e) {
    degrade('<code>availability()</code> threw: ' + errMessage(e) + '.');
    return;
  }

  if (status === 'unavailable') {
    degrade('Built-in AI reports <code>unavailable</code> on this device.');
    return;
  }

  if (status === 'available') {
    setStatus('Model ready. Pick a type and hit Summarize.', 'ok');
  } else {
    setStatus(
      'Model needs a one-time download (a few GB). It starts on your first summary.',
      'warn',
    );
  }
  runBtn.disabled = false;
}

// Build a fresh summarizer for the current options, wiring a download monitor.
async function createSummarizer(): Promise<SummarizerInstance> {
  const options: SummarizerCreateOptions = {
    type: typeEl.value as SummaryType, // 'key-points' | 'tl;dr' | 'teaser' | 'headline'
    format: formatEl.value as SummaryFormat, // 'markdown' | 'plain-text'
    length: lengthEl.value as SummaryLength, // 'short' | 'medium' | 'long'
  };
  const shared = sharedEl.value.trim();
  if (shared) options.sharedContext = shared;

  dlEl.hidden = false;
  dlEl.value = 0;
  setStatus('Preparing the model…', 'warn');

  const created = await Summarizer.create({
    ...options,
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
  return created;
}

async function run(): Promise<void> {
  const text = sourceEl.value.trim();
  if (!text || busy) return;

  busy = true;
  runBtn.disabled = true;
  outputEl.textContent = '';

  try {
    // Options may have changed since the last run — recreate, don't leak.
    if (summarizer) {
      summarizer.destroy();
      summarizer = null;
    }
    summarizer = await createSummarizer();

    setStatus('Summarizing…', 'warn');
    const stream = summarizer.summarizeStreaming(text);
    for await (const chunk of stream) {
      outputEl.textContent += chunk; // deltas — append, never replace
    }
    setStatus('Done. Change the type or length and run it again.', 'ok');
  } catch (e) {
    const name = errName(e);
    if (name === 'QuotaExceededError') {
      outputEl.textContent =
        'Input is over the quota (QuotaExceededError). Trim the text, or split it into ' +
        'sections and summarize each, then summarize the summaries.';
    } else if (name === 'NotSupportedError') {
      outputEl.textContent =
        'That type/format/length combo is not supported here (NotSupportedError). Try another.';
    } else if (name === 'InvalidStateError') {
      outputEl.textContent = 'That summarizer was destroyed. Run again to recreate it.';
      summarizer = null;
    } else {
      outputEl.textContent = 'Error: ' + errMessage(e);
    }
    setStatus('Error: ' + name + '.', 'err');
  } finally {
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

// Free GPU memory on teardown.
window.addEventListener('beforeunload', () => {
  if (summarizer) summarizer.destroy();
});

void init();
