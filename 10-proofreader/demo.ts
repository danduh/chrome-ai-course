// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The @types/dom-chromium-ai package ships fuller
// declarations; the minimal ambient surface below keeps this file self-contained.

// --- Minimal ambient surface for Chrome's Proofreader API (flag-gated as of Chrome 150) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

// The five adapter languages the Proofreader ships today.
type ProofreaderLanguageCode = 'en' | 'es' | 'ja' | 'de' | 'fr';

// NOTE: the correction category field is `types` — plural, an array. Not `type`.
type ProofreaderCorrectionType =
  | 'spelling'
  | 'punctuation'
  | 'capitalization'
  | 'preposition'
  | 'missing-words'
  | 'grammar';

interface ProofreaderCorrection {
  startIndex: number;
  endIndex: number;
  correction: string;
  types?: ProofreaderCorrectionType[]; // filled when includeCorrectionTypes is true
  explanation?: string; // filled when includeCorrectionExplanations is true
}

interface ProofreadResult {
  correctedInput: string;
  corrections: ProofreaderCorrection[];
}

interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: ProgressEvent) => void,
  ): void;
}

interface ProofreaderCreateOptions {
  expectedInputLanguages?: string[];
  includeCorrectionTypes?: boolean;
  includeCorrectionExplanations?: boolean;
  correctionExplanationLanguage?: string;
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

interface ProofreaderProofreadOptions {
  signal?: AbortSignal;
}

interface ProofreaderInstance {
  proofread(
    input: string,
    options?: ProofreaderProofreadOptions,
  ): Promise<ProofreadResult>;
  destroy(): void;
}

declare const Proofreader: {
  availability(options?: {
    expectedInputLanguages?: string[];
  }): Promise<Availability>;
  create(options?: ProofreaderCreateOptions): Promise<ProofreaderInstance>;
};

// A segment of the walked diff: unchanged text, the removed original, or the inserted fix.
interface DiffSegment {
  kind: 'unchanged' | 'removed' | 'inserted';
  text: string;
}

// --- Demo logic (typed mirror of the inline script in index.html) ---
const LESSON_URL = 'https://danduh.me/courses/chrome-built-in-ai/proofreader';
const SETUP_URL =
  'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/proofreader';
const FLAG = '#proofreader-api';

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const sourceEl = document.getElementById('source') as HTMLTextAreaElement;
const langEl = document.getElementById('lang') as HTMLSelectElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const correctedEl = document.getElementById('corrected') as HTMLDivElement;
const diffEl = document.getElementById('diff') as HTMLDivElement;
const listEl = document.getElementById('list') as HTMLUListElement;

// One session, cached by the language it was created for.
let proofreader: ProofreaderInstance | null = null;
let proofreaderLang: ProofreaderLanguageCode | null = null;
let busy = false;

function setStatus(html: string, kind?: 'ok' | 'warn' | 'err'): void {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.innerHTML = html;
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

function escapeHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clearOutput(): void {
  correctedEl.textContent = '';
  diffEl.innerHTML = '';
  listEl.innerHTML = '';
}

function degrade(reason: string): void {
  setStatus(
    reason +
      ' Enable <code>' +
      FLAG +
      '</code> in <code>chrome://flags</code> (see <a href="' +
      SETUP_URL +
      '">Setup &amp; availability</a>), or try the <a href="' +
      LIVE_DEMO_URL +
      '">hosted demo</a>.',
    'err',
  );
  runBtn.disabled = true;
}

// Feature-detect + availability() gate before anything else.
async function init(): Promise<void> {
  if (typeof Proofreader === 'undefined') {
    degrade('This browser has no built-in <code>Proofreader</code>.');
    return;
  }

  let status: Availability;
  try {
    status = await Proofreader.availability({
      expectedInputLanguages: [langEl.value],
    });
  } catch (e) {
    degrade('<code>availability()</code> threw: ' + errMessage(e) + '.');
    return;
  }

  if (status === 'unavailable') {
    degrade(
      '<code>Proofreader</code> reports <code>unavailable</code> — usually the flag is off.',
    );
    return;
  }

  if (status === 'available') {
    setStatus('Model ready. Edit the text and hit Proofread.', 'ok');
  } else {
    setStatus(
      'Model needs a one-time adapter download (a few GB). It starts on your first proofread.',
      'warn',
    );
  }
  runBtn.disabled = false;
}

// Reuse a cached session for the current language, or create a fresh one
// with a download monitor. One session per language — don't leak.
async function ensureSession(): Promise<ProofreaderInstance> {
  const lang = langEl.value as ProofreaderLanguageCode;
  if (proofreader && proofreaderLang === lang) return proofreader;
  if (proofreader) {
    proofreader.destroy();
    proofreader = null;
    proofreaderLang = null;
  }

  dlEl.hidden = false;
  dlEl.value = 0;
  setStatus('Preparing the model…', 'warn');

  const created = await Proofreader.create({
    expectedInputLanguages: [lang], // 'en' | 'es' | 'ja' | 'de' | 'fr'
    includeCorrectionTypes: true, // fill each correction's `types` array
    includeCorrectionExplanations: true, // add a human-readable `explanation`
    correctionExplanationLanguage: 'en', // explanation language, independent of the input
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // 0..1 fraction, no e.total in current builds
        setStatus(
          'Downloading adapter… ' + Math.round(e.loaded * 100) + '%',
          'warn',
        );
      });
    },
  });

  dlEl.hidden = true;
  proofreader = created;
  proofreaderLang = lang;
  return created;
}

// Walk the input once: unchanged spans, removed (original slice), inserted (correction).
// Mirrors the shipped diffSegments walk — sort by startIndex, then interleave.
function buildSegments(
  input: string,
  corrections: ProofreaderCorrection[],
): DiffSegment[] {
  if (corrections.length === 0) return [{ kind: 'unchanged', text: input }];
  const sorted = [...corrections].sort((a, b) => a.startIndex - b.startIndex);
  const segments: DiffSegment[] = [];
  let cursor = 0;
  for (const c of sorted) {
    if (cursor < c.startIndex) {
      segments.push({ kind: 'unchanged', text: input.slice(cursor, c.startIndex) });
    }
    segments.push({ kind: 'removed', text: input.slice(c.startIndex, c.endIndex) });
    segments.push({ kind: 'inserted', text: c.correction });
    cursor = c.endIndex;
  }
  if (cursor < input.length) {
    segments.push({ kind: 'unchanged', text: input.slice(cursor) });
  }
  return segments;
}

// Render the diff as struck-through original + highlighted correction, inline.
function renderDiff(
  input: string,
  corrections: ProofreaderCorrection[],
): void {
  const segs = buildSegments(input, corrections);
  diffEl.innerHTML = segs
    .map((s) => {
      const t = escapeHtml(s.text);
      if (s.kind === 'unchanged') return '<span>' + t + '</span>';
      if (s.kind === 'removed') return s.text ? '<del>' + t + '</del>' : '';
      return s.text ? '<ins>' + t + '</ins>' : '';
    })
    .join('');
}

// Render each correction: original slice (by index), the suggestion, its types, and explanation.
function renderList(
  input: string,
  corrections: ProofreaderCorrection[],
): void {
  if (corrections.length === 0) {
    listEl.innerHTML = '<li>No corrections — the text is clean.</li>';
    return;
  }
  listEl.innerHTML = corrections
    .map((c) => {
      const original = escapeHtml(input.slice(c.startIndex, c.endIndex));
      const correction = escapeHtml(c.correction);
      const types =
        c.types && c.types.length
          ? ' ' +
            c.types.map((t) => '<code>' + escapeHtml(t) + '</code>').join(' ')
          : '';
      const explanation = c.explanation ? ' — ' + escapeHtml(c.explanation) : '';
      return (
        '<li>changed &ldquo;<del>' +
        original +
        '</del>&rdquo; &rarr; &ldquo;<ins>' +
        correction +
        '</ins>&rdquo;' +
        types +
        explanation +
        '</li>'
      );
    })
    .join('');
}

async function run(): Promise<void> {
  const input = sourceEl.value;
  if (!input.trim() || busy) return;

  busy = true;
  runBtn.disabled = true;
  clearOutput();

  try {
    const pr = await ensureSession();

    setStatus('Proofreading…', 'warn');
    // Indices come back as offsets into `input` — slice originals from it, not correctedInput.
    const result = await pr.proofread(input);

    correctedEl.textContent = result.correctedInput;
    renderDiff(input, result.corrections);
    renderList(input, result.corrections);

    const n = result.corrections.length;
    setStatus(
      n
        ? 'Done — ' +
            n +
            ' correction' +
            (n === 1 ? '' : 's') +
            '. Edit the text and run it again.'
        : 'Done — no corrections found.',
      'ok',
    );
  } catch (e) {
    const name = errName(e);
    if (name === 'QuotaExceededError') {
      correctedEl.textContent =
        'Input is over the model quota (QuotaExceededError). Trim the text and try again.';
    } else if (name === 'NotSupportedError') {
      correctedEl.textContent =
        'That language is not supported (NotSupportedError). Pick en, es, ja, de, or fr.';
    } else if (name === 'InvalidStateError') {
      correctedEl.textContent = 'That session was destroyed. Run again to recreate it.';
      proofreader = null;
      proofreaderLang = null;
    } else if (name === 'AbortError') {
      correctedEl.textContent = 'Proofreading was aborted.';
    } else {
      correctedEl.textContent = 'Error: ' + errMessage(e);
    }
    setStatus('Error: ' + name + '.', 'err');
  } finally {
    busy = false;
    runBtn.disabled = false;
  }
}

runBtn.addEventListener('click', () => void run());

// Switching language invalidates the cached session — drop it and re-check.
langEl.addEventListener('change', () => {
  if (proofreader) {
    proofreader.destroy();
    proofreader = null;
    proofreaderLang = null;
  }
  clearOutput();
  runBtn.disabled = true;
  void init();
});

// Free GPU memory on teardown.
window.addEventListener('beforeunload', () => {
  if (proofreader) proofreader.destroy();
});

void init();
