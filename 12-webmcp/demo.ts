// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. Two ambient surfaces are declared self-contained
// below: Chrome's Prompt API (`LanguageModel`) and WebMCP (`document.modelContext`).
// In a real project, @types/dom-chromium-ai ships the Prompt API declarations;
// WebMCP has no published types yet, so the ambient block here matches the shape
// Chrome ships.

// --- Ambient surface 1: Chrome's built-in Prompt API (current stable) --------
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

interface LanguageModelSession {
  prompt(
    input: string,
    options?: { responseConstraint?: object; signal?: AbortSignal },
  ): Promise<string>;
  destroy(): void;
}

declare const LanguageModel: {
  availability(options?: Partial<LanguageModelCreateOptions>): Promise<Availability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};

// --- Ambient surface 2: WebMCP. Mirrors chat/src/app/types/webmcp.d.ts.
// The page's tools live on `document.modelContext`, augmented onto the DOM lib types.
interface ModelContextTool {
  name: string;
  description: string;
  inputSchema?: object; // JSON Schema for the input object
  annotations?: { readOnlyHint?: boolean };
  // Handler input is dynamic per-tool; returns Promise<unknown> (or unknown).
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown;
}

interface ModelContextRegisterToolOptions {
  signal?: AbortSignal; // abort to unregister — portable across Chrome 146-150
}

interface ModelContext {
  registerTool(tool: ModelContextTool, options?: ModelContextRegisterToolOptions): void;
  // Chrome 150+ only — the AbortSignal path above works everywhere.
  unregisterTool?(name: string): void;
  clearContext?(): void;
}

interface Document {
  readonly modelContext?: ModelContext;
}

// --- Demo logic (typed mirror of the inline script in index.html) ------------
const LESSON_URL = 'https://danduh.me/courses/chrome-built-in-ai/webmcp';
const SETUP_URL = 'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/webmcp';
const WEBMCP_FLAG = 'chrome://flags/#enable-webmcp-testing';
const MAX_STEPS = 8;

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const itemNameEl = document.getElementById('itemName') as HTMLInputElement;
const addBtn = document.getElementById('addBtn') as HTMLButtonElement;
const resetBtn = document.getElementById('resetBtn') as HTMLButtonElement;
const cartEl = document.getElementById('cart') as HTMLUListElement;
const toolsHeaderEl = document.getElementById('toolsHeader') as HTMLDivElement;
const toolsEl = document.getElementById('tools') as HTMLUListElement;
const toolsNoteEl = document.getElementById('toolsNote') as HTMLDivElement;
const promptEl = document.getElementById('prompt') as HTMLInputElement;
const runBtn = document.getElementById('runBtn') as HTMLButtonElement;
const logEl = document.getElementById('log') as HTMLDivElement;
const replyEl = document.getElementById('reply') as HTMLDivElement;

type CartItem = { name: string; qty: number };

// The page state. One array. The tools and the buttons share it.
let cart: CartItem[] = [];
let modelContext: ModelContext | null = null; // resolved from document.modelContext in init()
let controller: AbortController | null = null; // governs every registration
let session: LanguageModelSession | null = null; // the in-page LanguageModel agent
let busy = false;

function setStatus(html: string, kind?: 'ok' | 'warn' | 'err'): void {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.innerHTML = html;
}

// --- Cart helpers ------------------------------------------------------------
function cartSummary(): string {
  if (cart.length === 0) return '(empty)';
  return cart.map((i) => i.name + '\u00d7' + i.qty).join(', ');
}

function renderCart(): void {
  cartEl.textContent = '';
  if (cart.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Cart is empty.';
    cartEl.appendChild(li);
    return;
  }
  cart.forEach((item) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = item.name;
    const qty = document.createElement('span');
    qty.className = 'qty';
    qty.textContent = '\u00d7 ' + item.qty;
    li.appendChild(name);
    li.appendChild(qty);
    cartEl.appendChild(li);
  });
}

// --- The WebMCP tool descriptors. This ONE array is the source of truth: it is
// registered on document.modelContext (for external agents) AND the in-page loop
// dispatches into it (for the LanguageModel agent). Each execute returns
// Promise<unknown> per the WebMCP contract.
const CART_TOOLS: ModelContextTool[] = [
  {
    name: 'addItem',
    description:
      'Add an item to the cart. If the item is already there, its quantity is increased. qty defaults to 1.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Item name, e.g. "milk"' },
        qty: { type: 'integer', minimum: 1, description: '(optional) how many; defaults to 1' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    async execute(input: Record<string, unknown>): Promise<unknown> {
      const name = String(input && input.name != null ? input.name : '').trim();
      if (!name) return { error: 'name is required' };
      const qty = Math.max(1, Math.floor(Number(input && input.qty != null ? input.qty : 1)) || 1);
      const found = cart.find((i) => i.name.toLowerCase() === name.toLowerCase());
      if (found) found.qty += qty;
      else cart.push({ name, qty });
      renderCart();
      return 'Added ' + qty + ' \u00d7 "' + name + '". Cart: ' + cartSummary() + '.';
    },
  },
  {
    name: 'removeItem',
    description: 'Remove an item from the cart by name (case-insensitive substring match).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Item name to remove' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    async execute(input: Record<string, unknown>): Promise<unknown> {
      const q = String(input && input.name != null ? input.name : '').trim().toLowerCase();
      if (!q) return { error: 'name is required' };
      const before = cart.length;
      cart = cart.filter((i) => !i.name.toLowerCase().includes(q));
      renderCart();
      if (cart.length === before) return 'No item matched "' + q + '". Cart: ' + cartSummary() + '.';
      return 'Removed items matching "' + q + '". Cart: ' + cartSummary() + '.';
    },
  },
  {
    name: 'listItems',
    description: 'List the current cart contents. Read-only.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    async execute(): Promise<unknown> {
      // Returns an object — the agent loop stringifies it. That coercion,
      // Promise<unknown> -> string, is the WebMCP-to-LanguageModel bridge.
      return { items: cart.map((i) => ({ name: i.name, qty: i.qty })), count: cart.length };
    },
  },
];

// --- Register every tool under one AbortController. controller.abort()
// unregisters the whole set (portable across Chrome 146-150). -----------------
const DUPLICATE_NAME_PATTERN = /duplicate tool name|already registered/i;

function registerTools(): number {
  const mc = modelContext;
  if (!mc) return 0;
  controller = new AbortController();
  let registered = 0;
  for (const tool of CART_TOOLS) {
    try {
      mc.registerTool(tool, { signal: controller.signal });
      registered++;
    } catch (e) {
      // Double-register throws "duplicate tool name" — treat as already-there.
      if (DUPLICATE_NAME_PATTERN.test(e instanceof Error ? e.message : '')) {
        registered++;
        continue;
      }
      throw e;
    }
  }
  return registered;
}

function renderTools(registeredCount: number): void {
  toolsEl.textContent = '';
  CART_TOOLS.forEach((tool) => {
    const li = document.createElement('li');
    li.dataset.tool = tool.name;
    const code = document.createElement('code');
    code.textContent = tool.name;
    li.appendChild(code);
    if (tool.annotations && tool.annotations.readOnlyHint) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'read-only';
      li.appendChild(badge);
    }
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = tool.description;
    li.appendChild(desc);
    toolsEl.appendChild(li);
  });
  if (registeredCount > 0) {
    toolsHeaderEl.innerHTML =
      '\u2713 ' + registeredCount + ' tools registered on <code>document.modelContext</code>.';
  } else {
    toolsHeaderEl.innerHTML = 'WebMCP off — tools not registered. The cart still works.';
  }
}

function markLiveTool(name: string | null): void {
  Array.from(toolsEl.children).forEach((el) => {
    (el as HTMLElement).classList.toggle('live', (el as HTMLElement).dataset.tool === name);
  });
}

// --- The intent-loop schema and system prompt (same shape as lesson 4). ------
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

const SYSTEM_PROMPT = [
  'You drive a shopping cart by calling tools.',
  'Emit ONE JSON object per turn and nothing else — no prose, no code fences.',
  '',
  'Tools you can call:',
  '- addItem — args: { "name": string, "qty": integer (optional, default 1) }.',
  '- removeItem — args: { "name": string }.',
  '- listItems — args: {}. Returns the current cart.',
  '',
  'Call ONE tool per turn. After you receive its result, either call another tool or finish.',
  'When the request is fully handled, emit { "toolName": "done", "reply": "<short summary>" }.',
].join('\n');

// --- Fence-stripping JSON parse. The model still fences JSON sometimes. -------
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

// --- Session creation: expectedInputs/expectedOutputs declare languages + a download monitor. ------
async function getSession(): Promise<LanguageModelSession> {
  if (session) return session;
  dlEl.hidden = false;
  dlEl.value = 0;
  session = await LanguageModel.create({
    expectedInputs:  [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // 0..1 fraction, no e.total in current builds
        setStatus('Downloading model\u2026 ' + Math.round(e.loaded * 100) + '%', 'warn');
      });
    },
  });
  dlEl.hidden = true;
  return session;
}

// --- The agent loop: prompt -> parse -> run a registered tool -> feed back. ---
async function runAgent(): Promise<void> {
  const question = promptEl.value.trim();
  if (!question || busy) return;
  busy = true;
  runBtn.disabled = true;
  logEl.textContent = '';
  replyEl.textContent = '';
  setStatus('Thinking\u2026', 'warn');
  try {
    const s = await getSession();
    let next = question;
    let finished = false;

    for (let i = 0; i < MAX_STEPS; i++) {
      // responseConstraint (the intent JSON Schema) rides on prompt(), not create().
      const step = parseJson<Step>(await s.prompt(next, { responseConstraint: INTENT_SCHEMA }));

      if (!step || typeof step.toolName !== 'string') {
        logStep(i + 1, '(parse failed)', {}, '');
        replyEl.textContent = 'Could not parse a tool call.';
        finished = true;
        break;
      }

      if (step.toolName === 'done') {
        replyEl.textContent = step.reply || '(no reply)';
        finished = true;
        break;
      }

      const args = step.args && typeof step.args === 'object' ? step.args : {};
      const tool = CART_TOOLS.find((t) => t.name === step.toolName);

      markLiveTool(step.toolName);
      let result: string;
      if (tool) {
        const raw = await tool.execute(args); // Promise<unknown>
        result = typeof raw === 'string' ? raw : JSON.stringify(raw);
      } else {
        result = JSON.stringify({ error: 'unknown tool "' + step.toolName + '"' });
      }
      markLiveTool(null);

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
      replyEl.textContent = 'Stopped after ' + MAX_STEPS + ' steps without a final reply.';
    }
    setStatus('Done.', 'ok');
  } catch (e) {
    replyEl.textContent = 'Error: ' + errMessage(e);
    setStatus('Error: ' + errName(e) + '.', 'err');
  } finally {
    markLiveTool(null);
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
    '#' + n + '  ' + toolName + '(' + JSON.stringify(args) + ')  \u2192  ' + result;
  logEl.appendChild(row);
}

function errName(e: unknown): string {
  return e instanceof Error ? e.name : 'Error';
}
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message || e.name : String(e);
}

// --- Manual buttons prove the tools and the UI share one state. --------------
addBtn.addEventListener('click', () => {
  const name = itemNameEl.value.trim();
  if (!name) return;
  void CART_TOOLS[0].execute({ name, qty: 1 });
  itemNameEl.value = '';
});
resetBtn.addEventListener('click', () => {
  cart = [];
  renderCart();
});
runBtn.addEventListener('click', () => void runAgent());

// --- Feature-detect BOTH document.modelContext AND LanguageModel. ------------
async function init(): Promise<void> {
  renderCart();

  // 1) WebMCP entry point. The page's tools live on document.modelContext.
  modelContext = document.modelContext ?? null;
  if (!modelContext) {
    renderTools(0);
    toolsNoteEl.innerHTML =
      'Enable <code>' +
      WEBMCP_FLAG +
      '</code> in desktop Chrome to expose tools, or open the <a href="' +
      LIVE_DEMO_URL +
      '">hosted demo</a>.';
  } else {
    try {
      const count = registerTools();
      renderTools(count);
    } catch (e) {
      renderTools(0);
      toolsNoteEl.textContent = 'Tool registration failed: ' + errMessage(e);
    }
  }

  // 2) The in-page agent needs the LanguageModel global + availability().
  if (typeof LanguageModel === 'undefined') {
    setStatus(
      'No built-in <code>LanguageModel</code> here, so the agent is off. You need ' +
        'desktop Chrome with built-in AI — see <a href="' +
        SETUP_URL +
        '">Setup</a>, or the <a href="' +
        LIVE_DEMO_URL +
        '">hosted demo</a>.',
      modelContext ? 'warn' : 'err',
    );
    return;
  }
  let status: Availability;
  try {
    status = await LanguageModel.availability();
  } catch (e) {
    setStatus('<code>availability()</code> threw: ' + errMessage(e) + '.', 'err');
    return;
  }
  if (status === 'unavailable') {
    setStatus(
      'Built-in AI reports <code>unavailable</code> on this device. Work through ' +
        '<a href="' +
        SETUP_URL +
        '">Setup</a>, or try the <a href="' +
        LIVE_DEMO_URL +
        '">hosted demo</a>.',
      'err',
    );
    return;
  }
  if (status === 'available') {
    setStatus('Model ready. Edit the request and hit Run agent.', 'ok');
  } else {
    setStatus('Model needs a one-time download (a few GB). It starts on your first Run agent.', 'warn');
  }
  runBtn.disabled = false;
}

// Free GPU memory AND unregister every tool on teardown.
window.addEventListener('beforeunload', () => {
  if (controller) controller.abort(); // unregisters the whole tool set
  if (session) session.destroy(); // frees the model session
});

void init();
