#!/usr/bin/env node

import { mkdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { inventoryRoots } from './model-inventory-lib.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');

function usage() {
  return `Usage:
  node scripts/inventory-models.mjs --lm-studio-root=<path> [--root=<id>=<path> ...] [--output=<repo-path>]
  node scripts/inventory-models.mjs --lm-studio-default [--dry-run]

Options:
  --lm-studio-root=<path>  Scan an explicit LM Studio models directory.
  --lm-studio-default      Scan the conventional ~/.lmstudio/models directory.
  --root=<id>=<path>       Scan another GGUF directory under a non-secret label.
  --output=<path>          New JSON artifact inside this repository (never overwritten).
  --dry-run                Validate root availability without hashing model files or writing output.
  --help                   Show this help.
`;
}

export function parseRootSpec(value) {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('--root must use <id>=<path>.');
  }
  return { id: value.slice(0, separator), kind: 'gguf_directory', path: value.slice(separator + 1) };
}

export function parseInventoryArgs(argv) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const options = {
    roots: [],
    output: path.join(repositoryRoot, 'results', `model-inventory-${timestamp}.json`),
    dryRun: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--lm-studio-default') {
      options.roots.push({ id: 'lm-studio', kind: 'lm_studio', path: path.join(os.homedir(), '.lmstudio', 'models') });
    } else if (arg.startsWith('--lm-studio-root=')) {
      options.roots.push({ id: 'lm-studio', kind: 'lm_studio', path: arg.slice('--lm-studio-root='.length) });
    } else if (arg.startsWith('--root=')) options.roots.push(parseRootSpec(arg.slice('--root='.length)));
    else if (arg.startsWith('--output=')) options.output = path.resolve(arg.slice('--output='.length));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function assertOutputInsideRepository(outputPath) {
  const relative = path.relative(repositoryRoot, path.resolve(outputPath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Output must remain inside the LocalAgentResearch repository.');
  }
}

async function dryRunRoots(roots) {
  const rows = [];
  for (const root of roots) {
    let status = 'present';
    try {
      const rootStat = await stat(path.resolve(root.path));
      if (!rootStat.isDirectory()) status = 'not-a-directory';
    } catch (error) {
      status = error?.code === 'ENOENT' ? 'missing' : 'error';
    }
    rows.push({ id: root.id, kind: root.kind, status, root_path_disclosure: 'omitted' });
  }
  return rows;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseInventoryArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (options.roots.length === 0) throw new Error('No roots selected. Use --lm-studio-root, --lm-studio-default, or --root.');
  assertOutputInsideRepository(options.output);

  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify({ dry_run: true, roots: await dryRunRoots(options.roots) }, null, 2)}\n`);
    return 0;
  }

  const report = await inventoryRoots(options.roots);
  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`Wrote ${report.summary.gguf_file_count} GGUF identities to ${path.relative(repositoryRoot, options.output)}\n`);
  return report.summary.error_count === 0 ? 0 : 2;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
