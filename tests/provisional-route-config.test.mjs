import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..');
const proposalPath = path.join(repositoryRoot, 'reports', 'local-model-routes.provisional.schema-v1.json');
const auditPath = path.join(repositoryRoot, 'reports', 'project-role-routing-audit.json');
const loaderPath = path.resolve(
  repositoryRoot,
  '..',
  'LucasAgentStudio',
  'src',
  'server',
  'local-model-route-config.js',
);

test('schema-v1 proposal reconciles all 83 roles and fails closed for deliberate omissions', async () => {
  const [{
    loadLocalModelRouteConfig,
    resolveLocalRoute,
    applyLocalRouteToAgent,
    applyLocalRouteToRequest,
  }, auditText, proposalText] = await Promise.all([
    import(pathToFileURL(loaderPath).href),
    readFile(auditPath, 'utf8'),
    readFile(proposalPath, 'utf8'),
  ]);
  const audit = JSON.parse(auditText);
  const config = loadLocalModelRouteConfig(proposalPath);
  assert.equal(
    audit.provisionalRouteProposal.sha256,
    createHash('sha256').update(proposalText).digest('hex'),
  );

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.endpoints.length, 2);
  assert.deepEqual(config.endpoints.map((endpoint) => endpoint.id), [
    'gpu0-lmstudio-timesliced',
    'gpu1-llamacpp-granite-static',
  ]);
  assert.equal(config.endpoints[0].exclusiveResidency, true);
  assert.equal(config.endpoints[0].runtimeManagedContext, true);
  assert.equal(config.endpoints[0].contextLength, null);
  assert.equal(config.endpoints[0].parallel, 1);
  assert.equal(config.endpoints[0].runtime, 'lm_studio');
  assert.deepEqual(config.endpoints[0].gpuAffinity, [0]);
  assert.equal(config.endpoints[1].exclusiveResidency, false);
  assert.equal(config.endpoints[1].runtime, 'llama_cpp');
  assert.deepEqual(config.endpoints[1].gpuAffinity, [1]);

  const projects = Object.entries(config.routing.projects);
  assert.equal(projects.length, 16);
  assert.equal(projects.every(([, project]) => project.localOnly && project.default === null), true);
  const roleRouteCount = projects.reduce((count, [, project]) => count + Object.keys(project.roles).length, 0);
  const exactAgentRouteCount = Object.keys(config.routing.agents).length;
  assert.equal(roleRouteCount, 71);
  assert.equal(exactAgentRouteCount, 2);

  const modelCounts = {};
  for (const [, project] of projects) {
    for (const route of Object.values(project.roles)) {
      modelCounts[route.model] = (modelCounts[route.model] || 0) + 1;
    }
  }
  for (const route of Object.values(config.routing.agents)) {
    modelCounts[route.model] = (modelCounts[route.model] || 0) + 1;
  }
  assert.deepEqual(modelCounts, {
    'google/gemma-4-e4b': 32,
    'granite-4.1-8b': 30,
    'openai/gpt-oss-20b': 9,
    'qwen/qwen3.5-9b': 2,
  });
  assert.equal(config.utilityRoutes['code-independent-alternate'].model,
    'mistralai_devstral-small-2-24b-instruct-2512');

  const inventoryCount = audit.projects.reduce(
    (count, project) => count + project.roleSuffixes.length + (project.noncanonicalDirectorAgentId ? 1 : 0),
    0,
  );
  assert.equal(inventoryCount, 83);
  assert.equal(config.proposalAudit.routedProjectAgentCount, 73);
  assert.equal(config.proposalAudit.omittedAgentIds.length, 10);

  for (const [projectId, agentId] of [
    ['veritasium-second-brain', 'project-veritasium-second-brain-director'],
    ['summer-2027-internship-research', 'project-summer-2027-internship-research-director'],
  ]) {
    const route = resolveLocalRoute(config, { projectId, agentId });
    assert.equal(route.source, 'agent');
    assert.equal(route.routingLocked, false);
    assert.equal(route.routeStatus, 'provisional');
    assert.equal(route.admissionStatus, 'provisional');
  }

  for (const agentId of config.proposalAudit.omittedAgentIds) {
    const project = audit.projects.find((candidate) => (
      agentId.startsWith(`${candidate.projectId}-`) || candidate.noncanonicalDirectorAgentId === agentId
    ));
    assert.ok(project, agentId);
    assert.equal(resolveLocalRoute(config, { projectId: project.projectId, agentId }), null, agentId);
    const projected = applyLocalRouteToAgent(config, { id: agentId, project: project.projectId });
    assert.equal(projected.routeEligible, false, agentId);
    assert.equal(projected.routingStatus, 'unresolved', agentId);
    assert.equal(projected.admissionStatus, 'not-admitted', agentId);
    assert.throws(
      () => applyLocalRouteToRequest(config, {
        agentId,
        projectId: project.projectId,
        profile: { id: agentId, project: project.projectId },
        modelMode: 'frontier',
      }),
      (error) => error?.code === 'LOCAL_MODEL_ROUTE_UNRESOLVED',
      agentId,
    );
  }
});
