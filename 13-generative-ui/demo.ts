// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The @types/dom-chromium-ai package ships fuller
// declarations for LanguageModel; the minimal ambient surface below keeps this
// file self-contained.

// --- Minimal ambient surface for Chrome's built-in Prompt API (current stable) ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
type Role = 'system' | 'user' | 'assistant';

interface DownloadMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (e: ProgressEvent) => void,
  ): void;
}

interface LanguageModelCreateOptions {
  expectedInputs?: Array<{ type: 'text' | 'image' | 'audio'; languages?: string[] }>;
  expectedOutputs?: Array<{ type: 'text'; languages?: string[] }>;
  initialPrompts?: Array<{ role: Role; content: string }>;
  signal?: AbortSignal;
  monitor?: (m: DownloadMonitor) => void;
}

interface PromptOptions {
  responseConstraint?: object; // JSON Schema, passed per call
  signal?: AbortSignal;
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

// --- MCP Apps (SEP-1865) tool-result shape ---
// A UI-returning tool answers with model-readable `content` PLUS a nested
// `_meta.ui.resourceUri` (an McpUiToolMeta object) the host resolves to sandboxed
// markup. The old flat `_meta["ui/resourceUri"]` (with a slash) is deprecated.
interface UIResource {
  content: Array<{ type: 'text'; text: string }>;
  _meta: { ui: { resourceUri: string } };
}
type ToolResult = UIResource | string;

interface FormField {
  name?: string;
  label?: string;
  type?: string;
}
interface FormSpec {
  title?: string;
  submitLabel?: string;
  fields?: FormField[] | null;
}

type Step = { toolName: string; args?: Record<string, unknown>; reply?: string };

// --- Demo logic (typed mirror of the inline script in index.html) ---
const LESSON_URL = 'https://danduh.me/courses/chrome-built-in-ai/generative-ui';
const SETUP_URL = 'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/generative-ui';
const MAX_STEPS = 6;

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const questionEl = document.getElementById('question') as HTMLInputElement;
const runBtn = document.getElementById('runBtn') as HTMLButtonElement;
const replyEl = document.getElementById('reply') as HTMLDivElement;
const uiFrame = document.getElementById('ui') as HTMLIFrameElement;
const cannedBtn = document.getElementById('cannedBtn') as HTMLButtonElement;
const eventsEl = document.getElementById('events') as HTMLDivElement;

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
      '">hosted demo</a>. The canned example below still works without a model.',
    'err',
  );
  runBtn.disabled = true;
  // cannedBtn stays enabled — the sandbox + postMessage round-trip needs no model.
}

function logEvent(tag: string, text: string): void {
  const row = document.createElement('div');
  row.className = 'row';
  const t = document.createElement('span');
  t.className = 'tag';
  t.textContent = tag;
  row.appendChild(t);
  row.appendChild(document.createTextNode(' ' + text));
  eventsEl.appendChild(row);
}

// --- HTML escaping. Anything the model puts into markup MUST be escaped ---
// before it lands in the iframe srcdoc — the model's output is untrusted.
function escapeHtml(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- The UI resource registry. A UI-returning tool stores its markup here, ---
// keyed by a ui:// token; the host looks it up when it renders the iframe.
const uiRegistry = new Map<string, string>();

// --- Build the tool's returned UI: a small self-contained form document. ---
// The inner script's closing tag is written as <\/script> so this outer page
// parser doesn't end the script early; the string still closes cleanly.
function renderFormHtml(spec: FormSpec): string {
  const title = escapeHtml(spec.title ? spec.title : 'Quick form');
  const submitLabel = escapeHtml(spec.submitLabel ? spec.submitLabel : 'Submit');
  const fields: FormField[] =
    Array.isArray(spec.fields) && spec.fields.length
      ? spec.fields
      : [
          { name: 'name', label: 'Your name', type: 'text' },
          { name: 'email', label: 'Email', type: 'email' },
        ];
  const rows = fields
    .map((f) => {
      const name = escapeHtml(f.name ? f.name : 'field');
      const label = escapeHtml(f.label ? f.label : f.name || 'Field');
      const type = escapeHtml(f.type ? f.type : 'text');
      return (
        '<label>' + label + '<input name="' + name + '" type="' + type + '" /></label>'
      );
    })
    .join('');
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    // Defense in depth: even inside the sandbox, lock the document down.
    '<meta http-equiv="Content-Security-Policy" ',
    'content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">',
    '<style>',
    'body{font:14px system-ui,-apple-system,sans-serif;margin:0;padding:12px;color:#111}',
    '@media (prefers-color-scheme:dark){body{color:#eee;background:#1f2430}}',
    'h2{font-size:1rem;margin:.1rem 0 .6rem}',
    'label{display:block;margin:.5rem 0;font-size:.85rem}',
    'input{display:block;width:100%;padding:.4rem;margin-top:.2rem;box-sizing:border-box}',
    'button{margin-top:.6rem;padding:.45rem .9rem;font:inherit;cursor:pointer}',
    '</style></head><body>',
    '<h2>' + title + '</h2>',
    '<form id="f">' + rows + '<button type="submit">' + submitLabel + '</button></form>',
    '<script>',
    'document.getElementById("f").addEventListener("submit",function(e){',
    '  e.preventDefault();',
    '  var values={};',
    '  new FormData(e.target).forEach(function(v,k){values[k]=v;});',
    // JSON-RPC 2.0 envelope up to the host. "ui/submit" is this demo's own name;
    // real MCP Apps posts a tools/call back — same envelope, same source check.
    '  parent.postMessage({jsonrpc:"2.0",method:"ui/submit",params:{values:values}},"*");',
    '  var b=e.target.querySelector("button");b.textContent="Sent";b.disabled=true;',
    '},false);',
    '<\/script>',
    '</body></html>',
  ].join('');
}

// --- Tools, keyed by name. renderForm RETURNS UI, not a string. ---
const TOOLS: Record<string, (args: Record<string, unknown>) => ToolResult> = {
  // MCP Apps shape: model-readable `content` + nested `_meta.ui.resourceUri`.
  renderForm(args: Record<string, unknown>): UIResource {
    const spec: FormSpec = {
      title: args.title ? String(args.title) : 'Quick form',
      submitLabel: args.submitLabel ? String(args.submitLabel) : 'Submit',
      fields: Array.isArray(args.fields) ? (args.fields as FormField[]) : null,
    };
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : String(Date.now());
    const uri = 'ui://gen-ui/form/' + id;
    uiRegistry.set(uri, renderFormHtml(spec));
    return {
      content: [{ type: 'text', text: 'Rendered a form titled "' + spec.title + '".' }],
      _meta: { ui: { resourceUri: uri } },
    };
  },
};

const TOOL_SYSTEM = [
  'You help users by rendering small interactive UI widgets in the browser.',
  'Emit ONE JSON object per turn and nothing else — no prose, no code fences.',
  '',
  'Tools you can call:',
  '- renderForm — args: { "title": string, "submitLabel": string }. Renders an',
  '  interactive form the user fills in. Use it whenever the user wants to book,',
  '  sign up, register, or submit details.',
  '',
  'Call renderForm ONCE for such a request. After its result arrives, emit',
  '{ "toolName": "done", "reply": "Fill in the form above and submit it." }.',
  'When the user later sends their submitted form values, confirm them in one',
  'friendly sentence with { "toolName": "done", "reply": "..." }.',
].join('\n');

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

// --- Fence-stripping JSON parse (same guard as the tool-calling lesson). ---
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

// --- Session creation: expectedInputs/expectedOutputs declare languages + a download monitor. ---
async function createSession(
  opts: LanguageModelCreateOptions,
): Promise<LanguageModelSession> {
  dlEl.hidden = false;
  dlEl.value = 0;
  const session = await LanguageModel.create({
    ...opts,
    expectedInputs:  [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // e.loaded is a 0..1 fraction (e.total is always 1)
        setStatus('Downloading model… ' + Math.round(e.loaded * 100) + '%', 'warn');
      });
    },
  });
  dlEl.hidden = true;
  return session;
}

async function getToolSession(): Promise<LanguageModelSession> {
  if (!toolSession) {
    toolSession = await createSession({
      initialPrompts: [{ role: 'system', content: TOOL_SYSTEM }],
    });
  }
  return toolSession;
}

// --- Render a ui:// resource into the sandboxed iframe. ---
function renderResource(uri: string): void {
  const html = uiRegistry.get(uri);
  if (!html) {
    logEvent('host', 'no markup registered for ' + uri);
    return;
  }
  // srcdoc — never innerHTML into your own DOM. A fresh document, sandboxed.
  uiFrame.srcdoc = html;
  logEvent('render', 'rendered ' + uri + ' in <iframe sandbox="allow-scripts">');
}

// --- The intent loop. When a tool result carries a ui:// resource, render ---
// it and feed back ONLY { content } so ui:// never enters the model context.
async function driveLoop(
  session: LanguageModelSession,
  firstPrompt: string,
): Promise<void> {
  let next = firstPrompt;
  for (let i = 0; i < MAX_STEPS; i++) {
    // Invariant, actually enforced: the literal ui:// must NEVER reach
    // session.prompt(). console.assert only logs, so throw to really block it.
    if (next.indexOf('ui://') !== -1) throw new Error('ui:// leaked into the model prompt');

    // responseConstraint rides on each prompt(), not create().
    const raw = await session.prompt(next, { responseConstraint: INTENT_SCHEMA });
    const step = parseJson<Step>(raw);

    if (!step || typeof step.toolName !== 'string') {
      replyEl.textContent = raw;
      return;
    }
    if (step.toolName === 'done') {
      replyEl.textContent = step.reply || '(no reply)';
      return;
    }

    const args: Record<string, unknown> =
      step.args && typeof step.args === 'object' ? step.args : {};
    const tool = TOOLS[step.toolName];
    if (!tool) {
      next =
        'Tool "' +
        step.toolName +
        '" is not registered. Call renderForm, or emit {"toolName":"done","reply":"..."}.';
      continue;
    }

    const result = tool(args);

    // MCP Apps interceptor: an object result carrying _meta.ui.resourceUri
    // is a UI resource; a plain string is an ordinary tool result.
    let back: string;
    if (typeof result === 'object') {
      const uri = result._meta.ui.resourceUri;
      renderResource(uri);
      // Feed back ONLY { content } — the ui:// URI is intentionally stripped.
      back = JSON.stringify({ content: result.content });
      logEvent('tool', step.toolName + ' → UI resource (stripped before model)');
    } else {
      back = result; // plain string tool result
      logEvent('tool', step.toolName + ' → ' + back);
    }

    next =
      'Tool "' +
      step.toolName +
      '" result: ' +
      back +
      '. Now emit {"toolName":"done","reply":"..."}.';
  }
  replyEl.textContent = 'Stopped after ' + MAX_STEPS + ' steps without a reply.';
}

// --- Part 1: run the model loop. ---
async function runAgent(): Promise<void> {
  const question = questionEl.value.trim();
  if (!question || busy) return;
  busy = true;
  runBtn.disabled = true;
  replyEl.textContent = '';
  setStatus('Thinking…', 'warn');
  try {
    const session = await getToolSession();
    await driveLoop(session, question);
    setStatus('Done. Submit the form to close the loop.', 'ok');
  } catch (e) {
    replyEl.textContent = 'Error: ' + errMessage(e);
    setStatus('Error: ' + errName(e) + '.', 'err');
  } finally {
    busy = false;
    runBtn.disabled = false;
  }
}

// --- Part 2: render the same tool output with no model at all. ---
function showCanned(): void {
  const result = TOOLS.renderForm({ title: 'Book a demo slot', submitLabel: 'Book it' });
  const uri = (result as UIResource)._meta.ui.resourceUri;
  logEvent('canned', 'called renderForm() directly, got ' + uri);
  renderResource(uri);
  replyEl.textContent = '';
  setStatus('Canned UI rendered. Fill it in and submit.', 'ok');
}

// --- The postMessage channel home. VALIDATE the source, not the origin. ---
// Sandboxed srcdoc iframes post with event.origin === "null", so an origin
// string check is useless here — check the source window object instead.
function onFrameMessage(event: MessageEvent): void {
  if (event.source !== uiFrame.contentWindow) return; // not our iframe — drop it
  const data = event.data as
    | { jsonrpc?: string; method?: string; params?: { values?: Record<string, string> } }
    | null;
  if (!data || data.jsonrpc !== '2.0') return; // not our protocol — drop it
  if (data.method === 'ui/submit') {
    const values = (data.params && data.params.values) || {};
    logEvent('message', 'ui/submit from iframe (source verified) ' + JSON.stringify(values));
    void handleSubmit(values);
  }
}

async function handleSubmit(values: Record<string, string>): Promise<void> {
  const summary = Object.keys(values)
    .map((k) => k + ': ' + values[k])
    .join(', ');
  // If a model session exists, feed the values back into the loop for a
  // confirmation. Otherwise (canned path) just show what came home.
  if (toolSession && !busy) {
    busy = true;
    setStatus('Confirming…', 'warn');
    try {
      await driveLoop(
        toolSession,
        'The user submitted the form with these values: ' +
          JSON.stringify(values) +
          '. Confirm it back to them in one sentence.',
      );
      setStatus('Done.', 'ok');
    } catch (e) {
      replyEl.textContent = 'Error: ' + errMessage(e);
      setStatus('Error: ' + errName(e) + '.', 'err');
    } finally {
      busy = false;
    }
  } else {
    replyEl.textContent = 'Received from the sandbox — ' + summary;
  }
}

// --- Feature-detect + availability() gate before any create(). ---
async function init(): Promise<void> {
  cannedBtn.disabled = false; // the canned round-trip needs no model
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
    setStatus('Model ready. Try Run, or the canned example.', 'ok');
  } else {
    setStatus(
      'Model needs a one-time download (a few GB). It starts on your first Run.',
      'warn',
    );
  }
  runBtn.disabled = false;
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

runBtn.addEventListener('click', () => void runAgent());
cannedBtn.addEventListener('click', () => showCanned());
window.addEventListener('message', onFrameMessage);

// Free GPU memory on teardown.
window.addEventListener('beforeunload', () => {
  if (toolSession) toolSession.destroy();
});

void init();
