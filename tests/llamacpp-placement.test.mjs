import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildBenchmarkPlan,
  buildLlamaBenchArguments,
  buildPlacements,
  buildSchedule,
  evaluateDeviceProbe,
  evaluateHelpProbe,
  parseNvidiaSmiCsv,
  safeChildEnvironment,
  validateExecutionConsent,
  validatePlacementOptions,
} from '../benchmark/llamacpp-placement-lib.mjs';
import { parsePlacementArgs } from '../benchmark/run-llamacpp-placement.mjs';

function options(overrides = {}) {
  return {
    modelPath: 'C:\\private\\model.gguf',
    modelId: 'fixture/model:Q4_K_M',
    llamaBenchPath: 'C:\\private\\llama-bench.exe',
    singleDevice: 'CUDA0',
    dualDevices: ['CUDA0', 'CUDA1'],
    tensorSplit: [8, 7],
    nvidiaIndices: [0, 1],
    rounds: 3,
    promptTokens: 512,
    generationTokens: 128,
    threads: 8,
    batchSize: 512,
    ubatchSize: 128,
    gpuLayers: 999,
    fitTargetMiB: null,
    fitContextTokens: null,
    timeoutMs: 600_000,
    telemetryMs: 1_000,
    cooldownMs: 5_000,
    maxOutputBytes: 64 * 1024 * 1024,
    flashAttention: 'auto',
    loadMode: 'mmap',
    cacheTypeK: 'f16',
    cacheTypeV: 'f16',
    execute: false,
    acknowledgeGpuWorkload: false,
    ...overrides,
  };
}

test('placements generate explicit single-GPU and dual layer-split llama-bench commands', () => {
  const config = options();
  const [single, dual] = buildPlacements(config);
  const singleArgs = buildLlamaBenchArguments(config, single, 'model.gguf');
  const dualArgs = buildLlamaBenchArguments(config, dual, 'model.gguf');

  assert.deepEqual(single, {
    placement_id: 'single_gpu',
    split_mode: 'none',
    devices: ['CUDA0'],
    tensor_split: null,
    main_gpu_within_device_list: 0,
  });
  assert.equal(singleArgs[singleArgs.indexOf('-sm') + 1], 'none');
  assert.equal(singleArgs[singleArgs.indexOf('-dev') + 1], 'CUDA0');
  assert.equal(singleArgs[singleArgs.indexOf('-mg') + 1], '0');
  assert.equal(singleArgs.includes('-ts'), false);

  assert.equal(dual.split_mode, 'layer');
  assert.equal(dualArgs[dualArgs.indexOf('-dev') + 1], 'CUDA0/CUDA1');
  assert.equal(dualArgs[dualArgs.indexOf('-ts') + 1], '8/7');
  assert.equal(dualArgs.includes('-mg'), false);
  assert.equal(dualArgs[dualArgs.indexOf('-r') + 1], '1');
  assert.ok(dualArgs.includes('--offline'));
});

test('optional fit policy applies the same explicit target and context to both placements', () => {
  const config = options({ fitTargetMiB: 1024, fitContextTokens: 4096 });
  const [single, dual] = buildPlacements(config);
  for (const placement of [single, dual]) {
    const args = buildLlamaBenchArguments(config, placement, 'model.gguf');
    assert.equal(args[args.indexOf('--fit-target') + 1], '1024');
    assert.equal(args[args.indexOf('--fit-ctx') + 1], '4096');
  }
  const plan = buildBenchmarkPlan(config, {
    model: { model_id: config.modelId, file_name: 'model.gguf', size_bytes: 1, sha256: 'a'.repeat(64) },
    runtime: { kind: 'llama-bench', file_name: 'llama-bench.exe', size_bytes: 1, sha256: 'b'.repeat(64) },
  });
  assert.deepEqual(plan.benchmark_parameters.fit_policy, {
    enabled: true,
    target_margin_mib_per_device: 1024,
    minimum_context_tokens: 4096,
    same_policy_for_every_placement: true,
    actual_gpu_layers_must_come_from_llama_bench_output: true,
  });
});

test('placement CLI parses explicit llama-bench fit controls', () => {
  const parsed = parsePlacementArgs([
    '--llama-bench=C:\\tools\\llama-bench.exe',
    '--model=C:\\models\\model.gguf',
    '--model-id=fixture/model:Q4_K_M',
    '--single-device=CUDA0',
    '--dual-devices=CUDA0,CUDA1',
    '--nvidia-indices=0,1',
    '--tensor-split=1,1',
    '--fit-target=1024',
    '--fit-ctx=4096',
  ]);
  assert.equal(parsed.fitTargetMiB, 1024);
  assert.equal(parsed.fitContextTokens, 4096);
});

test('schedule alternates placement order to expose order and thermal bias', () => {
  assert.deepEqual(buildSchedule(3).map((item) => item.placement_id), [
    'single_gpu', 'dual_gpu_layer_split',
    'dual_gpu_layer_split', 'single_gpu',
    'single_gpu', 'dual_gpu_layer_split',
  ]);
});

test('benchmark plan contains hashes and commands but no absolute machine paths', () => {
  const config = options();
  const plan = buildBenchmarkPlan(config, {
    model: {
      model_id: config.modelId,
      file_name: 'model.gguf',
      size_bytes: 100,
      sha256: 'a'.repeat(64),
      absolute_path_persisted: false,
    },
    runtime: {
      kind: 'llama-bench',
      file_name: 'llama-bench.exe',
      size_bytes: 200,
      sha256: 'b'.repeat(64),
      absolute_path_persisted: false,
    },
  });
  const serialized = JSON.stringify(plan);
  assert.equal(plan.cases.length, 6);
  assert.match(plan.suite_sha256, /^[a-f0-9]{64}$/);
  assert.equal(serialized.includes('C:\\private'), false);
  assert.equal(plan.benchmark_parameters.requested_context_tokens, 640);
});

test('execution requires a second explicit acknowledgement', () => {
  assert.doesNotThrow(() => validateExecutionConsent(options()));
  assert.throws(
    () => validateExecutionConsent(options({ execute: true, acknowledgeGpuWorkload: false })),
    /acknowledge-gpu-workload/,
  );
  assert.doesNotThrow(() => validateExecutionConsent(options({ execute: true, acknowledgeGpuWorkload: true })));
});

test('placement validation rejects ambiguous devices and malformed splits', () => {
  assert.throws(() => validatePlacementOptions(options({ dualDevices: ['CUDA0', 'CUDA0'] })), /distinct/);
  assert.throws(() => validatePlacementOptions(options({ tensorSplit: [1] })), /two positive/);
  assert.throws(() => validatePlacementOptions(options({ singleDevice: 'CUDA2' })), /also appear/);
  assert.throws(() => validatePlacementOptions(options({ fitTargetMiB: 1024 })), /supplied together/);
  assert.throws(
    () => validatePlacementOptions(options({ fitTargetMiB: 1024, fitContextTokens: 512 })),
    /cannot be smaller/,
  );
});

function probeCapture({ stdout = '', stderr = '', exitCode = 0, ...overrides } = {}) {
  return {
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    exit_code: exitCode,
    spawn_error: null,
    timed_out: false,
    aborted: false,
    output_limit_exceeded: false,
    ...overrides,
  };
}

test('bounded help probe fingerprints capabilities without relying on --version', async () => {
  const help = [
    '--model', '--repetitions', '--output', '--n-gpu-layers', '--split-mode', '--device', '--tensor-split',
    '--fit-target', '--fit-ctx',
  ].join('\n');
  assert.equal(evaluateHelpProbe(probeCapture({ stdout: help }), true).accepted, true);
  const missingFit = evaluateHelpProbe(probeCapture({ stdout: help.replace('--fit-ctx', '') }), true);
  assert.equal(missingFit.accepted, false);
  assert.deepEqual(missingFit.missing_capabilities, ['--fit-ctx']);
  assert.equal(evaluateHelpProbe(probeCapture({ stdout: help, exitCode: 2 }), true).accepted, false);

  const runnerSource = await readFile(new URL('../benchmark/run-llamacpp-placement.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runnerSource, /options\.llamaBenchPath\s*,\s*\[\s*['"]--version['"]\s*\]/);
});

test('device probe accepts b10566-style exit 1 only when every requested ID is present', () => {
  const compatible = evaluateDeviceProbe(probeCapture({
    stdout: 'CUDA0: NVIDIA RTX 3070\nCUDA1: NVIDIA GTX 1080\n',
    exitCode: 1,
  }), ['CUDA0', 'CUDA1']);
  assert.equal(compatible.accepted, true);
  assert.equal(compatible.observed_exit_code, 1);

  const missing = evaluateDeviceProbe(probeCapture({ stdout: 'CUDA0: NVIDIA RTX 3070\n', exitCode: 1 }), ['CUDA0', 'CUDA1']);
  assert.equal(missing.accepted, false);
  assert.deepEqual(missing.missing_device_identifiers, ['CUDA1']);
  assert.equal(evaluateDeviceProbe(probeCapture({
    stdout: 'CUDA0: one\nCUDA1: two\n', exitCode: 2,
  }), ['CUDA0', 'CUDA1']).accepted, false);
  assert.equal(evaluateDeviceProbe(probeCapture({
    stdout: 'CUDA0: one\nCUDA1: two\n', exitCode: 1, timed_out: true,
  }), ['CUDA0', 'CUDA1']).accepted, false);
});

test('NVIDIA telemetry parser retains stable GPU identity and nullable unsupported fields', () => {
  const csv = [
    '2026/08/23 12:00:00.000, 0, GPU-aaa, NVIDIA RTX 3070, 999.1, 8192, 1024, 50, 65, 120.5',
    '2026/08/23 12:00:00.000, 1, GPU-bbb, NVIDIA GTX 1080, 999.1, 8192, 0, 0, 40, [N/A]',
  ].join('\n');
  const rows = parseNvidiaSmiCsv(csv, [0, 1]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].uuid, 'GPU-aaa');
  assert.equal(rows[0].memory_used_mib, 1024);
  assert.equal(rows[1].power_draw_w, null);
});

test('child environment allowlist excludes provider credentials', () => {
  const child = safeChildEnvironment({
    Path: 'C:\\Windows',
    ProgramFiles: 'C:\\Program Files',
    ProgramW6432: 'C:\\Program Files',
    CUDA_PATH: 'C:\\CUDA',
    GGML_CUDA_F16: '1',
    OPENAI_API_KEY: 'secret',
    HF_TOKEN: 'secret',
  });
  assert.equal(child.Path, 'C:\\Windows');
  assert.equal(child.ProgramFiles, 'C:\\Program Files');
  assert.equal(child.ProgramW6432, 'C:\\Program Files');
  assert.equal('CUDA_PATH' in child, false);
  assert.equal('GGML_CUDA_F16' in child, false);
  assert.equal('OPENAI_API_KEY' in child, false);
  assert.equal('HF_TOKEN' in child, false);
});
