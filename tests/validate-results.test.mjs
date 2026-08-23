import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { detectResultFamily, sha256, validateResultFile, validateResultObject } from '../benchmark/result-validator-lib.mjs';
import { buildValidationReceipt } from '../benchmark/validate-results.mjs';

const HASH = 'a'.repeat(64);
const clone = (value) => structuredClone(value);

function baseText() {
  return {
    schemaVersion: 1,
    startedAt: '2026-08-23T00:00:00.000Z',
    finishedAt: '2026-08-23T00:01:00.000Z',
    taskSuite: { hashSha256: HASH, stage: 'screen', taskIds: ['task'], repeats: 1 },
    models: [{
      model: 'fixture/text', status: 'completed',
      cases: [{ taskId: 'task', category: 'planning', repeat: 0, status: 'completed', score: { score: 1 }, response: { wallMs: 1000 } }],
      summary: {
        score: 1, possible: 1, passRate: 1, completedCases: 1, failedCases: 0,
        meanTokensPerSecond: 1, meanTimeToFirstTokenSeconds: 1, totalWallSeconds: 1,
        categories: { planning: { score: 1, possible: 1, passRate: 1 } },
      },
    }],
    ranking: [{ model: 'fixture/text', passRate: 1, totalWallSeconds: 1 }],
  };
}

function baseCode() {
  const source = 'function answer() { return 42; }';
  const receipt = {
    status: 'completed', functionName: 'answer', sourceSha256: sha256(source), sourceBytes: Buffer.byteLength(source),
    score: 1, passedWeight: 1, totalWeight: 1, passedTests: 1, totalTests: 1, wallMs: 1,
    tests: [{ id: 'returns', weight: 1, assertion: 'result', passed: true, status: 'completed' }],
  };
  return {
    schemaVersion: 1,
    startedAt: '2026-08-23T00:00:00.000Z', finishedAt: '2026-08-23T00:01:00.000Z',
    suite: { hashSha256: HASH, taskIds: ['code_task'], repeats: 1, inspection: { valid: true, errors: [] } },
    executionPolicy: {
      oneNamedSynchronousFunction: true, freshVmContextPerTest: true,
      vmCodeGeneration: { strings: false, wasm: false }, requireExposed: false, processExposed: false,
      maxSourceBytes: 24576, vmTimeoutMs: 250,
    },
    models: [{
      model: 'fixture/code', status: 'completed',
      cases: [{ taskId: 'code_task', category: 'code', functionName: 'answer', repeat: 0, status: 'completed', response: { wallMs: 1000 }, candidateSource: source, receipt }],
      summary: {
        score: 1, possible: 1, passRate: 1, completedCases: 1, requestFailedCases: 0,
        fullyPassedCases: 1, executedTests: 1, passedTests: 1, meanTokensPerSecond: 1,
        totalModelWallSeconds: 1, totalVmWallSeconds: 0.001,
      },
    }],
    ranking: [{ model: 'fixture/code', passRate: 1, fullyPassedCases: 1, totalModelWallSeconds: 1 }],
  };
}

function baseVision() {
  return {
    schemaVersion: 1,
    startedAt: '2026-08-23T00:00:00.000Z', finishedAt: '2026-08-23T00:01:00.000Z',
    options: { repeats: 1 },
    suite: { hashSha256: HASH, imageSha256: HASH, tasks: ['vision_task'] },
    models: [{
      model: 'fixture/vision', status: 'completed',
      cases: [{ taskId: 'vision_task', category: 'vision', repeat: 0, status: 'completed', score: 1, response: { wallMs: 1000 } }],
      score: 1, possible: 1, passRate: 1,
    }],
    ranking: [{ model: 'fixture/vision', score: 1, possible: 1, passRate: 1 }],
  };
}

function baseReasoning() {
  return {
    schemaVersion: 1,
    startedAt: '2026-08-23T00:00:00.000Z', finishedAt: '2026-08-23T00:01:00.000Z',
    options: { repeats: 1 },
    taskSuite: { hashSha256: HASH, taskIds: ['reason_task'] },
    profiles: [{
      id: 'fixture/reason@low', model: 'fixture/reason', reasoning: 'low', status: 'completed',
      cases: [{
        taskId: 'reason_task', category: 'reasoning', repeat: 0, status: 'completed', score: { score: 1 },
        response: { wallMs: 1000, usage: { reasoning_tokens: 2, completion_tokens: 3 }, modelInfo: { model_instance_id: 'fixture/reason' } },
      }],
      summary: {
        score: 1, possible: 1, passRate: 1, completedCases: 1, failedCases: 0,
        meanTokensPerSecond: 1, reasoningTokens: 2, outputTokens: 3, totalWallSeconds: 1,
      },
    }],
    ranking: [{ id: 'fixture/reason@low', passRate: 1, totalWallSeconds: 1 }],
  };
}

function response(wallMs = 100) {
  return { text: 'ok', wallMs, usage: { completion_tokens: 1 } };
}

function baseLoop() {
  const draft = response(100);
  const critique = response(100);
  const final = response(100);
  const direct = { status: 'completed', output: draft, score: { score: 1, passed: 1, total: 1 }, calls: 1, wallMs: 100, completionTokens: 1 };
  const chained = { status: 'completed', draft, critique, final, score: { score: 1, passed: 1, total: 1 }, calls: 3, wallMs: 300, completionTokens: 3 };
  return {
    schemaVersion: 1,
    startedAt: '2026-08-23T00:00:00.000Z', finishedAt: '2026-08-23T00:01:00.000Z',
    options: { solver: 'fixture/solver', critic: 'fixture/critic', repeats: 1 },
    taskSuite: { hashSha256: HASH, taskIds: ['loop_task'] },
    design: { direct: 'one', selfRefine: 'self', crossSpecialist: 'cross' },
    loads: [
      { model: 'fixture/solver', phase: 'draft-and-self-refine', wallSeconds: 1 },
      { model: 'fixture/critic', phase: 'cross-specialist-critique', wallSeconds: 1 },
      { model: 'fixture/solver', phase: 'cross-specialist-finalize', wallSeconds: 1 },
    ],
    cases: [{ taskId: 'loop_task', category: 'planning', repeat: 0, direct, selfRefine: chained, crossSpecialist: clone(chained) }],
    summaries: {
      direct: { score: 1, possible: 1, passRate: 1, completedCases: 1, failedCases: 0, calls: 1, wallSeconds: 0.1, completionTokens: 1 },
      selfRefine: { score: 1, possible: 1, passRate: 1, completedCases: 1, failedCases: 0, calls: 3, wallSeconds: 0.3, completionTokens: 3 },
      crossSpecialist: { score: 1, possible: 1, passRate: 1, completedCases: 1, failedCases: 0, calls: 3, wallSeconds: 0.3, completionTokens: 3 },
    },
  };
}

function telemetrySample() {
  return { error: null, gpus: [{ index: 0 }, { index: 1 }] };
}

function basePlacement() {
  const benchmarkParameters = {
    prompt_tokens: 8, generation_tokens: 4, threads: 2, batch_size: 8, ubatch_size: 4, gpu_layers: 99,
    schedule: [{ case_id: 'single', round: 1, placement_id: 'single_gpu' }, { case_id: 'dual', round: 1, placement_id: 'dual_gpu_layer_split' }],
  };
  const command = (name) => ({ executable: 'llama-bench', working_directory: '<MODEL_DIRECTORY>', arguments: [name] });
  const planCases = [
    { case_id: 'single', round: 1, placement_id: 'single_gpu', placement: { placement_id: 'single_gpu', split_mode: 'none' }, command: command('single') },
    { case_id: 'dual', round: 1, placement_id: 'dual_gpu_layer_split', placement: { placement_id: 'dual_gpu_layer_split', split_mode: 'layer' }, command: command('dual') },
  ];
  const processReceipt = (splitMode) => ({
    started_at: '2026-08-23T00:00:01.000Z', finished_at: '2026-08-23T00:00:02.000Z', wall_ms: 1000,
    exit_code: 0, signal: null, timed_out: false, aborted: false, output_limit_exceeded: false, spawn_error: null,
    stdout: '[]', stderr: '', stdout_sha256_before_redaction: HASH, stderr_sha256_before_redaction: HASH,
    redactions: { stdout: [], stderr: [], spawn_error: [] },
    parsed_json: [
      { model_filename: 'model.gguf', split_mode: splitMode, devices: 'CUDA0', n_prompt: 8, n_gen: 0, n_batch: 8, n_ubatch: 4, n_threads: 2, n_gpu_layers: 99, avg_ns: 10, avg_ts: 10 },
      { model_filename: 'model.gguf', split_mode: splitMode, devices: 'CUDA0', n_prompt: 0, n_gen: 4, n_batch: 8, n_ubatch: 4, n_threads: 2, n_gpu_layers: 99, avg_ns: 10, avg_ts: 10 },
    ],
    json_parse_error: null,
  });
  const suiteHash = sha256(JSON.stringify(benchmarkParameters));
  const report = {
    schema_version: 'llamacpp-placement-receipt/1.0', execution_mode: true, gpu_model_workload_started: true,
    status: 'completed', started_at: '2026-08-23T00:00:00.000Z', finished_at: '2026-08-23T00:01:00.000Z', suite_sha256: suiteHash,
    plan: {
      schema_version: 'llamacpp-placement-plan/1.0', workload_launched: false, suite_sha256: suiteHash,
      model: { sha256: HASH, file_name: 'model.gguf' }, runtime: { sha256: HASH }, requested_rounds: 1,
      telemetry: { selected_indices: [0, 1] }, benchmark_parameters: benchmarkParameters, cases: planCases,
    },
    probes: {
      llama_bench_help: { evaluation: { accepted: true } }, llama_bench_devices: { evaluation: { accepted: true } },
      nvidia_smi_version: { exit_code: 0 }, hardware_before: telemetrySample(), hardware_after: telemetrySample(),
    },
    cases: planCases.map((item) => ({
      case_id: item.case_id, round: item.round, placement_id: item.placement_id, command: item.command,
      process: processReceipt(item.placement.split_mode), telemetry: { before: telemetrySample(), samples: [telemetrySample()], after: telemetrySample() }, status: 'completed',
    })),
    failure: null, receipt_content_sha256: null,
  };
  report.receipt_content_sha256 = sha256(JSON.stringify({ ...report, receipt_content_sha256: null }));
  return report;
}

test('family dispatch recognizes every supported result contract', () => {
  const fixtures = [
    [baseText(), 'text'], [baseCode(), 'code'], [baseVision(), 'vision'],
    [baseReasoning(), 'reasoning-profile'], [baseLoop(), 'loop-ablation'], [basePlacement(), 'llamacpp-placement'],
  ];
  for (const [fixture, family] of fixtures) {
    assert.equal(detectResultFamily(fixture), family);
    const result = validateResultObject(fixture);
    assert.equal(result.valid, true, `${family}: ${JSON.stringify(result.findings)}`);
    assert.equal(result.complete, true);
    assert.equal(result.comparisonEligible, true);
  }
});

test('text validation preserves duplicate, score, response, count, summary, and ranking checks', () => {
  const report = baseText();
  report.models[0].cases.push(clone(report.models[0].cases[0]));
  report.models[0].cases[0].score.score = 2;
  report.models[0].cases[0].response = null;
  report.models[0].summary.passRate = 0.5;
  report.ranking = [];
  const codes = validateResultObject(report).findings.map((item) => item.code);
  for (const code of ['case.duplicate', 'case.score.invalid', 'case.completed.response_missing', 'subject.case_count.invalid', 'summary.pass_rate.mismatch', 'ranking.order.mismatch']) assert.ok(codes.includes(code), code);
});

test('family reconcilers reject tampered code, vision, reasoning, and loop receipts', () => {
  const code = baseCode();
  code.models[0].cases[0].receipt.sourceSha256 = HASH;
  code.models[0].cases[0].receipt.sourceBytes = 1;
  code.models[0].cases[0].receipt.tests[0].weight = 0.5;
  const codeCodes = validateResultObject(code).findings.map((item) => item.code);
  assert.ok(codeCodes.includes('code.source.hash_mismatch'));
  assert.ok(codeCodes.includes('code.source.bytes_mismatch'));
  assert.ok(codeCodes.includes('code.receipt.total_weight_mismatch'));

  const vision = baseVision();
  vision.models[0].passRate = 0;
  assert.ok(validateResultObject(vision).findings.some((item) => item.code === 'vision.pass_rate.mismatch'));

  const reasoning = baseReasoning();
  reasoning.profiles[0].id = 'wrong';
  assert.ok(validateResultObject(reasoning).findings.some((item) => item.code === 'reasoning.profile.id_mismatch'));

  const loop = baseLoop();
  loop.options.critic = loop.options.solver;
  loop.summaries.crossSpecialist.calls = 2;
  const loopCodes = validateResultObject(loop).findings.map((item) => item.code);
  assert.ok(loopCodes.includes('loop.family_independence.invalid'));
  assert.ok(loopCodes.includes('loop.summary.mismatch'));
});

test('placement validation checks process reconciliation, suite lineage, and receipt self-hash', () => {
  const report = basePlacement();
  report.cases[0].status = 'failed';
  report.cases[1].process.parsed_json[1].n_gen = 999;
  report.suite_sha256 = HASH;
  const codes = validateResultObject(report).findings.map((item) => item.code);
  assert.ok(codes.includes('placement.case.status_mismatch'));
  assert.ok(codes.includes('placement.benchmark.workload_mismatch'));
  assert.ok(codes.includes('placement.suite_hash.mismatch'));
  assert.ok(codes.includes('placement.receipt_hash.mismatch'));
});

test('unknown and failed placement outcomes cannot become comparison evidence', () => {
  assert.equal(validateResultObject({ schemaVersion: 1 }).valid, false);
  const report = basePlacement();
  report.status = 'failed';
  report.cases = [];
  report.gpu_model_workload_started = false;
  report.failure = { type: 'Error', message: 'probe failed' };
  report.receipt_content_sha256 = sha256(JSON.stringify({ ...report, receipt_content_sha256: null }));
  const result = validateResultObject(report);
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.equal(result.complete, true);
  assert.equal(result.comparisonEligible, false);
});

test('a structurally sound checkpoint remains valid but incomplete and excluded', () => {
  const report = baseText();
  report.finishedAt = null;
  report.models[0].status = 'running';
  report.ranking = [];
  const result = validateResultObject(report);
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.equal(result.complete, false);
  assert.equal(result.comparisonEligible, false);
  assert.ok(result.findings.some((item) => item.code === 'run.incomplete' && item.severity === 'warning'));
});

test('a staged loop checkpoint is valid but cannot become comparison evidence', () => {
  const report = baseLoop();
  report.finishedAt = null;
  report.summaries = {};
  report.cases[0].crossSpecialist = {
    status: 'drafted',
    draft: report.cases[0].direct.output,
  };
  const result = validateResultObject(report);
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.equal(result.complete, false);
  assert.equal(result.comparisonEligible, false);

  report.cases[0].crossSpecialist = { status: 'drafted' };
  const tampered = validateResultObject(report);
  assert.equal(tampered.valid, false);
  assert.ok(tampered.findings.some((item) => item.code === 'loop.stage.draft_invalid'));
});

test('file and aggregate receipts bind immutable content hashes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'local-agent-result-validator-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'text.json');
  const raw = `${JSON.stringify(baseText(), null, 2)}\n`;
  await writeFile(file, raw, 'utf8');
  const result = await validateResultFile(file, { cwd: directory, context: {} });
  assert.equal(result.valid, true, JSON.stringify(result.findings));
  assert.equal(result.file, 'text.json');
  assert.equal(result.artifactSha256, sha256(raw));

  const receipt = buildValidationReceipt([result], '2026-08-23T00:00:00.000Z');
  assert.match(receipt.receiptContentSha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.receiptContentSha256, sha256(JSON.stringify({ ...receipt, receiptContentSha256: null })));
});
