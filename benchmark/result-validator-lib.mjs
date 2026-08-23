import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/i;
const TERMINAL_PLACEMENT_STATUSES = new Set(['completed', 'completed_with_failures', 'failed', 'interrupted']);

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function add(findings, severity, code, message) {
  findings.push({ severity, code, message });
}

function error(findings, code, message) {
  add(findings, 'error', code, message);
}

function warning(findings, code, message) {
  add(findings, 'warning', code, message);
}

function closeEnough(actual, expected, tolerance = 1e-9) {
  return Number.isFinite(Number(actual))
    && Number.isFinite(Number(expected))
    && Math.abs(Number(actual) - Number(expected)) <= tolerance;
}

function requireReconciled(findings, code, label, actual, expected, tolerance = 1e-9) {
  if (!closeEnough(actual, expected, tolerance)) {
    error(findings, code, `${label} does not reconcile (stored=${String(actual)}, recomputed=${String(expected)}).`);
  }
}

function validTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateTimeEnvelope(report, findings, startKey, finishKey) {
  const started = report[startKey];
  const finished = report[finishKey];
  if (!validTimestamp(started)) error(findings, 'time.started.invalid', `Missing or invalid ${startKey}.`);
  if (finished === null || finished === undefined || finished === '') {
    warning(findings, 'run.incomplete', `${finishKey} is null; the run is incomplete.`);
    return false;
  }
  if (!validTimestamp(finished)) {
    error(findings, 'time.finished.invalid', `Invalid ${finishKey}.`);
    return false;
  }
  if (validTimestamp(started) && Date.parse(finished) < Date.parse(started)) {
    error(findings, 'time.order.invalid', `${finishKey} precedes ${startKey}.`);
  }
  return true;
}

function validateTaskManifest(taskIds, repeats, findings, label) {
  if (!Array.isArray(taskIds) || taskIds.length === 0 || taskIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    error(findings, 'suite.tasks.empty', `${label} task manifest is empty or malformed.`);
    return 0;
  }
  if (new Set(taskIds).size !== taskIds.length) error(findings, 'suite.tasks.duplicate', `${label} contains duplicate task IDs.`);
  if (!Number.isSafeInteger(repeats) || repeats < 1) {
    error(findings, 'suite.repeats.invalid', `${label} repeats must be a positive integer.`);
    return 0;
  }
  return taskIds.length * repeats;
}

function validateScore(value, findings, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    error(findings, 'case.score.invalid', `${label}: score must be between 0 and 1; found ${String(value)}.`);
    return 0;
  }
  return number;
}

function validateCaseMatrix({
  subjects,
  subjectId,
  taskIds,
  repeats,
  expectedCases,
  scoreOf,
  completedCase,
  failedStatuses,
  completedSubjectStatuses = ['completed'],
  failedSubjectStatuses = ['load_failed'],
  runComplete = true,
  intermediateCaseStatuses = ['running', 'requesting'],
  intermediateSubjectStatuses = ['loading', 'running'],
  findings,
}) {
  if (!Array.isArray(subjects)) {
    error(findings, 'subjects.missing', 'Expected an array of model/profile records.');
    return;
  }
  const subjectIds = subjects.map(subjectId);
  if (subjectIds.some((id) => typeof id !== 'string' || id.length === 0)) error(findings, 'subjects.id.invalid', 'Every model/profile record must have a non-empty identity.');
  if (new Set(subjectIds).size !== subjectIds.length) error(findings, 'subjects.id.duplicate', 'Model/profile identities must be unique.');
  const taskSet = new Set(taskIds ?? []);

  for (const subject of subjects) {
    const id = subjectId(subject) || '<unknown>';
    if (!Array.isArray(subject.cases)) {
      error(findings, 'cases.missing', `${id}: cases must be an array.`);
      continue;
    }
    const keys = new Set();
    for (const item of subject.cases) {
      const key = `${item?.taskId}:${item?.repeat}`;
      if (keys.has(key)) error(findings, 'case.duplicate', `${id}: duplicate case ${key}.`);
      keys.add(key);
      if (!taskSet.has(item?.taskId)) error(findings, 'case.task.unknown', `${id}/${key}: task is not in the stored suite manifest.`);
      if (!Number.isSafeInteger(item?.repeat) || item.repeat < 0 || item.repeat >= repeats) error(findings, 'case.repeat.invalid', `${id}/${key}: repeat is outside 0..${repeats - 1}.`);
      validateScore(scoreOf(item), findings, `${id}/${key}`);
      if (item?.status === 'completed') completedCase(item, findings, `${id}/${key}`);
      else if (failedStatuses.includes(item?.status)) {
        if (typeof item.error !== 'string' || item.error.length === 0) error(findings, 'case.failure.error_missing', `${id}/${key}: failed case lacks an error.`);
      } else if (!runComplete && intermediateCaseStatuses.includes(item?.status)) {
        // A checkpoint may retain an in-flight case. It is structurally valid
        // evidence, but the top-level incomplete flag prevents comparison use.
      } else {
        error(findings, 'case.status.invalid', `${id}/${key}: unsupported terminal case status ${String(item?.status)}.`);
      }
    }
    if (completedSubjectStatuses.includes(subject.status) && subject.cases.length !== expectedCases) {
      error(findings, 'subject.case_count.invalid', `${id}: expected ${expectedCases} cases, found ${subject.cases.length}.`);
    }
    if (failedSubjectStatuses.includes(subject.status) && (typeof subject.error !== 'string' || subject.error.length === 0)) {
      error(findings, 'subject.failure.error_missing', `${id}: ${subject.status} record lacks an error.`);
    }
    if (!completedSubjectStatuses.includes(subject.status)
      && !failedSubjectStatuses.includes(subject.status)
      && !(!runComplete && intermediateSubjectStatuses.includes(subject.status))) {
      error(findings, 'subject.status.invalid', `${id}: unsupported terminal subject status ${String(subject.status)}.`);
    }
  }
}

function caseWallMs(item) {
  return Number(item?.response?.wallMs ?? item?.wallMs ?? 0);
}

function reconcileTextLikeSummary(subject, scoreOf, findings, label, options = {}) {
  if (!isObject(subject.summary)) {
    error(findings, 'summary.missing', `${label}: completed record lacks a summary.`);
    return;
  }
  const cases = subject.cases ?? [];
  const completed = cases.filter((item) => item.status === 'completed');
  const score = completed.reduce((sum, item) => sum + Number(scoreOf(item) || 0), 0);
  const possible = options.possible ?? cases.length;
  const failed = possible - completed.length;
  requireReconciled(findings, 'summary.score.mismatch', `${label} summary score`, subject.summary.score, score, 1e-6);
  requireReconciled(findings, 'summary.possible.mismatch', `${label} summary possible`, subject.summary.possible, possible);
  requireReconciled(findings, 'summary.pass_rate.mismatch', `${label} summary passRate`, subject.summary.passRate, possible ? score / possible : 0, 1e-6);
  requireReconciled(findings, 'summary.completed.mismatch', `${label} summary completedCases`, subject.summary.completedCases, completed.length);
  const storedFailed = subject.summary.failedCases ?? subject.summary.requestFailedCases;
  if (options.failedField !== false) requireReconciled(findings, 'summary.failed.mismatch', `${label} summary failed cases`, storedFailed, failed);
  if (subject.summary.totalWallSeconds !== undefined) {
    const wall = Number((cases.reduce((sum, item) => sum + caseWallMs(item), 0) / 1000).toFixed(2));
    requireReconciled(findings, 'summary.wall.mismatch', `${label} summary totalWallSeconds`, subject.summary.totalWallSeconds, wall, 0.011);
  }
  return { score, possible, completed: completed.length, failed };
}

function validateCurrentSourceHash(storedHash, currentSource, findings, family) {
  if (!SHA256.test(storedHash ?? '')) {
    error(findings, 'suite.hash.invalid', `${family}: stored suite SHA-256 is missing or malformed.`);
  } else if (currentSource && storedHash !== sha256(currentSource)) {
    warning(findings, 'suite.source.changed', `${family}: current suite source differs from the stored run hash; stored raw provenance remains authoritative.`);
  }
}

function validateRankingOrder(report, subjects, identity, comparator, findings) {
  if (!Array.isArray(report.ranking)) {
    error(findings, 'ranking.missing', 'Completed report lacks a ranking array.');
    return;
  }
  const stored = report.ranking.map(identity);
  const expected = subjects.filter((subject) => subject.summary).map((subject) => ({ ...subject.summary, __id: identity(subject) })).sort(comparator).map((row) => row.__id);
  if (JSON.stringify(stored) !== JSON.stringify(expected)) error(findings, 'ranking.order.mismatch', 'Stored ranking does not match the recomputed ranking.');
}

function validateText(report, findings, context) {
  const complete = validateTimeEnvelope(report, findings, 'startedAt', 'finishedAt');
  const suite = report.taskSuite;
  const repeats = Number(suite?.repeats);
  const expected = validateTaskManifest(suite?.taskIds, repeats, findings, 'Text suite');
  validateCurrentSourceHash(suite?.hashSha256, context.taskSuiteSource, findings, 'text');
  if (!Array.isArray(report.models) || report.models.length === 0) error(findings, 'models.empty', 'Text report has no model records.');
  validateCaseMatrix({
    subjects: report.models,
    subjectId: (model) => model.model,
    taskIds: suite?.taskIds,
    repeats,
    expectedCases: expected,
    scoreOf: (item) => item?.score?.score,
    completedCase: (item, rows, label) => {
      if (!isObject(item.response)) error(rows, 'case.completed.response_missing', `${label}: completed case lacks response.`);
    },
    failedStatuses: ['failed'],
    runComplete: complete,
    findings,
  });
  for (const model of report.models ?? []) {
    if (model.status === 'completed') {
      reconcileTextLikeSummary(model, (item) => item?.score?.score, findings, model.model);
      if (isObject(model.summary?.categories)) {
        const recomputed = {};
        for (const item of model.cases ?? []) {
          const category = item.category;
          if (!recomputed[category]) recomputed[category] = { score: 0, possible: 0, passRate: 0 };
          recomputed[category].score += item.status === 'completed' ? Number(item.score?.score || 0) : 0;
          recomputed[category].possible += 1;
        }
        for (const row of Object.values(recomputed)) row.passRate = row.possible ? row.score / row.possible : 0;
        if (JSON.stringify(Object.keys(model.summary.categories).sort()) !== JSON.stringify(Object.keys(recomputed).sort())) error(findings, 'summary.categories.keys_mismatch', `${model.model}: summary category keys do not reconcile.`);
        for (const [category, row] of Object.entries(recomputed)) {
          const stored = model.summary.categories[category];
          if (!stored || !closeEnough(stored.score, row.score, 1e-6) || !closeEnough(stored.possible, row.possible) || !closeEnough(stored.passRate, row.passRate, 1e-6)) error(findings, 'summary.categories.mismatch', `${model.model}: category ${category} does not reconcile.`);
        }
      }
    }
  }
  if (complete) validateRankingOrder(report, report.models ?? [], (row) => row.model, (a, b) => b.passRate - a.passRate || a.totalWallSeconds - b.totalWallSeconds, findings);
  return { complete, expectedCasesPerCompletedSubject: expected, subjectCount: report.models?.length ?? 0, comparisonEligible: complete };
}

function validateCodeReceipt(item, findings, label, executionPolicy) {
  const receipt = item?.receipt;
  if (!isObject(receipt)) {
    error(findings, 'code.receipt.missing', `${label}: code case lacks a VM receipt.`);
    return;
  }
  const score = validateScore(receipt.score, findings, `${label}/receipt`);
  if (!['completed', 'parse_error'].includes(receipt.status)) error(findings, 'code.receipt.status.invalid', `${label}: unsupported VM receipt status ${String(receipt.status)}.`);
  if (receipt.functionName !== item.functionName) error(findings, 'code.receipt.function_mismatch', `${label}: receipt functionName does not match the case contract.`);
  if (!Number.isFinite(Number(receipt.wallMs)) || Number(receipt.wallMs) < 0) error(findings, 'code.receipt.wall.invalid', `${label}: VM wall time is invalid.`);
  if (!Number.isFinite(receipt.totalWeight) || receipt.totalWeight <= 0 || !Number.isFinite(receipt.passedWeight) || receipt.passedWeight < 0 || receipt.passedWeight > receipt.totalWeight) {
    error(findings, 'code.receipt.weights.invalid', `${label}: receipt weights are invalid.`);
  } else {
    requireReconciled(findings, 'code.receipt.score_mismatch', `${label} receipt score`, score, receipt.passedWeight / receipt.totalWeight, 1e-6);
  }
  if (!Array.isArray(receipt.tests)) error(findings, 'code.receipt.tests.missing', `${label}: receipt tests must be an array.`);
  else {
    if (new Set(receipt.tests.map((test) => test.id)).size !== receipt.tests.length) error(findings, 'code.receipt.tests.duplicate', `${label}: receipt test IDs are duplicated.`);
    if (receipt.tests.some((test) => typeof test.id !== 'string' || test.id.length === 0 || !Number.isFinite(test.weight) || test.weight <= 0 || typeof test.passed !== 'boolean' || !['completed', 'not_run'].includes(test.status))) {
      error(findings, 'code.receipt.test.invalid', `${label}: every VM test needs an ID, positive weight, boolean result, and supported status.`);
    }
    requireReconciled(findings, 'code.receipt.test_count_mismatch', `${label} receipt totalTests`, receipt.totalTests, receipt.tests.length);
    requireReconciled(findings, 'code.receipt.passed_count_mismatch', `${label} receipt passedTests`, receipt.passedTests, receipt.tests.filter((test) => test.passed === true).length);
    requireReconciled(findings, 'code.receipt.total_weight_mismatch', `${label} receipt totalWeight`, receipt.totalWeight, receipt.tests.reduce((sum, test) => sum + Number(test.weight || 0), 0), 1e-6);
    requireReconciled(findings, 'code.receipt.passed_weight_mismatch', `${label} receipt passedWeight`, receipt.passedWeight, receipt.tests.reduce((sum, test) => sum + (test.passed === true ? Number(test.weight || 0) : 0), 0), 1e-6);
  }
  if (item.status === 'completed') {
    if (!isObject(item.response)) error(findings, 'code.response.missing', `${label}: completed request lacks a response.`);
    if (typeof item.candidateSource === 'string' && item.candidateSource.length > 0) {
      if (!SHA256.test(receipt.sourceSha256 ?? '') || receipt.sourceSha256 !== sha256(item.candidateSource)) error(findings, 'code.source.hash_mismatch', `${label}: source hash does not match recovered source.`);
      const bytes = Buffer.byteLength(item.candidateSource);
      requireReconciled(findings, 'code.source.bytes_mismatch', `${label} sourceBytes`, receipt.sourceBytes, bytes);
      if (Number.isSafeInteger(executionPolicy?.maxSourceBytes) && bytes > executionPolicy.maxSourceBytes) error(findings, 'code.source.limit_exceeded', `${label}: recovered source exceeds the recorded execution limit.`);
    } else if (receipt.status !== 'parse_error' || receipt.sourceSha256 !== null || receipt.sourceBytes !== 0) {
      error(findings, 'code.source.missing', `${label}: missing recovered source is valid only for a reconciled parse_error receipt.`);
    }
  }
}

function validateCode(report, findings, context) {
  const complete = validateTimeEnvelope(report, findings, 'startedAt', 'finishedAt');
  const suite = report.suite;
  const repeats = Number(suite?.repeats);
  const expected = validateTaskManifest(suite?.taskIds, repeats, findings, 'Code suite');
  validateCurrentSourceHash(suite?.hashSha256, context.codeSuiteSource, findings, 'code');
  if (suite?.inspection?.valid !== true || (suite?.inspection?.errors?.length ?? 0) !== 0) error(findings, 'code.suite.inspection_invalid', 'Stored code-suite inspection did not pass cleanly.');
  const policy = report.executionPolicy;
  const safePolicy = policy?.oneNamedSynchronousFunction === true
    && policy?.freshVmContextPerTest === true
    && policy?.vmCodeGeneration?.strings === false
    && policy?.vmCodeGeneration?.wasm === false
    && policy?.requireExposed === false
    && policy?.processExposed === false
    && Number.isSafeInteger(policy?.maxSourceBytes) && policy.maxSourceBytes > 0
    && Number.isSafeInteger(policy?.vmTimeoutMs) && policy.vmTimeoutMs > 0;
  if (!safePolicy) error(findings, 'code.execution_policy.unsafe', 'Code execution policy is missing or does not preserve the bounded VM contract.');
  if (!Array.isArray(report.models) || report.models.length === 0) error(findings, 'models.empty', 'Code report has no model records.');
  validateCaseMatrix({
    subjects: report.models,
    subjectId: (model) => model.model,
    taskIds: suite?.taskIds,
    repeats,
    expectedCases: expected,
    scoreOf: (item) => item?.receipt?.score,
    completedCase: (item, rows, label) => {
      if (!isObject(item.response)) error(rows, 'code.response.missing', `${label}: completed request lacks a response.`);
    },
    failedStatuses: ['request_failed'],
    runComplete: complete,
    findings,
  });
  for (const model of report.models ?? []) {
    for (const item of model.cases ?? []) validateCodeReceipt(item, findings, `${model.model}/${item.taskId}:${item.repeat}`, policy);
    if (isObject(model.summary)) {
      const cases = model.cases ?? [];
      const score = cases.reduce((sum, item) => sum + Number(item.receipt?.score || 0), 0);
      const completed = cases.filter((item) => item.status === 'completed').length;
      requireReconciled(findings, 'summary.score.mismatch', `${model.model} summary score`, model.summary.score, Number(score.toFixed(6)), 1e-6);
      requireReconciled(findings, 'summary.possible.mismatch', `${model.model} summary possible`, model.summary.possible, expected);
      requireReconciled(findings, 'summary.pass_rate.mismatch', `${model.model} summary passRate`, model.summary.passRate, expected ? Number((score / expected).toFixed(6)) : 0, 1e-6);
      requireReconciled(findings, 'summary.completed.mismatch', `${model.model} summary completedCases`, model.summary.completedCases, completed);
      requireReconciled(findings, 'summary.failed.mismatch', `${model.model} summary requestFailedCases`, model.summary.requestFailedCases, cases.filter((item) => item.status === 'request_failed').length);
      requireReconciled(findings, 'summary.full_pass.mismatch', `${model.model} summary fullyPassedCases`, model.summary.fullyPassedCases, cases.filter((item) => item.receipt?.score === 1).length);
      requireReconciled(findings, 'summary.executed_tests.mismatch', `${model.model} summary executedTests`, model.summary.executedTests, cases.reduce((sum, item) => sum + Number(item.receipt?.totalTests || 0), 0));
      requireReconciled(findings, 'summary.passed_tests.mismatch', `${model.model} summary passedTests`, model.summary.passedTests, cases.reduce((sum, item) => sum + Number(item.receipt?.passedTests || 0), 0));
    } else if (model.status === 'completed') error(findings, 'summary.missing', `${model.model}: completed record lacks a summary.`);
  }
  if (complete) validateRankingOrder(report, report.models ?? [], (row) => row.model, (a, b) => b.passRate - a.passRate || b.fullyPassedCases - a.fullyPassedCases || a.totalModelWallSeconds - b.totalModelWallSeconds, findings);
  return { complete, expectedCasesPerCompletedSubject: expected, subjectCount: report.models?.length ?? 0, comparisonEligible: complete };
}

function validateVision(report, findings, context) {
  const complete = validateTimeEnvelope(report, findings, 'startedAt', 'finishedAt');
  const suite = report.suite;
  const repeats = Number(report.options?.repeats);
  const expected = validateTaskManifest(suite?.tasks, repeats, findings, 'Vision suite');
  validateCurrentSourceHash(suite?.hashSha256, context.visionSuiteSource, findings, 'vision');
  if (!SHA256.test(suite?.imageSha256 ?? '')) error(findings, 'vision.image_hash.invalid', 'Vision diagnostic image hash is missing or malformed.');
  else if (context.visionImage && suite.imageSha256 !== sha256(context.visionImage)) warning(findings, 'vision.image.changed', 'Current diagnostic image differs from the image used by this run.');
  if (!Array.isArray(report.models) || report.models.length === 0) error(findings, 'models.empty', 'Vision report has no model records.');
  validateCaseMatrix({
    subjects: report.models,
    subjectId: (model) => model.model,
    taskIds: suite?.tasks,
    repeats,
    expectedCases: expected,
    scoreOf: (item) => item?.score,
    completedCase: (item, rows, label) => {
      if (!isObject(item.response)) error(rows, 'case.completed.response_missing', `${label}: completed vision case lacks response.`);
    },
    failedStatuses: ['failed'],
    runComplete: complete,
    findings,
  });
  for (const model of report.models ?? []) {
    const score = (model.cases ?? []).reduce((sum, item) => sum + Number(item.score || 0), 0);
    requireReconciled(findings, 'vision.score.mismatch', `${model.model} score`, model.score, score, 1e-6);
    requireReconciled(findings, 'vision.possible.mismatch', `${model.model} possible`, model.possible, expected);
    requireReconciled(findings, 'vision.pass_rate.mismatch', `${model.model} passRate`, model.passRate, expected ? score / expected : 0, 1e-6);
  }
  if (complete) {
    const stored = (report.ranking ?? []).map((row) => row.model);
    const expectedRanking = (report.models ?? []).map((row, index) => ({ model: row.model, passRate: row.passRate, index })).sort((a, b) => b.passRate - a.passRate || a.index - b.index).map((row) => row.model);
    if (JSON.stringify(stored) !== JSON.stringify(expectedRanking)) error(findings, 'ranking.order.mismatch', 'Stored vision ranking does not match the recomputed ranking.');
  }
  return { complete, expectedCasesPerCompletedSubject: expected, subjectCount: report.models?.length ?? 0, comparisonEligible: complete };
}

function validateReasoning(report, findings, context) {
  const complete = validateTimeEnvelope(report, findings, 'startedAt', 'finishedAt');
  const suite = report.taskSuite;
  const repeats = Number(report.options?.repeats);
  const expected = validateTaskManifest(suite?.taskIds, repeats, findings, 'Reasoning-profile suite');
  validateCurrentSourceHash(suite?.hashSha256, context.taskSuiteSource, findings, 'reasoning-profile');
  if (!Array.isArray(report.profiles) || report.profiles.length === 0) error(findings, 'profiles.empty', 'Reasoning report has no profile records.');
  validateCaseMatrix({
    subjects: report.profiles,
    subjectId: (profile) => profile.id,
    taskIds: suite?.taskIds,
    repeats,
    expectedCases: expected,
    scoreOf: (item) => item?.score?.score,
    completedCase: (item, rows, label) => {
      if (!isObject(item.response)) error(rows, 'case.completed.response_missing', `${label}: completed reasoning case lacks response.`);
    },
    failedStatuses: ['failed'],
    runComplete: complete,
    findings,
  });
  const allowedReasoning = new Set(['off', 'low', 'medium', 'high', 'on']);
  for (const profile of report.profiles ?? []) {
    if (profile.id !== `${profile.model}@${profile.reasoning}`) error(findings, 'reasoning.profile.id_mismatch', `${profile.id}: profile ID does not match model@reasoning.`);
    if (!allowedReasoning.has(profile.reasoning)) error(findings, 'reasoning.profile.setting_invalid', `${profile.id}: invalid reasoning setting.`);
    if (profile.status === 'completed') {
      const summary = reconcileTextLikeSummary(profile, (item) => item?.score?.score, findings, profile.id);
      const completedCases = (profile.cases ?? []).filter((item) => item.status === 'completed');
      for (const item of completedCases) {
        const instanceId = item.response?.modelInfo?.model_instance_id;
        if (typeof instanceId !== 'string' || instanceId.length === 0) {
          error(findings, 'reasoning.instance_identity.missing', `${profile.id}/${item.taskId}:${item.repeat}: native-v1 response lacks model_instance_id.`);
        } else if (instanceId !== profile.model) {
          error(findings, 'reasoning.instance_identity.mismatch', `${profile.id}/${item.taskId}:${item.repeat}: response instance ${instanceId} does not exactly match requested model ${profile.model}.`);
        }
      }
      requireReconciled(findings, 'reasoning.tokens.mismatch', `${profile.id} reasoningTokens`, profile.summary?.reasoningTokens, completedCases.reduce((sum, item) => sum + Number(item.response?.usage?.reasoning_tokens || 0), 0));
      requireReconciled(findings, 'reasoning.output_tokens.mismatch', `${profile.id} outputTokens`, profile.summary?.outputTokens, completedCases.reduce((sum, item) => sum + Number(item.response?.usage?.completion_tokens || 0), 0));
      if (summary && profile.summary.possible !== (profile.cases ?? []).length) error(findings, 'summary.possible.mismatch', `${profile.id}: possible must equal recorded cases.`);
    }
  }
  if (complete) validateRankingOrder(report, report.profiles ?? [], (row) => row.id, (a, b) => b.passRate - a.passRate || a.totalWallSeconds - b.totalWallSeconds, findings);
  return { complete, expectedCasesPerCompletedSubject: expected, subjectCount: report.profiles?.length ?? 0, comparisonEligible: complete };
}

function loopMethodSummary(cases, field) {
  const completed = cases.filter((item) => item?.[field]?.status === 'completed');
  const score = completed.reduce((sum, item) => sum + Number(item[field]?.score?.score || 0), 0);
  const possible = cases.length;
  return {
    score,
    possible,
    passRate: possible ? score / possible : 0,
    completedCases: completed.length,
    failedCases: possible - completed.length,
    calls: cases.reduce((sum, item) => sum + Number(item?.[field]?.calls || 0), 0),
    wallSeconds: Number((cases.reduce((sum, item) => sum + Number(item?.[field]?.wallMs || 0), 0) / 1000).toFixed(2)),
    completionTokens: cases.reduce((sum, item) => sum + Number(item?.[field]?.completionTokens || 0), 0),
  };
}

function loopResponseMetrics(responses) {
  return {
    wallMs: responses.reduce((sum, response) => sum + Number(response?.wallMs || 0), 0),
    completionTokens: responses.reduce((sum, response) => sum + Number(response?.usage?.completion_tokens || 0), 0),
  };
}

function validateLoopResponse(response, findings, label) {
  if (!isObject(response)) {
    error(findings, 'loop.response.missing', `${label}: response receipt is missing.`);
    return;
  }
  if (typeof response.text !== 'string') error(findings, 'loop.response.text_invalid', `${label}: response text must be a string.`);
  if (!Number.isFinite(Number(response.wallMs)) || Number(response.wallMs) < 0) error(findings, 'loop.response.wall_invalid', `${label}: response wall time is invalid.`);
  if (!isObject(response.usage) || !Number.isFinite(Number(response.usage.completion_tokens)) || Number(response.usage.completion_tokens) < 0) error(findings, 'loop.response.tokens_invalid', `${label}: response completion-token receipt is invalid.`);
}

function validateLoopMethod(method, field, findings, label, complete) {
  if (!isObject(method)) {
    error(findings, 'loop.method.missing', `${label}/${field}: treatment result is missing.`);
    return;
  }
  if (method.status === 'completed') {
    const score = validateScore(method.score?.score, findings, `${label}/${field}`);
    if (!Number.isSafeInteger(method.score?.passed) || !Number.isSafeInteger(method.score?.total) || method.score.total < 1 || method.score.passed < 0 || method.score.passed > method.score.total) {
      error(findings, 'loop.score.receipt_invalid', `${label}/${field}: score receipt needs valid passed and total counts.`);
    } else requireReconciled(findings, 'loop.score.receipt_mismatch', `${label}/${field} score`, score, method.score.passed / method.score.total, 1e-6);
    const expectedCalls = field === 'direct' ? 1 : 3;
    if (method.calls !== expectedCalls) error(findings, 'loop.calls.mismatch', `${label}/${field}: completed treatment must record ${expectedCalls} calls.`);
    const responses = field === 'direct' ? [method.output] : [method.draft, method.critique, method.final];
    responses.forEach((response, index) => validateLoopResponse(response, findings, `${label}/${field}/response-${index + 1}`));
    const metrics = loopResponseMetrics(responses);
    requireReconciled(findings, 'loop.wall.mismatch', `${label}/${field} wallMs`, method.wallMs, metrics.wallMs);
    requireReconciled(findings, 'loop.tokens.mismatch', `${label}/${field} completionTokens`, method.completionTokens, metrics.completionTokens);
  } else if (method.status === 'failed') {
    if (typeof method.error !== 'string' || method.error.length === 0) error(findings, 'loop.failure.error_missing', `${label}/${field}: failed treatment lacks an error.`);
  } else if (!complete && method.status === undefined && Object.keys(method).length === 0) {
    // The runner preallocates empty treatment objects before the first request.
  } else if (!complete && method.status === 'drafted') {
    if (field !== 'crossSpecialist' || !isObject(method.draft)) error(findings, 'loop.stage.draft_invalid', `${label}/${field}: drafted checkpoint lacks the cross-specialist draft receipt.`);
  } else if (!complete && method.status === 'critiqued') {
    if (field !== 'crossSpecialist' || !isObject(method.draft) || !isObject(method.critique)) error(findings, 'loop.stage.critique_invalid', `${label}/${field}: critiqued checkpoint lacks draft and critique receipts.`);
  } else {
    error(findings, 'loop.status.invalid', `${label}/${field}: invalid terminal treatment status ${String(method.status)}.`);
  }
}

function validateLoop(report, findings, context) {
  const complete = validateTimeEnvelope(report, findings, 'startedAt', 'finishedAt');
  const suite = report.taskSuite;
  const repeats = Number(report.options?.repeats);
  const expected = validateTaskManifest(suite?.taskIds, repeats, findings, 'Loop-ablation suite');
  validateCurrentSourceHash(suite?.hashSha256, context.taskSuiteSource, findings, 'loop-ablation');
  if (report.options?.solver === report.options?.critic) error(findings, 'loop.family_independence.invalid', 'Loop solver and cross-specialist critic must be different models.');
  if (typeof report.options?.solver !== 'string' || report.options.solver.length === 0 || typeof report.options?.critic !== 'string' || report.options.critic.length === 0) error(findings, 'loop.model_identity.missing', 'Loop solver and critic identities must be non-empty strings.');
  if (!Array.isArray(report.cases)) error(findings, 'cases.missing', 'Loop report cases must be an array.');
  const keys = new Set();
  for (const item of report.cases ?? []) {
    const key = `${item.taskId}:${item.repeat}`;
    if (keys.has(key)) error(findings, 'case.duplicate', `Loop report has duplicate case ${key}.`);
    keys.add(key);
    if (!(suite?.taskIds ?? []).includes(item.taskId)) error(findings, 'case.task.unknown', `${key}: task is not in the stored loop suite.`);
    if (!Number.isSafeInteger(item.repeat) || item.repeat < 0 || item.repeat >= repeats) error(findings, 'case.repeat.invalid', `${key}: repeat is invalid.`);
    for (const field of ['direct', 'selfRefine', 'crossSpecialist']) validateLoopMethod(item[field], field, findings, key, complete);
    const sharedDraft = item.direct?.output;
    for (const field of ['selfRefine', 'crossSpecialist']) {
      if (isObject(sharedDraft) && isObject(item[field]?.draft) && JSON.stringify(item[field].draft) !== JSON.stringify(sharedDraft)) error(findings, 'loop.shared_draft.mismatch', `${key}/${field}: treatment did not reuse the recorded direct draft.`);
    }
  }
  if (complete && (report.cases?.length ?? 0) !== expected) error(findings, 'loop.case_count.invalid', `Loop report expected ${expected} cases, found ${report.cases?.length ?? 0}.`);
  if (complete) {
    const expectedLoads = [
      { model: report.options?.solver, phase: 'draft-and-self-refine' },
      { model: report.options?.critic, phase: 'cross-specialist-critique' },
      { model: report.options?.solver, phase: 'cross-specialist-finalize' },
    ];
    if (!Array.isArray(report.loads) || report.loads.length !== expectedLoads.length) error(findings, 'loop.loads.invalid', 'Completed loop receipt must record the three expected model-load phases.');
    else report.loads.forEach((load, index) => {
      const expectedLoad = expectedLoads[index];
      if (load.model !== expectedLoad.model || load.phase !== expectedLoad.phase || !Number.isFinite(Number(load.wallSeconds)) || Number(load.wallSeconds) < 0) error(findings, 'loop.load.mismatch', `Loop load phase ${index + 1} does not match the planned solver/critic sequence.`);
    });
  }
  for (const field of ['direct', 'selfRefine', 'crossSpecialist']) {
    const recomputed = loopMethodSummary(report.cases ?? [], field);
    const stored = report.summaries?.[field];
    if (!isObject(stored) && complete) error(findings, 'loop.summary.missing', `Loop summary ${field} is missing.`);
    else if (isObject(stored)) for (const [metric, value] of Object.entries(recomputed)) requireReconciled(findings, 'loop.summary.mismatch', `${field}.${metric}`, stored[metric], value, metric === 'wallSeconds' ? 0.011 : 1e-9);
  }
  return { complete, expectedCasesPerCompletedSubject: expected, subjectCount: 1, comparisonEligible: complete };
}

function placementGpuSet(sample) {
  if (!isObject(sample) || sample.error) return null;
  return new Set((sample.gpus ?? []).filter((gpu) => Number.isSafeInteger(gpu.index)).map((gpu) => gpu.index));
}

function placementTelemetryComplete(telemetry, indices) {
  const samples = [telemetry?.before, ...(telemetry?.samples ?? []), telemetry?.after];
  return samples.length >= 2 && samples.every((sample) => {
    const observed = placementGpuSet(sample);
    return observed && indices.every((index) => observed.has(index));
  });
}

function validatePlacementBenchmarkRows(item, planned, parameters, modelFileName, findings) {
  const rows = item.process?.parsed_json;
  if (!Array.isArray(rows) || rows.length < 2 || rows.some((row) => !isObject(row))) {
    error(findings, 'placement.benchmark.rows_invalid', `${item.case_id}: parsed llama-bench output must contain prompt and generation rows.`);
    return;
  }
  const promptRows = rows.filter((row) => Number(row.n_prompt) === Number(parameters?.prompt_tokens) && Number(row.n_gen) === 0);
  const generationRows = rows.filter((row) => Number(row.n_gen) === Number(parameters?.generation_tokens) && Number(row.n_prompt) === 0);
  if (promptRows.length !== 1 || generationRows.length !== 1) error(findings, 'placement.benchmark.workload_mismatch', `${item.case_id}: parsed output does not contain exactly one configured prompt row and one generation row.`);
  for (const row of rows) {
    if (!Number.isFinite(Number(row.avg_ts)) || Number(row.avg_ts) <= 0 || !Number.isFinite(Number(row.avg_ns)) || Number(row.avg_ns) <= 0) error(findings, 'placement.benchmark.throughput_invalid', `${item.case_id}: llama-bench timing/throughput values are invalid.`);
    if (modelFileName && row.model_filename !== modelFileName) error(findings, 'placement.benchmark.model_mismatch', `${item.case_id}: llama-bench model filename does not match the hashed plan identity.`);
    if (row.split_mode !== planned?.placement?.split_mode) error(findings, 'placement.benchmark.split_mismatch', `${item.case_id}: reported split mode does not match the planned placement.`);
    const numericBindings = [
      ['n_batch', 'batch_size'], ['n_ubatch', 'ubatch_size'], ['n_threads', 'threads'], ['n_gpu_layers', 'gpu_layers'],
    ];
    for (const [observedKey, configuredKey] of numericBindings) {
      if (Number(row[observedKey]) !== Number(parameters?.[configuredKey])) error(findings, 'placement.benchmark.parameter_mismatch', `${item.case_id}: ${observedKey} does not match ${configuredKey}.`);
    }
    if (typeof row.devices !== 'string' || row.devices.length === 0) error(findings, 'placement.benchmark.devices_missing', `${item.case_id}: llama-bench did not report device placement.`);
  }
}

function validatePlacement(report, findings) {
  const completeTime = validateTimeEnvelope(report, findings, 'started_at', 'finished_at');
  if (report.schema_version !== 'llamacpp-placement-receipt/1.0') error(findings, 'schema.version.unsupported', `Unsupported placement schema ${String(report.schema_version)}.`);
  if (report.execution_mode !== true) error(findings, 'placement.execution_mode.invalid', 'Placement receipt must record execution_mode=true.');
  if (!['running', ...TERMINAL_PLACEMENT_STATUSES].includes(report.status)) error(findings, 'placement.status.invalid', `Unsupported placement status ${String(report.status)}.`);
  const plan = report.plan;
  if (plan?.schema_version !== 'llamacpp-placement-plan/1.0') error(findings, 'placement.plan.schema_invalid', 'Placement plan schema is missing or unsupported.');
  if (plan?.workload_launched !== false) error(findings, 'placement.plan.mutated', 'Embedded plan must retain workload_launched=false.');
  if (!SHA256.test(plan?.model?.sha256 ?? '') || !SHA256.test(plan?.runtime?.sha256 ?? '')) error(findings, 'placement.identity_hash.invalid', 'Placement model/runtime identity hashes are missing or malformed.');
  const derivedSuite = isObject(plan?.benchmark_parameters) ? sha256(JSON.stringify(plan.benchmark_parameters)) : null;
  if (!SHA256.test(report.suite_sha256 ?? '') || report.suite_sha256 !== plan?.suite_sha256 || report.suite_sha256 !== derivedSuite) error(findings, 'placement.suite_hash.mismatch', 'Placement receipt, plan, and recomputed suite hashes do not match.');
  if (!Number.isSafeInteger(plan?.requested_rounds) || plan.requested_rounds < 1) error(findings, 'placement.rounds.invalid', 'Placement requested_rounds must be positive.');
  if (!Array.isArray(plan?.cases) || plan.cases.length !== plan.requested_rounds * 2) error(findings, 'placement.plan.case_count.invalid', 'Placement plan must contain two cases per round.');
  const planById = new Map((plan?.cases ?? []).map((item) => [item.case_id, item]));
  if (planById.size !== (plan?.cases ?? []).length) error(findings, 'placement.plan.case_duplicate', 'Placement plan case IDs are duplicated.');
  if (!Array.isArray(report.cases)) error(findings, 'placement.cases.missing', 'Placement cases must be an array.');
  if (new Set((report.cases ?? []).map((item) => item.case_id)).size !== (report.cases ?? []).length) error(findings, 'placement.case_duplicate', 'Placement receipt case IDs are duplicated.');
  const indices = plan?.telemetry?.selected_indices ?? [];
  for (const item of report.cases ?? []) {
    const planned = planById.get(item.case_id);
    if (!planned) error(findings, 'placement.case.unplanned', `${item.case_id}: case is not in the embedded plan.`);
    else if (item.round !== planned.round || item.placement_id !== planned.placement_id || JSON.stringify(item.command) !== JSON.stringify(planned.command)) error(findings, 'placement.case.plan_mismatch', `${item.case_id}: case does not match its embedded plan.`);
    const process = item.process;
    const processSuccess = process?.exit_code === 0 && process?.timed_out === false && process?.aborted === false
      && process?.output_limit_exceeded === false && process?.spawn_error === null && process?.parsed_json !== null;
    const telemetrySuccess = placementTelemetryComplete(item.telemetry, indices);
    const expectedStatus = processSuccess && telemetrySuccess ? 'completed' : 'failed';
    if (item.status !== expectedStatus) error(findings, 'placement.case.status_mismatch', `${item.case_id}: stored status does not match process and telemetry receipts.`);
    if (expectedStatus === 'completed') validatePlacementBenchmarkRows(item, planned, plan?.benchmark_parameters, plan?.model?.file_name, findings);
    if (!validTimestamp(process?.started_at) || !validTimestamp(process?.finished_at) || Number(process?.wall_ms) < 0) error(findings, 'placement.process.time_invalid', `${item.case_id}: process timing receipt is invalid.`);
    if (!SHA256.test(process?.stdout_sha256_before_redaction ?? '') || !SHA256.test(process?.stderr_sha256_before_redaction ?? '')) error(findings, 'placement.process.hash_invalid', `${item.case_id}: pre-redaction stream hashes are missing.`);
  }
  const terminal = TERMINAL_PLACEMENT_STATUSES.has(report.status) && completeTime;
  if (terminal && ['completed', 'completed_with_failures'].includes(report.status) && (report.cases?.length ?? 0) !== (plan?.cases?.length ?? 0)) error(findings, 'placement.case_count.invalid', 'Finished placement receipt does not contain every planned case.');
  if (report.status === 'completed' && !(report.cases ?? []).every((item) => item.status === 'completed')) error(findings, 'placement.status.completed_mismatch', 'Completed placement receipt contains failed cases.');
  if (report.status === 'completed_with_failures' && !(report.cases ?? []).some((item) => item.status === 'failed')) error(findings, 'placement.status.failure_mismatch', 'completed_with_failures receipt contains no failed case.');
  if (['failed', 'interrupted'].includes(report.status) && !isObject(report.failure)) error(findings, 'placement.failure.missing', `${report.status} receipt lacks a failure object.`);
  if (report.status === 'completed' && report.failure !== null) error(findings, 'placement.failure.unexpected', 'Completed receipt must have failure=null.');
  if ((report.cases?.length ?? 0) > 0 && report.gpu_model_workload_started !== true) error(findings, 'placement.workload_flag.mismatch', 'Receipt has cases but gpu_model_workload_started is not true.');
  if (!SHA256.test(report.receipt_content_sha256 ?? '')) error(findings, 'placement.receipt_hash.invalid', 'Receipt content hash is missing or malformed.');
  else {
    const derivedReceipt = sha256(JSON.stringify({ ...report, receipt_content_sha256: null }));
    if (report.receipt_content_sha256 !== derivedReceipt) error(findings, 'placement.receipt_hash.mismatch', 'Receipt content hash does not reconcile with the stored payload.');
  }
  if (report.status === 'completed') {
    if (report.probes?.llama_bench_help?.evaluation?.accepted !== true || report.probes?.llama_bench_devices?.evaluation?.accepted !== true) error(findings, 'placement.probe.not_accepted', 'Completed placement receipt lacks accepted help/device probes.');
    if (report.probes?.nvidia_smi_version?.exit_code !== 0) error(findings, 'placement.telemetry_probe.failed', 'Completed placement receipt lacks a successful nvidia-smi version probe.');
    if (!placementTelemetryComplete({ before: report.probes?.hardware_before, samples: [], after: report.probes?.hardware_after }, indices)) error(findings, 'placement.top_telemetry.incomplete', 'Completed placement receipt lacks complete before/after telemetry.');
  }
  return {
    complete: terminal,
    expectedCasesPerCompletedSubject: plan?.cases?.length ?? 0,
    subjectCount: 1,
    comparisonEligible: terminal && report.status === 'completed',
    outcomeStatus: report.status,
  };
}

export function detectResultFamily(report) {
  if (report?.schema_version === 'llamacpp-placement-receipt/1.0') return 'llamacpp-placement';
  if (report?.schemaVersion !== 1) return 'unknown';
  if (isObject(report.design) && Array.isArray(report.cases) && isObject(report.summaries)) return 'loop-ablation';
  if (Array.isArray(report.profiles) && isObject(report.taskSuite)) return 'reasoning-profile';
  if (Array.isArray(report.models) && isObject(report.suite?.inspection) && isObject(report.executionPolicy)) return 'code';
  if (Array.isArray(report.models) && typeof report.suite?.imageSha256 === 'string') return 'vision';
  if (Array.isArray(report.models) && isObject(report.taskSuite)) return 'text';
  return 'unknown';
}

export function validateResultObject(report, context = {}) {
  const findings = [];
  const family = detectResultFamily(report);
  let details;
  if (!isObject(report)) {
    error(findings, 'report.not_object', 'Benchmark report must be a JSON object.');
    details = { complete: false, expectedCasesPerCompletedSubject: 0, subjectCount: 0, comparisonEligible: false };
  } else if (family === 'unknown') {
    error(findings, 'family.unknown', 'Result does not match a supported text, code, vision, reasoning-profile, loop-ablation, or llama.cpp placement family.');
    details = { complete: false, expectedCasesPerCompletedSubject: 0, subjectCount: 0, comparisonEligible: false };
  } else {
    if (family !== 'llamacpp-placement' && report.schemaVersion !== 1) error(findings, 'schema.version.unsupported', `Unsupported schemaVersion ${String(report.schemaVersion)}.`);
    const validators = {
      text: validateText,
      code: validateCode,
      vision: validateVision,
      'reasoning-profile': validateReasoning,
      'loop-ablation': validateLoop,
      'llamacpp-placement': validatePlacement,
    };
    details = validators[family](report, findings, context);
  }
  const valid = !findings.some((item) => item.severity === 'error');
  return {
    family,
    valid,
    complete: Boolean(details.complete),
    comparisonEligible: valid && Boolean(details.comparisonEligible),
    expectedCasesPerCompletedSubject: details.expectedCasesPerCompletedSubject,
    subjectCount: details.subjectCount,
    outcomeStatus: details.outcomeStatus ?? (details.complete ? 'completed' : 'incomplete'),
    findings,
  };
}

async function loadValidationContext() {
  const base = new URL('./', import.meta.url);
  const optionalRead = async (relative) => readFile(new URL(relative, base)).catch(() => null);
  const [taskSuiteSource, codeSuiteSource, visionSuiteSource, visionImage] = await Promise.all([
    optionalRead('task-suite.mjs'),
    optionalRead('code-suite.mjs'),
    optionalRead('vision-suite.mjs'),
    optionalRead('assets/vision-diagnostic.png'),
  ]);
  return { taskSuiteSource, codeSuiteSource, visionSuiteSource, visionImage };
}

export async function validateResultFile(file, options = {}) {
  const absolute = path.resolve(options.cwd ?? process.cwd(), file);
  const relativeFile = path.relative(options.cwd ?? process.cwd(), absolute).split(path.sep).join('/');
  let raw;
  try {
    raw = await readFile(absolute);
  } catch (caught) {
    return {
      file: relativeFile,
      artifactSha256: null,
      family: 'unknown',
      valid: false,
      complete: false,
      comparisonEligible: false,
      expectedCasesPerCompletedSubject: 0,
      subjectCount: 0,
      outcomeStatus: 'unreadable',
      findings: [{ severity: 'error', code: 'file.read_failed', message: caught instanceof Error ? caught.message : String(caught) }],
    };
  }
  const artifactSha256 = sha256(raw);
  let report;
  try {
    report = JSON.parse(raw.toString('utf8'));
  } catch (caught) {
    return {
      file: relativeFile,
      artifactSha256,
      family: 'unknown',
      valid: false,
      complete: false,
      comparisonEligible: false,
      expectedCasesPerCompletedSubject: 0,
      subjectCount: 0,
      outcomeStatus: 'unreadable',
      findings: [{ severity: 'error', code: 'file.parse_failed', message: caught instanceof Error ? caught.message : String(caught) }],
    };
  }
  const context = options.context ?? await loadValidationContext();
  return {
    file: relativeFile,
    artifactSha256,
    ...validateResultObject(report, context),
  };
}
