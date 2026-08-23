#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sha256, validateResultFile } from './result-validator-lib.mjs';

function parseArgs(argv) {
  const options = { files: [], output: null };
  for (const argument of argv) {
    if (argument.startsWith('--output=')) options.output = argument.slice('--output='.length);
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument.startsWith('--')) throw new Error(`Unknown option: ${argument}`);
    else options.files.push(argument);
  }
  return options;
}

function usage() {
  return [
    'Usage: node benchmark/validate-results.mjs [--output=REPORT.json] RESULT.json [...]',
    '',
    'Supported families: text, code, vision, reasoning-profile, loop-ablation,',
    'and llamacpp-placement. Validation never runs a model or changes runtime state.',
  ].join('\n');
}

function outputInsideWorkingDirectory(output) {
  const root = path.resolve(process.cwd());
  const resolved = path.resolve(root, output);
  const relative = path.relative(root, resolved);
  if (!output || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Validation receipt output must remain inside the current repository.');
  }
  return resolved;
}

export function buildValidationReceipt(results, validatedAt = new Date().toISOString()) {
  const receipt = {
    schemaVersion: 1,
    validatorVersion: 'suite-aware/1.1',
    validatedAt,
    supportedFamilies: ['text', 'code', 'vision', 'reasoning-profile', 'loop-ablation', 'llamacpp-placement'],
    results,
    receiptContentSha256: null,
  };
  receipt.receiptContentSha256 = sha256(JSON.stringify(receipt));
  return receipt;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  if (!options.files.length) throw new Error('Pass one or more benchmark JSON files.');
  const results = [];
  for (const file of options.files) results.push(await validateResultFile(file));
  const receipt = buildValidationReceipt(results);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.output) {
    const output = outputInsideWorkingDirectory(options.output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, serialized, 'utf8');
  }
  process.stdout.write(serialized);
  return results.some((result) => !result.valid) ? 1 : 0;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((caught) => {
    process.stderr.write(`${caught?.stack ?? caught}\n`);
    process.exitCode = 1;
  });
}
