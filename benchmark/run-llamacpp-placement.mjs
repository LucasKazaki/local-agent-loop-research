#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildBenchmarkPlan,
  buildLlamaBenchArguments,
  buildPlacements,
  evaluateDeviceProbe,
  evaluateHelpProbe,
  parseNvidiaSmiCsv,
  safeChildEnvironment,
  staticHardwareIdentity,
  validateExecutionConsent,
  validatePlacementOptions,
} from './llamacpp-placement-lib.mjs';
import {
  inspectGgufArtifact,
  redactSensitiveText,
  sha256File,
  sha256Text,
} from '../scripts/model-inventory-lib.mjs';

const benchmarkDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(benchmarkDirectory, '..');

function usage() {
  return `Usage (plan only; no inference):
  node benchmark/run-llamacpp-placement.mjs --llama-bench=<path> --model=<gguf> --model-id=<id> \\
    --single-device=CUDA0 --dual-devices=CUDA0,CUDA1 --nvidia-indices=0,1 --tensor-split=1,1

To execute later, add both:
  --execute --acknowledge-gpu-workload

Important options:
  --output=<repo-path>       New receipt path; existing files are never overwritten.
  --rounds=<n>               Alternating A/B rounds (default: 3).
  --prompt-tokens=<n>        Synthetic prompt-processing tokens (default: 512).
  --generation-tokens=<n>    Synthetic generation tokens (default: 128).
  --threads=<n>              CPU threads (default: 8).
  --gpu-layers=<n>           Maximum offloaded layers (default: 999).
  --fit-target=<MiB>         Optional equal reserve margin per selected GPU.
  --fit-ctx=<tokens>         Required with --fit-target; minimum fit context.
  --telemetry-ms=<n>         NVIDIA sample interval (default: 1000; minimum: 250).
  --timeout-ms=<n>           Per-process timeout (default: 600000).
  --cooldown-ms=<n>          Delay between cases (default: 5000; maximum: 60000).
  --help                     Show this help.
`;
}

function parseNumberList(value, name) {
  const values = value.split(',').map((item) => Number(item.trim()));
  if (values.some((item) => !Number.isFinite(item))) throw new Error(`${name} contains a non-number.`);
  return values;
}

function parseInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be an integer.`);
  return parsed;
}

export function parsePlacementArgs(argv) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const options = {
    llamaBenchPath: '',
    modelPath: '',
    modelId: '',
    singleDevice: '',
    dualDevices: [],
    nvidiaIndices: [],
    tensorSplit: [],
    nvidiaSmiPath: 'nvidia-smi',
    outputPath: path.join(repositoryRoot, 'results', `llamacpp-placement-${timestamp}.json`),
    rounds: 3,
    promptTokens: 512,
    generationTokens: 128,
    threads: 8,
    batchSize: 512,
    ubatchSize: 128,
    gpuLayers: 999,
    fitTargetMiB: null,
    fitContextTokens: null,
    cacheTypeK: 'f16',
    cacheTypeV: 'f16',
    flashAttention: 'auto',
    loadMode: 'mmap',
    timeoutMs: 600_000,
    telemetryMs: 1_000,
    cooldownMs: 5_000,
    maxOutputBytes: 64 * 1024 * 1024,
    execute: false,
    acknowledgeGpuWorkload: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--execute') options.execute = true;
    else if (arg === '--acknowledge-gpu-workload') options.acknowledgeGpuWorkload = true;
    else if (arg.startsWith('--llama-bench=')) options.llamaBenchPath = path.resolve(arg.slice('--llama-bench='.length));
    else if (arg.startsWith('--model=')) options.modelPath = path.resolve(arg.slice('--model='.length));
    else if (arg.startsWith('--model-id=')) options.modelId = arg.slice('--model-id='.length);
    else if (arg.startsWith('--single-device=')) options.singleDevice = arg.slice('--single-device='.length);
    else if (arg.startsWith('--dual-devices=')) options.dualDevices = arg.slice('--dual-devices='.length).split(',').map((item) => item.trim()).filter(Boolean);
    else if (arg.startsWith('--nvidia-indices=')) options.nvidiaIndices = parseNumberList(arg.slice('--nvidia-indices='.length), '--nvidia-indices');
    else if (arg.startsWith('--tensor-split=')) options.tensorSplit = parseNumberList(arg.slice('--tensor-split='.length), '--tensor-split');
    else if (arg.startsWith('--nvidia-smi=')) options.nvidiaSmiPath = path.resolve(arg.slice('--nvidia-smi='.length));
    else if (arg.startsWith('--output=')) options.outputPath = path.resolve(arg.slice('--output='.length));
    else if (arg.startsWith('--rounds=')) options.rounds = parseInteger(arg.slice('--rounds='.length), '--rounds');
    else if (arg.startsWith('--prompt-tokens=')) options.promptTokens = parseInteger(arg.slice('--prompt-tokens='.length), '--prompt-tokens');
    else if (arg.startsWith('--generation-tokens=')) options.generationTokens = parseInteger(arg.slice('--generation-tokens='.length), '--generation-tokens');
    else if (arg.startsWith('--threads=')) options.threads = parseInteger(arg.slice('--threads='.length), '--threads');
    else if (arg.startsWith('--batch-size=')) options.batchSize = parseInteger(arg.slice('--batch-size='.length), '--batch-size');
    else if (arg.startsWith('--ubatch-size=')) options.ubatchSize = parseInteger(arg.slice('--ubatch-size='.length), '--ubatch-size');
    else if (arg.startsWith('--gpu-layers=')) options.gpuLayers = parseInteger(arg.slice('--gpu-layers='.length), '--gpu-layers');
    else if (arg.startsWith('--fit-target=')) options.fitTargetMiB = parseInteger(arg.slice('--fit-target='.length), '--fit-target');
    else if (arg.startsWith('--fit-ctx=')) options.fitContextTokens = parseInteger(arg.slice('--fit-ctx='.length), '--fit-ctx');
    else if (arg.startsWith('--cache-type-k=')) options.cacheTypeK = arg.slice('--cache-type-k='.length);
    else if (arg.startsWith('--cache-type-v=')) options.cacheTypeV = arg.slice('--cache-type-v='.length);
    else if (arg.startsWith('--flash-attn=')) options.flashAttention = arg.slice('--flash-attn='.length);
    else if (arg.startsWith('--load-mode=')) options.loadMode = arg.slice('--load-mode='.length);
    else if (arg.startsWith('--timeout-ms=')) options.timeoutMs = parseInteger(arg.slice('--timeout-ms='.length), '--timeout-ms');
    else if (arg.startsWith('--telemetry-ms=')) options.telemetryMs = parseInteger(arg.slice('--telemetry-ms='.length), '--telemetry-ms');
    else if (arg.startsWith('--cooldown-ms=')) options.cooldownMs = parseInteger(arg.slice('--cooldown-ms='.length), '--cooldown-ms');
    else if (arg.startsWith('--max-output-mib=')) options.maxOutputBytes = parseInteger(arg.slice('--max-output-mib='.length), '--max-output-mib') * 1024 * 1024;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assertInsideRepository(outputPath) {
  const relative = path.relative(repositoryRoot, path.resolve(outputPath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Benchmark receipt must be written inside the LocalAgentResearch repository.');
  }
}

async function regularFileIdentity(filePath, kind) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`${kind} path is not a regular file.`);
  const fileName = path.basename(filePath);
  if (redactSensitiveText(fileName).redactions.length > 0) {
    throw new Error(`${kind} file name resembles a secret and cannot be persisted safely.`);
  }
  return {
    file_name: fileName,
    size_bytes: fileStat.size,
    modified_at: fileStat.mtime.toISOString(),
    sha256: await sha256File(filePath),
    absolute_path_persisted: false,
  };
}

async function prepareIdentities(options) {
  const runtimePromise = regularFileIdentity(options.llamaBenchPath, 'llama-bench');
  const modelStat = await stat(options.modelPath);
  if (!modelStat.isFile()) throw new Error('model path is not a regular file.');
  const modelFileName = path.basename(options.modelPath);
  if (redactSensitiveText(modelFileName).redactions.length > 0) {
    throw new Error('model file name resembles a secret and cannot be persisted safely.');
  }
  const inspected = await inspectGgufArtifact(options.modelPath);
  const modelStatAfter = await stat(options.modelPath);
  if (modelStat.size !== modelStatAfter.size || modelStat.mtimeMs !== modelStatAfter.mtimeMs) {
    throw new Error('Model artifact changed while it was being hashed.');
  }
  if (!inspected.gguf.valid) throw new Error(`Model does not have a valid GGUF header: ${inspected.gguf.reason}`);
  const runtime = await runtimePromise;
  return {
    runtime: {
      kind: 'llama-bench',
      ...runtime,
      identity_basis: ['executable-sha256', 'bounded-help-capability-probe'],
    },
    model: {
      model_id: options.modelId,
      file_name: modelFileName,
      size_bytes: modelStat.size,
      modified_at: modelStat.mtime.toISOString(),
      sha256: inspected.sha256,
      absolute_path_persisted: false,
      gguf: inspected.gguf,
    },
  };
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function runCaptured(executable, args, options = {}) {
  return new Promise((resolve) => {
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let aborted = false;
    let outputLimitExceeded = false;
    let spawnError = null;
    let settled = false;
    let timer = null;
    let abortHandler = () => {};
    const startedAt = new Date();
    let child;

    const finish = (code = null, signal = null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortHandler);
      const finishedAt = new Date();
      resolve({
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        wall_ms: finishedAt.getTime() - startedAt.getTime(),
        exit_code: code,
        signal,
        timed_out: timedOut,
        aborted,
        output_limit_exceeded: outputLimitExceeded,
        spawn_error: spawnError,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    };

    const terminate = () => {
      if (child && !child.killed) child.kill('SIGTERM');
    };
    abortHandler = () => {
      aborted = true;
      terminate();
    };

    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      spawnError = error instanceof Error ? error.message : String(error);
      finish();
      return;
    }

    const append = (target, chunk, streamName) => {
      const buffer = Buffer.from(chunk);
      if (streamName === 'stdout') stdoutBytes += buffer.length;
      else stderrBytes += buffer.length;
      if (stdoutBytes + stderrBytes > options.maxOutputBytes) {
        outputLimitExceeded = true;
        terminate();
        return;
      }
      target.push(buffer);
    };
    child.stdout.on('data', (chunk) => append(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => append(stderr, chunk, 'stderr'));
    child.once('error', (error) => {
      spawnError = error instanceof Error ? error.message : String(error);
    });
    child.once('close', finish);

    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);
    options.signal?.addEventListener('abort', abortHandler, { once: true });
    if (options.signal?.aborted) abortHandler();
  });
}

function sanitizedCapture(capture, knownPaths) {
  const rawStdout = capture.stdout.toString('utf8');
  const rawStderr = capture.stderr.toString('utf8');
  const safeStdout = redactSensitiveText(rawStdout, knownPaths);
  const safeStderr = redactSensitiveText(rawStderr, knownPaths);
  const safeSpawnError = redactSensitiveText(capture.spawn_error ?? '', knownPaths);
  let parsedJson = null;
  let jsonParseError = null;
  try {
    parsedJson = rawStdout.trim() ? JSON.parse(rawStdout) : null;
    parsedJson = JSON.parse(redactSensitiveText(JSON.stringify(parsedJson), knownPaths).text);
  } catch (error) {
    jsonParseError = error instanceof Error ? error.message : String(error);
  }
  return {
    started_at: capture.started_at,
    finished_at: capture.finished_at,
    wall_ms: capture.wall_ms,
    exit_code: capture.exit_code,
    signal: capture.signal,
    timed_out: capture.timed_out,
    aborted: capture.aborted,
    output_limit_exceeded: capture.output_limit_exceeded,
    spawn_error: safeSpawnError.text || null,
    stdout: safeStdout.text,
    stderr: safeStderr.text,
    stdout_sha256_before_redaction: sha256Buffer(capture.stdout),
    stderr_sha256_before_redaction: sha256Buffer(capture.stderr),
    redactions: {
      stdout: safeStdout.redactions,
      stderr: safeStderr.redactions,
      spawn_error: safeSpawnError.redactions,
    },
    parsed_json: parsedJson,
    json_parse_error: jsonParseError,
  };
}

async function sampleNvidia(options, signal, knownPaths) {
  const query = 'timestamp,index,uuid,name,driver_version,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw';
  const capture = await runCaptured(options.nvidiaSmiPath, [
    `--query-gpu=${query}`,
    '--format=csv,noheader,nounits',
  ], {
    cwd: repositoryRoot,
    env: safeChildEnvironment(),
    timeoutMs: Math.min(15_000, options.timeoutMs),
    maxOutputBytes: 1024 * 1024,
    signal,
  });
  const sanitized = sanitizedCapture(capture, knownPaths);
  return {
    sampled_at: new Date().toISOString(),
    system: {
      free_ram_bytes: os.freemem(),
      load_average: os.loadavg(),
      harness_process_memory_bytes: process.memoryUsage().rss,
    },
    gpus: capture.exit_code === 0 ? parseNvidiaSmiCsv(capture.stdout.toString('utf8'), options.nvidiaIndices) : [],
    error: capture.exit_code === 0 ? null : {
      exit_code: capture.exit_code,
      timed_out: capture.timed_out,
      spawn_error: sanitized.spawn_error,
      stderr: sanitized.stderr,
    },
  };
}

function telemetryHasSelectedGpus(sample, selectedIndices) {
  if (sample.error) return false;
  const observed = new Set(sample.gpus.filter((item) => Number.isSafeInteger(item.index)).map((item) => item.index));
  return selectedIndices.every((index) => observed.has(index));
}

async function runCase(options, planCase, placement, signal, knownPaths) {
  const samples = [];
  const before = await sampleNvidia(options, signal, knownPaths);
  if (!telemetryHasSelectedGpus(before, options.nvidiaIndices)) {
    throw new Error('Pre-case telemetry did not report every selected NVIDIA GPU.');
  }
  let telemetryPending = Promise.resolve();
  const timer = setInterval(() => {
    telemetryPending = telemetryPending.then(async () => {
      samples.push(await sampleNvidia(options, signal, knownPaths));
    });
  }, options.telemetryMs);

  const actualArgs = buildLlamaBenchArguments(options, placement, path.basename(options.modelPath));
  let capture;
  try {
    capture = await runCaptured(options.llamaBenchPath, actualArgs, {
      cwd: path.dirname(options.modelPath),
      env: safeChildEnvironment(),
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      signal,
    });
  } finally {
    clearInterval(timer);
    await telemetryPending;
  }
  const after = await sampleNvidia(options, signal, knownPaths);
  const processReceipt = sanitizedCapture(capture, knownPaths);
  const telemetryComplete = telemetryHasSelectedGpus(after, options.nvidiaIndices)
    && samples.every((sample) => telemetryHasSelectedGpus(sample, options.nvidiaIndices));
  return {
    case_id: planCase.case_id,
    round: planCase.round,
    placement_id: planCase.placement_id,
    command: planCase.command,
    process: processReceipt,
    telemetry: { before, samples, after },
    status: processReceipt.exit_code === 0 && !processReceipt.timed_out && !processReceipt.output_limit_exceeded
      && processReceipt.parsed_json !== null && telemetryComplete ? 'completed' : 'failed',
  };
}

async function writeCheckpoint(partialPath, report, firstWrite = false) {
  await writeFile(partialPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    flag: firstWrite ? 'wx' : 'w',
  });
}

function safeFailure(error, knownPaths) {
  const safe = redactSensitiveText(error instanceof Error ? error.message : String(error), knownPaths);
  return { type: error instanceof Error ? error.name : 'Error', message: safe.text, redactions: safe.redactions };
}

function wait(ms, signal) {
  if (ms === 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('Aborted.'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function executeBenchmark(options, plan, abortController) {
  assertInsideRepository(options.outputPath);
  const partialPath = options.outputPath.toLowerCase().endsWith('.json')
    ? `${options.outputPath.slice(0, -5)}.partial.json`
    : `${options.outputPath}.partial`;
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  for (const candidate of [options.outputPath, partialPath]) {
    try {
      await stat(candidate);
      throw new Error(`Refusing to overwrite existing receipt: ${path.relative(repositoryRoot, candidate)}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const knownPaths = [
    options.llamaBenchPath,
    path.dirname(options.llamaBenchPath),
    options.modelPath,
    path.dirname(options.modelPath),
    os.homedir(),
  ];
  const report = {
    schema_version: 'llamacpp-placement-receipt/1.0',
    execution_mode: true,
    gpu_model_workload_started: false,
    status: 'running',
    started_at: new Date().toISOString(),
    finished_at: null,
    suite_sha256: plan.suite_sha256,
    plan,
    environment: staticHardwareIdentity(),
    child_environment_policy: {
      inherited_key_names: Object.keys(safeChildEnvironment()).sort((left, right) => left.localeCompare(right, 'en')),
      performance_override_variables_inherited: false,
      provider_credential_variables_inherited: false,
    },
    privacy: {
      known_local_paths_replaced: true,
      recognized_secret_patterns_redacted: true,
      pre_redaction_stream_hashes_retained: true,
      raw_model_weights_published: false,
    },
    probes: {},
    cases: [],
    failure: null,
  };
  await writeCheckpoint(partialPath, report, true);

  try {
    const commonCapture = {
      cwd: path.dirname(options.llamaBenchPath),
      env: safeChildEnvironment(),
      timeoutMs: Math.min(15_000, options.timeoutMs),
      maxOutputBytes: 4 * 1024 * 1024,
      signal: abortController.signal,
    };
    const help = await runCaptured(options.llamaBenchPath, ['--help'], commonCapture);
    const helpEvaluation = evaluateHelpProbe(
      help,
      options.fitTargetMiB !== null && options.fitTargetMiB !== undefined,
    );
    report.probes.llama_bench_help = {
      ...sanitizedCapture(help, knownPaths),
      evaluation: helpEvaluation,
      identity_note: 'Executable SHA-256 is authoritative; help output is a bounded capability/build fingerprint.',
    };
    if (!helpEvaluation.accepted) {
      throw new Error(`llama-bench --help capability probe failed: ${[
        ...helpEvaluation.process_issues,
        ...helpEvaluation.missing_capabilities,
      ].join(', ')}`);
    }

    const devices = await runCaptured(options.llamaBenchPath, ['--list-devices'], commonCapture);
    const requestedDevices = [...new Set([options.singleDevice, ...options.dualDevices])];
    const deviceEvaluation = evaluateDeviceProbe(devices, requestedDevices);
    report.probes.llama_bench_devices = {
      ...sanitizedCapture(devices, knownPaths),
      evaluation: deviceEvaluation,
    };
    if (!deviceEvaluation.accepted) {
      throw new Error(`llama-bench --list-devices probe failed: ${[
        ...deviceEvaluation.process_issues,
        ...deviceEvaluation.missing_device_identifiers,
      ].join(', ')}`);
    }

    const smiVersion = await runCaptured(options.nvidiaSmiPath, ['--version'], {
      ...commonCapture,
      cwd: repositoryRoot,
    });
    report.probes.nvidia_smi_version = sanitizedCapture(smiVersion, knownPaths);
    if (smiVersion.exit_code !== 0) throw new Error('nvidia-smi --version failed.');
    report.probes.hardware_before = await sampleNvidia(options, abortController.signal, knownPaths);
    if (!telemetryHasSelectedGpus(report.probes.hardware_before, options.nvidiaIndices)) {
      throw new Error('Initial telemetry did not report every selected NVIDIA GPU.');
    }
    await writeCheckpoint(partialPath, report);

    const placements = buildPlacements(options);
    for (let index = 0; index < plan.cases.length; index += 1) {
      if (abortController.signal.aborted) throw abortController.signal.reason ?? new Error('Benchmark aborted.');
      const planCase = plan.cases[index];
      const placement = placements.find((item) => item.placement_id === planCase.placement_id);
      report.cases.push(await runCase(options, planCase, placement, abortController.signal, knownPaths));
      report.gpu_model_workload_started = true;
      await writeCheckpoint(partialPath, report);
      if (index < plan.cases.length - 1) await wait(options.cooldownMs, abortController.signal);
    }

    report.probes.hardware_after = await sampleNvidia(options, abortController.signal, knownPaths);
    report.status = report.cases.every((item) => item.status === 'completed') ? 'completed' : 'completed_with_failures';
  } catch (error) {
    report.status = abortController.signal.aborted ? 'interrupted' : 'failed';
    report.failure = safeFailure(error, knownPaths);
  }

  report.finished_at = new Date().toISOString();
  report.receipt_content_sha256 = sha256Text(JSON.stringify({ ...report, receipt_content_sha256: null }));
  await writeCheckpoint(partialPath, report);
  await rename(partialPath, options.outputPath);
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parsePlacementArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  validatePlacementOptions(options);
  validateExecutionConsent(options);
  assertInsideRepository(options.outputPath);
  const identities = await prepareIdentities(options);
  const plan = buildBenchmarkPlan(options, identities);

  if (!options.execute) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.stderr.write('Plan only: no llama.cpp process, model inference, or GPU telemetry was launched.\n');
    return 0;
  }

  const abortController = new AbortController();
  const abort = (signal) => abortController.abort(new Error(`Received ${signal}.`));
  const onSigint = () => abort('SIGINT');
  const onSigterm = () => abort('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  try {
    const report = await executeBenchmark(options, plan, abortController);
    process.stdout.write(`Wrote ${report.status} receipt to ${path.relative(repositoryRoot, options.outputPath)}\n`);
    if (report.status === 'completed') return 0;
    if (report.status === 'interrupted') return 130;
    return 2;
  } finally {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
