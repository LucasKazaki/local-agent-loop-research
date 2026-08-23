import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { isDeepStrictEqual } from 'node:util';

const MAX_SOURCE_BYTES = 24 * 1024;
const FORBIDDEN_SOURCE = /\b(?:require|process|import|export|fetch|WebSocket|WebAssembly|eval|Function)\b/;
const ALLOWED_ASSERTIONS = new Set(['result', 'inputUnchanged', 'notSameAsArgument']);

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function taskPrompt(functionName, contract) {
  return [
    `Write exactly one synchronous JavaScript function declaration named ${functionName}.`,
    contract,
    'Return only the function declaration, with no markdown, imports, exports, require, process, network calls, timers, or test code.',
    'Do not mutate input arrays or objects unless the contract explicitly says otherwise.',
  ].join('\n');
}

export const codeTasks = [
  {
    id: 'code_immutable_rank_sort',
    category: 'immutability',
    functionName: 'sortByRank',
    maxTokens: 260,
    prompt: taskPrompt(
      'sortByRank',
      'Signature: function sortByRank(rows). Return a new array containing the same row objects ordered by ascending numeric rank. Preserve input order for equal ranks and do not mutate rows or its objects.',
    ),
    tests: [
      {
        id: 'ascending-order', weight: 0.4, assertion: 'result',
        args: [[{ id: 'a', rank: 3 }, { id: 'b', rank: 1 }, { id: 'c', rank: 2 }]],
        expected: [{ id: 'b', rank: 1 }, { id: 'c', rank: 2 }, { id: 'a', rank: 3 }],
      },
      {
        id: 'input-unchanged', weight: 0.25, assertion: 'inputUnchanged',
        args: [[{ id: 'a', rank: 2 }, { id: 'b', rank: 1 }]],
      },
      {
        id: 'new-array', weight: 0.15, assertion: 'notSameAsArgument', argumentIndex: 0,
        args: [[{ id: 'a', rank: 1 }]],
      },
      {
        id: 'stable-ties', weight: 0.2, assertion: 'result',
        args: [[{ id: 'a', rank: 2 }, { id: 'b', rank: 1 }, { id: 'c', rank: 1 }]],
        expected: [{ id: 'b', rank: 1 }, { id: 'c', rank: 1 }, { id: 'a', rank: 2 }],
      },
    ],
  },
  {
    id: 'code_fencing_settlement',
    category: 'concurrency_safety',
    functionName: 'canSettle',
    maxTokens: 220,
    prompt: taskPrompt(
      'canSettle',
      'Signature: function canSettle(task, epoch). Return true only when task is a non-null object, task.status is exactly "running", task.fencingEpoch and epoch are integers, and the epochs are strictly equal. Return false for every other input.',
    ),
    tests: [
      { id: 'matching-running-epoch', weight: 0.25, assertion: 'result', args: [{ status: 'running', fencingEpoch: 7 }, 7], expected: true },
      { id: 'stale-epoch', weight: 0.25, assertion: 'result', args: [{ status: 'running', fencingEpoch: 8 }, 7], expected: false },
      { id: 'wrong-status', weight: 0.2, assertion: 'result', args: [{ status: 'ready', fencingEpoch: 7 }, 7], expected: false },
      { id: 'missing-task', weight: 0.15, assertion: 'result', args: [null, 7], expected: false },
      { id: 'no-coercion', weight: 0.15, assertion: 'result', args: [{ status: 'running', fencingEpoch: 7 }, '7'], expected: false },
    ],
  },
  {
    id: 'code_dependency_readiness',
    category: 'planning',
    functionName: 'readyTaskIds',
    maxTokens: 380,
    prompt: taskPrompt(
      'readyTaskIds',
      'Signature: function readyTaskIds(tasks). Each task has id, status, and dependsOn (an array of task ids). Return lexicographically sorted ids for tasks whose status is exactly "pending" and whose dependencies all exist with status exactly "done". A pending task with no dependencies is ready; a missing dependency is not ready. Do not mutate the input.',
    ),
    tests: [
      {
        id: 'mixed-dag', weight: 0.35, assertion: 'result',
        args: [[
          { id: 'a', status: 'done', dependsOn: [] },
          { id: 'b', status: 'pending', dependsOn: ['a'] },
          { id: 'c', status: 'pending', dependsOn: ['x'] },
          { id: 'd', status: 'pending', dependsOn: [] },
          { id: 'x', status: 'running', dependsOn: [] },
        ]],
        expected: ['b', 'd'],
      },
      {
        id: 'missing-dependency', weight: 0.2, assertion: 'result',
        args: [[{ id: 'a', status: 'pending', dependsOn: ['missing'] }]], expected: [],
      },
      {
        id: 'pending-only', weight: 0.15, assertion: 'result',
        args: [[{ id: 'a', status: 'done', dependsOn: [] }, { id: 'b', status: 'running', dependsOn: [] }]], expected: [],
      },
      {
        id: 'deterministic-order', weight: 0.15, assertion: 'result',
        args: [[
          { id: 'z', status: 'pending', dependsOn: [] },
          { id: 'a', status: 'pending', dependsOn: [] },
          { id: 'm', status: 'pending', dependsOn: [] },
        ]],
        expected: ['a', 'm', 'z'],
      },
      {
        id: 'input-unchanged', weight: 0.15, assertion: 'inputUnchanged',
        args: [[{ id: 'a', status: 'done', dependsOn: [] }, { id: 'b', status: 'pending', dependsOn: ['a'] }]],
      },
    ],
  },
  {
    id: 'code_evidence_log_reconciliation',
    category: 'evidence',
    functionName: 'reconcileAgentLog',
    maxTokens: 460,
    prompt: taskPrompt(
      'reconcileAgentLog',
      'Signature: function reconcileAgentLog(lines). From an array of log strings, return {produced, retry, verifiedTestCount}. produced is the sorted unique task ids from lines containing "task <id> settled produced". retry is the sorted unique task ids from lines containing "task <id> retry scheduled". verifiedTestCount is the sum of tests:<integer> only on lines for which test exit=0. Ignore other lines and do not mutate lines.',
    ),
    tests: [
      {
        id: 'canonical-log', weight: 0.4, assertion: 'result',
        args: [[
          '10:00 task A started',
          '10:04 task A test exit=0 evidence=tests:42',
          '10:05 task A settled produced',
          '10:06 task B timed out',
          '10:07 task B retry scheduled',
        ]],
        expected: { produced: ['A'], retry: ['B'], verifiedTestCount: 42 },
      },
      {
        id: 'failed-tests-not-verified', weight: 0.2, assertion: 'result',
        args: [['task A test exit=1 evidence=tests:99', 'task B test exit=0 evidence=tests:3']],
        expected: { produced: [], retry: [], verifiedTestCount: 3 },
      },
      {
        id: 'sorted-deduplicated-events', weight: 0.2, assertion: 'result',
        args: [['task Z settled produced', 'task A settled produced', 'task Z settled produced', 'task C retry scheduled', 'task C retry scheduled']],
        expected: { produced: ['A', 'Z'], retry: ['C'], verifiedTestCount: 0 },
      },
      {
        id: 'input-unchanged', weight: 0.1, assertion: 'inputUnchanged',
        args: [['task A settled produced', 'task B retry scheduled']],
      },
      {
        id: 'irrelevant-lines', weight: 0.1, assertion: 'result',
        args: [['hello', 'task A started', 'tests:100 without an exit receipt']],
        expected: { produced: [], retry: [], verifiedTestCount: 0 },
      },
    ],
  },
  {
    id: 'code_windows_path_scope',
    category: 'safety',
    functionName: 'isPathWithin',
    maxTokens: 480,
    prompt: taskPrompt(
      'isPathWithin',
      'Signature: function isPathWithin(root, target). For Windows drive-absolute paths, return true when target is root itself or a descendant after case-insensitive normalization of slash direction, repeated separators, ".", and "..". Return false for relative paths, different drives, sibling prefix tricks, traversal outside root, invalid inputs, or attempts to traverse above the drive root. Do not use path, require, or process.',
    ),
    tests: [
      { id: 'same-root', weight: 0.1, assertion: 'result', args: ['C:\\AI\\projects\\Demo', 'c:/ai/projects/demo/'], expected: true },
      { id: 'mixed-separator-descendant', weight: 0.25, assertion: 'result', args: ['C:\\AI\\projects\\Demo', 'c:/AI/projects/Demo/src\\file.js'], expected: true },
      { id: 'dot-segment-descendant', weight: 0.1, assertion: 'result', args: ['C:\\AI\\projects\\Demo', 'C:\\AI\\projects\\Demo\\src\\.\\file.js'], expected: true },
      { id: 'parent-traversal', weight: 0.25, assertion: 'result', args: ['C:\\AI\\projects\\Demo', 'C:\\AI\\projects\\Demo\\..\\Other\\data.json'], expected: false },
      { id: 'sibling-prefix', weight: 0.15, assertion: 'result', args: ['C:\\AI\\projects\\Demo', 'C:\\AI\\projects\\DemoBackup\\file.js'], expected: false },
      { id: 'different-drive', weight: 0.1, assertion: 'result', args: ['C:\\AI\\projects\\Demo', 'D:\\AI\\projects\\Demo\\file.js'], expected: false },
      { id: 'relative-target', weight: 0.05, assertion: 'result', args: ['C:\\AI\\projects\\Demo', 'src\\file.js'], expected: false },
    ],
  },
];

function scanNamedFunction(text, functionName) {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\bfunction\\s+${escapedName}\\s*\\(`).exec(text);
  if (!match) return null;

  const bodyStart = text.indexOf('{', match.index + match[0].length);
  if (bodyStart < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = bodyStart; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (lineComment) {
      if (character === '\n' || character === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
    } else if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
    } else if (character === '"' || character === "'" || character === '`') {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(match.index, index + 1).trim();
    }
  }

  return null;
}

export function extractCandidateSource(rawOutput, functionName) {
  const value = String(rawOutput ?? '').trim();
  if (!value) return null;

  const fences = [...value.matchAll(/```(?:javascript|js)?\s*([\s\S]*?)```/gi)].map((match) => match[1].trim());
  for (const candidate of [...fences, value]) {
    const extracted = scanNamedFunction(candidate, functionName);
    if (extracted) return extracted;
  }
  return null;
}

export function inspectCodeSuite() {
  const errors = [];
  const ids = new Set();

  for (const task of codeTasks) {
    if (!task.id || ids.has(task.id)) errors.push(`duplicate or missing task id: ${task.id}`);
    ids.add(task.id);
    if (!task.functionName) errors.push(`${task.id}: missing functionName`);
    if (!Array.isArray(task.tests) || task.tests.length === 0) errors.push(`${task.id}: no tests`);
    const testIds = new Set();
    let totalWeight = 0;
    for (const test of task.tests || []) {
      if (!test.id || testIds.has(test.id)) errors.push(`${task.id}: duplicate or missing test id ${test.id}`);
      testIds.add(test.id);
      if (!ALLOWED_ASSERTIONS.has(test.assertion)) errors.push(`${task.id}/${test.id}: unsupported assertion ${test.assertion}`);
      if (!(Number(test.weight) > 0)) errors.push(`${task.id}/${test.id}: weight must be positive`);
      totalWeight += Number(test.weight) || 0;
    }
    if (Math.abs(totalWeight - 1) > 1e-9) errors.push(`${task.id}: test weights sum to ${totalWeight}, expected 1`);
  }

  return { valid: errors.length === 0, taskCount: codeTasks.length, errors };
}

export function executeCandidateInvocation(source, functionName, args, { timeoutMs = 250 } = {}) {
  const started = performance.now();
  const boundedTimeout = Math.max(10, Math.min(2_000, Math.trunc(Number(timeoutMs) || 250)));
  const context = vm.createContext(Object.create(null), {
    name: `local-agent-code-${functionName}`,
    codeGeneration: { strings: false, wasm: false },
  });
  const argsJson = JSON.stringify(args);
  const functionNameJson = JSON.stringify(functionName);
  const program = [
    "'use strict';",
    'const __stringify = JSON.stringify;',
    'const __map = Array.prototype.map;',
    `const __args = ${argsJson};`,
    `const __candidate = (${source});`,
    `if (typeof __candidate !== 'function' || __candidate.name !== ${functionNameJson}) throw new TypeError('Expected named function ${functionName}');`,
    'const __value = __candidate(...__args);',
    "if (__value && typeof __value.then === 'function') throw new TypeError('Async results are not supported');",
    '__stringify({ valueDefined: __value !== undefined, value: __value, argsAfter: __args, sameAsArguments: __map.call(__args, (argument) => __value === argument) });',
  ].join('\n');

  let script;
  try {
    script = new vm.Script(program, { filename: `candidate-${functionName}.js`, displayErrors: true });
  } catch (error) {
    return {
      status: 'compile_error', wallMs: round(performance.now() - started, 3),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let serialized;
  try {
    serialized = script.runInContext(context, { timeout: boundedTimeout, breakOnSigint: true });
  } catch (error) {
    const timedOut = error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /timed out/i.test(String(error?.message || ''));
    return {
      status: timedOut ? 'timeout' : 'runtime_error', wallMs: round(performance.now() - started, 3),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const payload = JSON.parse(serialized);
    return {
      status: 'completed', wallMs: round(performance.now() - started, 3),
      valueDefined: payload.valueDefined,
      value: payload.valueDefined ? payload.value : undefined,
      argsAfter: payload.argsAfter,
      sameAsArguments: payload.sameAsArguments,
    };
  } catch (error) {
    return {
      status: 'serialization_error', wallMs: round(performance.now() - started, 3),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function blockedReceipt(task, status, error, source = null) {
  const totalWeight = (task.tests || []).reduce((sum, test) => sum + Number(test.weight || 0), 0);
  return {
    status,
    functionName: task.functionName,
    sourceSha256: source ? createHash('sha256').update(source).digest('hex') : null,
    sourceBytes: source ? Buffer.byteLength(source) : 0,
    score: 0,
    passedWeight: 0,
    totalWeight: round(totalWeight),
    passedTests: 0,
    totalTests: task.tests?.length || 0,
    wallMs: 0,
    error,
    tests: (task.tests || []).map((test) => ({
      id: test.id, weight: test.weight, assertion: test.assertion, passed: false, status: 'not_run', error,
    })),
  };
}

export function makeUnexecutedCodeReceipt(task, status, error) {
  return blockedReceipt(task, status, error);
}

function scoreAssertion(test, execution) {
  if (execution.status !== 'completed') return false;
  if (test.assertion === 'result') return isDeepStrictEqual(execution.value, test.expected);
  if (test.assertion === 'inputUnchanged') return isDeepStrictEqual(execution.argsAfter, test.args);
  if (test.assertion === 'notSameAsArgument') return execution.sameAsArguments?.[test.argumentIndex] === false;
  return false;
}

export function evaluateCodeTask(task, rawOutput, { timeoutMs = 250 } = {}) {
  const started = performance.now();
  const source = extractCandidateSource(rawOutput, task.functionName);
  if (!source) return { source: null, receipt: blockedReceipt(task, 'parse_error', `No function declaration named ${task.functionName} was found.`) };

  const sourceBytes = Buffer.byteLength(source);
  if (sourceBytes > MAX_SOURCE_BYTES) {
    return { source, receipt: blockedReceipt(task, 'rejected', `Source exceeds ${MAX_SOURCE_BYTES} bytes.`, source) };
  }
  const forbidden = source.match(FORBIDDEN_SOURCE)?.[0];
  if (forbidden) {
    return { source, receipt: blockedReceipt(task, 'rejected', `Forbidden host or dynamic-code identifier: ${forbidden}`, source) };
  }

  const tests = [];
  let passedWeight = 0;
  for (const test of task.tests) {
    const execution = executeCandidateInvocation(source, task.functionName, test.args, { timeoutMs });
    const passed = scoreAssertion(test, execution);
    if (passed) passedWeight += test.weight;
    tests.push({
      id: test.id,
      weight: test.weight,
      assertion: test.assertion,
      passed,
      status: execution.status,
      expected: test.assertion === 'result' ? test.expected : undefined,
      actual: test.assertion === 'result' ? execution.value : undefined,
      argsAfter: test.assertion === 'inputUnchanged' ? execution.argsAfter : undefined,
      sameAsArgument: test.assertion === 'notSameAsArgument' ? execution.sameAsArguments?.[test.argumentIndex] : undefined,
      wallMs: execution.wallMs,
      error: execution.error,
    });
  }

  const totalWeight = task.tests.reduce((sum, test) => sum + test.weight, 0);
  const executionFailures = tests.filter((test) => test.status !== 'completed').length;
  return {
    source,
    receipt: {
      status: executionFailures ? 'tested_with_execution_errors' : 'completed',
      functionName: task.functionName,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      sourceBytes,
      score: round(totalWeight ? passedWeight / totalWeight : 0),
      passedWeight: round(passedWeight),
      totalWeight: round(totalWeight),
      passedTests: tests.filter((test) => test.passed).length,
      totalTests: tests.length,
      wallMs: round(performance.now() - started, 3),
      tests,
    },
  };
}
