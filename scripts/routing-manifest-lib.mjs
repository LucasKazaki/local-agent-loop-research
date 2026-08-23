import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { validateJsonSchema } from './json-schema-lite.mjs';

const SHA256 = /^[a-f0-9]{64}$/i;
const PLANNED_PROFILES = new Map([
  ['planner', ['planner']],
  ['researcher_extractor', ['researcher', 'extractor']],
  ['coder', ['coder']],
  ['verifier_critic', ['verifier', 'critic']],
  ['synthesizer_policy', ['synthesizer', 'policy_guard']],
  ['vision', ['vision']],
]);

export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath) {
  return sha256Text(await readFile(filePath));
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function repoPath(repoRoot, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    throw new Error(`Repository path must be a non-empty relative path: ${String(relativePath)}`);
  }
  const root = path.resolve(repoRoot);
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Path escapes repository root: ${relativePath}`);
  }
  return resolved;
}

function asPortable(value) {
  return value.split(path.sep).join('/');
}

function safePathError(error, repoRoot) {
  const root = path.resolve(repoRoot);
  return String(error?.message ?? error)
    .replaceAll(root, '<REPO_ROOT>')
    .replaceAll(root.replaceAll('\\', '/'), '<REPO_ROOT>');
}

function check(id, passed, expected, actual, detail = null) {
  return { id, status: passed ? 'pass' : 'fail', expected, actual, detail };
}

function validIso(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validatePolicy(policy) {
  const errors = [];
  const requireString = (value, label) => {
    if (typeof value !== 'string' || value.length === 0) errors.push(`${label} must be a non-empty string`);
  };
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return ['policy must be an object'];
  if (policy.policy_version !== 'routing-policy/1.0') errors.push('policy_version must be routing-policy/1.0');
  requireString(policy.policy_id, 'policy_id');
  requireString(policy?.manifest?.manifest_id, 'manifest.manifest_id');
  requireString(policy?.manifest?.benchmark_snapshot_id, 'manifest.benchmark_snapshot_id');
  requireString(policy?.manifest?.hardware_profile_id, 'manifest.hardware_profile_id');
  if (!policy.inputs || typeof policy.inputs !== 'object') errors.push('inputs must be an object');
  if (!Array.isArray(policy?.inputs?.benchmark_results)) errors.push('inputs.benchmark_results must be an array');
  if (!policy?.inputs?.model_inventory || typeof policy.inputs.model_inventory !== 'object') errors.push('inputs.model_inventory must be an object');
  for (const group of ['prompt_bundles', 'templates', 'runtime_settings', 'runtimes']) {
    if (!Array.isArray(policy?.bindings?.[group])) errors.push(`bindings.${group} must be an array`);
  }
  if (!Array.isArray(policy.profiles)) errors.push('profiles must be an array');

  const profileIds = new Set();
  for (const [index, profile] of (policy.profiles ?? []).entries()) {
    requireString(profile?.profile_id, `profiles[${index}].profile_id`);
    if (profileIds.has(profile?.profile_id)) errors.push(`duplicate profile_id ${profile.profile_id}`);
    profileIds.add(profile?.profile_id);
    if (!Array.isArray(profile?.candidates)) errors.push(`profiles[${index}].candidates must be an array`);
    if (!profile?.metric_selectors || typeof profile.metric_selectors !== 'object') errors.push(`profiles[${index}].metric_selectors must be an object`);
    if (!Number.isFinite(profile?.success_cutoff) || profile.success_cutoff < 0 || profile.success_cutoff > 1) errors.push(`profiles[${index}].success_cutoff must be between 0 and 1`);
  }
  for (const [profileId, roles] of PLANNED_PROFILES) {
    const profile = (policy.profiles ?? []).find((item) => item.profile_id === profileId);
    if (!profile) {
      errors.push(`missing planned profile ${profileId}`);
      continue;
    }
    if (canonicalJson([...(profile.roles ?? [])].sort()) !== canonicalJson([...roles].sort())) {
      errors.push(`planned profile ${profileId} must have roles ${roles.join(', ')}`);
    }
  }
  return errors;
}

async function loadPinnedJson(repoRoot, descriptor, kind) {
  const output = {
    id: descriptor?.artifact_id ?? descriptor?.id ?? kind,
    kind,
    path: descriptor?.path ?? null,
    expected_sha256: descriptor?.sha256 ?? null,
    actual_sha256: null,
    verified: false,
    errors: [],
    value: null,
  };
  if (!SHA256.test(output.expected_sha256 ?? '')) output.errors.push('expected SHA-256 is absent or invalid');
  try {
    const fullPath = repoPath(repoRoot, output.path);
    const bytes = await readFile(fullPath);
    output.actual_sha256 = sha256Text(bytes);
    if (output.actual_sha256 !== output.expected_sha256) output.errors.push('file SHA-256 does not match policy');
    try {
      output.value = JSON.parse(bytes.toString('utf8'));
    } catch (error) {
      output.errors.push(`JSON parse failed: ${error.message}`);
    }
  } catch (error) {
    output.errors.push(safePathError(error, repoRoot));
  }
  output.verified = output.errors.length === 0;
  return output;
}

async function loadPinnedFile(repoRoot, descriptor, kind) {
  const output = {
    id: descriptor?.id ?? kind,
    kind,
    path: descriptor?.path ?? null,
    expected_sha256: descriptor?.sha256 ?? null,
    actual_sha256: null,
    verified: false,
    errors: [],
  };
  if (!SHA256.test(output.expected_sha256 ?? '')) output.errors.push('expected SHA-256 is absent or invalid');
  try {
    const bytes = await readFile(repoPath(repoRoot, output.path));
    output.actual_sha256 = sha256Text(bytes);
    if (output.actual_sha256 !== output.expected_sha256) output.errors.push('file SHA-256 does not match policy');
  } catch (error) {
    output.errors.push(safePathError(error, repoRoot));
  }
  output.verified = output.errors.length === 0;
  return output;
}

function inventoryIntegrity(inventory, expectations = {}) {
  const checks = [];
  const payloadHash = inventory?.roots ? sha256Text(JSON.stringify({ roots: inventory.roots })) : null;
  checks.push(check('inventory.schema_version', inventory?.schema_version === 'model-inventory/1.0', 'model-inventory/1.0', inventory?.schema_version ?? null));
  checks.push(check('inventory.self_hash', SHA256.test(inventory?.inventory_sha256 ?? '') && payloadHash === inventory.inventory_sha256, inventory?.inventory_sha256 ?? null, payloadHash));
  const models = (inventory?.roots ?? []).flatMap((root) => root.models ?? []);
  checks.push(check('inventory.minimum_model_count', models.length >= (expectations.minimum_model_count ?? 1), expectations.minimum_model_count ?? 1, models.length));
  checks.push(check('inventory.model_count_reconciled', inventory?.summary?.gguf_file_count === models.length, models.length, inventory?.summary?.gguf_file_count ?? null));
  checks.push(check('inventory.byte_count_reconciled', inventory?.summary?.total_bytes === models.reduce((sum, model) => sum + (model.size_bytes ?? 0), 0), models.reduce((sum, model) => sum + (model.size_bytes ?? 0), 0), inventory?.summary?.total_bytes ?? null));
  checks.push(check('inventory.valid_headers', models.length > 0 && models.every((model) => model?.gguf?.valid === true), true, models.filter((model) => model?.gguf?.valid === true).length));
  checks.push(check('inventory.unique_artifact_ids', new Set(models.map((model) => model.artifact_id)).size === models.length, models.length, new Set(models.map((model) => model.artifact_id)).size));
  if (expectations.require_all_roots_present !== false) {
    checks.push(check('inventory.all_roots_present', (inventory?.roots ?? []).every((root) => root.status === 'present'), 'all roots status=present', (inventory?.roots ?? []).map((root) => `${root.id}:${root.status}`)));
  }
  if (expectations.require_zero_errors !== false) {
    checks.push(check('inventory.zero_errors', (inventory?.summary?.error_count ?? Number.POSITIVE_INFINITY) === 0, 0, inventory?.summary?.error_count ?? null));
  }
  if (expectations.require_zero_ignored_entries !== false) {
    const ignored = (inventory?.roots ?? []).reduce((sum, root) => sum + (root?.summary?.ignored_entry_count ?? 0), 0);
    checks.push(check('inventory.zero_ignored_entries', ignored === 0, 0, ignored));
  }
  checks.push(check('inventory.all_artifacts_hashed', models.length > 0 && models.every((model) => SHA256.test(model.sha256 ?? '')), true, models.filter((model) => SHA256.test(model.sha256 ?? '')).length));
  return { checks, models };
}

function benchmarkIntegrity(source, descriptor) {
  const report = source.value;
  const suite = report?.taskSuite ?? report?.suite;
  const checks = [
    check(`${source.id}.finished`, validIso(report?.finishedAt), 'completed report with finishedAt', report?.finishedAt ?? null),
    check(`${source.id}.time_order`, validIso(report?.startedAt) && validIso(report?.finishedAt) && Date.parse(report.finishedAt) >= Date.parse(report.startedAt), 'finishedAt >= startedAt', { startedAt: report?.startedAt ?? null, finishedAt: report?.finishedAt ?? null }),
    check(`${source.id}.suite_hash`, SHA256.test(descriptor.suite_sha256 ?? '') && suite?.hashSha256 === descriptor.suite_sha256, descriptor.suite_sha256 ?? null, suite?.hashSha256 ?? null),
    check(`${source.id}.models_present`, Array.isArray(report?.models) && report.models.length > 0, 'at least one model record', report?.models?.length ?? null),
  ];
  return checks;
}

function reportModel(report, modelId) {
  return (report?.models ?? []).find((item) => item.model === modelId) ?? null;
}

function normalizedScore(item) {
  const raw = typeof item?.score === 'number'
    ? item.score
    : typeof item?.score?.score === 'number'
      ? item.score.score
      : typeof item?.receipt?.score === 'number'
        ? item.receipt.score
        : null;
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return null;
  return raw;
}

function normalizeCases(sourceId, model) {
  return (model?.cases ?? []).map((item) => ({
    artifact_id: sourceId,
    task_id: item.taskId ?? null,
    category: item.category ?? null,
    repeat: Number.isInteger(item.repeat) ? item.repeat : 0,
    status: item.status ?? 'unknown',
    score: normalizedScore(item),
    wall_seconds: Number.isFinite(item?.response?.wallMs)
      ? item.response.wallMs / 1000
      : Number.isFinite(item?.receipt?.wallMs)
        ? item.receipt.wallMs / 1000
        : null,
    runtime_name: item?.response?.runtime?.name ?? null,
    runtime_version: item?.response?.runtime?.version ?? null,
  }));
}

function selectorCases(cases, selector) {
  if (selector === null) return [];
  if (!selector || typeof selector !== 'object') return cases;
  return cases.filter((item) => {
    if (Array.isArray(selector.artifact_ids) && !selector.artifact_ids.includes(item.artifact_id)) return false;
    if (Array.isArray(selector.task_ids) && !selector.task_ids.includes(item.task_id)) return false;
    if (Array.isArray(selector.categories) && !selector.categories.includes(item.category)) return false;
    return true;
  });
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function successRate(cases, cutoff) {
  if (!cases.length) return null;
  return cases.filter((item) => item.status === 'completed' && item.score !== null && item.score >= cutoff).length / cases.length;
}

function regressionRate(cases, cutoff) {
  const byTask = new Map();
  for (const item of cases) {
    if (!byTask.has(item.task_id)) byTask.set(item.task_id, []);
    byTask.get(item.task_id).push(item);
  }
  const repeated = [...byTask.values()].filter((items) => new Set(items.map((item) => item.repeat)).size > 1);
  if (!repeated.length) return null;
  const regressed = repeated.filter((items) => {
    const ordered = [...items].sort((left, right) => left.repeat - right.repeat);
    const first = ordered[0];
    return ordered.slice(1).some((item) => {
      const firstPass = first.status === 'completed' && first.score !== null && first.score >= cutoff;
      const laterPass = item.status === 'completed' && item.score !== null && item.score >= cutoff;
      return firstPass && !laterPass;
    });
  }).length;
  return regressed / repeated.length;
}

function observedResources(model) {
  if (model?.resourceMeasurement?.quality === 'peak'
    && Number.isInteger(model.resourceMeasurement.peakVramMib)
    && Number.isInteger(model.resourceMeasurement.peakRamMib)) {
    return {
      quality: 'peak',
      peak_vram_mib: model.resourceMeasurement.peakVramMib,
      peak_ram_mib: model.resourceMeasurement.peakRamMib,
    };
  }
  const samples = [model?.hardwareLoaded, model?.hardwareAfter].filter(Boolean);
  const vram = samples.map((sample) => (sample.gpus ?? []).reduce((sum, gpu) => sum + (gpu.usedMiB ?? 0), 0)).filter(Number.isFinite);
  const ram = samples.map((sample) => Number.isFinite(sample.totalRamGiB) && Number.isFinite(sample.freeRamGiB)
    ? Math.round((sample.totalRamGiB - sample.freeRamGiB) * 1024)
    : null).filter(Number.isFinite);
  return {
    quality: samples.length ? 'sampled_not_peak' : 'missing',
    peak_vram_mib: vram.length ? Math.round(Math.max(...vram)) : null,
    peak_ram_mib: ram.length ? Math.round(Math.max(...ram)) : null,
  };
}

function computeMetrics(cases, selectors, cutoff, resources) {
  const roleCases = selectorCases(cases, selectors.role_score);
  const successCases = selectorCases(cases, selectors.task_success_rate ?? selectors.role_score);
  const schemaCases = selectorCases(cases, selectors.schema_success);
  const toolCases = selectorCases(cases, selectors.tool_semantic_success);
  const citationCases = selectorCases(cases, selectors.citation_precision);
  const regressionCases = selectorCases(cases, selectors.regression_rate);
  const selected = selectorCases(cases, selectors.latency ?? selectors.role_score);
  const allRoleCases = selectorCases(cases, selectors.failure_rate ?? selectors.role_score);
  return {
    role_score: mean(roleCases.map((item) => item.score ?? 0)),
    task_success_rate: successRate(successCases, cutoff),
    tool_semantic_success: selectors.tool_semantic_success === null ? null : successRate(toolCases, cutoff),
    schema_success: successRate(schemaCases, cutoff),
    citation_precision: selectors.citation_precision === null ? null : successRate(citationCases, cutoff),
    regression_rate: selectors.regression_rate === null ? null : regressionRate(regressionCases, cutoff),
    median_seconds: median(selected.map((item) => item.wall_seconds).filter(Number.isFinite)),
    peak_vram_mib: resources.peak_vram_mib,
    peak_ram_mib: resources.peak_ram_mib,
    failure_rate: allRoleCases.length ? allRoleCases.filter((item) => item.status !== 'completed').length / allRoleCases.length : null,
    evaluated_tasks: new Set(roleCases.map((item) => item.task_id).filter(Boolean)).size,
    repetitions: new Set(roleCases.map((item) => item.repeat)).size,
    evaluated_cases: roleCases.length,
  };
}

function thresholdChecks(profile, metrics) {
  const output = [];
  const thresholds = profile.minimum_thresholds;
  const lowerBounds = ['role_score', 'task_success_rate', 'tool_semantic_success', 'schema_success', 'citation_precision'];
  for (const metric of lowerBounds) {
    if (thresholds[metric] !== undefined) output.push(check(`threshold.${metric}`, metrics[metric] !== null && metrics[metric] >= thresholds[metric], `>= ${thresholds[metric]}`, metrics[metric]));
  }
  const upperBounds = {
    maximum_regression_rate: 'regression_rate',
    maximum_median_seconds: 'median_seconds',
    maximum_peak_vram_mib: 'peak_vram_mib',
    maximum_peak_ram_mib: 'peak_ram_mib',
  };
  for (const [threshold, metric] of Object.entries(upperBounds)) {
    if (thresholds[threshold] !== undefined) output.push(check(`threshold.${threshold}`, metrics[metric] !== null && metrics[metric] <= thresholds[threshold], `<= ${thresholds[threshold]}`, metrics[metric]));
  }
  const operational = profile.operational_thresholds ?? {};
  if (operational.maximum_failure_rate !== undefined) output.push(check('threshold.maximum_failure_rate', metrics.failure_rate !== null && metrics.failure_rate <= operational.maximum_failure_rate, `<= ${operational.maximum_failure_rate}`, metrics.failure_rate));
  if (operational.minimum_evaluated_tasks !== undefined) output.push(check('threshold.minimum_evaluated_tasks', metrics.evaluated_tasks >= operational.minimum_evaluated_tasks, `>= ${operational.minimum_evaluated_tasks}`, metrics.evaluated_tasks));
  if (operational.minimum_repetitions !== undefined) output.push(check('threshold.minimum_repetitions', metrics.repetitions >= operational.minimum_repetitions, `>= ${operational.minimum_repetitions}`, metrics.repetitions));
  return output;
}

function capabilitiesPass(required, actual) {
  const checks = [];
  for (const capability of ['tool_calling', 'schema_output', 'vision', 'reasoning_state']) {
    checks.push(check(`capability.${capability}`, !required[capability] || actual?.[capability] === true, required[capability], actual?.[capability] ?? null));
  }
  return checks;
}

function runtimeReportChecks(cases, runtime) {
  const checks = [];
  if (runtime.reported_name) {
    const names = [...new Set(cases.map((item) => item.runtime_name).filter(Boolean))];
    checks.push(check('runtime.reported_name', names.length > 0 && names.every((name) => name === runtime.reported_name), runtime.reported_name, names));
  }
  if (runtime.reported_version) {
    const versions = [...new Set(cases.map((item) => item.runtime_version).filter(Boolean))];
    checks.push(check('runtime.reported_version', versions.length > 0 && versions.every((version) => version === runtime.reported_version), runtime.reported_version, versions));
  }
  return checks;
}

function inventoryModel(inventoryModels, artifactId) {
  return inventoryModels.find((model) => model.artifact_id === artifactId) ?? null;
}

function publicSource(source) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'value'));
}

export function deriveBenchmarkSnapshotId(policy) {
  const sourceBindings = {
    inventory: {
      path: policy?.inputs?.model_inventory?.path ?? null,
      sha256: policy?.inputs?.model_inventory?.sha256 ?? null,
    },
    benchmarks: (policy?.inputs?.benchmark_results ?? []).map((item) => ({ artifact_id: item.artifact_id, path: item.path, sha256: item.sha256, suite_sha256: item.suite_sha256 })).sort((left, right) => String(left.artifact_id).localeCompare(String(right.artifact_id))),
    prompt_bundles: (policy?.bindings?.prompt_bundles ?? []).map((item) => ({ id: item.id, path: item.path, sha256: item.sha256 })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    templates: (policy?.bindings?.templates ?? []).map((item) => ({ id: item.id, path: item.path, sha256: item.sha256 })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    runtime_settings: (policy?.bindings?.runtime_settings ?? []).map((item) => ({ id: item.id, path: item.path, sha256: item.sha256 })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    runtimes: (policy?.bindings?.runtimes ?? []).map((item) => ({ runtime_id: item.runtime_id, kind: item.kind, build_id: item.build_id, build_artifact: item.build_artifact, api_base: item.api_base })).sort((left, right) => String(left.runtime_id).localeCompare(String(right.runtime_id))),
  };
  return `bench_${sha256Text(canonicalJson(sourceBindings)).slice(0, 32)}`;
}

function compareCandidates(profile, left, right) {
  const ordering = [...profile.selection_policy.order_by, ...profile.selection_policy.tie_breakers];
  for (const rule of ordering) {
    const leftValue = left.measured_scores[rule.metric];
    const rightValue = right.measured_scores[rule.metric];
    if (leftValue === rightValue) continue;
    if (leftValue === null) return 1;
    if (rightValue === null) return -1;
    return rule.direction === 'higher' ? rightValue - leftValue : leftValue - rightValue;
  }
  return left.model_id.localeCompare(right.model_id);
}

export async function buildRoutingArtifacts({ repoRoot, policyPath, generatedAt = new Date().toISOString() }) {
  const absolutePolicyPath = repoPath(repoRoot, policyPath);
  const policyBytes = await readFile(absolutePolicyPath);
  const policySha256 = sha256Text(policyBytes);
  const policy = JSON.parse(policyBytes.toString('utf8'));
  const policyErrors = validatePolicy(policy);
  if (policyErrors.length) throw new Error(`Routing policy is invalid:\n- ${policyErrors.join('\n- ')}`);

  const manifestSchemaPath = 'schemas/routing-manifest.schema.json';
  const schemaBytes = await readFile(repoPath(repoRoot, manifestSchemaPath));
  const manifestSchema = JSON.parse(schemaBytes.toString('utf8'));
  const schemaSha256 = sha256Text(schemaBytes);

  const inventorySource = await loadPinnedJson(repoRoot, policy.inputs.model_inventory, 'model_inventory');
  const benchmarkSources = await Promise.all(policy.inputs.benchmark_results.map((item) => loadPinnedJson(repoRoot, item, item.kind ?? 'benchmark_result')));
  const promptSources = await Promise.all(policy.bindings.prompt_bundles.map((item) => loadPinnedFile(repoRoot, item, 'prompt_bundle')));
  const templateSources = await Promise.all(policy.bindings.templates.map((item) => loadPinnedFile(repoRoot, item, 'template')));
  const settingsSources = await Promise.all(policy.bindings.runtime_settings.map((item) => loadPinnedFile(repoRoot, item, 'runtime_settings')));
  const runtimeSources = await Promise.all(policy.bindings.runtimes.map(async (item) => ({
    ...await loadPinnedFile(repoRoot, { ...item.build_artifact, id: item.runtime_id }, 'runtime_build'),
    runtime_id: item.runtime_id,
  })));
  const sources = [inventorySource, ...benchmarkSources, ...promptSources, ...templateSources, ...settingsSources, ...runtimeSources];

  const inventory = inventoryIntegrity(inventorySource.value, policy.inputs.model_inventory.expectations);
  const benchmarkChecks = benchmarkSources.flatMap((source) => {
    const descriptor = policy.inputs.benchmark_results.find((item) => item.artifact_id === source.id);
    return benchmarkIntegrity(source, descriptor);
  });
  const sourceChecks = [
    ...sources.map((source) => check(`source.${source.id}.sha256`, source.verified, source.expected_sha256, source.actual_sha256, source.errors.join('; ') || null)),
    ...inventory.checks,
    ...benchmarkChecks,
  ];
  const expectedSnapshotId = deriveBenchmarkSnapshotId(policy);
  const reviewValid = policy.review?.status === 'reviewed'
    && policy.review?.authority === 'human'
    && typeof policy.review?.reviewed_by === 'string'
    && policy.review.reviewed_by.length > 0
    && validIso(policy.review?.reviewed_at);
  const globalChecks = [
    check('policy.human_review', reviewValid, 'reviewed human policy', policy.review ?? null),
    check('snapshot.content_addressed_id', policy.manifest.benchmark_snapshot_id === expectedSnapshotId, expectedSnapshotId, policy.manifest.benchmark_snapshot_id),
    ...sourceChecks,
  ];

  const benchmarkById = new Map(benchmarkSources.map((source) => [source.id, source]));
  const promptById = new Map(promptSources.map((source) => [source.id, source]));
  const templateById = new Map(templateSources.map((source) => [source.id, source]));
  const settingsById = new Map(settingsSources.map((source) => [source.id, source]));
  const runtimeById = new Map(policy.bindings.runtimes.map((runtime) => [runtime.runtime_id, runtime]));
  const runtimeSourceById = new Map(runtimeSources.map((source) => [source.runtime_id, source]));
  const rows = [];
  const profiles = [];

  for (const profile of policy.profiles) {
    const eligible = [];
    for (const candidate of profile.candidates) {
      const checks = [check('global.inputs_verified', globalChecks.every((item) => item.status === 'pass'), true, globalChecks.filter((item) => item.status === 'fail').map((item) => item.id))];
      const inventoryItem = inventoryModel(inventory.models, candidate.inventory_artifact_id);
      checks.push(check('inventory.artifact_id', Boolean(inventoryItem), candidate.inventory_artifact_id, inventoryItem?.artifact_id ?? null));
      checks.push(check('inventory.model_sha256', inventoryItem?.sha256 === candidate.model_artifact_sha256 && SHA256.test(candidate.model_artifact_sha256 ?? ''), candidate.model_artifact_sha256, inventoryItem?.sha256 ?? null));
      checks.push(check('inventory.quantization', inventoryItem?.quantization_from_filename === candidate.quantization, candidate.quantization, inventoryItem?.quantization_from_filename ?? null));

      const prompt = promptById.get(candidate.prompt_bundle_id);
      const template = templateById.get(candidate.template_id);
      const settings = settingsById.get(candidate.runtime_settings_id);
      const runtime = runtimeById.get(candidate.runtime_id);
      const runtimeSource = runtimeSourceById.get(candidate.runtime_id);
      checks.push(check('binding.prompt_bundle', Boolean(prompt?.verified), candidate.prompt_bundle_id, prompt?.id ?? null));
      checks.push(check('binding.template', Boolean(template?.verified), candidate.template_id, template?.id ?? null));
      checks.push(check('binding.runtime_settings', Boolean(settings?.verified), candidate.runtime_settings_id, settings?.id ?? null));
      checks.push(check('binding.runtime', Boolean(runtime && runtimeSource?.verified), candidate.runtime_id, runtime?.runtime_id ?? null));
      checks.push(check(
        'binding.runtime_build_id_hash',
        Boolean(runtimeSource?.actual_sha256 && runtime?.build_id?.includes(`sha256:${runtimeSource.actual_sha256}`)),
        `build_id containing sha256:${runtimeSource?.actual_sha256 ?? '<unresolved>'}`,
        runtime?.build_id ?? null,
        'The routing schema carries build_id but has no separate runtime hash field, so build_id must be content-addressed.',
      ));

      const cases = [];
      const evidenceModels = [];
      for (const measurement of candidate.measurements ?? []) {
        const source = benchmarkById.get(measurement.artifact_id);
        const model = reportModel(source?.value, measurement.benchmark_model_id);
        checks.push(check(`measurement.${measurement.artifact_id}.source`, Boolean(source?.verified), 'verified benchmark source', source?.verified ?? false));
        checks.push(check(`measurement.${measurement.artifact_id}.model`, Boolean(model), measurement.benchmark_model_id, model?.model ?? null));
        checks.push(check(`measurement.${measurement.artifact_id}.completed`, model?.status === 'completed', 'completed', model?.status ?? null));
        if (model) {
          evidenceModels.push({ artifactId: measurement.artifact_id, model });
          cases.push(...normalizeCases(measurement.artifact_id, model));
          const binding = model.measurementBindings ?? model.provenance?.bindings ?? {};
          checks.push(check(`measurement.${measurement.artifact_id}.model_hash`, binding.modelArtifactSha256 === candidate.model_artifact_sha256, candidate.model_artifact_sha256, binding.modelArtifactSha256 ?? null));
          checks.push(check(`measurement.${measurement.artifact_id}.prompt_hash`, binding.promptBundleSha256 === prompt?.actual_sha256, prompt?.actual_sha256 ?? null, binding.promptBundleSha256 ?? null));
          checks.push(check(`measurement.${measurement.artifact_id}.template_hash`, binding.templateSha256 === template?.actual_sha256, template?.actual_sha256 ?? null, binding.templateSha256 ?? null));
          checks.push(check(`measurement.${measurement.artifact_id}.settings_hash`, binding.runtimeSettingsSha256 === settings?.actual_sha256, settings?.actual_sha256 ?? null, binding.runtimeSettingsSha256 ?? null));
          checks.push(check(`measurement.${measurement.artifact_id}.runtime_hash`, binding.runtimeBuildSha256 === runtimeSource?.actual_sha256, runtimeSource?.actual_sha256 ?? null, binding.runtimeBuildSha256 ?? null));
          checks.push(check(`measurement.${measurement.artifact_id}.hardware`, binding.hardwareProfileId === policy.manifest.hardware_profile_id, policy.manifest.hardware_profile_id, binding.hardwareProfileId ?? null));
        }
      }
      checks.push(check('measurement.primary_artifact', (candidate.measurements ?? []).some((item) => item.artifact_id === candidate.measurement_artifact_id), candidate.measurement_artifact_id, (candidate.measurements ?? []).map((item) => item.artifact_id)));
      checks.push(check('measurement.cases_present', cases.length > 0, 'at least one case', cases.length));

      const resourceEvidence = evidenceModels.find((item) => item.artifactId === candidate.resource_artifact_id);
      const resources = observedResources(resourceEvidence?.model);
      checks.push(check('measurement.peak_resource_receipt', resources.quality === 'peak', 'peak', resources.quality));
      if (runtime) checks.push(...runtimeReportChecks(cases, runtime));
      checks.push(...capabilitiesPass(profile.required_capabilities, candidate.capabilities));
      checks.push(check('capability.context', candidate.context_limit >= profile.required_capabilities.minimum_context_tokens, `>= ${profile.required_capabilities.minimum_context_tokens}`, candidate.context_limit));

      const metrics = computeMetrics(cases, profile.metric_selectors, profile.success_cutoff, resources);
      checks.push(check('metric.role_score_available', metrics.role_score !== null, 'number', metrics.role_score));
      checks.push(check('metric.task_success_rate_available', metrics.task_success_rate !== null, 'number', metrics.task_success_rate));
      checks.push(check('metric.schema_success_available', metrics.schema_success !== null, 'number', metrics.schema_success));
      checks.push(check('metric.median_seconds_available', metrics.median_seconds !== null, 'number', metrics.median_seconds));
      checks.push(...thresholdChecks(profile, metrics));

      const accepted = checks.every((item) => item.status === 'pass');
      const hashes = {
        model_artifact_sha256: candidate.model_artifact_sha256 ?? null,
        prompt_bundle_sha256: prompt?.actual_sha256 ?? null,
        template_sha256: template?.actual_sha256 ?? null,
        runtime_build_sha256: runtimeSource?.actual_sha256 ?? null,
        runtime_settings_sha256: settings?.actual_sha256 ?? null,
        policy_sha256: policySha256,
        routing_schema_sha256: schemaSha256,
      };
      rows.push({
        profile_id: profile.profile_id,
        roles: profile.roles,
        decision: accepted ? 'eligible' : 'rejected',
        model_id: candidate.model_id,
        inventory_artifact_id: candidate.inventory_artifact_id,
        runtime_id: candidate.runtime_id,
        measurement_artifact_ids: (candidate.measurements ?? []).map((item) => item.artifact_id),
        resource_artifact_id: candidate.resource_artifact_id,
        metrics,
        resource_measurement_quality: resources.quality,
        hashes,
        checks,
      });

      if (accepted) {
        eligible.push({
          model_id: candidate.model_id,
          model_family: candidate.model_family,
          model_artifact_sha256: candidate.model_artifact_sha256,
          quantization: candidate.quantization,
          prompt_bundle_sha256: prompt.actual_sha256,
          template_sha256: template.actual_sha256,
          runtime: {
            runtime_id: runtime.runtime_id,
            kind: runtime.kind,
            build_id: runtime.build_id,
            api_base: runtime.api_base,
          },
          runtime_settings_sha256: settings.actual_sha256,
          gpu_affinity: candidate.gpu_affinity,
          context_limit: candidate.context_limit,
          max_output_tokens: candidate.max_output_tokens,
          capabilities: candidate.capabilities,
          measured_scores: {
            role_score: metrics.role_score,
            task_success_rate: metrics.task_success_rate,
            tool_semantic_success: metrics.tool_semantic_success,
            schema_success: metrics.schema_success,
            citation_precision: metrics.citation_precision,
            regression_rate: metrics.regression_rate,
            median_seconds: metrics.median_seconds,
            peak_vram_mib: metrics.peak_vram_mib,
            peak_ram_mib: metrics.peak_ram_mib,
            evaluated_tasks: metrics.evaluated_tasks,
            repetitions: metrics.repetitions,
          },
          benchmark_snapshot_id: policy.manifest.benchmark_snapshot_id,
          measurement_artifact_id: candidate.measurement_artifact_id,
          thresholds_passed: true,
        });
      }
    }

    if (profile.candidates.length === 0) {
      rows.push({
        profile_id: profile.profile_id,
        roles: profile.roles,
        decision: 'unresolved_no_policy_mapping',
        model_id: null,
        inventory_artifact_id: null,
        runtime_id: null,
        measurement_artifact_ids: [],
        resource_artifact_id: null,
        metrics: {
          role_score: null,
          task_success_rate: null,
          tool_semantic_success: null,
          schema_success: null,
          citation_precision: null,
          regression_rate: null,
          median_seconds: null,
          peak_vram_mib: null,
          peak_ram_mib: null,
          failure_rate: null,
          evaluated_tasks: 0,
          repetitions: 0,
          evaluated_cases: 0,
        },
        resource_measurement_quality: 'missing',
        hashes: {
          model_artifact_sha256: null,
          prompt_bundle_sha256: null,
          template_sha256: null,
          runtime_build_sha256: null,
          runtime_settings_sha256: null,
          policy_sha256: policySha256,
          routing_schema_sha256: schemaSha256,
        },
        checks: [check('policy.candidate_mapping', false, 'at least one explicitly reviewed model/runtime mapping', 0)],
      });
    }

    eligible.sort((left, right) => compareCandidates(profile, left, right));
    profiles.push({
      profile_id: profile.profile_id,
      description: profile.description,
      roles: profile.roles,
      task_families: profile.task_families,
      required_capabilities: profile.required_capabilities,
      minimum_thresholds: profile.minimum_thresholds,
      selection_policy: profile.selection_policy,
      eligible_models: eligible,
      fallback_profile_id: profile.fallback_profile_id,
    });
  }

  const manifest = {
    manifest_version: 'routing-manifest/1.0',
    protocol_version: 'local-loop/1.0',
    manifest_id: policy.manifest.manifest_id,
    status: 'draft',
    generated_at: generatedAt,
    benchmark_snapshot_id: policy.manifest.benchmark_snapshot_id,
    hardware_profile_id: policy.manifest.hardware_profile_id,
    profiles,
  };
  const preValidation = validateJsonSchema(manifest, manifestSchema);
  const allProfilesEligible = profiles.every((profile) => profile.eligible_models.length > 0);
  globalChecks.push(check(
    'routing.all_planned_profiles_eligible',
    allProfilesEligible,
    [...PLANNED_PROFILES.keys()],
    profiles.filter((profile) => profile.eligible_models.length > 0).map((profile) => profile.profile_id),
  ));
  if (preValidation.valid && reviewValid && globalChecks.every((item) => item.status === 'pass') && allProfilesEligible) manifest.status = 'validated';
  const schemaValidation = validateJsonSchema(manifest, manifestSchema);
  if (!schemaValidation.valid && manifest.status === 'validated') manifest.status = 'draft';

  const decisionTable = {
    decision_table_version: 'routing-decision-table/1.0',
    generated_at: generatedAt,
    evidence_label: manifest.status === 'validated' ? 'measured' : 'draft-unresolved',
    frontier_parity_established: false,
    policy: { path: asPortable(policyPath), sha256: policySha256, policy_id: policy.policy_id, review: policy.review },
    manifest: {
      manifest_id: manifest.manifest_id,
      status: manifest.status,
      benchmark_snapshot_id: manifest.benchmark_snapshot_id,
      expected_benchmark_snapshot_id: expectedSnapshotId,
      schema_path: manifestSchemaPath,
      schema_sha256: schemaSha256,
      schema_valid: schemaValidation.valid,
      schema_errors: schemaValidation.errors,
    },
    sources: sources.map(publicSource),
    global_checks: globalChecks,
    rows,
    unresolved_profiles: profiles.filter((profile) => profile.eligible_models.length === 0).map((profile) => profile.profile_id),
  };
  return { policy, manifest, decisionTable };
}

export function decisionRowsToCsv(rows) {
  const columns = [
    'profile_id', 'roles', 'decision', 'model_id', 'runtime_id', 'role_score', 'task_success_rate',
    'schema_success', 'tool_semantic_success', 'citation_precision', 'regression_rate', 'failure_rate',
    'median_seconds', 'peak_vram_mib', 'peak_ram_mib', 'resource_measurement_quality', 'failed_checks',
  ];
  const quote = (value) => {
    if (value === null || value === undefined) return '';
    const text = Array.isArray(value) ? value.join('|') : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const lines = [columns.join(',')];
  for (const row of rows) {
    const record = {
      ...row,
      role_score: row.metrics.role_score,
      task_success_rate: row.metrics.task_success_rate,
      schema_success: row.metrics.schema_success,
      tool_semantic_success: row.metrics.tool_semantic_success,
      citation_precision: row.metrics.citation_precision,
      regression_rate: row.metrics.regression_rate,
      failure_rate: row.metrics.failure_rate,
      median_seconds: row.metrics.median_seconds,
      peak_vram_mib: row.metrics.peak_vram_mib,
      peak_ram_mib: row.metrics.peak_ram_mib,
      failed_checks: row.checks.filter((item) => item.status === 'fail').map((item) => item.id),
    };
    lines.push(columns.map((column) => quote(record[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
