import assert from 'node:assert/strict';
import test from 'node:test';

import { parseJson } from '../benchmark/json-contracts.mjs';

test('parseJson accepts direct objects, arrays, and scalar JSON', () => {
  assert.deepEqual(parseJson('{"status":"ok","count":2}'), { status: 'ok', count: 2 });
  assert.deepEqual(parseJson('["researcher","qa"]'), ['researcher', 'qa']);
  assert.equal(parseJson('false'), false);
  assert.equal(parseJson('42'), 42);
});

test('parseJson recovers fenced JSON', () => {
  assert.deepEqual(
    parseJson('Result:\n```json\n{"status":"completed","items":[]}\n```\n'),
    { status: 'completed', items: [] },
  );
});

test('parseJson recovers one balanced embedded object or array', () => {
  assert.deepEqual(
    parseJson('Short explanation before {"message":"a } inside a string","nested":{"ok":true}} after.'),
    { message: 'a } inside a string', nested: { ok: true } },
  );
  assert.deepEqual(parseJson('Answer: [1,{"two":2},3].'), [1, { two: 2 }, 3]);
});

test('parseJson refuses invalid or ambiguous recovery', () => {
  assert.equal(parseJson(''), null);
  assert.equal(parseJson('not JSON'), null);
  assert.equal(parseJson('broken {"value":1'), null);
  assert.equal(parseJson('first {"value":1} second {"value":2}'), null);
});
