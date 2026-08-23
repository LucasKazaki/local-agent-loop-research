#!/usr/bin/env node
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRoutingArtifacts, decisionRowsToCsv } from './routing-manifest-lib.mjs';

function parseArgs(argv) {
  const options = {
    policy: 'policies/routing-policy.draft.json',
    manifest: 'reports/routing-manifest.draft.json',
    decisionTable: 'reports/routing-decision-table.draft.json',
    decisionCsv: 'reports/routing-decision-table.draft.csv',
    requireValidated: false,
  };
  for (const argument of argv) {
    if (argument === '--require-validated') options.requireValidated = true;
    else if (argument.startsWith('--policy=')) options.policy = argument.slice('--policy='.length);
    else if (argument.startsWith('--manifest=')) options.manifest = argument.slice('--manifest='.length);
    else if (argument.startsWith('--decision-table=')) options.decisionTable = argument.slice('--decision-table='.length);
    else if (argument.startsWith('--decision-csv=')) options.decisionCsv = argument.slice('--decision-csv='.length);
    else if (argument === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function resolveInside(repoRoot, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error(`Output must be a repository-relative path: ${relativePath}`);
  const output = path.resolve(repoRoot, relativePath);
  const relative = path.relative(repoRoot, output);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Output escapes repository root: ${relativePath}`);
  return output;
}

async function atomicWrite(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { encoding: 'utf8' });
  await rename(temporary, filePath);
}

function usage() {
  return [
    'Usage: node scripts/build-routing-manifest.mjs [options]',
    '',
    '  --policy=PATH          Reviewed routing policy JSON',
    '  --manifest=PATH        Routing manifest JSON output',
    '  --decision-table=PATH  Detailed decision table JSON output',
    '  --decision-csv=PATH    Flat decision table CSV output',
    '  --require-validated    Exit 2 when evidence cannot produce validated status',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(scriptDirectory, '..');
  const generatedAt = new Date().toISOString();
  const artifacts = await buildRoutingArtifacts({ repoRoot, policyPath: options.policy, generatedAt });
  const manifestPath = resolveInside(repoRoot, options.manifest);
  const decisionPath = resolveInside(repoRoot, options.decisionTable);
  const csvPath = resolveInside(repoRoot, options.decisionCsv);
  for (const output of [manifestPath, decisionPath, csvPath]) {
    if (path.resolve(output) === path.resolve(repoRoot, options.policy)) throw new Error('An output path may not overwrite the policy input.');
  }
  await atomicWrite(manifestPath, `${JSON.stringify(artifacts.manifest, null, 2)}\n`);
  await atomicWrite(decisionPath, `${JSON.stringify(artifacts.decisionTable, null, 2)}\n`);
  await atomicWrite(csvPath, decisionRowsToCsv(artifacts.decisionTable.rows));
  process.stdout.write(`${JSON.stringify({
    status: artifacts.manifest.status,
    manifest: path.relative(repoRoot, manifestPath).split(path.sep).join('/'),
    decision_table: path.relative(repoRoot, decisionPath).split(path.sep).join('/'),
    decision_csv: path.relative(repoRoot, csvPath).split(path.sep).join('/'),
    eligible_profiles: artifacts.manifest.profiles.filter((profile) => profile.eligible_models.length > 0).length,
    unresolved_profiles: artifacts.decisionTable.unresolved_profiles,
  }, null, 2)}\n`);
  return options.requireValidated && artifacts.manifest.status !== 'validated' ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
