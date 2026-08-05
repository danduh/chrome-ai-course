// Reference only — the runnable demo is index.html. Types illustrate the API; compile with tsc if you want.
//
// This mirrors the inline <script> in index.html with types added. It is not
// built or loaded by the page. The approach is the shipped MiniEval in four
// ideas: a golden set -> a deterministic, rule-based check -> run each case N
// times -> report a stability rate. Throughout, ERROR (the harness broke) is
// kept separate from FAIL (the model was wrong) — counting infra errors as
// failures makes a good model look bad. Everything runs on-device.

// --- Minimal ambient surface for the built-in AI globals used here ---
type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface DownloadMonitor {
  addEventListener(type: 'downloadprogress', listener: (e: ProgressEvent) => void): void;
}

interface SummarizerCreateOptions {
  type?: 'tldr' | 'key-points' | 'teaser' | 'headline';
  format?: 'markdown' | 'plain-text';
  outputLanguage?: string;
  monitor?: (m: DownloadMonitor) => void;
}
interface SummarizerInstance {
  summarize(input: string): Promise<string>;
  destroy(): void;
}

interface TranslatorCreateOptions {
  sourceLanguage: string;
  targetLanguage: string;
  monitor?: (m: DownloadMonitor) => void;
}
interface TranslatorInstance {
  translate(input: string): Promise<string>;
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
  prompt(input: string): Promise<string>;
  destroy(): void;
}

declare const Summarizer: {
  availability(options?: SummarizerCreateOptions): Promise<Availability>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerInstance>;
};
declare const Translator: {
  availability(options: TranslatorCreateOptions): Promise<Availability>;
  create(options: TranslatorCreateOptions): Promise<TranslatorInstance>;
};
declare const LanguageModel: {
  availability(options?: LanguageModelCreateOptions): Promise<Availability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSession>;
};

// --- The golden-set types (copied from the shipped testCases.ts) ---
type EvalApi = 'summarizer' | 'translator' | 'prompt';

interface CheckResult {
  pass: boolean;
  /** Short human reason shown next to the run, e.g. "27 words". */
  reason: string;
}

interface EvalCase {
  id: string;
  name: string;
  api: EvalApi;
  input: string;
  /** Plain-language description of the rule the output must satisfy. */
  rule: string;
  /** Summarizer type, when api === 'summarizer'. */
  summaryType?: 'tldr' | 'key-points' | 'teaser' | 'headline';
  /** Deterministic scorer — regular code, no model involved. */
  check: (output: string) => CheckResult;
}

// --- The golden set: trusted inputs + a rule-based check each ---
const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
const lineCount = (s: string): number =>
  s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean).length;

const SAMPLE =
  'Chrome ships several built-in AI APIs that run entirely on-device using Gemini Nano. ' +
  'Because inference happens locally, there is no server round-trip, no per-request cost, ' +
  'and no data leaves the machine. Developers can prompt, summarize, translate, write, and ' +
  'proofread without any backend or API key.';
const TRANSLATE_INPUT = 'On-device AI keeps your data on your machine — no server, no cost.';

const EVAL_CASES: EvalCase[] = [
  {
    id: 'summary-short',
    name: 'Summary is short',
    api: 'summarizer',
    summaryType: 'tldr',
    input: SAMPLE,
    rule: 'non-empty and ≤ 40 words',
    check: (o) => {
      const w = wordCount(o);
      return { pass: o.trim().length > 0 && w <= 40, reason: `${w} words` };
    },
  },
  {
    id: 'summary-keypoints',
    name: 'Summary has multiple points',
    api: 'summarizer',
    summaryType: 'key-points',
    input: SAMPLE,
    rule: 'at least 2 bullet points / lines',
    check: (o) => {
      const n = lineCount(o);
      return { pass: n >= 2, reason: `${n} lines` };
    },
  },
  {
    id: 'translate-produced',
    name: 'Translation is produced',
    api: 'translator',
    input: TRANSLATE_INPUT,
    rule: 'non-empty and different from the English input',
    check: (o) => ({
      pass: o.trim().length > 0 && o.trim() !== TRANSLATE_INPUT,
      reason: `${o.trim().length} chars`,
    }),
  },
  {
    id: 'prompt-yesno',
    name: 'Answers yes / no only',
    api: 'prompt',
    input: "Answer with only the single word 'yes' or 'no'. Is the sky blue on a clear day?",
    rule: 'output is exactly "yes" or "no"',
    check: (o) => {
      const a = o.trim().toLowerCase().replace(/[.!"']/g, '');
      return { pass: a === 'yes' || a === 'no', reason: `got "${o.trim().slice(0, 40)}"` };
    },
  },
];

// --- Running a case: gate -> create(monitor) -> call N times -> score ---
type RunStatus = 'pass' | 'fail' | 'error';
interface RunResult {
  index: number;
  status: RunStatus;
  reason?: string;
  output?: string;
}
interface Runner {
  call: () => Promise<string>;
  destroy: () => void;
}

function named(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}
function errName(e: unknown, fallback: string): string {
  return (e as { name?: string } | null)?.name ?? fallback;
}

// Download progress -> a 0..1 fraction. e.total exists and is always 1, so
// e.loaded is already the fraction to render as a percentage.
let onProgress: (pct: number) => void = () => {};
function monitor(m: DownloadMonitor): void {
  m.addEventListener('downloadprogress', (e: ProgressEvent) => onProgress(Math.round(e.loaded * 100)));
}

// Build one runner. A missing global or an `unavailable` state throws — the
// caller turns that into ERROR runs, never FAIL. Each API declares its own
// language: Summarizer keeps outputLanguage, the Prompt API uses expectedInputs/Outputs.
async function makeRunner(c: EvalCase): Promise<Runner> {
  if (c.api === 'summarizer') {
    if (typeof Summarizer === 'undefined') throw named('unavailable');
    const opts: SummarizerCreateOptions = {
      type: c.summaryType ?? 'tldr',
      format: 'plain-text',
      outputLanguage: 'en',
    };
    if ((await Summarizer.availability(opts)) === 'unavailable') throw named('unavailable');
    const s = await Summarizer.create({ ...opts, monitor });
    return { call: () => s.summarize(c.input), destroy: () => s.destroy() };
  }
  if (c.api === 'translator') {
    if (typeof Translator === 'undefined') throw named('unavailable');
    const opts: TranslatorCreateOptions = { sourceLanguage: 'en', targetLanguage: 'es' };
    if ((await Translator.availability(opts)) === 'unavailable') throw named('unavailable');
    const t = await Translator.create({ ...opts, monitor });
    return { call: () => t.translate(c.input), destroy: () => t.destroy() };
  }
  if (typeof LanguageModel === 'undefined') throw named('unavailable');
  const opts: LanguageModelCreateOptions = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };
  if ((await LanguageModel.availability(opts)) === 'unavailable') throw named('unavailable');
  const s = await LanguageModel.create({ ...opts, monitor });
  return { call: () => s.prompt(c.input), destroy: () => s.destroy() };
}

let activeRunner: Runner | null = null;

async function runCase(
  c: EvalCase,
  n: number,
  onUpdate?: (results: RunResult[]) => void,
): Promise<RunResult[]> {
  const results: RunResult[] = [];
  const update = (): void => onUpdate?.(results);
  let runner: Runner;
  try {
    runner = await makeRunner(c);
  } catch (e) {
    // create()/availability() failed before any run — every run is an infra
    // ERROR, NOT a FAIL. A FAIL you didn't earn would skew the stability rate.
    const reason = errName(e, 'create failed');
    for (let i = 0; i < n; i++) results.push({ index: i, status: 'error', reason });
    update();
    return results;
  }
  activeRunner = runner;
  try {
    for (let i = 0; i < n; i++) {
      try {
        const output = await runner.call();
        const r = c.check(output); // deterministic — regular code, no model
        results.push({ index: i, status: r.pass ? 'pass' : 'fail', reason: r.reason, output });
      } catch (e) {
        results.push({ index: i, status: 'error', reason: errName(e, 'run failed') });
      }
      update();
    }
  } finally {
    try {
      runner.destroy(); // free GPU memory
    } catch {
      /* already gone */
    }
    activeRunner = null;
  }
  return results;
}

// --- Scoring: passed / scored, with ERROR excluded from the denominator ---
interface Summary {
  passed: number;
  failed: number;
  errored: number;
  scored: number;
  rate: number | null;
}
function summarize(results: RunResult[]): Summary {
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const errored = results.filter((r) => r.status === 'error').length;
  const scored = passed + failed; // ERROR != FAIL — infra errors are not scored
  const rate = scored > 0 ? Math.round((passed / scored) * 100) : null;
  return { passed, failed, errored, scored, rate };
}
const badgeClass = (rate: number | null): string =>
  rate == null ? 'gray' : rate >= 80 ? 'good' : rate >= 50 ? 'mid' : 'bad';

// --- Rendering (typed mirror of the inline DOM logic) ---
const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));

function dotSpan(r: RunResult): string {
  const cls = r.status === 'pass' ? 'dot pass' : r.status === 'fail' ? 'dot fail' : 'dot err';
  const title = `run ${r.index + 1}: ${r.status}${r.reason ? ` — ${r.reason}` : ''}`;
  return `<span class="${cls}" title="${esc(title)}"></span>`;
}
function perRun(r: RunResult): string {
  const cls = r.status === 'pass' ? 'ok' : r.status === 'fail' ? 'bad' : 'mut';
  let li = `<li><span class="mono ${cls}">${r.status.toUpperCase()}</span> run ${r.index + 1}${
    r.reason ? ` — ${esc(r.reason)}` : ''
  }`;
  if (r.output && r.output.trim()) li += `<div class="out">${esc(r.output)}</div>`;
  return `${li}</li>`;
}

const statusEl = document.getElementById('status') as HTMLDivElement;
const dlEl = document.getElementById('dl') as HTMLProgressElement;
const casesEl = document.getElementById('cases') as HTMLDivElement;
const caseViewEl = document.getElementById('caseView') as HTMLDivElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const resultsEl = document.getElementById('results') as HTMLDivElement;
const nButtons = Array.from(document.querySelectorAll('.n')) as HTMLButtonElement[];

const SETUP_URL = 'https://danduh.me/courses/chrome-built-in-ai/setup-and-availability';
const LIVE_DEMO_URL = 'https://windowai.danduh.me/evaluation';

let selectedId = EVAL_CASES[0].id; // default to a Summarizer case (widely available)
let runsN = 8;
let busy = false;

const currentCase = (): EvalCase => EVAL_CASES.find((c) => c.id === selectedId) ?? EVAL_CASES[0];

function setStatus(html: string, kind?: 'ok' | 'warn' | 'err'): void {
  statusEl.className = 'status' + (kind ? ' ' + kind : '');
  statusEl.innerHTML = html;
}

// Wire the module-level progress callback to the shared progress bar.
onProgress = (pct: number): void => {
  dlEl.hidden = false;
  dlEl.value = pct / 100;
  setStatus(`Downloading model… ${pct}%`, 'warn');
};

function renderSingle(c: EvalCase, results: RunResult[], n: number): void {
  const s = summarize(results);
  let html = `<div class="dots">${results.map(dotSpan).join('')}</div>`;
  if (results.length) {
    html += '<div class="rate">';
    html +=
      s.rate != null
        ? `<span class="badge ${badgeClass(s.rate)}">passed ${s.passed}/${s.scored} · ${s.rate}% stable</span>`
        : '<span class="badge gray">0 scored runs</span>';
    if (s.errored)
      html += `<span class="muted">${s.errored} errored (infra — not counted, ERROR ≠ FAIL)</span>`;
    html += '</div>';
    if (results.length >= n)
      html += '<p class="muted">A single pass/fail would hide this — the model is non-deterministic.</p>';
    html += `<details><summary class="muted">Per-run detail</summary><ul class="runs">${results
      .map(perRun)
      .join('')}</ul></details>`;
  }
  resultsEl.innerHTML = html;
}

function renderCompact(c: EvalCase, results: RunResult[]): string {
  const s = summarize(results);
  let html = '<div class="crow">';
  html += `<div class="cname"><span class="api">${c.api}</span> ${esc(c.name)}</div>`;
  html += `<div class="dots">${results.map(dotSpan).join('')}</div>`;
  html +=
    s.rate != null
      ? `<span class="badge ${badgeClass(s.rate)}">${s.passed}/${s.scored} · ${s.rate}%</span>`
      : '<span class="badge gray">no scored runs</span>';
  if (s.errored) html += `<span class="muted">${s.errored} err</span>`;
  html += '</div>';
  return html;
}

function renderPills(): void {
  let html = EVAL_CASES.map(
    (c) => `<button class="pill${c.id === selectedId ? ' on' : ''}" data-id="${c.id}">${esc(c.name)}</button>`,
  ).join('');
  html += `<button class="pill${'all' === selectedId ? ' on' : ''}" data-id="all">All cases</button>`;
  casesEl.innerHTML = html;
}
function renderCaseView(): void {
  if (selectedId === 'all') {
    caseViewEl.innerHTML = `<p class="muted">Runs every case in the golden set, one after another — each ${runsN}×, each with its own stability rate.</p>`;
    return;
  }
  const c = currentCase();
  caseViewEl.innerHTML =
    `<div><span class="api">${c.api}</span> <span class="muted">input sent to the model</span></div>` +
    `<p class="cv-input">${esc(c.input)}</p>` +
    `<p class="cv-rule"><span class="muted">Passes when:</span> ${esc(c.rule)}</p>`;
}
function markRunButtons(): void {
  nButtons.forEach((b) => b.classList.toggle('on', Number(b.dataset.n) === runsN));
}

async function probeSelected(): Promise<void> {
  if (selectedId === 'all') {
    setStatus('Runs every case, one after another. Pick a run count and go.', 'ok');
    return;
  }
  const c = currentCase();
  let state: Availability | 'missing';
  try {
    if (c.api === 'summarizer')
      state = typeof Summarizer === 'undefined' ? 'missing' : await Summarizer.availability();
    else if (c.api === 'translator')
      state =
        typeof Translator === 'undefined'
          ? 'missing'
          : await Translator.availability({ sourceLanguage: 'en', targetLanguage: 'es' });
    else
      state =
        typeof LanguageModel === 'undefined'
          ? 'missing'
          : await LanguageModel.availability({
              expectedInputs: [{ type: 'text', languages: ['en'] }],
              expectedOutputs: [{ type: 'text', languages: ['en'] }],
            });
  } catch {
    state = 'unavailable';
  }
  const name = c.api === 'summarizer' ? 'Summarizer' : c.api === 'translator' ? 'Translator' : 'LanguageModel';
  if (state === 'missing')
    setStatus(`<code>${name}</code> is missing here — this case reports ERROR (infra), not FAIL.`, 'warn');
  else if (state === 'unavailable')
    setStatus(
      `<code>${name}</code> reports <code>unavailable</code> — running this case yields ERROR (infra), not FAIL.`,
      'warn',
    );
  else if (state === 'available') setStatus('Model ready. Run the eval.', 'ok');
  else setStatus('Model needs a one-time download (a few GB) — it starts on your first run.', 'warn');
}

function degrade(reason: string): void {
  setStatus(
    `${reason} Work through <a href="${SETUP_URL}">Setup &amp; availability</a>, or try the <a href="${LIVE_DEMO_URL}">hosted demo</a>.`,
    'err',
  );
  runBtn.disabled = true;
  nButtons.forEach((b) => (b.disabled = true));
}

function setBusy(b: boolean): void {
  busy = b;
  runBtn.disabled = b;
  runBtn.textContent = b ? 'Running…' : 'Run eval';
  nButtons.forEach((btn) => (btn.disabled = b));
  casesEl.querySelectorAll('.pill').forEach((p) => ((p as HTMLButtonElement).disabled = b));
}

async function run(): Promise<void> {
  if (busy) return;
  setBusy(true);
  resultsEl.innerHTML = '';
  try {
    if (selectedId === 'all') {
      for (const c of EVAL_CASES) {
        const holder = document.createElement('div');
        holder.className = 'caseblock';
        resultsEl.appendChild(holder);
        await runCase(c, runsN, (rs) => (holder.innerHTML = renderCompact(c, rs)));
      }
      setStatus(`Done. Four cases, each ${runsN}×. Gray dots are infra ERRORs, not model FAILs.`, 'ok');
    } else {
      const c = currentCase();
      setStatus(`Running ${c.name} ${runsN}×…`, 'warn');
      await runCase(c, runsN, (rs) => renderSingle(c, rs, runsN));
      setStatus('Done. Change the case or the run count and go again.', 'ok');
    }
  } finally {
    setBusy(false);
    dlEl.hidden = true;
  }
}

casesEl.addEventListener('click', (e) => {
  const btn = (e.target as Element | null)?.closest('.pill') as HTMLButtonElement | null;
  if (!btn || busy) return;
  selectedId = btn.dataset.id ?? EVAL_CASES[0].id;
  resultsEl.innerHTML = '';
  renderPills();
  renderCaseView();
  void probeSelected();
});
nButtons.forEach((btn) =>
  btn.addEventListener('click', () => {
    if (busy) return;
    runsN = Number(btn.dataset.n);
    markRunButtons();
    if (selectedId === 'all') renderCaseView();
  }),
);
runBtn.addEventListener('click', () => void run());

// Free GPU memory if the tab closes mid-run.
window.addEventListener('beforeunload', () => {
  if (activeRunner) {
    try {
      activeRunner.destroy();
    } catch {
      /* already gone */
    }
  }
});

function init(): void {
  renderPills();
  renderCaseView();
  markRunButtons();
  const hasAny =
    typeof Summarizer !== 'undefined' ||
    typeof Translator !== 'undefined' ||
    typeof LanguageModel !== 'undefined';
  if (!hasAny) {
    degrade(
      'This browser has no built-in AI globals (<code>Summarizer</code>, <code>Translator</code>, <code>LanguageModel</code>). You need desktop Chrome with built-in AI.',
    );
    return;
  }
  runBtn.disabled = false;
  void probeSelected();
}

init();
