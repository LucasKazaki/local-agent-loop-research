import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { codeTasks, evaluateCodeTask, inspectCodeSuite, makeUnexecutedCodeReceipt } from './code-suite.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultLms = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
const apiBase = process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234';

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseArgs(argv) {
  const options = {
    models: [],
    repeats: 1,
    context: 8192,
    tokenScale: 1,
    timeoutMs: Number(process.env.BENCH_CASE_TIMEOUT_MS || 180_000),
    vmTimeoutMs: 250,
    output: 'results/code-latest.json',
    restore: '',
    lms: process.env.LMS_PATH || defaultLms,
    manageModels: true,
  };

  for (const arg of argv) {
    if (arg === '--no-manage-models') options.manageModels = false;
    else if (arg.startsWith('--models=')) options.models.push(...arg.slice(9).split(',').filter(Boolean));
    else if (arg.startsWith('--repeats=')) options.repeats = Math.trunc(boundedNumber(arg.slice(10), 1, 1, 20));
    else if (arg.startsWith('--context=')) options.context = Math.trunc(boundedNumber(arg.slice(10), 8192, 2048, 131_072));
    else if (arg.startsWith('--token-scale=')) options.tokenScale = boundedNumber(arg.slice(14), 1, 0.25, 4);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = Math.trunc(boundedNumber(arg.slice(13), 180_000, 1_000, 600_000));
    else if (arg.startsWith('--case-timeout-ms=')) options.timeoutMs = Math.trunc(boundedNumber(arg.slice(18), 180_000, 1_000, 600_000));
    else if (arg.startsWith('--vm-timeout-ms=')) options.vmTimeoutMs = Math.trunc(boundedNumber(arg.slice(16), 250, 10, 2_000));
    else if (arg.startsWith('--output=')) options.output = arg.slice(9);
    else if (arg.startsWith('--restore=')) options.restore = arg.slice(10);
    else if (arg.startsWith('--lms=')) options.lms = arg.slice(6);
    else if (!arg.startsWith('--')) options.models.push(arg);
    else throw new Error(`Unknown option: ${arg}`);
  }

  options.models = [...new Set(options.models)];
  if (options.models.length === 0) throw new Error('Pass one or more explicit local model keys with --models=model-a,model-b.');
  if (!options.output) throw new Error('--output must not be empty.');
  return options;
}

async function runLms(options, args, timeoutMs = 300_000) {
  const result = await execFileAsync(options.lms, args, {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
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
      '--query-gpu=index,name,memory.total,memory.used,memory.free,utilization.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 15_000, windowsHide: true });
    gpus = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
      const [index, name, totalMiB, usedMiB, freeMiB, utilizationPercent] = line.split(',').map((item) => item.trim());
      return {
        index: Number(index), name, totalMiB: Number(totalMiB), usedMiB: Number(usedMiB),
        freeMiB: Number(freeMiB), utilizationPercent: Number(utilizationPercent),
      };
    });
  } catch (error) {
    gpus = [{ error: error instanceof Error ? error.message : String(error) }];
  }
  return {
    sampledAt: new Date().toISOString(),
    totalRamGiB: Number((os.totalmem() / 2 ** 30).toFixed(2)),
    freeRamGiB: Number((os.freemem() / 2 ** 30).toFixed(2)),
    gpus,
  };
}

async function requestCode(model, task, repeat, options) {
  const body = {
    model,
    messages: [
      {
        role: 'system',
        content: 'You are in a deterministic local coding benchmark. Return only the requested synchronous JavaScript function declaration. Never use imports, require, process, network APIs, timers, dynamic code generation, or markdown.',
      },
      { role: 'user', content: task.prompt },
    ],
    temperature: 0,
    seed: 20_000 + repeat,
    max_tokens: Math.ceil((task.maxTokens || 320) * options.tokenScale),
    stream: false,
  };
  const started = performance.now();
  const response = await fetch(`${apiBase}/api/v0/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  const rawBody = await response.text();
  const wallMs = Math.round(performance.now() - started);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${rawBody.slice(0, 1200)}`);
  const payload = JSON.parse(rawBody);
  const message = payload?.choices?.[0]?.message || {};
  return {
    text: String(message.content || ''),
    reasoning: String(message.reasoning || ''),
    message,
    wallMs,
    finishReason: payload?.choices?.[0]?.finish_reason || '',
    usage: payload?.usage || {},
    stats: payload?.stats || {},
    modelInfo: payload?.model_info || {},
    runtime: payload?.runtime || {},
  };
}

function summarizeModel(modelRecord, repeats) {
  const possible = codeTasks.length * repeats;
  const completed = modelRecord.cases.filter((item) => item.status === 'completed');
  const score = modelRecord.cases.reduce((sum, item) => sum + Number(item.receipt?.score || 0), 0);
  const stats = completed.map((item) => item.response?.stats).filter(Boolean);
  const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    score: Number(score.toFixed(6)),
    possible,
    passRate: possible ? Number((score / possible).toFixed(6)) : 0,
    completedCases: completed.length,
    requestFailedCases: modelRecord.cases.filter((item) => item.status === 'request_failed').length,
    fullyPassedCases: modelRecord.cases.filter((item) => item.receipt?.score === 1).length,
    executedTests: modelRecord.cases.reduce((sum, item) => sum + Number(item.receipt?.totalTests || 0), 0),
    passedTests: modelRecord.cases.reduce((sum, item) => sum + Number(item.receipt?.passedTests || 0), 0),
    meanTokensPerSecond: Number(mean(stats.map((item) => Number(item.tokens_per_second || 0)).filter((value) => value > 0)).toFixed(2)),
    totalModelWallSeconds: Number((modelRecord.cases.reduce((sum, item) => sum + Number(item.response?.wallMs || item.wallMs || 0), 0) / 1000).toFixed(2)),
    totalVmWallSeconds: Number((modelRecord.cases.reduce((sum, item) => sum + Number(item.receipt?.wallMs || 0), 0) / 1000).toFixed(3)),
  };
}

function initialRestoreModel(initialLoaded) {
  return initialLoaded?.[0]?.identifier
    || initialLoaded?.[0]?.modelKey
    || initialLoaded?.[0]?.model?.modelKey
    || '';
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const suiteInspection = inspectCodeSuite();
  if (!suiteInspection.valid) throw new Error(`Invalid code suite: ${suiteInspection.errors.join('; ')}`);

  const outputPath = path.resolve(repositoryRoot, options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const suiteSource = await readFile(new URL('./code-suite.mjs', import.meta.url), 'utf8');
  const inventory = await lmsJson(options, ['ls']);
  const initialLoaded = await lmsJson(options, ['ps']).catch(() => []);
  const report = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    options: { ...options, lms: path.basename(options.lms) },
    environment: {
      platform: process.platform, release: os.release(), arch: os.arch(),
      cpu: os.cpus()[0]?.model, node: process.version, apiBase,
    },
    suite: {
      hashSha256: createHash('sha256').update(suiteSource).digest('hex'),
      taskIds: codeTasks.map((task) => task.id),
      repeats: options.repeats,
      inspection: suiteInspection,
    },
    executionPolicy: {
      oneNamedSynchronousFunction: true,
      freshVmContextPerTest: true,
      vmCodeGeneration: { strings: false, wasm: false },
      requireExposed: false,
      processExposed: false,
      maxSourceBytes: 24 * 1024,
      vmTimeoutMs: options.vmTimeoutMs,
    },
    inventory,
    initialLoaded,
    hardwareBefore: await sampleHardware(),
    models: [],
    ranking: [],
  };
  const save = () => writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await save();

  console.log(`[code-benchmark] tasks=${codeTasks.length} repeats=${options.repeats} models=${options.models.length}`);
  console.log(`[code-benchmark] output=${outputPath}`);

  for (let modelIndex = 0; modelIndex < options.models.length; modelIndex += 1) {
    const model = options.models[modelIndex];
    const record = {
      model,
      meta: inventory.find((item) => item.modelKey === model) || null,
      status: 'loading',
      load: null,
      hardwareLoaded: null,
      cases: [],
      summary: null,
    };
    report.models.push(record);
    console.log(`[model ${modelIndex + 1}/${options.models.length}] ${model}`);

    try {
      if (options.manageModels) {
        await runLms(options, ['unload', '--all'], 90_000).catch(() => null);
        const loadStarted = performance.now();
        const load = await runLms(options, [
          'load', model, '--yes', '--context-length', String(options.context), '--parallel', '1', '--identifier', model,
        ], 300_000);
        record.load = {
          wallSeconds: Number(((performance.now() - loadStarted) / 1000).toFixed(2)),
          stdout: load.stdout.trim(),
          stderr: load.stderr.trim(),
        };
      }

      record.status = 'running';
      record.hardwareLoaded = await sampleHardware();
      for (let repeat = 0; repeat < options.repeats; repeat += 1) {
        for (const task of codeTasks) {
          const item = {
            taskId: task.id,
            category: task.category,
            functionName: task.functionName,
            repeat,
            status: 'requesting',
            response: null,
            candidateSource: null,
            receipt: makeUnexecutedCodeReceipt(task, 'not_executed', 'Model response has not completed.'),
          };
          record.cases.push(item);
          const started = performance.now();
          try {
            item.response = await requestCode(model, task, repeat, options);
            const evaluated = evaluateCodeTask(task, item.response.text, { timeoutMs: options.vmTimeoutMs });
            item.candidateSource = evaluated.source;
            item.receipt = evaluated.receipt;
            item.status = 'completed';
            console.log(
              `  [${repeat + 1}/${options.repeats}] ${task.id} score=${item.receipt.score.toFixed(3)} `
              + `tests=${item.receipt.passedTests}/${item.receipt.totalTests} status=${item.receipt.status}`,
            );
          } catch (error) {
            item.status = 'request_failed';
            item.error = error instanceof Error ? error.message : String(error);
            item.wallMs = Math.round(performance.now() - started);
            item.receipt = makeUnexecutedCodeReceipt(task, 'request_failed', item.error);
            console.log(`  [${repeat + 1}/${options.repeats}] ${task.id} REQUEST ERROR ${item.error.slice(0, 220)}`);
          }

          record.summary = summarizeModel(record, options.repeats);
          await save();
        }
      }
      record.status = 'completed';
      record.summary = summarizeModel(record, options.repeats);
    } catch (error) {
      record.status = 'load_failed';
      record.error = error instanceof Error ? error.message : String(error);
      record.summary = summarizeModel(record, options.repeats);
      console.log(`  LOAD ERROR ${record.error.slice(0, 500)}`);
    } finally {
      record.hardwareAfter = await sampleHardware();
      if (options.manageModels) await runLms(options, ['unload', '--all'], 90_000).catch(() => null);
      await save();
    }
  }

  const restore = options.restore || initialRestoreModel(initialLoaded);
  if (options.manageModels && restore) {
    try {
      console.log(`[code-benchmark] restoring ${restore}`);
      await runLms(options, [
        'load', restore, '--yes', '--context-length', String(options.context), '--parallel', '1', '--identifier', restore,
      ], 300_000);
      report.restoredModel = restore;
    } catch (error) {
      report.restoreError = error instanceof Error ? error.message : String(error);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.hardwareAfter = await sampleHardware();
  report.ranking = report.models
    .filter((model) => model.summary)
    .map((model) => ({ model: model.model, ...model.summary }))
    .sort((left, right) => right.passRate - left.passRate || right.fullyPassedCases - left.fullyPassedCases || left.totalModelWallSeconds - right.totalModelWallSeconds);
  await save();
  console.log('[code-benchmark] ranking');
  for (const row of report.ranking) {
    console.log(`  ${(row.passRate * 100).toFixed(1)}% | ${row.fullyPassedCases}/${row.possible} full | ${row.model}`);
  }
  console.log(`[code-benchmark] complete output=${outputPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
