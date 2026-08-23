import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { scoreTask, selectTasks } from './task-suite.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '..');
const LMS = process.env.LMS_PATH || path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
const API_BASE = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234';
const ALLOWED_REASONING = new Set(['off', 'low', 'medium', 'high', 'on']);

function parseArgs(argv) {
  const options = {
    profiles: [], repeats: 1, context: 8192, caseTimeoutMs: 120_000,
    tokenScale: 2, output: 'results/reasoning-profiles.json', restore: '',
  };
  for (const arg of argv) {
    if (arg.startsWith('--profiles=')) options.profiles.push(...arg.slice(11).split(',').filter(Boolean));
    else if (arg.startsWith('--repeats=')) options.repeats = Math.max(1, Number(arg.slice(10)) || 1);
    else if (arg.startsWith('--context=')) options.context = Math.max(2048, Number(arg.slice(10)) || 8192);
    else if (arg.startsWith('--case-timeout-ms=')) options.caseTimeoutMs = Math.max(1000, Number(arg.slice(18)) || 120_000);
    else if (arg.startsWith('--token-scale=')) options.tokenScale = Math.max(0.25, Number(arg.slice(14)) || 2);
    else if (arg.startsWith('--output=')) options.output = arg.slice(9);
    else if (arg.startsWith('--restore=')) options.restore = arg.slice(10);
  }
  if (!options.profiles.length) throw new Error('Pass --profiles=model@off,model@low.');
  options.profiles = options.profiles.map((value) => {
    const splitAt = value.lastIndexOf('@');
    if (splitAt < 1) throw new Error(`Invalid reasoning profile: ${value}`);
    const model = value.slice(0, splitAt);
    const reasoning = value.slice(splitAt + 1);
    if (!ALLOWED_REASONING.has(reasoning)) throw new Error(`Unsupported reasoning setting: ${reasoning}`);
    return { id: `${model}@${reasoning}`, model, reasoning };
  });
  return options;
}

async function runLms(args, timeout = 300_000) {
  return execFileAsync(LMS, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

async function lmsJson(args) {
  const { stdout } = await runLms([...args, '--json']);
  return JSON.parse(String(stdout));
}

async function sampleHardware() {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=index,name,memory.total,memory.used,utilization.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 15_000, windowsHide: true });
    return stdout.trim().split(/\r?\n/).map((line) => {
      const [index, name, totalMiB, usedMiB, utilizationPercent] = line.split(',').map((part) => part.trim());
      return { index: Number(index), name, totalMiB: Number(totalMiB), usedMiB: Number(usedMiB), utilizationPercent: Number(utilizationPercent) };
    });
  } catch (error) {
    return [{ error: error?.message || String(error) }];
  }
}

async function complete(profile, task, options) {
  const body = {
    model: profile.model,
    system_prompt: 'You are in a deterministic local-agent benchmark. Follow the requested final-output contract exactly. Use only supplied evidence.',
    input: task.prompt,
    reasoning: profile.reasoning,
    temperature: 0,
    max_output_tokens: Math.ceil((task.maxTokens || 256) * options.tokenScale),
    context_length: options.context,
    store: false,
    stream: false,
  };
  const started = performance.now();
  const response = await fetch(`${API_BASE}/api/v1/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.caseTimeoutMs),
  });
  const raw = await response.text();
  const wallMs = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const payload = JSON.parse(raw);
  const output = Array.isArray(payload.output) ? payload.output : [];
  const text = output.filter((item) => item?.type === 'message').map((item) => String(item.content || '')).join('\n');
  const reasoning = output.filter((item) => item?.type === 'reasoning').map((item) => String(item.content || '')).join('\n');
  const stats = payload.stats || {};
  return {
    text,
    message: { content: text, reasoning },
    reasoning,
    wallMs,
    finishReason: '',
    usage: {
      prompt_tokens: Number(stats.input_tokens || 0),
      completion_tokens: Number(stats.total_output_tokens || 0),
      reasoning_tokens: Number(stats.reasoning_output_tokens || 0),
    },
    stats: {
      ...stats,
      time_to_first_token: Number(stats.time_to_first_token_seconds || 0),
    },
    modelInfo: { model_instance_id: payload.model_instance_id || '' },
    rawPayload: payload,
  };
}

function summarize(row) {
  const completeCases = row.cases.filter((item) => item.status === 'completed');
  const score = completeCases.reduce((sum, item) => sum + Number(item.score?.score || 0), 0);
  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const tps = completeCases.map((item) => Number(item.response?.stats?.tokens_per_second || 0)).filter((value) => value > 0);
  const reasoningTokens = completeCases.reduce((sum, item) => sum + Number(item.response?.usage?.reasoning_tokens || 0), 0);
  const outputTokens = completeCases.reduce((sum, item) => sum + Number(item.response?.usage?.completion_tokens || 0), 0);
  return {
    score, possible: row.cases.length, passRate: row.cases.length ? score / row.cases.length : 0,
    completedCases: completeCases.length, failedCases: row.cases.length - completeCases.length,
    meanTokensPerSecond: Number(mean(tps).toFixed(2)), reasoningTokens, outputTokens,
    totalWallSeconds: Number((row.cases.reduce((sum, item) => sum + Number(item.response?.wallMs || item.wallMs || 0), 0) / 1000).toFixed(2)),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tasks = selectTasks('screen').filter((task) => !task.tools);
  const suiteSource = await readFile(new URL('./task-suite.mjs', import.meta.url), 'utf8');
  const output = path.resolve(ROOT, options.output);
  await mkdir(path.dirname(output), { recursive: true });
  const inventory = await lmsJson(['ls']);
  const initialLoaded = await lmsJson(['ps']).catch(() => []);
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null,
    options, environment: { platform: process.platform, cpu: os.cpus()[0]?.model, node: process.version, apiBase: API_BASE },
    taskSuite: { hashSha256: createHash('sha256').update(suiteSource).digest('hex'), taskIds: tasks.map((task) => task.id), excludes: ['native_tool_read_file'] },
    inventory, initialLoaded, hardwareBefore: await sampleHardware(), profiles: [], ranking: [],
  };
  const save = () => writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await save();

  for (const profile of options.profiles) {
    const row = { ...profile, status: 'loading', cases: [], summary: null };
    report.profiles.push(row);
    console.log(`[reasoning-profile] ${profile.id}`);
    try {
      await runLms(['unload', '--all'], 90_000).catch(() => null);
      // Native v1 chat manages its own model instance. Preloading with `lms load`
      // creates a second instance with different parallel defaults and corrupts
      // both throughput and residency measurements.
      row.loadMode = 'native-v1-autoload';
      row.status = 'running';
      for (let repeat = 0; repeat < options.repeats; repeat += 1) {
        for (const task of tasks) {
          const item = { taskId: task.id, category: task.category, repeat, status: 'running', score: { score: 0 } };
          row.cases.push(item);
          const started = performance.now();
          try {
            item.response = await complete(profile, task, options);
            if (!row.hardwareLoaded) row.hardwareLoaded = await sampleHardware();
            item.score = scoreTask(task, item.response);
            item.status = 'completed';
            console.log(`  ${task.id} score=${item.score.score.toFixed(2)} tps=${Number(item.response.stats.tokens_per_second || 0).toFixed(1)}`);
          } catch (error) {
            item.status = 'failed';
            item.error = error?.message || String(error);
            item.wallMs = Math.round(performance.now() - started);
            console.log(`  ${task.id} ERROR ${item.error.slice(0, 180)}`);
          }
          row.summary = summarize(row);
          await save();
        }
      }
      row.status = 'completed';
    } catch (error) {
      row.status = 'load_failed';
      row.error = error?.message || String(error);
    } finally {
      row.summary = summarize(row);
      row.hardwareAfter = await sampleHardware();
      await runLms(['unload', '--all'], 90_000).catch(() => null);
      await save();
    }
  }

  if (options.restore) await runLms(['load', options.restore, '--yes', '--context-length', String(options.context), '--parallel', '1', '--identifier', options.restore]).catch((error) => { report.restoreError = error?.message || String(error); });
  report.finishedAt = new Date().toISOString();
  report.hardwareAfter = await sampleHardware();
  report.ranking = report.profiles.map((row) => ({ id: row.id, model: row.model, reasoning: row.reasoning, ...row.summary })).sort((a, b) => b.passRate - a.passRate || a.totalWallSeconds - b.totalWallSeconds);
  await save();
  console.log(JSON.stringify(report.ranking, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
