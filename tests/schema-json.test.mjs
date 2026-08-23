import assert from 'node:assert/strict';
import test from 'node:test';

import { isStrictJsonObject, parseJsonObject } from '../benchmark/json-contracts.mjs';

test('parseJsonObject parses direct, fenced, and recovered schema objects', () => {
  assert.deepEqual(parseJsonObject('{"action":"continue"}'), { action: 'continue' });
  assert.deepEqual(parseJsonObject('```json\n{"action":"stop"}\n```'), { action: 'stop' });
  assert.deepEqual(parseJsonObject('Output: {"action":"review","evidence":[]}.'), {
    action: 'review',
    evidence: [],
  });
});

test('parseJsonObject rejects non-object JSON values', () => {
  for (const value of ['[]', 'null', 'true', '7', '"object-shaped text"']) {
    assert.equal(parseJsonObject(value), null, value);
  }
});

test('isStrictJsonObject accepts only plain object values', () => {
  assert.equal(isStrictJsonObject({}), true);
  assert.equal(isStrictJsonObject({ nested: { ok: true } }), true);
  assert.equal(isStrictJsonObject([]), false);
  assert.equal(isStrictJsonObject(null), false);
  assert.equal(isStrictJsonObject(new Date(0)), false);
  assert.equal(isStrictJsonObject(Object.create(null)), false);
});
