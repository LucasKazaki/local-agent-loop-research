import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { makeDiagnosticImage, visionTasks } from './vision-suite.mjs';

const execFileAsync = promisify(execFile);
const NODE_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '..');
const LMS = process.env.LMS_PATH || path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
const API_BASE = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234';

function parseArgs(argv) {
  const options = { models: [], repeats: 1, context: 8192, tokenScale: 1, caseTimeoutMs: 90_000, output: 'results/vision-installed.json', restore: '' };
  for (const arg of argv) {
    if (arg.startsWith('--models=')) options.models.push(...arg.slice(9).split(',').filter(Boolean));
    else if (arg.startsWith('--repeats=')) options.repeats = Math.max(1, Number(arg.slice(10)) || 1);
    else if (arg.startsWith('--context=')) options.context = Math.max(2048, Number(arg.slice(10)) || 8192);
    else if (arg.startsWith('--token-scale=')) options.tokenScale = Math.max(0.25, Number(arg.slice(14)) || 1);
    else if (arg.startsWith('--case-timeout-ms=')) options.caseTimeoutMs = Math.max(1000, Number(arg.slice(18)) || 90_000);
    else if (arg.startsWith('--output=')) options.output = arg.slice(9);
    else if (arg.startsWith('--restore=')) options.restore = arg.slice(10);
  }
  if (!options.models.length) throw new Error('Pass vision-capable model keys with --models=.');
  return options;
}

async function runLms(args, timeout = 300_000) {
  return execFileAsync(LMS, args, { timeout, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
}

async function completion(model, task, dataUrl, repeat, timeout, tokenScale) {
  const started = performance.now();
  const response = await fetch(`${API_BASE}/api/v0/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0, seed: 3000 + repeat, max_tokens: Math.ceil(task.maxTokens * tokenScale), stream: false,
      messages: [
        { role: 'system', content: 'Use only the supplied image. Follow the final-output contract exactly.' },
        { role: 'user', content: [{ type: 'text', text: task.prompt }, { type: 'image_url', image_url: { url: dataUrl } }] },
      ],
    }),
    signal: AbortSignal.timeout(timeout),
  });
  const raw = await response.text();
  const wallMs = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${raw.slice(0, 1200)}`);
  const payload = JSON.parse(raw);
  const message = payload?.choices?.[0]?.message || {};
  return { text: String(message.content || ''), message, wallMs, usage: payload.usage || {}, stats: payload.stats || {}, modelInfo: payload.model_info || {}, runtime: payload.runtime || {} };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = path.resolve(NODE_ROOT, options.output);
  await mkdir(path.dirname(output), { recursive: true });
  const suiteSource = await readFile(new URL('./vision-suite.mjs', import.meta.url), 'utf8');
  const image = makeDiagnosticImage();
  const imagePath = path.resolve(NODE_ROOT, 'benchmark/assets/vision-diagnostic.png');
  await mkdir(path.dirname(imagePath), { recursive: true });
  await writeFile(imagePath, image.png);
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), finishedAt: null, options,
    environment: { platform: process.platform, cpu: os.cpus()[0]?.model, node: process.version, apiBase: API_BASE },
    suite: { hashSha256: createHash('sha256').update(suiteSource).digest('hex'), imageSha256: createHash('sha256').update(image.png).digest('hex'), tasks: visionTasks.map((task) => task.id) },
    models: [], ranking: [],
  };
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  for (const model of options.models) {
    console.log(`[vision] ${model}`);
    const row = { model, status: 'loading', cases: [] };
    report.models.push(row);
    try {
      await runLms(['unload', '--all'], 90_000).catch(() => null);
      const loadStarted = performance.now();
      await runLms(['load', model, '--yes', '--context-length', String(options.context), '--parallel', '1', '--identifier', model]);
      row.loadWallSeconds = Number(((performance.now() - loadStarted) / 1000).toFixed(2));
      row.status = 'running';
      for (let repeat = 0; repeat < options.repeats; repeat += 1) {
        for (const task of visionTasks) {
          const item = { taskId: task.id, category: task.category, repeat, status: 'running', score: 0 };
          row.cases.push(item);
          try {
            item.response = await completion(model, task, image.dataUrl, repeat, options.caseTimeoutMs, options.tokenScale);
            item.score = task.score(item.response.text);
            item.status = 'completed';
            console.log(`  ${task.id} score=${item.score.toFixed(2)} tps=${Number(item.response.stats?.tokens_per_second || 0).toFixed(1)}`);
          } catch (error) {
            item.status = 'failed';
            item.error = error?.message || String(error);
            console.log(`  ${task.id} ERROR ${item.error.slice(0, 180)}`);
          }
          await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
        }
      }
      row.status = 'completed';
    } catch (error) {
      row.status = 'load_failed';
      row.error = error?.message || String(error);
    } finally {
      row.score = row.cases.reduce((sum, item) => sum + Number(item.score || 0), 0);
      row.possible = visionTasks.length * options.repeats;
      row.passRate = row.possible ? row.score / row.possible : 0;
      await runLms(['unload', '--all'], 90_000).catch(() => null);
      await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    }
  }
  if (options.restore) await runLms(['load', options.restore, '--yes', '--context-length', String(options.context), '--parallel', '1', '--identifier', options.restore]).catch((error) => { report.restoreError = error?.message || String(error); });
  report.ranking = report.models.map(({ model, passRate, score, possible }) => ({ model, passRate, score, possible })).sort((a, b) => b.passRate - a.passRate);
  report.finishedAt = new Date().toISOString();
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[vision] complete ${output}`);
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
