// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline JavaScript in index.html with types added. The shipped
// `@types/dom-chromium-ai` only declares the string overload of prompt(), so the
// multimodal (array-of-parts) surface is declared locally below and reached with
// a cast — the same workaround the source app uses. Nothing here is loaded by the
// page; it exists so you can read the typed shape.

// --- Local types for the multimodal surface -------------------------------

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface ContentPart {
  type: 'text' | 'image';
  // Prefer Blob; ImageBitmap / ImageData / HTMLImageElement / HTMLCanvasElement /
  // HTMLVideoElement are also accepted.
  value: string | Blob | ImageBitmap | ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement;
}

interface UserMessage {
  role: 'user' | 'assistant' | 'system';
  content: ContentPart[];
}

interface DownloadProgressEvent {
  loaded: number; // 0..1 fraction (no `total` in current builds)
}

interface CreateMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: DownloadProgressEvent) => void): void;
}

interface CreateOptions {
  expectedInputs?: Array<{ type: 'text' | 'image'; languages?: string[] }>;
  expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
  outputLanguage?: string;
  monitor?: (m: CreateMonitor) => void;
}

// The multimodal session: array-of-parts overloads that the shipped d.ts omits.
interface MultimodalSession {
  prompt(input: UserMessage[]): Promise<string>;
  promptStreaming(input: UserMessage[]): ReadableStream<string>;
  destroy(): void;
}

interface LanguageModelGlobal {
  availability(options?: { expectedInputs?: Array<{ type: 'image' }> }): Promise<Availability>;
  create(options?: CreateOptions): Promise<MultimodalSession>;
}

// In a real project this comes from `@types/dom-chromium-ai`; declared here so the
// reference file type-checks on its own.
declare const LanguageModel: LanguageModelGlobal | undefined;

// --- DOM refs --------------------------------------------------------------

const SETUP_URL = 'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_URL = 'https://windowai.danduh.me/multimodal';

const statusEl = document.getElementById('status') as HTMLDivElement;
const outputEl = document.getElementById('output') as HTMLDivElement;
const fileInput = document.getElementById('file') as HTMLInputElement;
const drop = document.getElementById('drop') as HTMLDivElement;
const preview = document.getElementById('preview') as HTMLImageElement;
const question = document.getElementById('question') as HTMLTextAreaElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const progress = document.getElementById('progress') as HTMLProgressElement;

let sessionPromise: Promise<MultimodalSession> | null = null;
let currentImage: Blob | null = null;
let currentUrl: string | null = null;

function setStatus(msg: string, cls?: 'ok' | 'warn' | 'err'): void {
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
  statusEl.textContent = msg;
}

// Probe multimodal availability. Older builds throw on the option — catch it
// and report "unavailable" rather than exploding.
async function getMultimodalAvailability(): Promise<Availability> {
  if (typeof LanguageModel === 'undefined') return 'unavailable';
  try {
    return await LanguageModel.availability({ expectedInputs: [{ type: 'image' }] });
  } catch {
    return 'unavailable';
  }
}

// Create once (loading the vision tower via expectedInputs), reuse after.
// The first create() may download the model, which blocks until it finishes.
function getSession(): Promise<MultimodalSession> {
  if (sessionPromise) return sessionPromise;
  if (typeof LanguageModel === 'undefined') {
    return Promise.reject(new Error('LanguageModel is unavailable'));
  }
  sessionPromise = LanguageModel.create({
    expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    outputLanguage: 'en',
    monitor(m) {
      m.addEventListener('downloadprogress', (e) => {
        const frac = e.loaded != null ? e.loaded : 0;
        progress.hidden = false;
        progress.value = frac;
        setStatus('Downloading model… ' + Math.round(frac * 100) + '%', 'warn');
      });
    },
  }).then((session) => {
    progress.hidden = true;
    return session;
  }).catch((err: unknown) => {
    sessionPromise = null; // let the next attempt retry a failed download
    progress.hidden = true;
    throw err;
  });
  return sessionPromise;
}

function setImage(blob: Blob | null | undefined): void {
  if (!blob || !blob.type.startsWith('image/')) {
    setStatus('That was not an image — try a PNG or JPEG.', 'warn');
    return;
  }
  currentImage = blob;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  currentUrl = URL.createObjectURL(blob);
  preview.src = currentUrl;
  preview.hidden = false;
  setStatus('Image ready. Ask away.', 'ok');
}

// Draw the image into a canvas at max 512px on the long side, then encode back
// to a Blob. canvas.toBlob hands you null on failure — null-check it.
async function downsample(blob: Blob, max = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      0.9,
    );
  });
}

async function run(): Promise<void> {
  if (!currentImage) {
    setStatus('Add an image first — drop, paste, or pick a file.', 'warn');
    return;
  }
  const text = question.value.trim() || 'What is in this picture?';
  runBtn.disabled = true;
  outputEl.textContent = '';
  try {
    setStatus('Preparing the model…', 'warn');
    const session = await getSession();
    setStatus('Thinking…', 'ok');
    const image = await downsample(currentImage, 512);
    // Role-wrapped content parts. The image part's key is `value`.
    const stream: ReadableStream<string> = session.promptStreaming([
      {
        role: 'user',
        content: [
          { type: 'text', value: text },
          { type: 'image', value: image },
        ],
      },
    ]);
    for await (const chunk of stream) {
      outputEl.textContent += chunk; // chunks are deltas — append
    }
    setStatus('Done. Every pixel stayed on this machine.', 'ok');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setStatus('Prompt failed: ' + message, 'err');
  } finally {
    runBtn.disabled = false;
  }
}

// --- Image sources: file picker, drag-and-drop, clipboard paste ---
drop.addEventListener('click', () => fileInput.click());
drop.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener('change', () => setImage(fileInput.files?.[0]));

drop.addEventListener('dragover', (e: DragEvent) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e: DragEvent) => {
  e.preventDefault();
  drop.classList.remove('over');
  setImage(e.dataTransfer?.files[0]);
});

document.addEventListener('paste', (e: ClipboardEvent) => {
  for (const item of e.clipboardData?.items ?? []) {
    if (item.type.startsWith('image/')) { setImage(item.getAsFile()); return; }
  }
});

runBtn.addEventListener('click', run);

function showUnavailable(): void {
  setStatus("Multimodal image input isn't available in this browser.", 'err');
  outputEl.innerHTML =
    'This demo needs desktop Chrome with Gemini Nano and image input. Work through ' +
    '<a href="' + SETUP_URL + '">Setup &amp; the availability lifecycle</a>, ' +
    'or try the <a href="' + LIVE_URL + '">hosted demo</a>.';
  runBtn.disabled = true;
}

// --- Boot: gate on availability BEFORE anyone can prompt ---
(async () => {
  const availability = await getMultimodalAvailability();
  if (availability === 'unavailable') {
    showUnavailable();
    return;
  }
  if (availability === 'available') {
    setStatus('Ready. Drop an image and ask.', 'ok');
  } else {
    setStatus('Ready — the model downloads on your first question (' + availability + ').', 'warn');
  }
  runBtn.disabled = false;
})();

// --- Teardown: free the vision tower and the preview URL ---
window.addEventListener('beforeunload', () => {
  if (sessionPromise) sessionPromise.then((s) => s.destroy()).catch(() => {});
  if (currentUrl) URL.revokeObjectURL(currentUrl);
});
