import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { makeDiagnosticImage, visionTasks } from '../benchmark/vision-suite.mjs';

const expectedImageSha256 = 'a19b3bd998a17e6e3aa2bf365d0d136e410abada488f3bd1fb9b71f13f7c56e9';

function visionTask(id) {
  const value = visionTasks.find((candidate) => candidate.id === id);
  assert.ok(value, `missing vision task ${id}`);
  return value;
}

test('diagnostic PNG bytes and hash are deterministic', () => {
  const first = makeDiagnosticImage();
  const second = makeDiagnosticImage();

  assert.deepEqual(first.png, second.png);
  assert.equal(first.png.length, 3876);
  assert.equal(first.png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(first.png.readUInt32BE(16), 512);
  assert.equal(first.png.readUInt32BE(20), 512);
  assert.equal(createHash('sha256').update(first.png).digest('hex'), expectedImageSha256);
  assert.equal(first.dataUrl, `data:image/png;base64,${first.png.toString('base64')}`);
});

test('vision localization scoring supports strict recovered JSON and partial credit', () => {
  const localization = visionTask('vision_grid_localization');
  const correct = {
    redCircle: { row: 1, column: 3 },
    greenTriangle: { row: 2, column: 2 },
    blueSquare: { row: 3, column: 1 },
  };
  assert.equal(localization.score(`Result:\n\`\`\`json\n${JSON.stringify(correct)}\n\`\`\``), 1);

  correct.blueSquare.column = 2;
  assert.equal(localization.score(JSON.stringify(correct)), 2 / 3);
  assert.equal(localization.score('[]'), 0);
});

test('vision counting and negative-grounding outputs are exact', () => {
  const counting = visionTask('vision_counting');
  const grounding = visionTask('vision_negative_grounding');

  assert.equal(counting.score(' 5\n'), 1);
  assert.equal(counting.score('There are 5 bars.'), 0);
  assert.equal(grounding.score('ABSENT'), 1);
  assert.equal(grounding.score('absent'), 0);
  assert.equal(grounding.score('PRESENT'), 0);
});
