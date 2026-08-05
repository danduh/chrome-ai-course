// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. It composes two browser globals:
//   - the Web Speech API (SpeechRecognition) — whose types aren't in the DOM lib
//     on every toolchain, so a minimal ambient shape is declared below;
//   - the Chrome Translator (stable since 138) — same minimal surface as lesson 7.

// --- Minimal ambient surface for the Web Speech API ---
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence?: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}
interface SpeechRecognitionErrorEventLike {
  error?: string;
  message?: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtorType = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtorType;
    webkitSpeechRecognition?: SpeechRecognitionCtorType;
  }
}

// --- Minimal ambient surface for the Chrome Translator (current stable) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: ProgressEvent) => void,
  ): void;
}

interface TranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

interface TranslatorInstance {
  translate(input: string, options?: { signal?: AbortSignal }): Promise<string>;
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
  'https://danduh.me/courses/chrome-built-in-ai/live-voice-translation';
const SETUP_URL =
  'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/live-translate/live-translate-demo';

interface Lang {
  code: string;
  name: string;
}

// Web Speech wants BCP-47; the short prefix before the '-' doubles as the
// Translator source language.
const SPEECH_LANGS: Lang[] = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'es-ES', name: 'Spanish' },
  { code: 'fr-FR', name: 'French' },
  { code: 'de-DE', name: 'German' },
  { code: 'uk-UA', name: 'Ukrainian' },
  { code: 'ru-RU', name: 'Russian' },
  { code: 'ja-JP', name: 'Japanese' },
  { code: 'he-IL', name: 'Hebrew' },
  { code: 'ar-SA', name: 'Arabic' },
];
// Short ISO codes — what the Translator expects for source and target.
const TARGET_LANGS: Lang[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ru', name: 'Russian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'he', name: 'Hebrew' },
  { code: 'ar', name: 'Arabic' },
];
const INTERIM_DEBOUNCE_MS = 300;

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const speechLangEl = document.getElementById('speechLang') as HTMLSelectElement;
const targetLangEl = document.getElementById('targetLang') as HTMLSelectElement;
const toggleBtn = document.getElementById('toggle') as HTMLButtonElement;
const speakEl = document.getElementById('speak') as HTMLInputElement;
const transcriptEl = document.getElementById('transcript') as HTMLDivElement;
const translationEl = document.getElementById('translation') as HTMLDivElement;

const SpeechRecognitionCtor: SpeechRecognitionCtorType | undefined =
  window.SpeechRecognition || window.webkitSpeechRecognition;

let recognition: SpeechRecognitionLike | null = null;
let listening = false;

let translator: TranslatorInstance | null = null; // cached per pair
let translatorKey = ''; // 'src->tgt' the current translator is built for

// Source transcript (append-only finals) + the live interim guess.
const finals: string[] = [];
let interimText = '';

// Translated output (append-only) + the live interim translation preview.
const translations: string[] = [];
let interimTranslation = '';

// Interim-translation debounce + cancellation.
let interimTimer: number | null = null;
let interimController: AbortController | null = null;
let interimReqId = 0;

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
  toggleBtn.disabled = true;
  speechLangEl.disabled = true;
  targetLangEl.disabled = true;
  speakEl.disabled = true;
}

function langName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
}

function populateSelect(sel: HTMLSelectElement, langs: Lang[], def: string): void {
  sel.innerHTML = langs
    .map(
      (l) =>
        '<option value="' +
        l.code +
        '"' +
        (l.code === def ? ' selected' : '') +
        '>' +
        l.name +
        '</option>',
    )
    .join('');
}

function errName(e: unknown): string {
  if (e instanceof DOMException || e instanceof Error) return e.name;
  return 'Error';
}

function errMessage(e: unknown): string {
  if (e instanceof DOMException || e instanceof Error) return e.message || e.name;
  return String(e);
}

// SpeechRecognition speaks BCP-47 ('en-US'); Translator wants the short code ('en').
function toTranslatorLang(speechLang: string): string {
  return speechLang.split('-')[0];
}

function sourceLang(): string {
  return toTranslatorLang(speechLangEl.value);
}
function targetLang(): string {
  return targetLangEl.value;
}

// Speech-to-text transcripts and on-device translations are untrusted text —
// build each line with textContent so nothing reaches an innerHTML sink.
function lineEl(text: string, interim = false): HTMLDivElement {
  const div = document.createElement('div');
  div.className = interim ? 'line interim' : 'line';
  div.textContent = text;
  return div;
}

function placeholderEl(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'placeholder';
  span.textContent = text;
  return span;
}

function renderTranscript(): void {
  transcriptEl.replaceChildren();
  if (!finals.length && !interimText) {
    transcriptEl.append(placeholderEl('Your words appear here as you speak.'));
    return;
  }
  for (const s of finals) transcriptEl.append(lineEl(s));
  if (interimText) transcriptEl.append(lineEl(interimText, true));
}

function renderTranslation(): void {
  translationEl.replaceChildren();
  if (!translations.length && !interimTranslation) {
    translationEl.append(
      placeholderEl('Translations appear here, one per finalized sentence.'),
    );
    return;
  }
  for (const s of translations) translationEl.append(lineEl(s));
  if (interimTranslation) translationEl.append(lineEl(interimTranslation, true));
}

// Probe the pair, then create (and cache) a translator for it. A different pair
// means a different pack — destroy the old instance and build a new one.
async function ensureTranslator(
  src: string,
  tgt: string,
): Promise<TranslatorInstance> {
  const key = src + '->' + tgt;
  if (translator && translatorKey === key) return translator;
  if (translator) {
    translator.destroy();
    translator = null;
    translatorKey = '';
  }

  const status: Availability = await Translator.availability({
    sourceLanguage: src,
    targetLanguage: tgt,
  });
  if (status === 'unavailable') {
    throw new DOMException('No language pack for ' + src + ' → ' + tgt + '.', 'NotSupportedError');
  }

  dlEl.hidden = false;
  dlEl.value = 0;
  translator = await Translator.create({
    sourceLanguage: src,
    targetLanguage: tgt,
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // 0..1 fraction — the language pack download
        setStatus(
          'Downloading the ' + src + '→' + tgt + ' pack… ' + Math.round(e.loaded * 100) + '%',
          'warn',
        );
      });
    },
  });
  translatorKey = key;
  dlEl.hidden = true;
  return translator;
}

async function translateOne(
  text: string,
  options?: { signal?: AbortSignal },
): Promise<string> {
  const src = sourceLang();
  const tgt = targetLang();
  if (src === tgt) return text; // passthrough — nothing to translate
  const t = await ensureTranslator(src, tgt);
  return t.translate(text, options);
}

function speak(text: string): void {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = targetLang();
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

// A finalized sentence: commit it, translate it on-device, append the result.
async function handleFinal(sentence: string): Promise<void> {
  finals.push(sentence);
  interimText = '';
  renderTranscript();

  // A final supersedes the interim preview — cancel it.
  interimController?.abort();
  interimController = null;
  interimTranslation = '';
  if (interimTimer !== null) {
    window.clearTimeout(interimTimer);
    interimTimer = null;
  }

  try {
    const output = await translateOne(sentence);
    if (output && output.trim()) {
      translations.push(output);
      renderTranslation();
      if (speakEl.checked) speak(output);
    }
    setStatus('Translation ran on-device. Transcription went through a server.', 'ok');
  } catch (e) {
    if (errName(e) === 'NotSupportedError') {
      setStatus('That language pair is unavailable on this device. Pick another target.', 'err');
    } else if (errName(e) !== 'AbortError') {
      setStatus('Translation error: ' + errMessage(e) + '.', 'err');
    }
  }
}

// A rolling interim: show it muted, and debounce-translate it into a preview,
// cancelling any older in-flight translation so previews can't land out of order.
function handleInterim(text: string): void {
  interimText = text;
  renderTranscript();

  if (interimTimer !== null) window.clearTimeout(interimTimer);
  interimTimer = window.setTimeout(async () => {
    const myId = ++interimReqId;
    interimController?.abort();
    const controller = new AbortController();
    interimController = controller;
    try {
      const preview = await translateOne(text, { signal: controller.signal });
      if (myId !== interimReqId) return; // a newer interim superseded us
      if (preview && preview.trim()) {
        interimTranslation = preview;
        renderTranslation();
      }
    } catch (e) {
      if (errName(e) !== 'AbortError') {
        /* transient — the next interim recovers */
      }
    }
  }, INTERIM_DEBOUNCE_MS);
}

function startListening(): void {
  if (!SpeechRecognitionCtor) return;
  const recog = new SpeechRecognitionCtor();
  recog.continuous = true; // keep listening across pauses
  recog.interimResults = true; // emit partial guesses while speaking
  recog.lang = speechLangEl.value;

  recog.onresult = (event: SpeechRecognitionEventLike) => {
    let interim = '';
    // Start at resultIndex — everything before it is already committed.
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const transcript = result[0].transcript;
      if (result.isFinal) {
        const trimmed = transcript.trim();
        if (trimmed) void handleFinal(trimmed);
      } else {
        interim += transcript;
      }
    }
    if (interim.trim()) handleInterim(interim);
  };

  recog.onerror = (event: SpeechRecognitionErrorEventLike) => {
    if (event.error === 'not-allowed') {
      setStatus('Microphone blocked — allow it in the address bar, then Start again.', 'err');
    } else if (event.error === 'network') {
      // The transcription hop is a server call — no connection, no transcript.
      setStatus('Speech recognition needs a network connection on this platform.', 'err');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      setStatus('Speech error: ' + (event.error || event.message) + '.', 'err');
    }
  };

  recog.onend = () => {
    listening = false;
    interimText = '';
    renderTranscript();
    toggleBtn.textContent = 'Start listening';
    toggleBtn.classList.remove('live');
  };

  recognition = recog;
  try {
    recog.start(); // needs a user gesture + mic permission + secure context
    listening = true;
    toggleBtn.textContent = 'Stop';
    toggleBtn.classList.add('live');
    setStatus('Listening… speak into the mic. Translations land on-device.', 'warn');
  } catch (e) {
    setStatus('Could not start recognition: ' + errMessage(e) + '.', 'err');
    listening = false;
  }
}

function stopListening(): void {
  try {
    recognition?.stop();
  } catch {
    /* idempotent — stopping an already-stopped recognizer is a no-op */
  }
}

function teardown(): void {
  stopListening();
  interimController?.abort();
  if (translator) {
    translator.destroy();
    translator = null;
    translatorKey = '';
  }
  speechSynthesis.cancel();
}

toggleBtn.addEventListener('click', () => {
  if (listening) stopListening();
  else startListening();
});

// Changing the spoken language mid-session: restart the recognizer with it.
speechLangEl.addEventListener('change', () => {
  if (!listening) return;
  stopListening();
  window.setTimeout(startListening, 50); // let onend run first
});

// Feature-detect BOTH globals before enabling anything.
function init(): void {
  const missing: string[] = [];
  if (!SpeechRecognitionCtor) missing.push('<code>SpeechRecognition</code> (Web Speech API)');
  if (typeof Translator === 'undefined') missing.push('<code>Translator</code>');
  if (missing.length) {
    degrade(
      'This browser is missing ' + missing.join(' and ') + '. You need desktop Chrome with built-in AI.',
    );
    renderTranscript();
    renderTranslation();
    return;
  }
  populateSelect(speechLangEl, SPEECH_LANGS, 'en-US');
  populateSelect(targetLangEl, TARGET_LANGS, 'es');
  renderTranscript();
  renderTranslation();
  setStatus('Ready. Pick languages, hit Start, and allow the microphone.', 'ok');
  toggleBtn.disabled = false;
}

window.addEventListener('beforeunload', teardown);
init();

// This file is a module (so `declare global` above can augment Window). The
// runnable version is the inline script in index.html, which needs no exports.
export {};
