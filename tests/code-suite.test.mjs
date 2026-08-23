import assert from 'node:assert/strict';
import test from 'node:test';

import {
  codeTasks,
  evaluateCodeTask,
  executeCandidateInvocation,
  extractCandidateSource,
  inspectCodeSuite,
} from '../benchmark/code-suite.mjs';

const referenceSolutions = {
  code_immutable_rank_sort: String.raw`function sortByRank(rows) {
    return [...rows].sort((left, right) => left.rank - right.rank);
  }`,
  code_fencing_settlement: String.raw`function canSettle(task, epoch) {
    return task !== null
      && typeof task === 'object'
      && task.status === 'running'
      && Number.isInteger(task.fencingEpoch)
      && Number.isInteger(epoch)
      && task.fencingEpoch === epoch;
  }`,
  code_dependency_readiness: String.raw`function readyTaskIds(tasks) {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return tasks
      .filter((task) => task.status === 'pending'
        && Array.isArray(task.dependsOn)
        && task.dependsOn.every((id) => byId.get(id)?.status === 'done'))
      .map((task) => task.id)
      .sort((left, right) => left.localeCompare(right));
  }`,
  code_evidence_log_reconciliation: String.raw`function reconcileAgentLog(lines) {
    const produced = new Set();
    const retry = new Set();
    let verifiedTestCount = 0;
    for (const line of lines) {
      const producedMatch = line.match(/\btask\s+(\S+)\s+settled\s+produced\b/i);
      const retryMatch = line.match(/\btask\s+(\S+)\s+retry\s+scheduled\b/i);
      const testMatch = line.match(/\btest\s+exit=0\b.*\btests:(\d+)\b/i);
      if (producedMatch) produced.add(producedMatch[1]);
      if (retryMatch) retry.add(retryMatch[1]);
      if (testMatch) verifiedTestCount += Number(testMatch[1]);
    }
    return {
      produced: [...produced].sort(),
      retry: [...retry].sort(),
      verifiedTestCount,
    };
  }`,
  code_windows_path_scope: String.raw`function isPathWithin(root, target) {
    function normalize(value) {
      if (typeof value !== 'string' || !/^[A-Za-z]:[\\/]/.test(value)) return null;
      const drive = value.slice(0, 2).toLowerCase();
      const parts = [];
      for (const part of value.slice(2).split(/[\\/]+/)) {
        if (!part || part === '.') continue;
        if (part === '..') {
          if (parts.length === 0) return null;
          parts.pop();
        } else {
          parts.push(part.toLowerCase());
        }
      }
      return { drive, parts };
    }
    const normalizedRoot = normalize(root);
    const normalizedTarget = normalize(target);
    if (!normalizedRoot || !normalizedTarget || normalizedRoot.drive !== normalizedTarget.drive) return false;
    return normalizedRoot.parts.length <= normalizedTarget.parts.length
      && normalizedRoot.parts.every((part, index) => normalizedTarget.parts[index] === part);
  }`,
};

test('code suite has unique ids, supported assertions, and normalized weights', () => {
  assert.deepEqual(inspectCodeSuite(), { valid: true, taskCount: 5, errors: [] });
  assert.equal(new Set(codeTasks.map((task) => task.id)).size, codeTasks.length);
  assert.ok(codeTasks.every((task) => task.prompt.includes(task.functionName)));
});

test('reference implementations satisfy every deterministic receipt', () => {
  for (const task of codeTasks) {
    const evaluated = evaluateCodeTask(task, referenceSolutions[task.id], { timeoutMs: 100 });
    assert.equal(evaluated.receipt.status, 'completed', task.id);
    assert.equal(evaluated.receipt.score, 1, task.id);
    assert.equal(evaluated.receipt.passedTests, evaluated.receipt.totalTests, task.id);
    assert.ok(evaluated.receipt.tests.every((receipt) => receipt.passed), task.id);
  }
});

test('weighted assertions give partial credit and detect input mutation', () => {
  const task = codeTasks.find((candidate) => candidate.id === 'code_immutable_rank_sort');
  const evaluated = evaluateCodeTask(
    task,
    'function sortByRank(rows) { return rows.sort((left, right) => left.rank - right.rank); }',
  );

  assert.equal(evaluated.receipt.score, 0.6);
  assert.deepEqual(
    evaluated.receipt.tests.filter((receipt) => !receipt.passed).map((receipt) => receipt.id),
    ['input-unchanged', 'new-array'],
  );
});

test('source recovery extracts the requested function from prose or a fence', () => {
  const fenced = [
    'Here is the implementation:',
    '```js',
    'function canSettle(task, epoch) {',
    '  return task?.status === "running" && task.fencingEpoch === epoch;',
    '}',
    '```',
  ].join('\n');
  assert.equal(
    extractCandidateSource(fenced, 'canSettle'),
    'function canSettle(task, epoch) {\n  return task?.status === "running" && task.fencingEpoch === epoch;\n}',
  );
  assert.equal(extractCandidateSource('no function was returned', 'canSettle'), null);
});

test('the VM exposes neither process nor require to candidate code', () => {
  const result = executeCandidateInvocation(
    "function inspectSandbox() { return [typeof globalThis['pro' + 'cess'], typeof globalThis['requ' + 'ire']]; }",
    'inspectSandbox',
    [],
  );
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.value, ['undefined', 'undefined']);
});

test('the harness contains compile failures, forbidden APIs, and infinite loops', () => {
  const task = codeTasks.find((candidate) => candidate.id === 'code_immutable_rank_sort');
  const compileFailure = evaluateCodeTask(task, 'function sortByRank(rows) { return rows.; }');
  assert.equal(compileFailure.receipt.status, 'tested_with_execution_errors');
  assert.ok(compileFailure.receipt.tests.every((receipt) => receipt.status === 'compile_error'));

  const rejected = evaluateCodeTask(task, 'function sortByRank(rows) { return process.cwd(); }');
  assert.equal(rejected.receipt.status, 'rejected');
  assert.equal(rejected.receipt.score, 0);
  assert.ok(rejected.receipt.tests.every((receipt) => receipt.status === 'not_run'));

  const timedOut = executeCandidateInvocation('function spin() { while (true) {} }', 'spin', [], { timeoutMs: 20 });
  assert.equal(timedOut.status, 'timeout');

  const dynamicCode = executeCandidateInvocation(
    "function dynamicCode() { return globalThis.constructor.constructor('return 7')(); }",
    'dynamicCode',
    [],
  );
  assert.equal(dynamicCode.status, 'runtime_error');
  assert.match(dynamicCode.error, /code generation|strings disallowed/i);
});
