import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  buildRoutingArtifacts,
  decisionRowsToCsv,
  deriveBenchmarkSnapshotId,
  sha256File,
} from '../scripts/routing-manifest-lib.mjs';
import { validateJsonSchema } from '../scripts/json-schema-lite.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const fixtureRoot = path.join(testDirectory, 'fixtures', 'routing');

const PROFILE_ROLES = {
  planner: ['planner'],
  researcher_extractor: ['researcher', 'extractor'],
  coder: ['coder'],
  verifier_critic: ['verifier', 'critic'],
  synthesizer_policy: ['synthesizer', 'policy_guard'],
  vision: ['vision'],
};

const PROFILE_CATEGORY = {
  planner: 'plan',
  researcher_extractor: 'research',
  coder: 'code',
  verifier_critic: 'verify',
  synthesizer_policy: 'synthesize',
  vision: 'vision',
};

async function makeFixtureRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'local-routing-fixture-'));
  await Promise.all([
    mkdir(path.join(root, 'schemas'), { recursive: true }),
    mkdir(path.join(root, 'evidence'), { recursive: true }),
    mkdir(path.join(root, 'assets'), { recursive: true }),
    mkdir(path.join(root, 'policies'), { recursive: true }),
  ]);
  await copyFile(path.join(repositoryRoot, 'schemas', 'routing-manifest.schema.json'), path.join(root, 'schemas', 'routing-manifest.schema.json'));
  await copyFile(path.join(fixtureRoot, 'model-inventory.json'), path.join(root, 'evidence', 'model-inventory.json'));
  await copyFile(path.join(fixtureRoot, 'benchmark-results.json'), path.join(root, 'evidence', 'benchmark-results.json'));
  for (const fileName of ['prompt-bundle.md', 'chat-template.txt', 'runtime-settings.json', 'runtime-build.txt']) {
    await copyFile(path.join(fixtureRoot, fileName), path.join(root, 'assets', fileName));
  }
  return root;
}

function makeProfile(profileId) {
  const category = PROFILE_CATEGORY[profileId];
  const vision = profileId === 'vision';
  return {
    profile_id: profileId,
    description: `Fixture routing profile for ${profileId}.`,
    roles: PROFILE_ROLES[profileId],
    task_families: vision ? ['vision'] : ['mixed'],
    required_capabilities: {
      tool_calling: false,
      schema_output: true,
      vision,
      reasoning_state: false,
      minimum_context_tokens: 8192,
    },
    minimum_thresholds: {
      role_score: 0.9,
      task_success_rate: 0.9,
      schema_success: 0.9,
      maximum_regression_rate: 0,
      maximum_median_seconds: 5,
      maximum_peak_vram_mib: 8192,
      maximum_peak_ram_mib: 16384,
    },
    operational_thresholds: {
      maximum_failure_rate: 0,
      minimum_evaluated_tasks: 1,
      minimum_repetitions: 2,
    },
    metric_selectors: {
      role_score: { categories: [category] },
      task_success_rate: { categories: [category] },
      schema_success: { categories: [category] },
      tool_semantic_success: null,
      citation_precision: null,
      regression_rate: { categories: [category] },
      latency: { categories: [category] },
      failure_rate: { categories: [category] },
    },
    success_cutoff: 1,
    selection_policy: {
      order_by: [{ metric: 'role_score', direction: 'higher' }],
      tie_breakers: [{ metric: 'median_seconds', direction: 'lower' }],
    },
    fallback_profile_id: null,
    candidates: [{
      model_id: 'fixture/model-a',
      model_family: 'fixture-family',
      inventory_artifact_id: 'fixture_models:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      model_artifact_sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      quantization: 'Q4_K_M',
      runtime_id: 'runtime_fixture_lmstudio',
      prompt_bundle_id: 'prompt_fixture',
      template_id: 'template_fixture',
      runtime_settings_id: 'settings_fixture',
      gpu_affinity: [0],
      context_limit: 16384,
      max_output_tokens: 512,
      capabilities: {
        tool_calling: true,
        schema_output: true,
        vision: true,
        reasoning_state: true,
      },
      measurements: [{ artifact_id: 'artifact_fixture_benchmark', benchmark_model_id: 'fixture/model-a' }],
      measurement_artifact_id: 'artifact_fixture_benchmark',
      resource_artifact_id: 'artifact_fixture_benchmark',
    }],
  };
}

async function makePolicy(root, overrides = {}) {
  const policy = {
    policy_version: 'routing-policy/1.0',
    policy_id: 'routing_policy_fixture_reviewed',
    review: {
      status: 'reviewed',
      authority: 'human',
      reviewed_by: 'fixture-reviewer',
      reviewed_at: '2026-08-23T01:00:00.000Z',
    },
    manifest: {
      manifest_id: 'routing_fixture_validated',
      benchmark_snapshot_id: 'bench_will_be_derived',
      hardware_profile_id: 'hardware_fixture_dual_gpu',
    },
    inputs: {
      model_inventory: {
        path: 'evidence/model-inventory.json',
        sha256: await sha256File(path.join(root, 'evidence', 'model-inventory.json')),
        expectations: { minimum_model_count: 2, require_all_roots_present: true, require_zero_errors: true, require_zero_ignored_entries: true },
      },
      benchmark_results: [{
        artifact_id: 'artifact_fixture_benchmark',
        kind: 'mixed',
        path: 'evidence/benchmark-results.json',
        sha256: await sha256File(path.join(root, 'evidence', 'benchmark-results.json')),
        suite_sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      }],
    },
    bindings: {
      prompt_bundles: [{ id: 'prompt_fixture', path: 'assets/prompt-bundle.md', sha256: await sha256File(path.join(root, 'assets', 'prompt-bundle.md')) }],
      templates: [{ id: 'template_fixture', path: 'assets/chat-template.txt', sha256: await sha256File(path.join(root, 'assets', 'chat-template.txt')) }],
      runtime_settings: [{ id: 'settings_fixture', path: 'assets/runtime-settings.json', sha256: await sha256File(path.join(root, 'assets', 'runtime-settings.json')) }],
      runtimes: [{
        runtime_id: 'runtime_fixture_lmstudio',
        kind: 'lm_studio',
        build_id: 'fixture-2.29.1+sha256:c36b7be063f4b5560556596a7425093246282c17e00b3f4b7d820f439013213f',
        build_artifact: { path: 'assets/runtime-build.txt', sha256: await sha256File(path.join(root, 'assets', 'runtime-build.txt')) },
        api_base: 'http://127.0.0.1:1234',
        reported_name: 'fixture-llama.cpp',
        reported_version: '2.29.1',
      }],
    },
    profiles: Object.keys(PROFILE_ROLES).map(makeProfile),
  };
  Object.assign(policy, overrides);
  policy.manifest.benchmark_snapshot_id = deriveBenchmarkSnapshotId(policy);
  await writeFile(path.join(root, 'policies', 'reviewed.json'), `${JSON.stringify(policy, null, 2)}\n`);
  return policy;
}

async function withFixture(callback) {
  const root = await makeFixtureRepository();
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('reviewed, fully bound evidence validates every planned profile', async () => withFixture(async (root) => {
  await makePolicy(root);
  const { manifest, decisionTable } = await buildRoutingArtifacts({
    repoRoot: root,
    policyPath: 'policies/reviewed.json',
    generatedAt: '2026-08-23T02:00:00.000Z',
  });

  assert.equal(manifest.status, 'validated');
  assert.equal(manifest.profiles.length, 6);
  assert.ok(manifest.profiles.every((profile) => profile.eligible_models.length === 1));
  assert.equal(decisionTable.manifest.schema_valid, true);
  assert.deepEqual(decisionTable.unresolved_profiles, []);
  assert.ok(decisionTable.rows.every((row) => row.metrics.failure_rate === 0));
  assert.ok(decisionTable.rows.every((row) => row.metrics.peak_vram_mib === 6000));
  assert.ok(decisionTable.rows.every((row) => row.metrics.peak_ram_mib === 10000));
  assert.ok(decisionTable.rows.every((row) => row.resource_measurement_quality === 'peak'));
  assert.ok(decisionTable.rows.every((row) => row.hashes.runtime_build_sha256.length === 64));
  assert.ok(!JSON.stringify(manifest).includes('fixture/unmapped'));
  assert.match(decisionRowsToCsv(decisionTable.rows), /failure_rate,median_seconds,peak_vram_mib,peak_ram_mib/);
}));

test('a benchmark hash mismatch fails closed and emits only a draft', async () => withFixture(async (root) => {
  await makePolicy(root);
  await writeFile(path.join(root, 'evidence', 'benchmark-results.json'), '{"tampered":true}\n');
  const { manifest, decisionTable } = await buildRoutingArtifacts({ repoRoot: root, policyPath: 'policies/reviewed.json' });

  assert.equal(manifest.status, 'draft');
  assert.ok(manifest.profiles.every((profile) => profile.eligible_models.length === 0));
  assert.ok(decisionTable.global_checks.some((item) => item.id === 'source.artifact_fixture_benchmark.sha256' && item.status === 'fail'));
}));

test('role thresholds reject only the policy-mapped candidate and never infer another inventory model', async () => withFixture(async (root) => {
  const reportPath = path.join(root, 'evidence', 'benchmark-results.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.models[0].cases.find((item) => item.taskId === 'code' && item.repeat === 1).score = 0;
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await makePolicy(root);
  const { manifest, decisionTable } = await buildRoutingArtifacts({ repoRoot: root, policyPath: 'policies/reviewed.json' });

  assert.equal(manifest.status, 'draft');
  assert.equal(manifest.profiles.find((profile) => profile.profile_id === 'coder').eligible_models.length, 0);
  assert.ok(decisionTable.unresolved_profiles.includes('coder'));
  const coder = decisionTable.rows.find((row) => row.profile_id === 'coder');
  assert.equal(coder.metrics.task_success_rate, 0.5);
  assert.equal(coder.metrics.regression_rate, 1);
  assert.ok(coder.checks.some((item) => item.id === 'threshold.role_score' && item.status === 'fail'));
  assert.ok(!JSON.stringify(decisionTable.rows).includes('fixture/unmapped'));
}));

test('sampled hardware observations are reported but cannot masquerade as peak receipts', async () => withFixture(async (root) => {
  const reportPath = path.join(root, 'evidence', 'benchmark-results.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  delete report.models[0].resourceMeasurement;
  report.models[0].hardwareLoaded = {
    totalRamGiB: 64,
    freeRamGiB: 54,
    gpus: [{ usedMiB: 6000 }],
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await makePolicy(root);
  const { manifest, decisionTable } = await buildRoutingArtifacts({ repoRoot: root, policyPath: 'policies/reviewed.json' });

  assert.equal(manifest.status, 'draft');
  assert.ok(manifest.profiles.every((profile) => profile.eligible_models.length === 0));
  assert.ok(decisionTable.rows.every((row) => row.resource_measurement_quality === 'sampled_not_peak'));
  assert.ok(decisionTable.rows.every((row) => row.metrics.peak_vram_mib === 6000));
  assert.ok(decisionTable.rows.every((row) => row.checks.some((item) => item.id === 'measurement.peak_resource_receipt' && item.status === 'fail')));
}));

test('routing schema validation rejects additional properties and validated empty profiles', async () => {
  const schema = JSON.parse(await readFile(path.join(repositoryRoot, 'schemas', 'routing-manifest.schema.json'), 'utf8'));
  const invalid = {
    manifest_version: 'routing-manifest/1.0',
    protocol_version: 'local-loop/1.0',
    manifest_id: 'routing_fixture',
    status: 'validated',
    generated_at: '2026-08-23T00:00:00.000Z',
    benchmark_snapshot_id: 'bench_fixture',
    hardware_profile_id: 'hardware_fixture',
    profiles: [],
    guessed_winner: 'forbidden',
  };
  const validation = validateJsonSchema(invalid, schema);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.instancePath === '/guessed_winner'));
  assert.ok(validation.errors.some((error) => error.schemaPath.endsWith('/minItems')));
});

test('checked-in unreviewed policy stays schema-valid and exposes every unmapped profile', async () => {
  const { manifest, decisionTable } = await buildRoutingArtifacts({
    repoRoot: repositoryRoot,
    policyPath: 'policies/routing-policy.draft.json',
    generatedAt: '2026-08-23T02:00:00.000Z',
  });
  assert.equal(manifest.status, 'draft');
  assert.equal(decisionTable.manifest.schema_valid, true);
  assert.equal(decisionTable.unresolved_profiles.length, 6);
  assert.equal(decisionTable.rows.filter((row) => row.decision === 'unresolved_no_policy_mapping').length, 6);
  assert.ok(decisionTable.rows.every((row) => row.checks.some((item) => item.id === 'policy.candidate_mapping')));
});
