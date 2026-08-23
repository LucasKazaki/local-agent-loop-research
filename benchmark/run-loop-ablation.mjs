import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { scoreTask, tasks } from './task-suite.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '..');
const LMS = process.env.LMS_PATH || path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
const API_BASE = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234';
const TASK_IDS = [
  'director_dependency_envelope',
  'claim_grounding_matrix',
  'critical_path_reasoning',
  'code_review_fencing',
  'research_fact_inference_split',
  'bounded_plan_stop_condition',
];

function parseArgs(argv) {
  const options = {
    solver: '',
    critic: '',
    repeats: 2,
    context: 8192,
    caseTimeoutMs: 90_000,
    output: 'results/loop-ablation.json',
    restore: '',
    manageModels: true,
    solverApiUrl: `${API_BASE}/api/v0/chat/completions`,
    criticApiUrl: `${API_BASE}/api/v0/chat/completions`,
    reuseDrafts: '',
  };
  for (const arg of argv) {
    if (arg.startsWith('--solver=')) options.solver = arg.slice(9);
    else if (arg.startsWith('--critic=')) options.critic = arg.slice(9);
    else if (arg.startsWith('--repeats=')) options.repeats = Math.max(1, Number(arg.slice(10)) || 2);
    else if (arg.startsWith('--context=')) options.context = Math.max(2048, Number(arg.slice(10)) || 8192);
    else if (arg.startsWith('--case-timeout-ms=')) options.caseTimeoutMs = Math.max(1000, Number(arg.slice(18)) || 90_000);
    else if (arg.startsWith('--output=')) options.output = arg.slice(9);
    else if (arg.startsWith('--restore=')) options.restore = arg.slice(10);
    else if (arg === '--no-manage-models') options.manageModels = false;
    else if (arg.startsWith('--solver-api-url=')) options.solverApiUrl = arg.slice(17);
    else if (arg.startsWith('--critic-api-url=')) options.criticApiUrl = arg.slice(17);
    else if (arg.startsWith('--reuse-drafts=')) options.reuseDrafts = arg.slice(15);
  }
  if (!options.solver || !options.critic) throw new Error('Pass --solver=<model> and --critic=<different model>.');
  if (options.solver === options.critic) throw new Error('The cross-specialist critic must be a different model; self-refinement is measured separately.');
  for (const [name, value] of [['solver API', options.solverApiUrl], ['critic API', options.criticApiUrl]]) {
    let url;
    try { url = new URL(value); } catch { throw new Error(`${name} URL is invalid.`); }
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error(`${name} URL must use an explicit loopback host.`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(`${name} URL is not a safe local HTTP(S) URL.`);
  }
  return options;
}

async function runLms(args, timeout = 300_000) {
  return execFileAsync(LMS, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

async function loadModel(model, context) {
  await runLms(['unload', '--all'], 90_000).catch(() => null);
  const started = performance.now();
  await runLms(['load', model, '--yes', '--context-length', String(context), '--parallel', '1', '--identifier', model]);
  return Number(((performance.now() - started) / 1000).toFixed(2));
}

async function complete(apiUrl, model, messages, maxTokens, seed, timeout) {
  const started = performance.now();
  const response = await fetch(apiUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0, seed, max_tokens: maxTokens, stream: false }),
    signal: AbortSignal.timeout(timeout),
  });
  const raw = await response.text();
  const wallMs = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const payload = JSON.parse(raw);
  const message = payload?.choices?.[0]?.message || {};
  return {
    text: String(message.content || ''), message, wallMs, usage: payload.usage || {}, stats: payload.stats || {},
    finishReason: payload?.choices?.[0]?.finish_reason || '', modelInfo: payload.model_info || {}, runtime: payload.runtime || {},
  };
}

function solveMessages(task) {
  return [
    { role: 'system', content: 'You are the producing specialist in a deterministic benchmark. Follow the requested final-output contract exactly. Use only supplied evidence.' },
    { role: 'user', content: task.prompt },
  ];
}

function critiqueMessages(task, draft) {
  return [
    { role: 'system', content: 'You are a read-only verifier. Check the draft against every explicit output contract, fact, dependency, safety boundary, and calculation in the task. Do not praise it. Return a concise defect list; say NO_DEFECTS only if every check passes.' },
    { role: 'user', content: `TASK\n${task.prompt}\n\nDRAFT\n${draft}` },
  ];
}

function reviseMessages(task, draft, critique) {
  return [
    { role: 'system', content: 'You are the finalizer. Correct valid defects. Ignore incorrect critique. Return only the answer requested by the original task, with no commentary about drafting or critique.' },
    { role: 'user', content: `ORIGINAL TASK\n${task.prompt}\n\nDRAFT\n${draft}\n\nVERIFIER NOTES\n${critique}` },
  ];
}

function methodSummary(cases, field) {
  const scored = cases.filter((item) => item[field]?.status === 'completed');
  const possible = cases.length;
  const score = scored.reduce((sum, item) => sum + Number(item[field].score?.score || 0), 0);
  const calls = cases.reduce((sum, item) => sum + Number(item[field]?.calls || 0), 0);
  const wallMs = cases.reduce((sum, item) => sum + Number(item[field]?.wallMs || 0), 0);
  const completionTokens = cases.reduce((sum, item) => sum + Number(item[field]?.completionTokens || 0), 0);
  return { score, possible, passRate: possible ? score / possible : 0, completedCases: scored.length, failedCases: possible - scored.length, calls, wallSeconds: Number((wallMs / 1000).toFixed(2)), completionTokens };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedTasks = TASK_IDS.map((id) => tasks.find((task) => task.id === id));
  if (selectedTasks.some((task) => !task)) throw new Error('A configured ablation task is missing from task-suite.mjs.');
  const source = await readFile(new URL('./task-suite.mjs', import.meta.url), 'utf8');
  const output = path.resolve(ROOT, options.output);
  await mkdir(path.dirname(output), { recursive: true });
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null, options,
    environment: { platform: process.platform, cpu: os.cpus()[0]?.model, node: process.version, apiBase: API_BASE },
    taskSuite: { hashSha256: createHash('sha256').update(source).digest('hex'), taskIds: TASK_IDS },
    design: {
      direct: 'One solver call; the output is also the common initial draft for both loop treatments.',
      selfRefine: 'Solver draft, same-model read-only critique, same-model finalization.',
      crossSpecialist: 'Solver draft, different-model read-only critique, solver finalization.',
    },
    loads: [], cases: [], summaries: {},
  };
  if (options.reuseDrafts) {
    const reusePath = path.resolve(ROOT, options.reuseDrafts);
    const relativeReusePath = path.relative(ROOT, reusePath);
    if (relativeReusePath.startsWith('..') || path.isAbsolute(relativeReusePath)) {
      throw new Error('--reuse-drafts must resolve inside this repository.');
    }
    const reuseBytes = await readFile(reusePath);
    const prior = JSON.parse(reuseBytes.toString('utf8'));
    if (!prior.finishedAt || prior.options?.solver !== options.solver
      || prior.options?.repeats !== options.repeats
      || prior.taskSuite?.hashSha256 !== report.taskSuite.hashSha256
      || prior.cases?.length !== options.repeats * selectedTasks.length) {
      throw new Error('--reuse-drafts is not a completed, solver/repeat/suite-compatible ablation artifact.');
    }
    if (prior.cases.some((item) => item.direct?.status !== 'completed'
      || !item.direct?.output || typeof item.direct.output.text !== 'string')) {
      throw new Error('--reuse-drafts contains an incomplete direct draft.');
    }
    report.reusedDrafts = {
      path: relativeReusePath.replaceAll('\\', '/'),
      sha256: createHash('sha256').update(reuseBytes).digest('hex'),
      finishedAt: prior.finishedAt,
      note: 'Direct drafts and self-refine controls were copied exactly; cross-family critique/finalization was rerun on preloaded isolated endpoints.',
    };
    report.cases = prior.cases.map((item) => ({
      taskId: item.taskId,
      category: item.category,
      repeat: item.repeat,
      direct: structuredClone(item.direct),
      selfRefine: structuredClone(item.selfRefine),
      crossSpecialist: { status: 'drafted', draft: structuredClone(item.direct.output) },
    }));
  } else {
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      for (const task of selectedTasks) report.cases.push({ taskId: task.id, category: task.category, repeat, direct: {}, selfRefine: {}, crossSpecialist: {} });
    }
  }
  const save = () => writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await save();

  if (!options.reuseDrafts) {
    if (options.manageModels) {
      report.loads.push({ model: options.solver, phase: 'draft-and-self-refine', wallSeconds: await loadModel(options.solver, options.context) });
    } else {
      report.loads.push({ model: options.solver, phase: 'draft-and-self-refine', wallSeconds: 0, preloaded: true, apiUrl: options.solverApiUrl });
    }
    for (const item of report.cases) {
      const task = selectedTasks.find((candidate) => candidate.id === item.taskId);
      try {
        const draft = await complete(options.solverApiUrl, options.solver, solveMessages(task), task.maxTokens || 320, 5000 + item.repeat, options.caseTimeoutMs);
        item.direct = { status: 'completed', output: draft, score: scoreTask(task, draft), calls: 1, wallMs: draft.wallMs, completionTokens: draft.usage?.completion_tokens || 0 };
        item.crossSpecialist = { status: 'drafted', draft };
        const selfCritique = await complete(options.solverApiUrl, options.solver, critiqueMessages(task, draft.text), 320, 6000 + item.repeat, options.caseTimeoutMs);
        const selfFinal = await complete(options.solverApiUrl, options.solver, reviseMessages(task, draft.text, selfCritique.text), task.maxTokens || 320, 7000 + item.repeat, options.caseTimeoutMs);
        item.selfRefine = {
          status: 'completed', draft, critique: selfCritique, final: selfFinal, score: scoreTask(task, selfFinal), calls: 3,
          wallMs: draft.wallMs + selfCritique.wallMs + selfFinal.wallMs,
          completionTokens: Number(draft.usage?.completion_tokens || 0) + Number(selfCritique.usage?.completion_tokens || 0) + Number(selfFinal.usage?.completion_tokens || 0),
        };
        console.log(`[self ${item.repeat + 1}/${options.repeats}] ${task.id} direct=${item.direct.score.score.toFixed(2)} refined=${item.selfRefine.score.score.toFixed(2)}`);
      } catch (error) {
        const message = error?.message || String(error);
        if (!item.direct.status) item.direct = { status: 'failed', error: message, calls: 1 };
        item.selfRefine = { status: 'failed', error: message, calls: item.direct.status === 'completed' ? 2 : 1 };
        if (!item.crossSpecialist.status) item.crossSpecialist = { status: 'failed', error: message };
        console.log(`[self] ${task.id} ERROR ${message.slice(0, 180)}`);
      }
      await save();
    }
  } else {
    report.loads.push({ model: options.solver, phase: 'draft-and-self-refine', wallSeconds: 0, reused: true, source: report.reusedDrafts.path });
    await save();
  }

  if (options.manageModels) {
    report.loads.push({ model: options.critic, phase: 'cross-specialist-critique', wallSeconds: await loadModel(options.critic, options.context) });
  } else {
    report.loads.push({ model: options.critic, phase: 'cross-specialist-critique', wallSeconds: 0, preloaded: true, apiUrl: options.criticApiUrl });
  }
  for (const item of report.cases) {
    if (item.crossSpecialist.status !== 'drafted') continue;
    const task = selectedTasks.find((candidate) => candidate.id === item.taskId);
    try {
      item.crossSpecialist.critique = await complete(options.criticApiUrl, options.critic, critiqueMessages(task, item.crossSpecialist.draft.text), 320, 8000 + item.repeat, options.caseTimeoutMs);
      item.crossSpecialist.status = 'critiqued';
      console.log(`[cross critic] ${task.id}`);
    } catch (error) {
      item.crossSpecialist.status = 'failed';
      item.crossSpecialist.error = error?.message || String(error);
    }
    await save();
  }

  if (options.manageModels) {
    report.loads.push({ model: options.solver, phase: 'cross-specialist-finalize', wallSeconds: await loadModel(options.solver, options.context) });
  } else {
    report.loads.push({ model: options.solver, phase: 'cross-specialist-finalize', wallSeconds: 0, preloaded: true, apiUrl: options.solverApiUrl });
  }
  for (const item of report.cases) {
    if (item.crossSpecialist.status !== 'critiqued') continue;
    const task = selectedTasks.find((candidate) => candidate.id === item.taskId);
    try {
      const final = await complete(options.solverApiUrl, options.solver, reviseMessages(task, item.crossSpecialist.draft.text, item.crossSpecialist.critique.text), task.maxTokens || 320, 9000 + item.repeat, options.caseTimeoutMs);
      const draft = item.crossSpecialist.draft;
      const critique = item.crossSpecialist.critique;
      item.crossSpecialist = {
        status: 'completed', draft, critique, final, score: scoreTask(task, final), calls: 3,
        wallMs: draft.wallMs + critique.wallMs + final.wallMs,
        completionTokens: Number(draft.usage?.completion_tokens || 0) + Number(critique.usage?.completion_tokens || 0) + Number(final.usage?.completion_tokens || 0),
      };
      console.log(`[cross final] ${task.id} score=${item.crossSpecialist.score.score.toFixed(2)}`);
    } catch (error) {
      item.crossSpecialist.status = 'failed';
      item.crossSpecialist.error = error?.message || String(error);
    }
    await save();
  }

  report.summaries = {
    direct: methodSummary(report.cases, 'direct'),
    selfRefine: methodSummary(report.cases, 'selfRefine'),
    crossSpecialist: methodSummary(report.cases, 'crossSpecialist'),
  };
  report.finishedAt = new Date().toISOString();
  if (options.manageModels) {
    await runLms(['unload', '--all'], 90_000).catch(() => null);
    if (options.restore) await runLms(['load', options.restore, '--yes', '--context-length', String(options.context), '--parallel', '1', '--identifier', options.restore]).catch((error) => { report.restoreError = error?.message || String(error); });
  }
  await save();
  console.log(JSON.stringify(report.summaries, null, 2));
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
