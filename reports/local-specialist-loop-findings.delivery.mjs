#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function usage() {
  return "Usage: node local-specialist-loop-findings.delivery.mjs <data-analytics-plugin-root> <artifact.json> <report.html>";
}

const [pluginRootArg, inputArg, outputArg] = process.argv.slice(2);
if (!pluginRootArg || !inputArg || !outputArg) {
  process.stderr.write(`${usage()}\n`);
  process.exitCode = 1;
} else {
  const pluginRoot = resolve(pluginRootArg);
  const scriptRoot = resolve(pluginRoot, "skills", "build-report", "scripts");
  const builder = await import(pathToFileURL(resolve(scriptRoot, "build_portable_artifact.mjs")).href);
  const delivery = await import(pathToFileURL(resolve(scriptRoot, "deliver_portable_artifact.mjs")).href);

  const originalRuntime = builder.readPackagedReaderRuntime().html;
  const originalRule = [
    "  width: 100vw;",
    "  height: 48px;",
    "  min-height: 48px;",
    "  margin-right: calc(50% - 50vw);",
    "  margin-left: calc(50% - 50vw);",
  ].join("\n");
  const correctedRule = [
    "  width: 100%;",
    "  height: 48px;",
    "  min-height: 48px;",
    "  margin-right: 0;",
    "  margin-left: 0;",
  ].join("\n");
  const matchCount = originalRuntime.split(originalRule).length - 1;
  if (matchCount !== 1) {
    throw new Error(`Expected exactly one packaged top-bar width rule; found ${matchCount}.`);
  }
  const correctedRuntime = originalRuntime.replace(originalRule, correctedRule);
  const build = (input, options = {}) => builder.buildPortableArtifact(input, {
    ...options,
    runtimeHtml: correctedRuntime,
  });

  const result = await delivery.deliverPortableArtifact({
    actionTimeoutMs: 5000,
    inputPath: resolve(inputArg),
    outputPath: resolve(outputArg),
    readyTimeoutMs: 10000,
    timeoutMs: 30000,
  }, { build });
  process.stdout.write(`${JSON.stringify({
    ...result,
    compatibilityCorrection: {
      scope: "shared-reader top bar only",
      from: "width: 100vw with viewport margins",
      to: "width: 100% with zero margins",
    },
  })}\n`);
}
