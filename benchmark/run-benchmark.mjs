import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { scoreTask, selectTasks } from './task-suite.mjs';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '..');
const DEFAULT_LMS = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
const API_BASE = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234';

function parseArgs(argv) {
  const options = {
    stage: 'screen', repeats: 1, context: 8192, manageModels: true,
    caseTimeoutMs: Number(process.env.BENCH_CASE_TIMEOUT_MS || 240_000), tokenScale: 1,
    lms: process.env.LMS_PATH || DEFAULT_LMS, apiPath: process.env.BENCH_API_PATH || '/api/v0/chat/completions', models: [], restore: '', output: '',
  };
  for (const arg of argv) {
    if (arg === '--no-manage-models') options.manageModels = false;
    else if (arg.startsWith('--stage=')) options.stage = arg.slice(8);
    else if (arg.startsWith('--repeats=')) options.repeats = Math.max(1, Number(arg.slice(10)) || 1);
    else if (arg.startsWith('--context=')) options.context = Math.max(2048, Number(arg.slice(10)) || 8192);
    else if (arg.startsWith('--case-timeout-ms=')) options.caseTimeoutMs = Math.max(1_000, Number(arg.slice(18)) || 240_000);
    else if (arg.startsWith('--token-scale=')) options.tokenScale = Math.max(0.25, Number(arg.slice(14)) || 1);
    else if (arg.startsWith('--lms=')) options.lms = arg.slice(6);
    else if (arg.startsWith('--api-path=')) options.apiPath = arg.slice(11);
    else if (arg.startsWith('--restore=')) options.restore = arg.slice(10);
    else if (arg.startsWith('--output=')) options.output = arg.slice(9);
    else if (arg.startsWith('--models=')) options.models.push(...arg.slice(9).split(',').filter(Boolean));
    else if (!arg.startsWith('--')) options.models.push(arg);
  }
  if (!options.apiPath.startsWith('/') || options.apiPath.includes('://')) throw new Error('--api-path must be an absolute URL path.');
  return options;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function runLms(options, args, timeout = 240_000) {
  const result = await execFileAsync(options.lms, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

async function lmsJson(options, args) {
  const { stdout } = await runLms(options, [...args, '--json']);
  return JSON.parse(stdout);
}

async function sampleHardware() {
  let gpus = [];
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu,power.draw',
      '--format=csv,noheader,nounits',
    ], { timeout: 15_000, windowsHide: true });
    gpus = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [index, name, totalMiB, usedMiB, freeMiB, utilizationPercent, powerWatts] = line.split(',').map((item) => item.trim());
      return { index: Number(index), name, totalMiB: Number(totalMiB), usedMiB: Number(usedMiB), freeMiB: Number(freeMiB), utilizationPercent: Number(utilizationPercent), powerWatts: Number(powerWatts) };
    });
  } catch (error) {
    gpus = [{ error: error?.message || String(error) }];
  }
  return {
    sampledAt: new Date().toISOString(),
    totalRamGiB: Number((os.totalmem() / 2 ** 30).toFixed(2)),
    freeRamGiB: Number((os.freemem() / 2 ** 30).toFixed(2)),
    gpus,
  };
}

async function requestCompletion(model, task, repeat, caseTimeoutMs, tokenScale, apiPath) {
  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are in a deterministic local-agent benchmark. Follow the requested output contract exactly. Do not claim to use unavailable tools or sources.' },
      { role: 'user', content: task.prompt },
    ],
    temperature: 0,
    seed: 1000 + repeat,
    max_tokens: Math.ceil((task.maxTokens || 256) * tokenScale),
    stream: false,
  };
  if (task.tools) {
    body.tools = task.tools;
    body.tool_choice = 'auto';
  }
  const started = performance.now();
  const response = await fetch(`${API_BASE}${apiPath}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(caseTimeoutMs),
  });
  const raw = await response.text();
  const wallMs = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const payload = JSON.parse(raw);
  const message = payload?.choices?.[0]?.message || {};
  const text = String(message?.content || '');
  return {
    text, message, wallMs,
    reasoning: String(message?.reasoning || ''),
    finishReason: payload?.choices?.[0]?.finish_reason || '',
    usage: payload?.usage || {}, stats: payload?.stats || {},
    modelInfo: payload?.model_info || {}, runtime: payload?.runtime || {},
  };
}

function summarizeModel(modelRecord, tasks) {
  const completed = modelRecord.cases.filter((item) => item.status === 'completed');
  const totalScore = completed.reduce((sum, item) => sum + item.score.score, 0);
  const possible = modelRecord.cases.length;
  const categories = {};
  for (const task of tasks) {
    const rows = modelRecord.cases.filter((item) => item.taskId === task.id && item.status === 'completed');
    if (!categories[task.category]) categories[task.category] = { score: 0, possible: 0, passRate: 0 };
    categories[task.category].score += rows.reduce((sum, item) => sum + item.score.score, 0);
    categories[task.category].possible += modelRecord.cases.filter((item) => item.taskId === task.id).length;
  }
  for (const value of Object.values(categories)) value.passRate = value.possible ? value.score / value.possible : 0;
  const statsRows = completed.map((item) => item.response?.stats).filter(Boolean);
  const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return {
    score: totalScore, possible, passRate: possible ? totalScore / possible : 0,
    completedCases: completed.length, failedCases: modelRecord.cases.length - completed.length,
    meanTokensPerSecond: Number(mean(statsRows.map((item) => Number(item.tokens_per_second || 0)).filter((x) => x > 0)).toFixed(2)),
    meanTimeToFirstTokenSeconds: Number(mean(statsRows.map((item) => Number(item.time_to_first_token || 0)).filter((x) => x > 0)).toFixed(3)),
    totalWallSeconds: Number((modelRecord.cases.reduce((sum, item) => sum + Number(item.response?.wallMs || item.wallMs || 0), 0) / 1000).toFixed(2)),
    categories,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const selectedTasks = selectTasks(options.stage);
  const source = await readFile(new URL('./task-suite.mjs', import.meta.url), 'utf8');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.resolve(options.output || path.join(ROOT, 'results', `benchmark-${options.stage}-${timestamp}.json`));
  await mkdir(path.dirname(outputPath), { recursive: true });

  const inventory = await lmsJson(options, ['ls']);
  const initialLoaded = await lmsJson(options, ['ps']).catch(() => []);
  const defaultModels = inventory.filter((item) => item.type === 'llm').map((item) => item.modelKey);
  const models = [...new Set(options.models.length ? options.models : defaultModels)];
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null,
    options: { ...options, lms: path.basename(options.lms) },
    environment: { platform: process.platform, release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, node: process.version, apiBase: API_BASE, apiPath: options.apiPath },
    taskSuite: { hashSha256: sha256(source), stage: options.stage, taskIds: selectedTasks.map((task) => task.id), repeats: options.repeats },
    inventory, initialLoaded, hardwareBefore: await sampleHardware(), models: [], ranking: [],
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[benchmark] stage=${options.stage} tasks=${selectedTasks.length} repeats=${options.repeats} models=${models.length}`);
  console.log(`[benchmark] output=${outputPath}`);

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    const meta = inventory.find((item) => item.modelKey === model) || null;
    const record = { model, meta, status: 'loading', load: null, hardwareLoaded: null, cases: [], summary: null };
    report.models.push(record);
    console.log(`[model ${modelIndex + 1}/${models.length}] ${model}`);
    try {
      if (options.manageModels) {
        await runLms(options, ['unload', '--all'], 90_000).catch(() => null);
        const loadStarted = performance.now();
        const load = await runLms(options, ['load', model, '--yes', '--context-length', String(options.context), '--parallel', '1', '--identifier', model], 300_000);
        record.load = { wallSeconds: Number(((performance.now() - loadStarted) / 1000).toFixed(2)), stdout: load.stdout.trim(), stderr: load.stderr.trim() };
      }
      record.status = 'running';
      record.hardwareLoaded = await sampleHardware();
      for (let repeat = 0; repeat < options.repeats; repeat += 1) {
        for (let taskIndex = 0; taskIndex < selectedTasks.length; taskIndex += 1) {
          const task = selectedTasks[taskIndex];
          const item = { taskId: task.id, category: task.category, repeat, status: 'running', score: { score: 0 } };
          record.cases.push(item);
          const started = performance.now();
          try {
            const response = await requestCompletion(model, task, repeat, options.caseTimeoutMs, options.tokenScale, options.apiPath);
            item.status = 'completed';
            item.response = response;
            item.score = scoreTask(task, response);
            console.log(`  [${repeat + 1}/${options.repeats} ${taskIndex + 1}/${selectedTasks.length}] ${task.id} score=${item.score.score.toFixed(2)} tps=${Number(response.stats?.tokens_per_second || 0).toFixed(1)}`);
          } catch (error) {
            item.status = 'failed';
            item.error = error?.message || String(error);
            item.wallMs = Math.round(performance.now() - started);
            console.log(`  [${repeat + 1}/${options.repeats} ${taskIndex + 1}/${selectedTasks.length}] ${task.id} ERROR ${item.error.slice(0, 180)}`);
          }
          record.summary = summarizeModel(record, selectedTasks);
          await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        }
      }
      record.status = 'completed';
      record.summary = summarizeModel(record, selectedTasks);
    } catch (error) {
      record.status = 'load_failed';
      record.error = error?.message || String(error);
      console.log(`  LOAD ERROR ${record.error.slice(0, 500)}`);
    } finally {
      record.hardwareAfter = await sampleHardware();
      if (options.manageModels) await runLms(options, ['unload', '--all'], 90_000).catch(() => null);
      await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
  }

  const restore = options.restore || initialLoaded?.[0]?.identifier || initialLoaded?.[0]?.modelKey || initialLoaded?.[0]?.model?.modelKey || '';
  if (options.manageModels && restore) {
    try {
      console.log(`[benchmark] restoring ${restore}`);
      await runLms(options, ['load', restore, '--yes', '--context-length', String(options.context), '--parallel', '1', '--identifier', restore], 300_000);
      report.restoredModel = restore;
    } catch (error) {
      report.restoreError = error?.message || String(error);
    }
  }
  report.finishedAt = new Date().toISOString();
  report.hardwareAfter = await sampleHardware();
  report.ranking = report.models.filter((item) => item.summary).map((item) => ({ model: item.model, ...item.summary })).sort((a, b) => b.passRate - a.passRate || a.totalWallSeconds - b.totalWallSeconds);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log('[benchmark] ranking');
  for (const row of report.ranking) console.log(`  ${(row.passRate * 100).toFixed(1)}% | ${row.meanTokensPerSecond.toFixed(1)} tok/s | ${row.model}`);
  console.log(`[benchmark] complete output=${outputPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
