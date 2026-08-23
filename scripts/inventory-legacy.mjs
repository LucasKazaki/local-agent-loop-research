#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, opendir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const workspaceRoot = path.resolve(repositoryRoot, "..", "..");
const outputPath = path.join(repositoryRoot, "evidence", "legacy-inventory.json");
const maxHashBytes = 64 * 1024 * 1024;

const sources = [
  {
    id: "legacy-agentic-ai-research",
    workspacePath: "projects/LucasAgentStudio/data/agentic-ai-research",
    classification: "archived-runtime-research",
    disposition: "Index for provenance; do not resume or append the retired standalone loop.",
  },
  {
    id: "agent-studio-research-loop",
    workspacePath: "projects/LucasAgentStudio/data/research-loops/agent-studio",
    classification: "archived-runtime-research",
    disposition: "Retain as historical findings and state; curate claims into this repository.",
  },
  {
    id: "agent-studio-competing-loops",
    workspacePath: "projects/LucasAgentStudio/data/research-loops/agent-studio-competing",
    classification: "archived-runtime-research",
    disposition: "Retain as historical frontier-agent comparison material.",
  },
  {
    id: "agentic-ai-research-reconciliation",
    workspacePath: "projects/LucasAgentStudio/data/research-loops/agentic-ai-research",
    classification: "archived-runtime-research",
    disposition: "Retain as historical overseer reconciliation evidence.",
  },
  {
    id: "research-loop-root-receipts",
    workspacePath: "projects/LucasAgentStudio/data/research-loops",
    scanMode: "top-level-files",
    classification: "archived-orchestration-receipts",
    disposition: "Index only the shared root receipts; named research subdirectories are inventoried separately or remain domain-specific.",
  },
  {
    id: "legacy-local-model-benchmarks",
    workspacePath: "projects/LucasAgentStudio/data/company-runtime/model-benchmarks",
    classification: "archived-benchmark-evidence",
    disposition: "Retain as historical benchmark evidence; use the canonical repository runner for new results.",
  },
  {
    id: "company-scan-source",
    workspacePath: "evidence/agent-studio-ai-company-scan-2026-08-22",
    classification: "imported-source-evidence",
    disposition: "Use as provenance for the curated repository copy under evidence/company-scan-2026-08-22.",
  },
  {
    id: "legacy-research-placeholder",
    workspacePath: "projects/LucasAgentStudio/research",
    classification: "legacy-placeholder",
    disposition: "Reference only; this empty placeholder is not the canonical research workspace.",
  },
];

function portablePath(value) {
  return value.split(path.sep).join("/");
}

function errorDetails(error) {
  return {
    code: typeof error?.code === "string" ? error.code : null,
    message: error instanceof Error ? error.message : String(error),
  };
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function listFiles(sourceRoot, scanMode) {
  const files = [];
  const ignoredEntries = [];
  const errors = [];

  async function walk(directoryPath) {
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch (error) {
      errors.push({
        operation: "open-directory",
        path: portablePath(path.relative(sourceRoot, directoryPath)) || ".",
        ...errorDetails(error),
      });
      return;
    }

    const entries = [];
    try {
      for await (const entry of directory) {
        entries.push(entry);
      }
    } catch (error) {
      errors.push({
        operation: "read-directory",
        path: portablePath(path.relative(sourceRoot, directoryPath)) || ".",
        ...errorDetails(error),
      });
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory() && scanMode === "recursive-files") {
        await walk(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      } else {
        ignoredEntries.push({
          path: portablePath(path.relative(sourceRoot, entryPath)),
          reason: entry.isSymbolicLink() ? "symbolic-link-not-followed" : "non-regular-entry",
        });
      }
    }
  }

  await walk(sourceRoot);
  files.sort((left, right) =>
    portablePath(path.relative(sourceRoot, left)).localeCompare(
      portablePath(path.relative(sourceRoot, right)),
      "en",
    ),
  );

  return { files, ignoredEntries, errors };
}

async function inventorySource(source) {
  const sourceRoot = path.resolve(workspaceRoot, ...source.workspacePath.split("/"));
  const base = {
    id: source.id,
    workspacePath: source.workspacePath,
    scanMode: source.scanMode ?? "recursive-files",
    classification: source.classification,
    disposition: source.disposition,
  };

  let sourceStat;
  try {
    sourceStat = await stat(sourceRoot);
  } catch (error) {
    return {
      ...base,
      status: error?.code === "ENOENT" ? "missing" : "error",
      summary: {
        fileCount: 0,
        totalBytes: 0,
        hashedFileCount: 0,
        skippedHashFileCount: 0,
        ignoredEntryCount: 0,
        errorCount: 1,
      },
      files: [],
      ignoredEntries: [],
      errors: [{ operation: "stat-source", path: ".", ...errorDetails(error) }],
    };
  }

  if (!sourceStat.isDirectory()) {
    return {
      ...base,
      status: "error",
      summary: {
        fileCount: 0,
        totalBytes: 0,
        hashedFileCount: 0,
        skippedHashFileCount: 0,
        ignoredEntryCount: 1,
        errorCount: 1,
      },
      files: [],
      ignoredEntries: [{ path: ".", reason: "source-is-not-a-directory" }],
      errors: [{ operation: "validate-source", path: ".", code: null, message: "Source is not a directory." }],
    };
  }

  const discovered = await listFiles(sourceRoot, base.scanMode);
  const fileRecords = [];
  const errors = [...discovered.errors];

  for (const filePath of discovered.files) {
    const relativePath = portablePath(path.relative(sourceRoot, filePath));
    const workspacePath = portablePath(path.relative(workspaceRoot, filePath));
    let fileStat;

    try {
      fileStat = await stat(filePath);
    } catch (error) {
      errors.push({ operation: "stat-file", path: relativePath, ...errorDetails(error) });
      continue;
    }

    const record = {
      path: relativePath,
      workspacePath,
      sizeBytes: fileStat.size,
      sha256: null,
    };

    if (fileStat.size > maxHashBytes) {
      record.hashSkipped = `file-exceeds-${maxHashBytes}-byte-limit`;
    } else {
      try {
        record.sha256 = await sha256(filePath);
      } catch (error) {
        record.hashError = errorDetails(error);
        errors.push({ operation: "hash-file", path: relativePath, ...errorDetails(error) });
      }
    }

    fileRecords.push(record);
  }

  const totalBytes = fileRecords.reduce((sum, file) => sum + file.sizeBytes, 0);
  const hashedFileCount = fileRecords.filter((file) => file.sha256 !== null).length;
  const skippedHashFileCount = fileRecords.filter((file) => "hashSkipped" in file).length;

  return {
    ...base,
    status: errors.length === 0 ? "present" : "partial",
    summary: {
      fileCount: fileRecords.length,
      totalBytes,
      hashedFileCount,
      skippedHashFileCount,
      ignoredEntryCount: discovered.ignoredEntries.length,
      errorCount: errors.length,
    },
    files: fileRecords,
    ignoredEntries: discovered.ignoredEntries,
    errors,
  };
}

const sourceInventories = [];
for (const source of sources) {
  sourceInventories.push(await inventorySource(source));
}

const summary = sourceInventories.reduce(
  (result, source) => {
    result.fileCount += source.summary.fileCount;
    result.totalBytes += source.summary.totalBytes;
    result.hashedFileCount += source.summary.hashedFileCount;
    result.skippedHashFileCount += source.summary.skippedHashFileCount;
    result.ignoredEntryCount += source.summary.ignoredEntryCount;
    result.errorCount += source.summary.errorCount;
    if (source.status === "missing") result.missingSourceCount += 1;
    else if (source.status === "error") result.errorSourceCount += 1;
    else result.presentSourceCount += 1;
    return result;
  },
  {
    sourceCount: sourceInventories.length,
    presentSourceCount: 0,
    missingSourceCount: 0,
    errorSourceCount: 0,
    fileCount: 0,
    totalBytes: 0,
    hashedFileCount: 0,
    skippedHashFileCount: 0,
    ignoredEntryCount: 0,
    errorCount: 0,
  },
);

const inventory = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generator: "scripts/inventory-legacy.mjs",
  pathBase: "C:/AI equivalent workspace root; paths are stored relative to this root",
  hashing: {
    algorithm: "sha256",
    maxFileBytes: maxHashBytes,
    note: "Files larger than the cap are listed with size but are not hashed.",
  },
  summary,
  sources: sourceInventories,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");

console.log(`Wrote ${portablePath(path.relative(repositoryRoot, outputPath))}`);
console.log(
  `Indexed ${summary.fileCount} files (${summary.totalBytes} bytes); ` +
    `${summary.hashedFileCount} hashed, ${summary.skippedHashFileCount} hash-skipped, ` +
    `${summary.errorCount} errors.`,
);

if (summary.errorCount > 0 || summary.missingSourceCount > 0 || summary.errorSourceCount > 0) {
  process.exitCode = 1;
}
