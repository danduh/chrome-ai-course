// Reference only — the runnable demo is index.html. Types illustrate the API;
// compile with tsc if you want.
//
// This mirrors the inline JS in index.html, with types added. It is NOT loaded
// by the page. It shows the shape every built-in AI API shares:
//   availability() -> create() (monitor + expectedInputs/expectedOutputs) -> use -> destroy()

// --- Minimal ambient shape of the raw Chrome built-in AI globals used here ---
// Chrome exposes these on `self`/`window`; there is no official .d.ts yet.

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface DownloadProgressEvent extends Event {
  /** 0..1 fraction of the download; multiply by 100 for a percentage. */
  readonly loaded: number;
  /** Always 1 — present so `loaded / total` also works. */
  readonly total: number;
}

interface CreateMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: DownloadProgressEvent) => void,
  ): void;
}

interface LanguageModelCreateOptions {
  /** Declare the languages this session will use, on the way in and out. */
  expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
  expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
  monitor?: (m: CreateMonitor) => void;
  signal?: AbortSignal;
}

interface LanguageModelSession {
  prompt(input: string, options?: { signal?: AbortSignal }): Promise<string>;
  /** Chrome returns a ReadableStream you can `for await` over; chunks are deltas. */
  promptStreaming(
    input: string,
    options?: { signal?: AbortSignal },
  ): ReadableStream<string> & AsyncIterable<string>;
  destroy(): void;
}

interface LanguageModelStatic {
  availability(options?: unknown): Promise<Availability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
}

// `undefined` in the type is deliberate — you must feature-detect before use.
declare const LanguageModel: LanguageModelStatic | undefined;

// --- The demo ---

const PROMPT = 'In one sentence, explain on-device AI to a web developer.';

let session: LanguageModelSession | null = null;

async function hello(): Promise<void> {
  // 1) Feature-detect the global (undefined off desktop Chrome or on http://).
  if (typeof LanguageModel === 'undefined') {
    console.log('Built-in AI is not available here.');
    return;
  }

  // 2) availability() BEFORE create().
  const status: Availability = await LanguageModel.availability();
  if (status === 'unavailable') {
    console.log('Gemini Nano is unavailable on this device.');
    return;
  }

  try {
    // 3) create() — declare languages via expectedInputs/expectedOutputs; monitor the first-run download.
    session = await LanguageModel.create({
      expectedInputs:  [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const pct = Math.round(e.loaded * 100); // e.loaded is 0..1
          console.log(`Downloading Gemini Nano… ${pct}%`);
        });
      },
    });

    // 4) Use it. Append streamed deltas — chunks are incremental, not cumulative.
    const stream = session.promptStreaming(PROMPT);
    let reply = '';
    for await (const chunk of stream) {
      reply += chunk;
    }
    console.log(reply);
  } finally {
    // 5) Free the model's memory sooner than the garbage collector would.
    session?.destroy();
    session = null;
  }
}

void hello();
