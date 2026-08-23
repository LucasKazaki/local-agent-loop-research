import os from 'node:os';

import { sha256Text } from '../scripts/model-inventory-lib.mjs';

export const LLAMA_CPP_SOURCES = Object.freeze({
  bench: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/llama-bench/llama-bench.cpp',
  cli: 'https://github.com/ggml-org/llama.cpp/blob/master/tools/cli/README.md',
});

export const REQUIRED_LLAMA_BENCH_HELP_FLAGS = Object.freeze([
  '--model',
  '--repetitions',
  '--output',
  '--n-gpu-layers',
  '--split-mode',
  '--device',
  '--tensor-split',
]);

function positiveInteger(value, name, minimum = 1) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${name} must be an integer >= ${minimum}.`);
  return value;
}

function validateDeviceName(value, name) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value)) {
    throw new Error(`${name} contains an unsupported device identifier: ${value}`);
  }
}

export function validatePlacementOptions(options) {
  if (!options.modelPath) throw new Error('--model is required.');
  if (!options.modelId || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(options.modelId)) {
    throw new Error('--model-id is required and must be a non-secret stable label.');
  }
  if (!options.llamaBenchPath) throw new Error('--llama-bench is required.');
  validateDeviceName(options.singleDevice, '--single-device');
  if (!Array.isArray(options.dualDevices) || options.dualDevices.length !== 2) {
    throw new Error('--dual-devices must contain exactly two llama.cpp device names.');
  }
  options.dualDevices.forEach((item) => validateDeviceName(item, '--dual-devices'));
  if (new Set(options.dualDevices).size !== 2) throw new Error('--dual-devices entries must be distinct.');
  if (!options.dualDevices.includes(options.singleDevice)) {
    throw new Error('--single-device must also appear in --dual-devices.');
  }
  if (!Array.isArray(options.tensorSplit) || options.tensorSplit.length !== 2
      || options.tensorSplit.some((item) => !Number.isFinite(item) || item <= 0)) {
    throw new Error('--tensor-split must contain two positive proportions.');
  }
  if (!Array.isArray(options.nvidiaIndices) || options.nvidiaIndices.length !== 2
      || options.nvidiaIndices.some((item) => !Number.isSafeInteger(item) || item < 0)) {
    throw new Error('--nvidia-indices must contain two non-negative integer indices.');
  }
  if (new Set(options.nvidiaIndices).size !== 2) throw new Error('--nvidia-indices entries must be distinct.');
  positiveInteger(options.rounds, '--rounds');
  positiveInteger(options.promptTokens, '--prompt-tokens');
  positiveInteger(options.generationTokens, '--generation-tokens');
  positiveInteger(options.threads, '--threads');
  positiveInteger(options.batchSize, '--batch-size');
  positiveInteger(options.ubatchSize, '--ubatch-size');
  positiveInteger(options.gpuLayers, '--gpu-layers');
  positiveInteger(options.timeoutMs, '--timeout-ms', 1_000);
  positiveInteger(options.telemetryMs, '--telemetry-ms', 250);
  positiveInteger(options.maxOutputBytes, '--max-output-bytes', 1_024);
  if (!Number.isSafeInteger(options.cooldownMs) || options.cooldownMs < 0 || options.cooldownMs > 60_000) {
    throw new Error('--cooldown-ms must be an integer from 0 through 60000.');
  }
  if (!['auto', 'on', 'off'].includes(options.flashAttention)) {
    throw new Error('--flash-attn must be auto, on, or off.');
  }
  const cacheTypes = ['f32', 'f16', 'bf16', 'q8_0', 'q4_0', 'q4_1', 'iq4_nl', 'q5_0', 'q5_1'];
  if (!cacheTypes.includes(options.cacheTypeK) || !cacheTypes.includes(options.cacheTypeV)) {
    throw new Error('--cache-type-k and --cache-type-v must use a supported explicit type.');
  }
  if (!['auto', 'none', 'mmap', 'mlock', 'mmap+mlock', 'dio'].includes(options.loadMode)) {
    throw new Error('--load-mode is not supported.');
  }
  const hasFitTarget = options.fitTargetMiB !== null && options.fitTargetMiB !== undefined;
  const hasFitContext = options.fitContextTokens !== null && options.fitContextTokens !== undefined;
  if (hasFitTarget !== hasFitContext) {
    throw new Error('--fit-target and --fit-ctx must be supplied together so fitting is explicit and reproducible.');
  }
  if (hasFitTarget) {
    positiveInteger(options.fitTargetMiB, '--fit-target');
    positiveInteger(options.fitContextTokens, '--fit-ctx');
    if (options.fitContextTokens < options.promptTokens + options.generationTokens) {
      throw new Error('--fit-ctx cannot be smaller than prompt tokens plus generation tokens.');
    }
  }
  return options;
}

export function validateExecutionConsent(options) {
  if (options.execute && !options.acknowledgeGpuWorkload) {
    throw new Error('--execute also requires --acknowledge-gpu-workload.');
  }
}

export function buildPlacements(options) {
  validatePlacementOptions(options);
  return [
    {
      placement_id: 'single_gpu',
      split_mode: 'none',
      devices: [options.singleDevice],
      tensor_split: null,
      main_gpu_within_device_list: 0,
    },
    {
      placement_id: 'dual_gpu_layer_split',
      split_mode: 'layer',
      devices: [...options.dualDevices],
      tensor_split: [...options.tensorSplit],
      main_gpu_within_device_list: null,
    },
  ];
}

export function buildSchedule(rounds) {
  positiveInteger(rounds, '--rounds');
  const schedule = [];
  for (let round = 0; round < rounds; round += 1) {
    const order = round % 2 === 0
      ? ['single_gpu', 'dual_gpu_layer_split']
      : ['dual_gpu_layer_split', 'single_gpu'];
    for (const placementId of order) {
      schedule.push({
        case_id: `round_${String(round + 1).padStart(2, '0')}_${placementId}`,
        round: round + 1,
        placement_id: placementId,
      });
    }
  }
  return schedule;
}

export function buildLlamaBenchArguments(options, placement, modelArgument) {
  const args = [
    '--offline',
    '-m', modelArgument,
    '-p', String(options.promptTokens),
    '-n', String(options.generationTokens),
    '-r', '1',
    '-b', String(options.batchSize),
    '-ub', String(options.ubatchSize),
    '-t', String(options.threads),
    '-ctk', options.cacheTypeK,
    '-ctv', options.cacheTypeV,
    '-ngl', String(options.gpuLayers),
    '-sm', placement.split_mode,
    '-dev', placement.devices.join('/'),
    '-fa', options.flashAttention,
    '-lm', options.loadMode,
    '-o', 'json',
  ];
  if (placement.split_mode === 'none') args.push('-mg', String(placement.main_gpu_within_device_list));
  if (placement.tensor_split) args.push('-ts', placement.tensor_split.join('/'));
  if (options.fitTargetMiB !== null && options.fitTargetMiB !== undefined) {
    args.push('--fit-target', String(options.fitTargetMiB), '--fit-ctx', String(options.fitContextTokens));
  }
  return args;
}

export function buildBenchmarkPlan(options, identities) {
  const placements = buildPlacements(options);
  const schedule = buildSchedule(options.rounds);
  const modelArgument = identities.model.file_name;
  const cases = schedule.map((scheduled) => {
    const placement = placements.find((item) => item.placement_id === scheduled.placement_id);
    return {
      ...scheduled,
      placement,
      command: {
        executable: identities.runtime.file_name,
        working_directory: '<MODEL_DIRECTORY>',
        arguments: buildLlamaBenchArguments(options, placement, modelArgument),
      },
    };
  });
  const suitePayload = {
    harness: 'llamacpp-placement/1.0',
    model_sha256: identities.model.sha256,
    runtime_sha256: identities.runtime.sha256,
    prompt_tokens: options.promptTokens,
    generation_tokens: options.generationTokens,
    threads: options.threads,
    batch_size: options.batchSize,
    ubatch_size: options.ubatchSize,
    gpu_layers: options.gpuLayers,
    cache_type_k: options.cacheTypeK,
    cache_type_v: options.cacheTypeV,
    flash_attention: options.flashAttention,
    load_mode: options.loadMode,
    warmup: true,
    requested_context_tokens: options.promptTokens + options.generationTokens,
    fit_policy: options.fitTargetMiB === null || options.fitTargetMiB === undefined ? {
      enabled: false,
      target_margin_mib_per_device: null,
      minimum_context_tokens: null,
    } : {
      enabled: true,
      target_margin_mib_per_device: options.fitTargetMiB,
      minimum_context_tokens: options.fitContextTokens,
      same_policy_for_every_placement: true,
      actual_gpu_layers_must_come_from_llama_bench_output: true,
    },
    nvidia_telemetry_indices: [...options.nvidiaIndices],
    placements,
    schedule: schedule.map(({ case_id, round, placement_id }) => ({ case_id, round, placement_id })),
  };
  return {
    schema_version: 'llamacpp-placement-plan/1.0',
    workload_launched: false,
    source_contract: LLAMA_CPP_SOURCES,
    suite_sha256: sha256Text(JSON.stringify(suitePayload)),
    model: identities.model,
    runtime: identities.runtime,
    requested_rounds: options.rounds,
    telemetry: {
      provider: 'nvidia-smi',
      selected_indices: [...options.nvidiaIndices],
      interval_ms: options.telemetryMs,
    },
    timeout_ms_per_case: options.timeoutMs,
    cooldown_ms_between_cases: options.cooldownMs,
    benchmark_parameters: suitePayload,
    cases,
  };
}

function probeOutput(capture) {
  const stdout = Buffer.isBuffer(capture?.stdout) ? capture.stdout.toString('utf8') : String(capture?.stdout ?? '');
  const stderr = Buffer.isBuffer(capture?.stderr) ? capture.stderr.toString('utf8') : String(capture?.stderr ?? '');
  return `${stdout}\n${stderr}`;
}

function probeProcessIssues(capture, acceptedExitCodes) {
  const issues = [];
  if (capture?.spawn_error) issues.push('spawn-error');
  if (capture?.timed_out) issues.push('timeout');
  if (capture?.aborted) issues.push('aborted');
  if (capture?.output_limit_exceeded) issues.push('output-limit-exceeded');
  if (!acceptedExitCodes.includes(capture?.exit_code)) issues.push('unexpected-exit-code');
  return issues;
}

export function evaluateHelpProbe(capture, fitRequired = false) {
  const requiredCapabilities = [
    ...REQUIRED_LLAMA_BENCH_HELP_FLAGS,
    ...(fitRequired ? ['--fit-target', '--fit-ctx'] : []),
  ];
  const output = probeOutput(capture);
  const missingCapabilities = requiredCapabilities.filter((flag) => !output.includes(flag));
  const processIssues = probeProcessIssues(capture, [0, 1]);
  return {
    accepted: processIssues.length === 0 && missingCapabilities.length === 0,
    probe_argument: '--help',
    accepted_exit_codes: [0, 1],
    observed_exit_code: capture?.exit_code ?? null,
    required_capabilities: requiredCapabilities,
    missing_capabilities: missingCapabilities,
    process_issues: processIssues,
  };
}

function containsDeviceIdentifier(output, identifier) {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_.-])${escaped}(?=$|[^A-Za-z0-9_.-])`, 'm').test(output);
}

export function evaluateDeviceProbe(capture, requiredDeviceIdentifiers) {
  const output = probeOutput(capture);
  const required = [...new Set(requiredDeviceIdentifiers)];
  const missingIdentifiers = required.filter((identifier) => !containsDeviceIdentifier(output, identifier));
  const processIssues = probeProcessIssues(capture, [0, 1]);
  return {
    accepted: processIssues.length === 0 && missingIdentifiers.length === 0,
    probe_argument: '--list-devices',
    accepted_exit_codes: [0, 1],
    observed_exit_code: capture?.exit_code ?? null,
    required_device_identifiers: required,
    missing_device_identifiers: missingIdentifiers,
    process_issues: processIssues,
  };
}

function numberOrNull(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || /^(?:N\/A|\[N\/A\]|Not Supported|\[Not Supported\])$/i.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseNvidiaSmiCsv(stdout, selectedIndices = null) {
  const selected = selectedIndices ? new Set(selectedIndices) : null;
  const rows = [];
  for (const line of String(stdout ?? '').split(/\r?\n/).filter(Boolean)) {
    const fields = line.split(',').map((item) => item.trim());
    if (fields.length !== 10) {
      rows.push({ parse_error: 'unexpected-column-count', raw_column_count: fields.length });
      continue;
    }
    const index = Number(fields[1]);
    if (selected && !selected.has(index)) continue;
    rows.push({
      timestamp: fields[0],
      index,
      uuid: fields[2],
      name: fields[3],
      driver_version: fields[4],
      memory_total_mib: numberOrNull(fields[5]),
      memory_used_mib: numberOrNull(fields[6]),
      utilization_gpu_percent: numberOrNull(fields[7]),
      temperature_gpu_c: numberOrNull(fields[8]),
      power_draw_w: numberOrNull(fields[9]),
    });
  }
  return rows;
}

export function safeChildEnvironment(source = process.env) {
  const exactKeys = new Set([
    'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP',
    'LANG', 'LC_ALL',
    // NVML discovery on 64-bit Windows depends on one of these installation-root
    // variables. They are non-secret system paths and are required for
    // nvidia-smi to initialize in an otherwise allowlisted child environment.
    'ProgramFiles', 'PROGRAMFILES', 'ProgramW6432', 'PROGRAMW6432',
  ]);
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (exactKeys.has(key)) result[key] = value;
  }
  return result;
}

export function staticHardwareIdentity() {
  return {
    platform: process.platform,
    os_release: os.release(),
    architecture: os.arch(),
    cpu_model: os.cpus()[0]?.model ?? null,
    logical_cpu_count: os.cpus().length,
    total_ram_bytes: os.totalmem(),
    node_version: process.version,
  };
}
