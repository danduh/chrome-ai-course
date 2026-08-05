// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. On-device inference has no server round-trip to
// instrument — no logprobs, no confidence, no output-token count, no model
// version — so an `AiSpan` only carries the signals Chrome actually gives you.
// Everything stays in the browser; the tracer logs sizes and timings, not content.

// --- Minimal ambient surface for the built-in AI globals used here ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: ProgressEvent) => void): void;
}

interface SummarizerCreateOptions {
  type?: 'key-points' | 'tldr' | 'teaser' | 'headline';
  format?: 'markdown' | 'plain-text';
  outputLanguage?: string;
  monitor?: (m: DownloadMonitor) => void;
}
interface SummarizerInstance {
  summarizeStreaming(input: string): ReadableStream<string>;
  destroy(): void;
}

interface LanguageModelCreateOptions {
  // The Prompt API declares languages via expectedInputs/expectedOutputs — it has
  // no outputLanguage option (that one is the Summarizer's).
  expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
  expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
  monitor?: (m: DownloadMonitor) => void;
}
interface LanguageModelSession {
  promptStreaming(input: string): ReadableStream<string>;
  // Prompt API context accounting.
  readonly contextUsage?: number;
  readonly contextWindow?: number;
  destroy(): void;
}

declare const Summarizer: {
  availability(options?: SummarizerCreateOptions): Promise<Availability>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerInstance>;
};
declare const LanguageModel: {
  availability(options?: LanguageModelCreateOptions): Promise<Availability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};

// --- The span shape: one normalized record per on-device AI call ---
type AiApi = 'prompt' | 'summarizer' | 'translator' | 'languageDetector';
type AiFinish = 'ok' | 'error' | 'abort';

interface AiSpan {
  id: string;
  ts: number;
  api: AiApi;
  op: string; // 'prompt' | 'summarize' | 'translate'
  stream: boolean;
  latencyMs: number;
  finish: AiFinish;
  ttftMs?: number; // streaming only: time to first chunk
  outChars?: number; // char proxy, NOT a token count
  contextUsage?: number; // Prompt API only
  contextWindow?: number; // Prompt API only
  errorName?: string; // DOMException.name on failure
  availability?: string; // availability() state captured before create()
  downloadPct?: number; // last downloadprogress value (0–100)
}

/** A trace consumer. Registered via addSink. Implementations must not throw. */
type Sink = (span: AiSpan) => void;

type DemoApi = 'summarizer' | 'prompt';

// --- A tiny tracer, ~30 lines, mirroring the shipped one ---
const sinks: Sink[] = [];
function addSink(sink: Sink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}
function emit(span: AiSpan): void {
  for (const sink of sinks) {
    try {
      sink(span);
    } catch {
      /* a broken sink never breaks the traced call */
    }
  }
}
function newSpan(api: AiApi, op: string, stream: boolean): AiSpan {
  return { id: crypto.randomUUID(), ts: Date.now(), api, op, stream, latencyMs: 0, finish: 'ok' };
}
function errName(e: unknown): string | undefined {
  return (e as { name?: string } | null)?.name;
}
const classify = (e: unknown): AiFinish => (errName(e) === 'AbortError' ? 'abort' : 'error');

/** Prompt API only — getters can throw on a destroyed session. */
function readContext(session: unknown): Pick<AiSpan, 'contextUsage' | 'contextWindow'> {
  try {
    const s = (session ?? {}) as {
      contextUsage?: number;
      contextWindow?: number;
    };
    return {
      contextUsage: s.contextUsage,
      contextWindow: s.contextWindow,
    };
  } catch {
    return {};
  }
}

/**
 * Trace a streaming call. Returns a pass-through ReadableStream so the caller
 * still renders incrementally; the span emits once the stream ends, errors, or
 * is cancelled — capturing TTFT + output chars.
 */
function traceStream(
  api: AiApi,
  op: string,
  session: unknown,
  run: () => ReadableStream<string>,
): ReadableStream<string> {
  const span = newSpan(api, op, true);
  const t0 = performance.now();
  let first = true;
  let chars = 0;
  let done = false;

  const finalize = (finish: AiFinish, errorName?: string): void => {
    if (done) return;
    done = true;
    span.latencyMs = performance.now() - t0;
    span.outChars = chars;
    span.finish = finish;
    if (errorName) span.errorName = errorName;
    Object.assign(span, readContext(session));
    emit(span); // hand the finished span to every sink
  };

  let reader: ReadableStreamDefaultReader<string> | undefined;
  return new ReadableStream<string>({
    start(controller) {
      try {
        reader = run().getReader();
      } catch (e) {
        finalize(classify(e), errName(e));
        controller.error(e);
      }
    },
    async pull(controller) {
      if (!reader) return;
      try {
        const result = await reader.read();
        if (result.done) {
          finalize('ok');
          controller.close();
          return;
        }
        if (first) {
          span.ttftMs = performance.now() - t0; // TTFT
          first = false;
        }
        chars += result.value.length;
        controller.enqueue(result.value); // pass the chunk straight through
      } catch (e) {
        finalize(classify(e), errName(e));
        controller.error(e);
      }
    },
    cancel(reason) {
      finalize('abort', errName(reason));
      return reader?.cancel(reason);
    },
  });
}

// --- Three projections of one span (mirroring SpanViews) ---
function structured(span: AiSpan): Record<string, unknown> {
  const out: Record<string, unknown> = {
    api: span.api,
    op: span.op,
    stream: span.stream,
    latencyMs: Math.round(span.latencyMs),
    finish: span.finish,
  };
  if (span.ttftMs != null) out.ttftMs = Math.round(span.ttftMs);
  if (span.outChars != null) out.outChars = span.outChars;
  if (span.contextUsage != null) out.contextUsage = span.contextUsage;
  if (span.contextWindow != null) out.contextWindow = span.contextWindow;
  if (span.availability) out.availability = span.availability;
  if (span.downloadPct != null) out.downloadPct = span.downloadPct;
  if (span.errorName) out.errorName = span.errorName;
  return out;
}
function genAi(span: AiSpan): { name: string; kind: 'INTERNAL'; attributes: Record<string, unknown> } {
  const attributes: Record<string, unknown> = {
    'gen_ai.operation.name': span.op,
    'gen_ai.provider.name': 'chrome.builtin',
    'gen_ai.request.model': 'gemini-nano', // Chrome exposes no version
    'gen_ai.request.stream': span.stream,
    'gen_ai.response.finish_reasons': [span.finish],
  };
  if (span.ttftMs != null) {
    attributes['gen_ai.response.time_to_first_chunk'] = Number((span.ttftMs / 1000).toFixed(3));
  }
  if (span.contextUsage != null) {
    attributes['gen_ai.usage.input_tokens'] = span.contextUsage; // approximate (cumulative)
  }
  if (span.errorName) attributes['error.type'] = span.errorName;
  return { name: `gen_ai.${span.op}`, kind: 'INTERNAL', attributes };
}
function consoleLine(span: AiSpan): string {
  const ttft = span.ttftMs != null ? ` · ttft ${Math.round(span.ttftMs)}ms` : '';
  return `[ai] ${span.api}.${span.op} · ${Math.round(span.latencyMs)}ms${ttft} · ${span.finish}`;
}

// --- Demo wiring (typed mirror of the inline script in index.html) ---
const LESSON_URL = 'https://danduh.me/courses/chrome-built-in-ai/observability-and-tracing';
const SETUP_URL = 'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/observability';

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const apiEl = document.getElementById('api') as HTMLSelectElement;
const sourceEl = document.getElementById('source') as HTMLTextAreaElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const signalsEl = document.getElementById('signals') as HTMLDivElement;
const outputEl = document.getElementById('output') as HTMLDivElement;
const statsEl = document.getElementById('stats') as HTMLDivElement;
const viewConsoleEl = document.getElementById('viewConsole') as HTMLPreElement;
const viewStructuredEl = document.getElementById('viewStructured') as HTMLPreElement;
const viewOtelEl = document.getElementById('viewOtel') as HTMLPreElement;
const logEl = document.getElementById('log') as HTMLDivElement;

let session: SummarizerInstance | LanguageModelSession | null = null;
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

// Two sinks, both get every span: the real console + an on-page mirror.
addSink((span) => console.log(consoleLine(span), structured(span)));
addSink((span) => {
  logEl.textContent = consoleLine(span) + '\n' + logEl.textContent;
});

function apiGlobal(api: DemoApi): typeof Summarizer | typeof LanguageModel | undefined {
  if (api === 'summarizer') return typeof Summarizer !== 'undefined' ? Summarizer : undefined;
  return typeof LanguageModel !== 'undefined' ? LanguageModel : undefined;
}

function renderStats(span: AiSpan): void {
  const parts: string[] = [];
  parts.push('<span class="stat"><b>latency</b>' + Math.round(span.latencyMs) + 'ms</span>');
  if (span.ttftMs != null) parts.push('<span class="stat"><b>ttft</b>' + Math.round(span.ttftMs) + 'ms</span>');
  if (span.outChars != null) parts.push('<span class="stat"><b>chars</b>' + span.outChars + '</span>');
  if (span.contextUsage != null) {
    parts.push(
      '<span class="stat"><b>context</b>' +
        span.contextUsage +
        (span.contextWindow != null ? '/' + span.contextWindow : '') +
        '</span>',
    );
  }
  parts.push('<span class="stat"><b>finish</b>' + span.finish + '</span>');
  statsEl.innerHTML = parts.join('');
}

function renderPanes(span: AiSpan): void {
  renderStats(span);
  viewConsoleEl.textContent = consoleLine(span) + '\n' + JSON.stringify(structured(span), null, 2);
  viewStructuredEl.textContent = JSON.stringify(structured(span), null, 2);
  viewOtelEl.textContent = JSON.stringify(genAi(span), null, 2);
}

// Feature-detect + availability() gate before create(), for the selected API.
async function checkAvailability(): Promise<void> {
  const api = apiEl.value as DemoApi;
  const Global = apiGlobal(api);
  const name = api === 'summarizer' ? 'Summarizer' : 'LanguageModel';
  runBtn.disabled = true;
  if (!Global) {
    degrade('This browser has no built-in <code>' + name + '</code>. You need desktop Chrome with built-in AI.');
    return;
  }
  let status: Availability;
  try {
    // Summarizer declares language with outputLanguage; the Prompt API with
    // expectedInputs/expectedOutputs. Same availability() gate, two option shapes.
    status =
      api === 'summarizer'
        ? await Summarizer.availability({ outputLanguage: 'en' })
        : await LanguageModel.availability({
            expectedInputs: [{ type: 'text', languages: ['en'] }],
            expectedOutputs: [{ type: 'text', languages: ['en'] }],
          });
  } catch (e) {
    degrade('<code>availability()</code> threw: ' + (e instanceof Error ? e.message : String(e)) + '.');
    return;
  }
  if (status === 'unavailable') {
    degrade('Built-in AI reports <code>unavailable</code> for ' + name + ' on this device.');
    return;
  }
  setStatus(
    status === 'available'
      ? 'Model ready. Hit Run &amp; trace.'
      : 'Model needs a one-time download (a few GB). It starts on your first run.',
    status === 'available' ? 'ok' : 'warn',
  );
  runBtn.disabled = false;
}

async function run(): Promise<void> {
  const api = apiEl.value as DemoApi;
  const text = sourceEl.value.trim();
  if (!text || busy) return;

  busy = true;
  runBtn.disabled = true;
  outputEl.textContent = '';
  signalsEl.textContent = '';

  // One-shot capture sink: grab this run's span to enrich + render the panes.
  let captured: AiSpan | undefined;
  const off = addSink((span) => {
    captured = span;
  });

  // Signals captured at create() time (before the stream trace).
  let seenAvailability: Availability | undefined;
  let seenDownloadPct: number | undefined;
  const monitor = (m: DownloadMonitor): void => {
    m.addEventListener('downloadprogress', (e: ProgressEvent) => {
      seenDownloadPct = Math.round(e.loaded * 100); // e.loaded is 0..1
      dlEl.hidden = false;
      dlEl.value = e.loaded;
      setStatus('Downloading model… ' + seenDownloadPct + '%', 'warn');
    });
  };

  try {
    let stream: ReadableStream<string>;
    if (api === 'summarizer') {
      seenAvailability = await Summarizer.availability({ outputLanguage: 'en' });
      const s = await Summarizer.create({
        type: 'key-points',
        format: 'plain-text',
        outputLanguage: 'en',
        monitor,
      });
      session = s;
      stream = traceStream('summarizer', 'summarize', s, () => s.summarizeStreaming(text));
    } else {
      seenAvailability = await LanguageModel.availability({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      });
      const s = await LanguageModel.create({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
        monitor,
      });
      session = s;
      stream = traceStream('prompt', 'prompt', s, () => s.promptStreaming(text));
    }
    dlEl.hidden = true;
    signalsEl.innerHTML =
      '<code>availability()</code> → ' +
      (seenAvailability || 'available') +
      (seenDownloadPct != null ? ' · <code>downloadprogress</code> → ' + seenDownloadPct + '%' : '');

    setStatus('Tracing…', 'warn');
    // Read the PASS-THROUGH stream: render each chunk; the span emits at the end.
    const reader = stream.getReader();
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      outputEl.textContent += result.value;
    }
    setStatus('Done. One call in, one span out — three views above.', 'ok');
  } catch (e) {
    // create() can fail before the tracer wraps the stream. Synthesize an error
    // span so the views still show what error observability looks like.
    const name = errName(e) ?? 'Error';
    if (!captured) {
      captured = {
        id: 'err-' + Date.now(),
        ts: Date.now(),
        api,
        op: api === 'summarizer' ? 'summarize' : 'prompt',
        stream: true,
        latencyMs: 0,
        finish: 'error',
        errorName: name,
      };
    }
    outputEl.textContent =
      'Call failed (' + name + '). The error is captured in the span — that is observability too.';
    setStatus('Error: ' + name + '.', 'err');
  } finally {
    off();
    if (captured) {
      const enriched: AiSpan = { ...captured, availability: seenAvailability, downloadPct: seenDownloadPct };
      emit(enriched); // re-emit the enriched span to the console + in-page sinks
      renderPanes(enriched);
    }
    if (session) session.destroy(); // free GPU memory after the run
    session = null;
    dlEl.hidden = true;
    busy = false;
    runBtn.disabled = false;
  }
}

runBtn.addEventListener('click', () => void run());
apiEl.addEventListener('change', () => void checkAvailability());

// Free GPU memory on teardown.
window.addEventListener('beforeunload', () => {
  if (session) session.destroy();
});

void checkAvailability();
