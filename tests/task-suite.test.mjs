import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreTask, selectTasks, tasks } from '../benchmark/task-suite.mjs';

function task(id) {
  const value = tasks.find((candidate) => candidate.id === id);
  assert.ok(value, `missing task ${id}`);
  return value;
}

test('task ids are unique and stage selection preserves contracts', () => {
  assert.equal(new Set(tasks.map((item) => item.id)).size, tasks.length);
  assert.deepEqual(selectTasks('deep'), tasks);
  assert.ok(selectTasks('screen').length > 0);
  assert.ok(selectTasks('screen').every((item) => item.stage === 'screen'));
  assert.throws(() => selectTasks('unknown'), /Unknown stage/);
});

test('exact-output scoring trims boundaries but rejects commentary', () => {
  const exactTask = task('instruction_exact_token');
  assert.equal(scoreTask(exactTask, { text: '  LOOP_OK\n' }).score, 1);
  assert.equal(scoreTask(exactTask, { text: 'LOOP_OK because the loop is healthy' }).score, 0);
});

test('director dependency envelope requires the intended role chain', () => {
  const directorTask = task('director_dependency_envelope');
  const response = {
    status: 'continue',
    tasks: [
      { id: 'research', role: 'researcher', dependsOn: [], acceptanceEvidence: ['official-source receipt'] },
      { id: 'implement', role: 'developer', dependsOn: ['research'], acceptanceEvidence: ['focused test'] },
      { id: 'verify', role: 'qa', dependsOn: ['implement'], acceptanceEvidence: ['independent QA receipt'] },
    ],
  };

  assert.equal(scoreTask(directorTask, { text: JSON.stringify(response) }).score, 1);

  response.tasks[2].dependsOn = ['research'];
  const broken = scoreTask(directorTask, { text: JSON.stringify(response) });
  assert.ok(broken.score < 1);
  assert.equal(broken.passed, broken.total - 1);
});

test('native tool scoring checks call count, name, and parsed arguments', () => {
  const toolTask = task('native_tool_read_file');
  const correct = {
    message: {
      tool_calls: [{ function: { name: 'read_project_file', arguments: '{"path":"AGENTS.md"}' } }],
    },
  };
  assert.equal(scoreTask(toolTask, correct).score, 1);

  const malformed = {
    message: {
      tool_calls: [{ function: { name: 'read_project_file', arguments: '{not-json}' } }],
    },
  };
  assert.equal(scoreTask(toolTask, malformed).passed, 2);
  assert.equal(scoreTask(toolTask, malformed).total, 3);
});

test('representative safety and arithmetic contracts score deterministically', () => {
  assert.equal(scoreTask(task('insufficient_evidence_abstention'), { text: 'INSUFFICIENT_EVIDENCE' }).score, 1);
  assert.equal(scoreTask(task('insufficient_evidence_abstention'), { text: 'Probably GPT-OSS' }).score, 0);
  assert.equal(
    scoreTask(task('weighted_average_reasoning'), {
      text: JSON.stringify({ modelA: 23 / 30, modelB: 16 / 20, winner: 'B' }),
    }).score,
    1,
  );
});

test('scoreTask clamps invalid ranges and contains scorer exceptions', () => {
  assert.equal(scoreTask({ score: () => ({ score: 4 }) }, {}).score, 1);
  assert.equal(scoreTask({ score: () => ({ score: -2 }) }, {}).score, 0);
  assert.equal(scoreTask({ score: () => ({ score: Number.NaN }) }, {}).score, 0);
  assert.deepEqual(
    scoreTask({ score: () => { throw new Error('contract failure'); } }, {}),
    { score: 0, error: 'contract failure' },
  );
});
