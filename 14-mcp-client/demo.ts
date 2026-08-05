// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The browser is an MCP CLIENT: it speaks raw
// JSON-RPC 2.0 over Streamable HTTP (fetch) to an MCP server, then Chrome's
// built-in `LanguageModel` (Gemini Nano) drives the discovered tools through a
// responseConstraint intent loop. A default in-page "mock server" runs the whole
// path offline; switching to a remote URL is CORS-gated.

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

interface LanguageModelSession {
  prompt(input: string, options?: { responseConstraint?: object; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}

declare const LanguageModel: {
  availability(options?: Partial<LanguageModelCreateOptions>): Promise<Availability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};

// --- MCP wire + domain types ---
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: number | null;
  result?: any;
  error?: { code: number; message: string };
}

// One primitive per transport — send(request) -> response — so the client code
// is identical for the mock and remote servers.
interface Transport {
  label: string;
  send(request: JsonRpcRequest): Promise<JsonRpcResponse | null>;
  close(): void;
}

interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface McpConnection {
  serverName: string;
  serverVersion: string;
  capabilities: string[];
  tools: McpToolInfo[];
}

// --- Constants ---
const LESSON_URL = 'https://danduh.me/courses/chrome-built-in-ai/mcp-client';
const SETUP_URL = 'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/mcp-client';
const MAX_TOOL_CALLS = 8;
// Modern MCP (revision 2026-07-28): no initialize handshake, no protocol-level
// session. Every request declares this version in its _meta and (over HTTP) in
// an MCP-Protocol-Version header.
const PROTOCOL_VERSION = '2026-07-28';
const CLIENT_INFO = { name: 'chrome-ai-course-mcp-client', version: '0.1.0' };

// The same language options go to availability() and create() — a narrower
// availability() answer than the option-less call would give.
const LANGUAGE_OPTS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const remoteFields = document.getElementById('remoteFields') as HTMLDivElement;
const urlEl = document.getElementById('url') as HTMLInputElement;
const tokenEl = document.getElementById('token') as HTMLInputElement;
const proxyEl = document.getElementById('proxy') as HTMLInputElement;
const connectBtn = document.getElementById('connectBtn') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnectBtn') as HTMLButtonElement;
const connEl = document.getElementById('conn') as HTMLDivElement;
const agentNote = document.getElementById('agentNote') as HTMLDivElement;
const questionEl = document.getElementById('question') as HTMLInputElement;
const runBtn = document.getElementById('runBtn') as HTMLButtonElement;
const logEl = document.getElementById('log') as HTMLDivElement;
const replyEl = document.getElementById('reply') as HTMLDivElement;

let transport: Transport | null = null;
let connection: McpConnection | null = null;
let agentSession: LanguageModelSession | null = null;
let agentToolsKey = '';
let nanoReady = false;
let busy = false;
let rpcId = 0;

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
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// =====================================================================
// The intent-loop schema and helpers (shared by every MCP server).
// =====================================================================

const INTENT_SCHEMA = {
  type: 'object',
  required: ['toolName'],
  additionalProperties: false,
  properties: {
    toolName: { type: 'string', description: 'Tool to call next, or "done" to reply.' },
    args: { type: 'object', description: 'Arguments object for the tool (omit when done).' },
    reply: { type: 'string', description: 'Final answer — only when toolName is "done".' },
  },
} as const;

// The model sometimes wraps JSON in a fence. 3 tiers:
// direct parse -> strip a ```json ... ``` fence -> extract the first { ... }.
function extractJsonFromResponse(text: string): Record<string, unknown> | null {
  const s = String(text == null ? '' : text).trim();
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch (e) { /* fall through */ }
  const fenced = s.match(/^`{3}(?:json)?\s*\n?([\s\S]*?)\n?`{3}$/);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (e) { /* fall through */ }
  }
  const braces = s.match(/\{[\s\S]*\}/);
  if (braces) {
    try {
      const parsed = JSON.parse(braces[0]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch (e) { /* give up */ }
  }
  return null;
}

// Small models sometimes emit args as a JSON STRING; normalize to an object.
function coerceArgs(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (e) { /* not JSON */ }
  }
  return {};
}

// Compact one-line rendering of a tool's inputSchema, e.g. `{ "a": number (required) }`.
function renderSchemaProperties(inputSchema: Record<string, unknown>): string {
  const props =
    inputSchema && typeof inputSchema.properties === 'object' && inputSchema.properties
      ? (inputSchema.properties as Record<string, unknown>)
      : {};
  const required = Array.isArray(inputSchema && inputSchema.required)
    ? (inputSchema.required as unknown[]).filter((r): r is string => typeof r === 'string')
    : [];
  const entries = Object.entries(props);
  if (entries.length === 0) return '{}';
  const rendered = entries
    .map(([key, value]) => {
      const spec = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
      const type = typeof spec.type === 'string' ? spec.type : 'any';
      return `"${key}": ${type}${required.includes(key) ? ' (required)' : ''}`;
    })
    .join(', ');
  return `{ ${rendered} }`;
}

// The system prompt teaches the JSON dispatch protocol and lists the connected
// server's tools, so Nano only ever names a real tool.
function buildSystemPrompt(tools: McpToolInfo[]): string {
  const toolLines =
    tools.length === 0
      ? '(no tools available — emit { "toolName": "done", "reply": "..." })'
      : tools
          .map((t) => {
            const desc = t.description ? ` — ${t.description}` : '';
            return `- ${t.name}${desc}\n  args: ${renderSchemaProperties(t.inputSchema)}`;
          })
          .join('\n');
  const validNames = tools.map((t) => t.name).join(', ');
  return [
    'You fulfil the user\u2019s request by calling tools exposed by a connected MCP server.',
    'Respond with ONE JSON object and nothing else — no markdown, no code fences.',
    'Format: { "toolName": "<name or done>", "args": { ... }, "reply": "<only when done>" }',
    '',
    'Available tools (call ONE per turn; the host executes it and feeds you the result):',
    toolLines,
    '',
    'Valid tool names: ' + (validNames || '(none)'),
    '',
    'Rules:',
    '1. Call ONE tool per turn and wait for its result before the next step.',
    '2. Only use a tool name from the list above.',
    '3. Fill "args" from the tool\u2019s argument schema.',
    '4. When done (or no tool is needed), emit { "toolName": "done", "reply": "..." }.',
  ].join('\n');
}

// Flatten MCP result content blocks to a single string — the shape the loop
// feeds back into Nano's next prompt.
function contentToString(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : JSON.stringify(content);
  }
  return content
    .map((block) => {
      if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
      return JSON.stringify(block);
    })
    .join('\n');
}

// =====================================================================
// Transports.
// =====================================================================

// --- Mock MCP server: answers JSON-RPC in-page. No network, no CORS. ---
const MOCK_TOOLS: McpToolInfo[] = [
  {
    name: 'add',
    description: 'Add two numbers and return the sum.',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
  {
    name: 'multiply',
    description: 'Multiply two numbers and return the product.',
    inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
  },
  {
    name: 'echo',
    description: 'Echo back a message.',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
  },
];

function mockHandle(request: JsonRpcRequest): JsonRpcResponse | null {
  const id = request.id;
  const method = request.method;
  const params = (request.params || {}) as Record<string, unknown>;
  // Modern results carry a resultType; "complete" is the ordinary terminal one.
  const ok = (result: Record<string, unknown>): JsonRpcResponse =>
    ({ jsonrpc: '2.0', id, result: Object.assign({ resultType: 'complete' }, result) });

  // server/discover reports identity, capabilities and supported versions in one
  // request — the modern replacement for the initialize handshake.
  if (method === 'server/discover') {
    return ok({
      supportedVersions: [PROTOCOL_VERSION],
      capabilities: { tools: {} },
      instructions: 'A tiny in-page MCP server: add, multiply, echo.',
      _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'mock-mcp-server', version: '0.1.0' } },
    });
  }
  if (method === 'tools/list') return ok({ tools: MOCK_TOOLS });
  if (method === 'tools/call') {
    const name = params.name as string;
    const args: any = params.arguments || {}; // model-supplied; any for arithmetic/concat
    if (name === 'add') {
      return ok({ content: [{ type: 'text', text: `The sum of ${args.a} and ${args.b} is ${Number(args.a) + Number(args.b)}.` }], isError: false });
    }
    if (name === 'multiply') {
      return ok({ content: [{ type: 'text', text: `The product of ${args.a} and ${args.b} is ${Number(args.a) * Number(args.b)}.` }], isError: false });
    }
    if (name === 'echo') {
      return ok({ content: [{ type: 'text', text: `Echo: ${args.message}` }], isError: false });
    }
    return ok({ content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true });
  }
  // Unknown method — a real modern server answers this over HTTP with 404 + this
  // same JSON-RPC -32601 body.
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

function makeMockTransport(): Transport {
  return {
    label: 'mock',
    send: (request) => Promise.resolve(mockHandle(request)),
    close: () => { /* nothing to close */ },
  };
}

// --- Remote transport: raw JSON-RPC over Streamable HTTP via fetch. ---
// Modern MCP is stateless — no session id to capture or echo. The client names
// its protocol version on every request (body _meta + header) and bumps it once
// if the server rejects it with UnsupportedProtocolVersionError.
function makeHttpTransport(opts: { url: string; token: string; proxyPrefix: string }): Transport {
  const endpoint = opts.proxyPrefix ? opts.proxyPrefix + opts.url : opts.url;
  let protocolVersion = PROTOCOL_VERSION;

  return {
    label: 'http',
    close: () => { /* stateless: nothing to tear down */ },
    send: async (request) => {
      // One POST at a given version. The body _meta version and the
      // MCP-Protocol-Version header MUST agree, so stamp both from `version`.
      const attempt = async (version: string): Promise<{ res: Response; body: string }> => {
        setRequestVersion(request, version);
        const p = (request.params || {}) as Record<string, any>;
        const name = p.name || p.uri; // params.name / params.uri drive the Mcp-Name mirror
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          // Streamable HTTP servers may answer with JSON or an SSE stream.
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': version, // exact casing; mirrors _meta
          'Mcp-Method': request.method,    // mirror header intermediaries can route on
        };
        if (name) headers['Mcp-Name'] = String(name); // required for tools/call
        if (opts.token) headers['Authorization'] = 'Bearer ' + opts.token;
        const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(request) });
        return { res, body: await res.text() };
      };

      let { res, body } = await attempt(protocolVersion);

      // Version mismatch is a 400 carrying UnsupportedProtocolVersionError
      // (-32022). Pick a mutually supported version and retry once.
      if (res.status === 400 && body) {
        const errObj = safeParse(body);
        if (errObj && errObj.error && errObj.error.code === -32022) {
          const supported: string[] = (errObj.error.data && errObj.error.data.supported) || [];
          const pick = supported.indexOf(PROTOCOL_VERSION) !== -1 ? PROTOCOL_VERSION : supported[0];
          if (!pick) throw new Error('No mutually supported MCP protocol version. Server supports: ' + supported.join(', '));
          protocolVersion = pick;
          ({ res, body } = await attempt(protocolVersion));
        }
      }

      if (!res.ok && res.status !== 202) {
        throw new Error('HTTP ' + res.status + (body ? ': ' + body.slice(0, 200) : ''));
      }

      const msg = parseRpcBody(res, body);
      if (msg && msg.error) throw new Error(msg.error.message || 'JSON-RPC error');
      return msg;
    },
  };
}

// Stamp the negotiated protocol version into the request body's _meta so it
// always matches the MCP-Protocol-Version header on the same POST.
function setRequestVersion(request: JsonRpcRequest, version: string): void {
  const params = (request.params || {}) as Record<string, any>;
  params._meta = Object.assign({}, params._meta, { 'io.modelcontextprotocol/protocolVersion': version });
  (request as any).params = params;
}

function safeParse(text: string): any {
  try { return JSON.parse(text); } catch (e) { return null; }
}

// Parse a JSON-RPC response that may arrive as JSON or as an SSE frame.
function parseRpcBody(res: Response, body: string): JsonRpcResponse | null {
  if (!body) return null; // 202 Accepted — no body
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (ct.indexOf('text/event-stream') !== -1) {
    const data = body.split(/\r?\n/)
      .filter((l) => l.indexOf('data:') === 0)
      .map((l) => l.slice(5).trim())
      .join('\n');
    return data ? (JSON.parse(data) as JsonRpcResponse) : null;
  }
  return JSON.parse(body) as JsonRpcResponse;
}

// =====================================================================
// MCP client methods — the same for every transport.
// =====================================================================

// Every modern request carries protocol metadata in _meta: the version the
// server reads cold, who's calling, and what the client supports.
function requestMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}
function rpc(t: Transport, method: string, params: Record<string, unknown>): Promise<JsonRpcResponse | null> {
  return t.send({ jsonrpc: '2.0', id: ++rpcId, method, params: Object.assign({}, params, { _meta: requestMeta() }) });
}

// Modern connect: server/discover (identity + capabilities) then tools/list.
// No initialize, no notifications/initialized, no session to open.
async function connectTransport(t: Transport): Promise<McpConnection> {
  const discRes = await rpc(t, 'server/discover', {});
  const disc = (discRes && discRes.result) || {};
  const listRes = await rpc(t, 'tools/list', {});
  const rawTools: any[] = (listRes && listRes.result && listRes.result.tools) || [];
  const tools: McpToolInfo[] = rawTools.map((x) => ({
    name: x.name,
    description: x.description || '',
    inputSchema: x.inputSchema || { type: 'object' },
  }));
  // Modern serverInfo rides in the result's _meta, not a top-level field.
  const serverInfo = (disc._meta && disc._meta['io.modelcontextprotocol/serverInfo']) || {};
  return {
    serverName: serverInfo.name || 'unknown',
    serverVersion: serverInfo.version || '',
    capabilities: Object.keys(disc.capabilities || {}),
    tools,
  };
}

// tools/call -> flatten the content blocks to a string.
async function callTool(t: Transport, name: string, args: Record<string, unknown>): Promise<string> {
  const res = await rpc(t, 'tools/call', { name, arguments: args });
  const result = (res && res.result) || {};
  return contentToString(result.content);
}

// =====================================================================
// Session lifecycle: expectedInputs/expectedOutputs + a download monitor. Recreated
// when the tool set changes (the system prompt embeds the tool list).
// =====================================================================
async function getAgentSession(tools: McpToolInfo[]): Promise<LanguageModelSession> {
  const key = tools.map((t) => t.name).slice().sort().join(',');
  if (agentSession && key === agentToolsKey) return agentSession;
  if (agentSession) { agentSession.destroy(); agentSession = null; }

  dlEl.hidden = false;
  dlEl.value = 0;
  agentSession = await LanguageModel.create({
    ...LANGUAGE_OPTS,
    initialPrompts: [{ role: 'system', content: buildSystemPrompt(tools) }],
    monitor(m: DownloadMonitor) {
      m.addEventListener('downloadprogress', (e: ProgressEvent) => {
        dlEl.value = e.loaded; // e.loaded is a 0..1 fraction; e.total is always 1
        setStatus('Downloading model… ' + Math.round(e.loaded * 100) + '%', 'warn');
      });
    },
  });
  dlEl.hidden = true;
  agentToolsKey = key;
  return agentSession;
}

// =====================================================================
// UI wiring.
// =====================================================================
function currentMode(): string {
  const checked = document.querySelector('input[name=mode]:checked') as HTMLInputElement | null;
  return checked ? checked.value : 'mock';
}

function syncModeFields(): void {
  remoteFields.hidden = currentMode() !== 'remote';
}

async function teardown(): Promise<void> {
  if (agentSession) { agentSession.destroy(); agentSession = null; agentToolsKey = ''; }
  if (transport) { transport.close(); transport = null; }
  connection = null;
}

function renderConnection(conn: McpConnection): void {
  connEl.textContent = '';
  const head = document.createElement('div');
  head.className = 'kv';
  const b = document.createElement('b');
  b.textContent = 'server: ';
  head.appendChild(b);
  head.appendChild(document.createTextNode(
    conn.serverName + (conn.serverVersion ? ' v' + conn.serverVersion : '') +
    '  ·  capabilities: ' + (conn.capabilities.join(', ') || 'none') +
    '  ·  ' + conn.tools.length + ' tool(s)',
  ));
  connEl.appendChild(head);
  conn.tools.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'tool';
    const name = document.createElement('b');
    name.textContent = t.name;
    row.appendChild(name);
    row.appendChild(document.createTextNode(
      (t.description ? ' — ' + t.description : '') + '  ' + renderSchemaProperties(t.inputSchema),
    ));
    connEl.appendChild(row);
  });
}

function setAgentNote(html: string, kind?: 'ok' | 'warn' | 'err'): void {
  agentNote.innerHTML = html || '';
  agentNote.className = html ? 'status ' + (kind || '') : 'muted';
}

async function handleConnect(): Promise<void> {
  if (busy) return;
  busy = true;
  connectBtn.disabled = true;
  const mode = currentMode();
  await teardown();
  connEl.className = 'output';
  connEl.textContent = '';
  runBtn.disabled = true;
  setStatus(mode === 'remote' ? 'Connecting to the remote server…' : 'Connecting to the mock server…', 'warn');
  try {
    const t: Transport = mode === 'remote'
      ? makeHttpTransport({ url: urlEl.value.trim(), token: tokenEl.value, proxyPrefix: proxyEl.value.trim() })
      : makeMockTransport();
    const conn = await connectTransport(t);
    transport = t;
    connection = conn;
    renderConnection(conn);
    disconnectBtn.disabled = false;
    setStatus('Connected to ' + escapeHtml(conn.serverName) + '. ' + conn.tools.length + ' tool(s) discovered.', 'ok');
    if (nanoReady) {
      runBtn.disabled = false;
      setAgentNote('');
    }
  } catch (e) {
    let hint = '';
    if (mode === 'remote') {
      hint = ' Browser → remote MCP is CORS-gated: the server must allow this origin and the ' +
        '<code>MCP-Protocol-Version</code>/<code>Mcp-Method</code>/<code>Mcp-Name</code> headers in its ' +
        'preflight. Try the mock server, or run a CORS proxy and use the prefix field.';
    }
    connEl.innerHTML = '<span style="color:#d44">Connect failed: ' + escapeHtml(errMessage(e)) + '</span>' + hint;
    setStatus('Connect failed.', 'err');
  } finally {
    busy = false;
    connectBtn.disabled = false;
  }
}

async function handleDisconnect(): Promise<void> {
  if (busy) return;
  await teardown();
  connEl.textContent = '';
  connEl.className = 'output';
  disconnectBtn.disabled = true;
  runBtn.disabled = true;
  logEl.textContent = '';
  replyEl.textContent = '';
  setStatus('Disconnected.', 'warn');
}

function logStep(n: number, toolName: string, args: Record<string, unknown>, result: string): void {
  const row = document.createElement('div');
  row.className = 'step';
  row.textContent = '#' + n + '  ' + toolName + '(' + JSON.stringify(args) + ')  →  ' + result;
  logEl.appendChild(row);
}

// The intent loop: prompt -> parse -> tools/call -> feed result -> repeat.
async function runAgent(): Promise<void> {
  if (!transport || !connection) { setStatus('Connect to a server first.', 'warn'); return; }
  const question = questionEl.value.trim();
  if (!question || busy) return;
  busy = true;
  runBtn.disabled = true;
  logEl.textContent = '';
  replyEl.textContent = '';
  setStatus('Thinking…', 'warn');
  try {
    const session = await getAgentSession(connection.tools);
    let promptText = question;
    let finished = false;

    for (let i = 0; i < MAX_TOOL_CALLS; i++) {
      // responseConstraint rides on each prompt(), not create().
      const raw = await session.prompt(promptText, { responseConstraint: INTENT_SCHEMA });
      const parsed = extractJsonFromResponse(raw);

      if (!parsed || typeof parsed.toolName !== 'string') {
        replyEl.textContent = raw;
        finished = true;
        break;
      }

      if (parsed.toolName === 'done') {
        replyEl.textContent = typeof parsed.reply === 'string' && parsed.reply ? parsed.reply : '(done)';
        finished = true;
        break;
      }

      // Only dispatch a tool the server actually advertised.
      const toolName = parsed.toolName;
      const tool = connection.tools.find((t) => t.name === toolName);
      if (!tool) {
        promptText = 'Tool "' + toolName + '" is not available. Valid tool names: ' +
          (connection.tools.map((t) => t.name).join(', ') || '(none)') +
          '. Call a valid tool or emit {"toolName":"done","reply":"..."}.';
        continue;
      }

      const args = coerceArgs(parsed.args);
      let result: string;
      try {
        result = await callTool(transport, toolName, args);
      } catch (e) {
        result = JSON.stringify({ error: errMessage(e) });
      }
      logStep(i + 1, toolName, args, result);

      // Feed the result back so the model can continue or finish.
      promptText = 'Tool "' + toolName + '" result: ' + result +
        '. Now call the next tool (emit the JSON), or if the request is complete emit ' +
        '{"toolName":"done","reply":"..."}.';
    }

    if (!finished) {
      replyEl.textContent = 'Stopped after ' + MAX_TOOL_CALLS + ' tool calls without a final reply.';
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

// Feature-detect + availability() gate. Connecting and listing tools work
// WITHOUT Nano — only the agent step needs the Prompt API, so it's gated
// separately here, not on the whole page.
async function initNano(): Promise<void> {
  connectBtn.disabled = false; // connect works regardless of Nano
  if (typeof LanguageModel === 'undefined') {
    nanoReady = false;
    setStatus('Ready to connect. This browser has no built-in <code>LanguageModel</code>, so the agent step is disabled — connection and tool discovery still work.', 'warn');
    setAgentNote('No built-in <code>LanguageModel</code> here. Work through <a href="' + SETUP_URL + '">Setup &amp; availability</a>, or try the <a href="' + LIVE_DEMO_URL + '">hosted demo</a>.', 'err');
    return;
  }
  let status: Availability;
  try {
    // Same options as create() — availability() answers for this exact request.
    status = await LanguageModel.availability(LANGUAGE_OPTS);
  } catch (e) {
    nanoReady = false;
    setStatus('Ready to connect. <code>availability()</code> threw, so the agent step is disabled.', 'warn');
    setAgentNote('Built-in AI is unavailable. See <a href="' + SETUP_URL + '">Setup &amp; availability</a>, or try the <a href="' + LIVE_DEMO_URL + '">hosted demo</a>.', 'err');
    return;
  }
  if (status === 'unavailable') {
    nanoReady = false;
    setStatus('Ready to connect. Built-in AI reports <code>unavailable</code>, so the agent step is disabled.', 'warn');
    setAgentNote('Built-in AI reports <code>unavailable</code> on this device. See <a href="' + SETUP_URL + '">Setup &amp; availability</a>, or try the <a href="' + LIVE_DEMO_URL + '">hosted demo</a>.', 'err');
    return;
  }
  nanoReady = true;
  if (status === 'available') {
    setStatus('Ready. Connect to the mock server, then ask a question.', 'ok');
  } else {
    setStatus('Ready. The model needs a one-time download (a few GB) on your first Ask.', 'warn');
  }
}

document.querySelectorAll('input[name=mode]').forEach((r) => {
  r.addEventListener('change', syncModeFields);
});
connectBtn.addEventListener('click', () => void handleConnect());
disconnectBtn.addEventListener('click', () => void handleDisconnect());
runBtn.addEventListener('click', () => void runAgent());

// Free GPU memory on teardown.
window.addEventListener('beforeunload', () => {
  if (agentSession) agentSession.destroy();
});

// Reference the lesson URL constant so tsc doesn't flag it as unused.
void LESSON_URL;

syncModeFields();
void initNano();
