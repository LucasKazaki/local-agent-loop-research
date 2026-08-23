import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  inventoryRoots,
  parseGgufHeaderBuffer,
  redactSensitiveText,
  sanitizeRelativePath,
} from '../scripts/model-inventory-lib.mjs';
import { parseRootSpec } from '../scripts/inventory-models.mjs';

function ggufFixture({ version = 3, tensors = 7n, metadata = 11n, payload = 'fixture' } = {}) {
  const header = Buffer.alloc(24);
  header.write('GGUF', 0, 'ascii');
  header.writeUInt32LE(version, 4);
  header.writeBigUInt64LE(tensors, 8);
  header.writeBigUInt64LE(metadata, 16);
  return Buffer.concat([header, Buffer.from(payload)]);
}

test('parseGgufHeaderBuffer validates the fixed GGUF identity header', () => {
  assert.deepEqual(parseGgufHeaderBuffer(ggufFixture().subarray(0, 24)), {
    valid: true,
    version: 3,
    tensor_count: '7',
    metadata_key_value_count: '11',
  });
  assert.deepEqual(parseGgufHeaderBuffer(Buffer.from('not gguf')), {
    valid: false,
    reason: 'header-shorter-than-24-bytes',
  });
});

test('inventoryRoots hashes GGUF files and derives LM Studio filesystem identities without root paths', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'local-agent-model-inventory-'));
  t.after(async () => {
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())));
    await rm(resolved, { recursive: true, force: true });
  });

  const modelDirectory = path.join(temporaryRoot, 'acme', 'tiny-instruct-GGUF');
  await mkdir(modelDirectory, { recursive: true });
  const bytes = ggufFixture({ payload: 'deterministic-model-fixture' });
  await writeFile(path.join(modelDirectory, 'tiny-instruct-Q4_K_M.gguf'), bytes);
  await writeFile(path.join(modelDirectory, 'notes.txt'), 'ignored');

  const report = await inventoryRoots([
    { id: 'lm-studio', kind: 'lm_studio', path: temporaryRoot },
  ], { generatedAt: '2026-08-23T12:00:00.000Z' });

  assert.equal(report.schema_version, 'model-inventory/1.0');
  assert.equal(report.summary.gguf_file_count, 1);
  assert.equal(report.summary.hashed_file_count, 1);
  const [model] = report.roots[0].models;
  assert.equal(model.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(model.relative_path, 'acme/tiny-instruct-GGUF/tiny-instruct-Q4_K_M.gguf');
  assert.equal(model.quantization_from_filename, 'Q4_K_M');
  assert.deepEqual(model.lm_studio_identity, {
    publisher: 'acme',
    repository: 'tiny-instruct-GGUF',
    model_key: 'acme/tiny-instruct-GGUF',
    artifact: 'tiny-instruct-Q4_K_M.gguf',
  });
  assert.equal(model.artifact_id, `lm-studio:sha256:${model.sha256}`);
  assert.equal(JSON.stringify(report).includes(temporaryRoot), false);
});

test('inventory output redacts recognized secret-shaped path components', async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'local-agent-model-redaction-'));
  t.after(async () => {
    const resolved = path.resolve(temporaryRoot);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())));
    await rm(resolved, { recursive: true, force: true });
  });
  const secret = 'hf_abcdefghijklmnopqrstuvwxyz123456';
  const modelDirectory = path.join(temporaryRoot, secret, 'repo');
  await mkdir(modelDirectory, { recursive: true });
  await writeFile(path.join(modelDirectory, 'safe-Q4_0.gguf'), ggufFixture());

  const report = await inventoryRoots([{ id: 'models', kind: 'lm_studio', path: temporaryRoot }]);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes(secret), false);
  assert.match(report.roots[0].models[0].relative_path, /^<redacted>\//);
});

test('secret and root argument helpers are deterministic and Windows-drive safe', () => {
  const redacted = redactSensitiveText('Bearer abcdefghijklmnopqrstuvwxyz');
  assert.equal(redacted.text.includes('abcdefghijklmnopqrstuvwxyz'), false);
  assert.deepEqual(parseRootSpec('archive=C:\\models\\gguf'), {
    id: 'archive',
    kind: 'gguf_directory',
    path: 'C:\\models\\gguf',
  });
  assert.equal(sanitizeRelativePath(`owner/${'sk-' + 'a'.repeat(24)}/model.gguf`), 'owner/<redacted>/model.gguf');
});
