// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The @types/dom-chromium-ai package ships fuller
// declarations; the minimal ambient surface below keeps this file self-contained.

// --- Minimal ambient surface for Chrome's Translator + LanguageDetector (current stable) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface CreateMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: ProgressEvent) => void,
  ): void;
}

interface LanguageDetectionResult {
  detectedLanguage: string; // BCP-47 code, or 'und' for unknown
  confidence: number; // 0..1
}

interface LanguageDetectorCreateOptions {
  expectedInputLanguages?: string[];
  signal?: AbortSignal;
  monitor?: (m: CreateMonitor) => void;
}

interface LanguageDetectorInstance {
  detect(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<LanguageDetectionResult[]>;
  destroy(): void;
}

declare const LanguageDetector: {
  availability(options?: {
    expectedInputLanguages?: string[];
  }): Promise<Availability>;
  create(
    options?: LanguageDetectorCreateOptions,
  ): Promise<LanguageDetectorInstance>;
};

interface TranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
  monitor?: (m: CreateMonitor) => void;
}

interface TranslatorInstance {
  translate(
    input: string,
    options?: { signal?: AbortSignal },
  ): Promise<string>;
  translateStreaming(input: string): ReadableStream<string>;
  destroy(): void;
}

declare const Translator: {
  // Availability is checked PER language pair — packs download per pair.
  availability(options: {
    sourceLanguage: string;
    targetLanguage: string;
  }): Promise<Availability>;
  create(options: TranslatorCreateOptions): Promise<TranslatorInstance>;
};

// --- Demo logic (typed mirror of the inline script in index.html) ---
const LESSON_URL =
  'https://danduh.me/courses/chrome-built-in-ai/translator-and-language-detector';
const SETUP_URL =
  'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/translate/translate-demo';

interface Lang {
  code: string;
  name: string;
}

// BCP-47 short codes — packs download per (source, target) pair.
const LANGS: Lang[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ja', name: 'Japanese' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ru', name: 'Russian' },
  { code: 'zh', name: 'Chinese' },
];
// Below this, treat the detected language as a guess, not a source.
const CONFIDENCE_FLOOR = 0.4;

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const sourceEl = document.getElementById('source') as HTMLTextAreaElement;
const detectBtn = document.getElementById('detect') as HTMLButtonElement;
const detectOut = document.getElementById('detectOut') as HTMLDivElement;
const sourceLangEl = document.getElementById('sourceLang') as HTMLSelectElement;
const targetLangEl = document.getElementById('targetLang') as HTMLSelectElement;
const translateBtn = document.getElementById('translate') as HTMLButtonElement;
const outputEl = document.getElementById('output') as HTMLDivElement;

let detector: LanguageDetectorInstance | null = null; // one detector, reused
let translator: TranslatorInstance | null = null; // current translator
let translatorKey = ''; // 'src->tgt' the current translator is built for
let detectedSource = ''; // top detected language, if confident enough
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
  detectBtn.disabled = true;
  translateBtn.disabled = true;
}

function langName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

function populateSelect(sel: HTMLSelectElement, def: string): void {
  sel.innerHTML = LANGS.map(
    (l) =>
      '<option value="' +
      l.code +
      '"' +
      (l.code === def ? ' selected' : '') +
      '>' +
      l.name +
      '</option>',
  ).join('');
}

function errName(e: unknown): string {
  if (e instanceof DOMException) return e.name;
  if (e instanceof Error) return e.name;
  return 'Error';
}

function errMessage(e: unknown): string {
  if (e instanceof DOMException || e instanceof Error) return e.message || e.name;
  return String(e);
}

// Render the ranked detection results. Results arrive sorted by confidence
// descending and always end with a trailing 'und' (unknown) entry.
function renderDetection(results: LanguageDetectionResult[]): void {
  const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
  detectOut.innerHTML = results
    .slice(0, 4)
    .map((r, i) => {
      const pct = (r.confidence * 100).toFixed(1) + '%';
      const label =
        r.detectedLanguage === 'und'
          ? 'und (unknown)'
          : langName(r.detectedLanguage) + ' (' + r.detectedLanguage + ')';
      const cls = i === 0 ? 'rowline top' : 'rowline';
      return (
        '<div class="' + cls + '"><span>' + esc(label) + '</span><span>' + pct + '</span></div>'
      );
    })
    .join('');
}

// Feature-detect both globals before anything else.
async function init(): Promise<void> {
  if (typeof LanguageDetector === 'undefined' || typeof Translator === 'undefined') {
    degrade(
      'This browser is missing the built-in <code>Translator</code> / <code>LanguageDetector</code> globals. You need desktop Chrome with built-in AI.',
    );
    return;
  }
  populateSelect(sourceLangEl, 'fr');
  populateSelect(targetLangEl, 'en');
  setStatus('Ready. Detect the language, or pick a source and hit Translate.', 'ok');
  detectBtn.disabled = false;
  translateBtn.disabled = false;
}

// Lazily create one detector, wiring a monitor for the first-run download.
async function ensureDetector(): Promise<LanguageDetectorInstance> {
  if (detector) return detector;

  const status = await LanguageDetector.availability();
  if (status === 'unavailable') {
    throw new DOMException(
      'Language detection is unavailable on this device.',
      'NotSupportedError',
    );
  }

  dlEl.hidden = false;
  dlEl.value = 0;
  detector = await LanguageDetector.create({
    monitor(m: CreateMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // 0..1 fraction; e.total exists and is always 1
        setStatus(
          'Downloading the detector model… ' + Math.round(e.loaded * 100) + '%',
          'warn',
        );
      });
    },
  });
  dlEl.hidden = true;
  return detector;
}

async function runDetect(): Promise<void> {
  const text = sourceEl.value.trim();
  if (!text || busy) return;

  busy = true;
  detectBtn.disabled = true;
  translateBtn.disabled = true;
  detectOut.textContent = '';

  try {
    setStatus('Detecting the language…', 'warn');
    const d = await ensureDetector();
    const results = await d.detect(text);
    renderDetection(results);

    const top = results[0];
    if (top && top.detectedLanguage !== 'und' && top.confidence >= CONFIDENCE_FLOOR) {
      detectedSource = top.detectedLanguage;
      if (LANGS.some((l) => l.code === detectedSource)) {
        sourceLangEl.value = detectedSource;
      }
      setStatus(
        'Detected ' + langName(detectedSource) + '. Pick a target and hit Translate.',
        'ok',
      );
    } else {
      detectedSource = '';
      setStatus(
        'Not sure what language that is (und or low confidence). Pick a source language by hand.',
        'warn',
      );
    }
  } catch (e) {
    setStatus('Detection failed: ' + errName(e) + '.', 'err');
  } finally {
    busy = false;
    detectBtn.disabled = false;
    translateBtn.disabled = false;
  }
}

// Probe the pair, then create (and cache) a translator for it. A different
// pair means a different pack — destroy the old instance and build a new one.
async function ensureTranslator(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<TranslatorInstance> {
  const key = sourceLanguage + '->' + targetLanguage;
  if (translator && translatorKey === key) return translator;
  if (translator) {
    translator.destroy();
    translator = null;
    translatorKey = '';
  }

  const status = await Translator.availability({ sourceLanguage, targetLanguage });
  if (status === 'unavailable') {
    throw new DOMException(
      'No language pack for ' + sourceLanguage + ' → ' + targetLanguage + '.',
      'NotSupportedError',
    );
  }

  dlEl.hidden = false;
  dlEl.value = 0;
  setStatus(
    'Preparing ' + langName(sourceLanguage) + ' → ' + langName(targetLanguage) + '…',
    'warn',
  );

  translator = await Translator.create({
    sourceLanguage,
    targetLanguage,
    monitor(m: CreateMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // 0..1 fraction
        setStatus(
          'Downloading the ' +
            sourceLanguage +
            '→' +
            targetLanguage +
            ' pack… ' +
            Math.round(e.loaded * 100) +
            '%',
          'warn',
        );
      });
    },
  });
  translatorKey = key;
  dlEl.hidden = true;
  return translator;
}

async function runTranslate(): Promise<void> {
  const text = sourceEl.value.trim();
  if (!text || busy) return;

  const sourceLanguage = sourceLangEl.value;
  const targetLanguage = targetLangEl.value;
  if (sourceLanguage === targetLanguage) {
    setStatus('Source and target are the same language — nothing to translate.', 'warn');
    return;
  }

  busy = true;
  detectBtn.disabled = true;
  translateBtn.disabled = true;
  outputEl.textContent = '';

  try {
    const t = await ensureTranslator(sourceLanguage, targetLanguage);
    setStatus(
      'Translating ' + langName(sourceLanguage) + ' → ' + langName(targetLanguage) + '…',
      'warn',
    );

    // Stream deltas and append them — never replace.
    const stream = t.translateStreaming(text);
    for await (const chunk of stream) {
      outputEl.textContent += chunk;
    }
    setStatus('Done. Everything ran on-device.', 'ok');
  } catch (e) {
    if (errName(e) === 'NotSupportedError') {
      outputEl.textContent =
        'That language pair is unavailable on this device. Try another target, or fall back to a cloud translator.';
    } else if (errName(e) === 'AbortError') {
      outputEl.textContent = 'Translation was cancelled.';
    } else {
      outputEl.textContent = 'Error: ' + errMessage(e);
    }
    setStatus('Error: ' + errName(e) + '.', 'err');
  } finally {
    busy = false;
    detectBtn.disabled = false;
    translateBtn.disabled = false;
  }
}

detectBtn.addEventListener('click', () => void runDetect());
translateBtn.addEventListener('click', () => void runTranslate());

// Free both models on teardown so they don't pin memory.
window.addEventListener('beforeunload', () => {
  if (detector) detector.destroy();
  if (translator) translator.destroy();
});

void init();
