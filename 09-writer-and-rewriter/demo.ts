// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The @types/dom-chromium-ai package ships fuller
// declarations; the minimal ambient surface below keeps this file self-contained.

// --- Minimal ambient surface for Chrome's Writer + Rewriter APIs (flag-gated as of Chrome 150) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

// Writer vocabulary.
type WriterTone = 'formal' | 'neutral' | 'casual';
type WriterFormat = 'markdown' | 'plain-text';
type WriterLength = 'short' | 'medium' | 'long';

// Rewriter vocabulary — every axis defaults to 'as-is'. Don't mix these with the Writer values.
type RewriterTone = 'as-is' | 'more-formal' | 'more-casual';
type RewriterFormat = 'as-is' | 'markdown' | 'plain-text';
type RewriterLength = 'as-is' | 'shorter' | 'longer';

interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: ProgressEvent) => void,
  ): void;
}

interface WriterCreateOptions {
  tone?: WriterTone;
  format?: WriterFormat;
  length?: WriterLength;
  sharedContext?: string;
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

interface RewriterCreateOptions {
  tone?: RewriterTone;
  format?: RewriterFormat;
  length?: RewriterLength;
  sharedContext?: string;
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

// Per-call options: a `context` steers a single input without a new instance.
interface CallOptions {
  context?: string;
  signal?: AbortSignal;
}

interface WriterInstance {
  write(input: string, options?: CallOptions): Promise<string>;
  writeStreaming(input: string, options?: CallOptions): ReadableStream<string>;
  destroy(): void;
}

interface RewriterInstance {
  rewrite(input: string, options?: CallOptions): Promise<string>;
  rewriteStreaming(input: string, options?: CallOptions): ReadableStream<string>;
  destroy(): void;
}

declare const Writer: {
  availability(options?: WriterCreateOptions): Promise<Availability>;
  create(options?: WriterCreateOptions): Promise<WriterInstance>;
};

declare const Rewriter: {
  availability(options?: RewriterCreateOptions): Promise<Availability>;
  create(options?: RewriterCreateOptions): Promise<RewriterInstance>;
};

// A structural type both globals satisfy, so setupTool can be parametric.
type ToolInstance = WriterInstance | RewriterInstance;
interface ToolApi {
  availability(options?: object): Promise<Availability>;
  create(options?: object): Promise<ToolInstance>;
}

interface ToolConfig {
  kind: 'writer' | 'rewriter';
  apiName: 'Writer' | 'Rewriter';
  flag: string;
  ids: {
    status: string;
    dl: string;
    source: string;
    tone: string;
    format: string;
    length: string;
    extra: string;
    run: string;
    output: string;
  };
}

interface ToolHandle {
  destroy(): void;
}

// --- Demo logic (typed mirror of the inline script in index.html) ---
const SETUP_URL =
  'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/writer/writer-demo';

function setStatus(
  el: HTMLElement,
  html: string,
  kind?: 'ok' | 'warn' | 'err',
): void {
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.innerHTML = html;
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

// Wire one tool (Writer or Rewriter). Returns a teardown handle.
function setupTool(cfg: ToolConfig): ToolHandle {
  // `Writer` / `Rewriter` are bare globals; pick the one this section drives.
  const api: ToolApi | undefined =
    cfg.kind === 'writer'
      ? typeof Writer !== 'undefined'
        ? Writer
        : undefined
      : typeof Rewriter !== 'undefined'
        ? Rewriter
        : undefined;

  const statusEl = document.getElementById(cfg.ids.status) as HTMLDivElement;
  const dlEl = document.getElementById(cfg.ids.dl) as HTMLProgressElement;
  const sourceEl = document.getElementById(cfg.ids.source) as HTMLTextAreaElement;
  const toneEl = document.getElementById(cfg.ids.tone) as HTMLSelectElement;
  const formatEl = document.getElementById(cfg.ids.format) as HTMLSelectElement;
  const lengthEl = document.getElementById(cfg.ids.length) as HTMLSelectElement;
  const extraEl = document.getElementById(cfg.ids.extra) as HTMLInputElement;
  const runBtn = document.getElementById(cfg.ids.run) as HTMLButtonElement;
  const outputEl = document.getElementById(cfg.ids.output) as HTMLDivElement;

  let instance: ToolInstance | null = null;
  let busy = false;

  function degrade(reason: string): void {
    setStatus(
      statusEl,
      reason +
        ' Enable <code>' +
        cfg.flag +
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
    if (!api) {
      degrade('This browser has no built-in <code>' + cfg.apiName + '</code>.');
      return;
    }

    let status: Availability;
    try {
      status = await api.availability();
    } catch (e) {
      degrade(
        '<code>' + cfg.apiName + '.availability()</code> threw: ' + errMessage(e) + '.',
      );
      return;
    }

    if (status === 'unavailable') {
      degrade(
        '<code>' + cfg.apiName + '</code> reports <code>unavailable</code> — usually the flag is off.',
      );
      return;
    }

    if (status === 'available') {
      setStatus(statusEl, 'Model ready. Fill the fields and run it.', 'ok');
    } else {
      setStatus(
        statusEl,
        'Model needs a one-time download (a few GB). It starts on your first run.',
        'warn',
      );
    }
    runBtn.disabled = false;
  }

  // Build create() options from the selects. sharedContext is a Writer-side frame.
  function buildCreateOptions(): WriterCreateOptions & RewriterCreateOptions {
    const options: WriterCreateOptions & RewriterCreateOptions = {
      tone: toneEl.value as WriterTone & RewriterTone,
      format: formatEl.value as WriterFormat & RewriterFormat,
      length: lengthEl.value as WriterLength & RewriterLength,
    };
    if (cfg.kind === 'writer') {
      const shared = extraEl.value.trim();
      if (shared) options.sharedContext = shared;
    }
    return options;
  }

  // Fresh instance for the current options, wiring a download monitor.
  async function createInstance(): Promise<ToolInstance> {
    dlEl.hidden = false;
    dlEl.value = 0;
    setStatus(statusEl, 'Preparing the model…', 'warn');

    const created = await (api as ToolApi).create({
      ...buildCreateOptions(),
      monitor(m: DownloadMonitor) {
        m.addEventListener('downloadprogress', (e: ProgressEvent) => {
          dlEl.value = e.loaded; // 0..1 fraction, no e.total in current builds
          setStatus(
            statusEl,
            'Downloading model… ' + Math.round(e.loaded * 100) + '%',
            'warn',
          );
        });
      },
    });

    dlEl.hidden = true;
    return created;
  }

  // Writer streams from the brief; Rewriter streams the transform, with a per-call context.
  function startStream(text: string): ReadableStream<string> {
    if (cfg.kind === 'writer') {
      return (instance as WriterInstance).writeStreaming(text);
    }
    const context = extraEl.value.trim();
    return (instance as RewriterInstance).rewriteStreaming(
      text,
      context ? { context } : undefined,
    );
  }

  async function run(): Promise<void> {
    const text = sourceEl.value.trim();
    if (!text || busy) return;

    busy = true;
    runBtn.disabled = true;
    outputEl.textContent = '';

    try {
      // Options may have changed since the last run — recreate, don't leak.
      if (instance) {
        instance.destroy();
        instance = null;
      }
      instance = await createInstance();

      setStatus(statusEl, cfg.kind === 'writer' ? 'Writing…' : 'Rewriting…', 'warn');
      const stream = startStream(text);
      for await (const chunk of stream) {
        outputEl.textContent += chunk; // deltas — append, never replace
      }
      setStatus(statusEl, 'Done. Change the options and run it again.', 'ok');
    } catch (e) {
      const name = errName(e);
      if (name === 'QuotaExceededError') {
        outputEl.textContent =
          'Input is over the quota (QuotaExceededError). Trim it, or split it into ' +
          'sections and run them one at a time.';
      } else if (name === 'NotSupportedError') {
        outputEl.textContent =
          'That tone/format/length combo is not supported here (NotSupportedError). Try another.';
      } else if (name === 'InvalidStateError') {
        outputEl.textContent = 'That instance was destroyed. Run again to recreate it.';
        instance = null;
      } else {
        outputEl.textContent = 'Error: ' + errMessage(e);
      }
      setStatus(statusEl, 'Error: ' + name + '.', 'err');
    } finally {
      busy = false;
      runBtn.disabled = false;
    }
  }

  runBtn.addEventListener('click', () => void run());
  void init();

  return {
    destroy(): void {
      if (instance) instance.destroy();
    },
  };
}

const writerTool = setupTool({
  kind: 'writer',
  apiName: 'Writer',
  flag: '#writer-api-for-gemini-nano',
  ids: {
    status: 'w-status',
    dl: 'w-dl',
    source: 'w-source',
    tone: 'w-tone',
    format: 'w-format',
    length: 'w-length',
    extra: 'w-shared',
    run: 'w-run',
    output: 'w-output',
  },
});

const rewriterTool = setupTool({
  kind: 'rewriter',
  apiName: 'Rewriter',
  flag: '#rewriter-api-for-gemini-nano',
  ids: {
    status: 'r-status',
    dl: 'r-dl',
    source: 'r-source',
    tone: 'r-tone',
    format: 'r-format',
    length: 'r-length',
    extra: 'r-context',
    run: 'r-run',
    output: 'r-output',
  },
});

// Free GPU memory on teardown — both instances.
window.addEventListener('beforeunload', () => {
  writerTool.destroy();
  rewriterTool.destroy();
});
