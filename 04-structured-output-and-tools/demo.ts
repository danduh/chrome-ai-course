// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The @types/dom-chromium-ai package ships fuller
// declarations; the minimal ambient surface below keeps this file self-contained.

// --- Minimal ambient surface for Chrome's built-in Prompt API (current stable) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
type Role = 'system' | 'user' | 'assistant';

interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: ProgressEvent) => void,
  ): void;
}

// A native tool definition. `execute` MUST resolve to a string.
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object; // JSON Schema
  execute: (args: any) => Promise<string>;
}

interface LanguageModelCreateOptions {
  outputLanguage?: string;
  initialPrompts?: Array<{ role: Role; content: string }>;
  responseFormat?: object; // JSON Schema (spec alias: responseConstraint)
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

interface PromptOptions {
  signal?: AbortSignal;
  responseFormat?: object; // per-call schema
}

interface LanguageModelSession {
  prompt(input: string, options?: PromptOptions): Promise<string>;
  destroy(): void;
}

declare const LanguageModel: {
  availability(
    options?: Partial<LanguageModelCreateOptions>,
  ): Promise<Availability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};

// --- Demo logic (typed mirror of the inline script in index.html) ---
const LESSON_URL =
  'https://danduh.me/courses/chrome-built-in-ai/structured-output-and-tools';
const SETUP_URL =
  'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/tool-calling/tool-calling-demo';
const MAX_STEPS = 8;

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const reviewEl = document.getElementById('review') as HTMLTextAreaElement;
const extractBtn = document.getElementById('extractBtn') as HTMLButtonElement;
const extractOut = document.getElementById('extractOut') as HTMLDivElement;
const questionEl = document.getElementById('question') as HTMLInputElement;
const runBtn = document.getElementById('runBtn') as HTMLButtonElement;
const logEl = document.getElementById('log') as HTMLDivElement;
const replyEl = document.getElementById('reply') as HTMLDivElement;

let extractSession: LanguageModelSession | null = null;
let toolSession: LanguageModelSession | null = null;
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
  extractBtn.disabled = true;
  runBtn.disabled = true;
}

// --- The JSON Schemas that constrain each part ---
type Extraction = {
  sentiment: 'positive' | 'neutral' | 'negative';
  topics: string[];
  summary: string;
};

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
    topics: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['sentiment', 'topics', 'summary'],
} as const;

type Step = { toolName: string; args?: Record<string, unknown>; reply?: string };

const INTENT_SCHEMA = {
  type: 'object',
  required: ['toolName'],
  additionalProperties: false,
  properties: {
    toolName: { type: 'string', description: 'Tool to call next, or "done" to reply.' },
    args: { type: 'object', description: 'Arguments object for the tool.' },
    reply: { type: 'string', description: 'Final answer — only when toolName is "done".' },
  },
} as const;

// --- Local tools. Each takes an args object and returns a STRING. ---
type ToolFn = (args: any) => string;

const TOOLS: Record<string, ToolFn> = {
  getWeather({ city }: { city?: string }) {
    const key = String(city == null ? '' : city).trim().toLowerCase();
    const table: Record<string, { tempC: number; sky: string }> = {
      'tel aviv': { tempC: 29, sky: 'sunny' },
      london: { tempC: 14, sky: 'light rain' },
      tokyo: { tempC: 22, sky: 'cloudy' },
      'new york': { tempC: 18, sky: 'clear' },
      berlin: { tempC: 12, sky: 'overcast' },
    };
    const hit = table[key] || { tempC: 20, sky: 'clear' };
    return JSON.stringify({ city: city || 'unknown', tempC: hit.tempC, sky: hit.sky });
  },
  calculate({ expression }: { expression?: string }) {
    // Demo-only evaluator: whitelist digits and arithmetic, then eval.
    const safe = String(expression == null ? '' : expression).replace(/[^0-9+\-*/().\s]/g, '');
    if (!safe.trim()) return JSON.stringify({ error: 'empty expression' });
    try {
      const result = Function('"use strict"; return (' + safe + ');')();
      return JSON.stringify({ expression, result });
    } catch (e) {
      return JSON.stringify({ error: 'invalid expression' });
    }
  },
};

const TOOL_SYSTEM = [
  'You are a small assistant that answers by calling tools.',
  'Emit ONE JSON object per turn and nothing else — no prose, no code fences.',
  '',
  'Tools you can call:',
  '- getWeather — args: { "city": string }. Current weather for a city.',
  '- calculate — args: { "expression": string }. Evaluate an arithmetic expression (convert percentages to multiplication, e.g. 15% of 240 -> 0.15 * 240).',
  '',
  'Call ONE tool per turn. After you receive its result, either call another tool or finish.',
  'When you can answer, emit { "toolName": "done", "reply": "<your answer>" }.',
].join('\n');

// --- Fence-stripping JSON parse. Even with responseFormat some builds wrap
// JSON in a fenced block; peel it off before parsing. 3 tiers:
// direct parse -> strip a ```json ... ``` fence -> extract the first { ... }.
function parseJson<T>(text: string): T | null {
  const s = String(text == null ? '' : text).trim();
  try {
    return JSON.parse(s) as T;
  } catch (e) {
    /* fall through */
  }
  const fenced = s.match(/^`{3}(?:json)?\s*\n?([\s\S]*?)\n?`{3}$/);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch (e) {
      /* fall through */
    }
  }
  const braces = s.match(/\{[\s\S]*\}/);
  if (braces) {
    try {
      return JSON.parse(braces[0]) as T;
    } catch (e) {
      /* give up */
    }
  }
  return null;
}

// --- Session creation: always outputLanguage:'en' + a download monitor. ---
async function createSession(
  opts: LanguageModelCreateOptions,
): Promise<LanguageModelSession> {
  dlEl.hidden = false;
  dlEl.value = 0;
  const session = await LanguageModel.create({
    ...opts,
    outputLanguage: 'en', // always — this is load-bearing
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // 0..1 fraction, no e.total in current builds
        setStatus('Downloading model… ' + Math.round(e.loaded * 100) + '%', 'warn');
      });
    },
  });
  dlEl.hidden = true;
  return session;
}

async function getExtractSession(): Promise<LanguageModelSession> {
  if (!extractSession) {
    extractSession = await createSession({
      initialPrompts: [
        {
          role: 'system',
          content: 'You extract structured data from short text. Reply with JSON only.',
        },
      ],
    });
  }
  return extractSession;
}

async function getToolSession(): Promise<LanguageModelSession> {
  if (!toolSession) {
    toolSession = await createSession({
      responseFormat: INTENT_SCHEMA,
      initialPrompts: [{ role: 'system', content: TOOL_SYSTEM }],
    });
  }
  return toolSession;
}

// --- Part A: constrain -> parse -> render ---
async function runExtract(): Promise<void> {
  const text = reviewEl.value.trim();
  if (!text || busy) return;
  busy = true;
  extractBtn.disabled = true;
  extractOut.textContent = '';
  setStatus('Extracting…', 'warn');
  try {
    const session = await getExtractSession();
    const raw = await session.prompt(
      'Extract the sentiment, the main topics, and a one-line summary of this text:\n\n' + text,
      { responseFormat: EXTRACT_SCHEMA },
    );
    const data = parseJson<Extraction>(raw);
    if (!data || typeof data.sentiment !== 'string') {
      extractOut.textContent = 'Could not parse a result. Raw output:\n\n' + raw;
      setStatus('Parse failed — see the raw output.', 'warn');
    } else {
      renderExtraction(data);
      setStatus('Done.', 'ok');
    }
  } catch (e) {
    extractOut.textContent = 'Error: ' + errMessage(e);
    setStatus('Error: ' + errName(e) + '.', 'err');
  } finally {
    busy = false;
    extractBtn.disabled = false;
  }
}

function renderExtraction(data: Extraction): void {
  extractOut.textContent = '';

  const sentiment = document.createElement('div');
  sentiment.className = 'kv';
  const label = document.createElement('b');
  label.textContent = 'sentiment: ';
  const chip = document.createElement('span');
  const kind = ['positive', 'neutral', 'negative'].includes(data.sentiment)
    ? data.sentiment
    : 'neutral';
  chip.className = 'chip ' + kind;
  chip.textContent = data.sentiment;
  sentiment.appendChild(label);
  sentiment.appendChild(chip);

  const topics = document.createElement('div');
  topics.className = 'kv';
  const tLabel = document.createElement('b');
  tLabel.textContent = 'topics: ';
  topics.appendChild(tLabel);
  const tags = document.createElement('span');
  tags.className = 'tags';
  (Array.isArray(data.topics) ? data.topics : []).forEach((t) => {
    const tag = document.createElement('span');
    tag.className = 'chip';
    tag.textContent = String(t);
    tags.appendChild(tag);
  });
  topics.appendChild(tags);

  const summary = document.createElement('div');
  summary.className = 'kv';
  const sLabel = document.createElement('b');
  sLabel.textContent = 'summary: ';
  summary.appendChild(sLabel);
  summary.appendChild(document.createTextNode(String(data.summary || '')));

  extractOut.appendChild(sentiment);
  extractOut.appendChild(topics);
  extractOut.appendChild(summary);
}

// --- Part B: the intent loop ---
async function runAgent(): Promise<void> {
  const question = questionEl.value.trim();
  if (!question || busy) return;
  busy = true;
  runBtn.disabled = true;
  logEl.textContent = '';
  replyEl.textContent = '';
  setStatus('Thinking…', 'warn');
  try {
    const session = await getToolSession();
    let next = question;
    let finished = false;

    for (let i = 0; i < MAX_STEPS; i++) {
      const raw = await session.prompt(next);
      const step = parseJson<Step>(raw);

      if (!step || typeof step.toolName !== 'string') {
        logStep(i + 1, '(parse failed)', {}, raw);
        replyEl.textContent = raw;
        finished = true;
        break;
      }

      if (step.toolName === 'done') {
        replyEl.textContent = step.reply || '(no reply)';
        finished = true;
        break;
      }

      const args =
        step.args && typeof step.args === 'object' ? step.args : {};
      const tool = TOOLS[step.toolName];
      const result = tool
        ? tool(args)
        : JSON.stringify({ error: 'unknown tool "' + step.toolName + '"' });

      logStep(i + 1, step.toolName, args, result);

      next =
        'Result of ' +
        step.toolName +
        '(' +
        JSON.stringify(args) +
        '): ' +
        result +
        '. Now call the next tool, or emit {"toolName":"done","reply":"..."}.';
    }

    if (!finished) {
      replyEl.textContent =
        'Stopped after ' + MAX_STEPS + ' steps without a final reply.';
    }
    setStatus('Done.', 'ok');
  } catch (e) {
    replyEl.textContent = 'Error: ' + errMessage(e);
    setStatus('Error: ' + errName(e) + '.', 'err');
  } finally {
    busy = false;
    runBtn.disabled = false;
  }
}

function logStep(
  n: number,
  toolName: string,
  args: Record<string, unknown>,
  result: string,
): void {
  const row = document.createElement('div');
  row.className = 'step';
  row.textContent =
    '#' + n + '  ' + toolName + '(' + JSON.stringify(args) + ')  →  ' + result;
  logEl.appendChild(row);
}

// --- Feature-detect + availability() gate before anything else. ---
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
    degrade('<code>availability()</code> threw: ' + errMessage(e) + '.');
    return;
  }
  if (status === 'unavailable') {
    degrade('Built-in AI reports <code>unavailable</code> on this device.');
    return;
  }
  if (status === 'available') {
    setStatus('Model ready. Try Extract, then Run.', 'ok');
  } else {
    setStatus(
      'Model needs a one-time download (a few GB). It starts on your first Extract or Run.',
      'warn',
    );
  }
  extractBtn.disabled = false;
  runBtn.disabled = false;
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

extractBtn.addEventListener('click', () => void runExtract());
runBtn.addEventListener('click', () => void runAgent());

// Free GPU memory on teardown.
window.addEventListener('beforeunload', () => {
  if (extractSession) extractSession.destroy();
  if (toolSession) toolSession.destroy();
});

void init();
