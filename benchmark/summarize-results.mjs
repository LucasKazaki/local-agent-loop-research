import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const options = { inputs: [], outputDir: 'results/derived' };
  for (const arg of argv) {
    if (arg.startsWith('--output-dir=')) options.outputDir = arg.slice(13);
    else if (!arg.startsWith('--')) options.inputs.push(arg);
  }
  if (!options.inputs.length) throw new Error('Pass one or more benchmark JSON files.');
  return options;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map((row) => columns.map((key) => csvCell(row[key])).join(','))].join('\n') + '\n';
}

function round(value, digits = 4) {
  const n = Number(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function gpuDelta(record, index) {
  const before = record.hardwareLoaded?.gpus?.find((gpu) => gpu.index === index);
  const baseline = before ? 0 : null;
  // hardwareLoaded is sampled after the model is loaded. Report absolute usage;
  // callers can compare it with the run-level hardwareBefore sample.
  return before ? round(before.usedMiB - baseline, 0) : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const modelRows = [];
  const caseRows = [];
  const provenance = [];

  for (const input of options.inputs) {
    const absolute = path.resolve(input);
    const report = JSON.parse(await readFile(absolute, 'utf8'));
    provenance.push({
      file: path.relative(process.cwd(), absolute),
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      stage: report.options?.stage || report.taskSuite?.stage,
      repeats: report.options?.repeats || report.taskSuite?.repeats,
      taskSuiteSha256: report.taskSuite?.hashSha256,
      complete: Boolean(report.finishedAt),
    });
    for (const model of report.models || []) {
      const categories = Object.fromEntries(Object.entries(model.summary?.categories || {}).map(([key, value]) => [
        `category_${key}`,
        round(value.passRate),
      ]));
      modelRows.push({
        source: path.basename(absolute),
        stage: report.options?.stage || report.taskSuite?.stage,
        repeats: report.options?.repeats || report.taskSuite?.repeats,
        model: model.model,
        status: model.status,
        quantization: model.meta?.quantization?.name || '',
        sizeGiB: round(Number(model.meta?.sizeBytes || 0) / 2 ** 30, 3),
        score: round(model.summary?.score),
        possible: model.summary?.possible ?? null,
        passRate: round(model.summary?.passRate),
        meanTokensPerSecond: round(model.summary?.meanTokensPerSecond, 2),
        meanTimeToFirstTokenSeconds: round(model.summary?.meanTimeToFirstTokenSeconds, 3),
        totalWallSeconds: round(model.summary?.totalWallSeconds, 2),
        loadWallSeconds: round(model.load?.wallSeconds, 2),
        gpu0UsedMiBLoaded: gpuDelta(model, 0),
        gpu1UsedMiBLoaded: gpuDelta(model, 1),
        completedCases: model.summary?.completedCases ?? 0,
        failedCases: model.summary?.failedCases ?? 0,
        ...categories,
      });
      for (const item of model.cases || []) {
        caseRows.push({
          source: path.basename(absolute),
          stage: report.options?.stage || report.taskSuite?.stage,
          model: model.model,
          taskId: item.taskId,
          category: item.category,
          repeat: item.repeat,
          status: item.status,
          score: round(item.score?.score),
          wallMs: item.response?.wallMs ?? item.wallMs ?? null,
          tokensPerSecond: round(item.response?.stats?.tokens_per_second, 2),
          timeToFirstTokenSeconds: round(item.response?.stats?.time_to_first_token, 3),
          finishReason: item.response?.finishReason || '',
          promptTokens: item.response?.usage?.prompt_tokens ?? null,
          completionTokens: item.response?.usage?.completion_tokens ?? null,
          error: item.error || '',
        });
      }
    }
  }

  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });
  const categoryColumns = [...new Set(modelRows.flatMap((row) => Object.keys(row).filter((key) => key.startsWith('category_'))))].sort();
  const modelColumns = [
    'source', 'stage', 'repeats', 'model', 'status', 'quantization', 'sizeGiB', 'score', 'possible', 'passRate',
    'meanTokensPerSecond', 'meanTimeToFirstTokenSeconds', 'totalWallSeconds', 'loadWallSeconds',
    'gpu0UsedMiBLoaded', 'gpu1UsedMiBLoaded', 'completedCases', 'failedCases', ...categoryColumns,
  ];
  const caseColumns = [
    'source', 'stage', 'model', 'taskId', 'category', 'repeat', 'status', 'score', 'wallMs',
    'tokensPerSecond', 'timeToFirstTokenSeconds', 'finishReason', 'promptTokens', 'completionTokens', 'error',
  ];
  await Promise.all([
    writeFile(path.join(outputDir, 'model-summary.csv'), toCsv(modelRows, modelColumns), 'utf8'),
    writeFile(path.join(outputDir, 'case-results.csv'), toCsv(caseRows, caseColumns), 'utf8'),
    writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), provenance, models: modelRows, cases: caseRows }, null, 2)}\n`, 'utf8'),
  ]);
  console.log(`Wrote ${modelRows.length} model rows and ${caseRows.length} case rows to ${outputDir}`);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
