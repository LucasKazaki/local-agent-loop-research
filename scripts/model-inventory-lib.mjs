import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, opendir, stat } from 'node:fs/promises';
import path from 'node:path';

const SECRET_PATTERNS = [
  { type: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g },
  { type: 'hugging-face-token', pattern: /\bhf_[A-Za-z0-9]{20,}\b/g },
  { type: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi },
  { type: 'credential-assignment', pattern: /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi },
  { type: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

export function sha256Text(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sha256File(filePath) {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

export async function inspectGgufArtifact(filePath) {
  const hash = createHash('sha256');
  const header = Buffer.alloc(24);
  let headerBytes = 0;
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
    if (headerBytes < header.length) {
      const copied = chunk.copy(header, headerBytes, 0, Math.min(chunk.length, header.length - headerBytes));
      headerBytes += copied;
    }
  }
  return {
    sha256: hash.digest('hex'),
    gguf: parseGgufHeaderBuffer(header.subarray(0, headerBytes)),
  };
}

export function portablePath(value) {
  return value.split(path.sep).join('/');
}

export function redactSensitiveText(value, knownPaths = []) {
  let text = String(value ?? '');
  const counts = new Map();

  const replace = (type, pattern, replacement) => {
    text = text.replace(pattern, () => {
      counts.set(type, (counts.get(type) ?? 0) + 1);
      return replacement;
    });
  };

  const uniqueKnownPaths = [...new Set(knownPaths.filter(Boolean).map((item) => String(item)))]
    .sort((left, right) => right.length - left.length);
  for (const [index, knownPath] of uniqueKnownPaths.entries()) {
    const variants = new Set([
      knownPath,
      knownPath.replaceAll('\\', '/'),
      knownPath.replaceAll('/', '\\'),
      JSON.stringify(knownPath).slice(1, -1),
    ]);
    for (const variant of variants) {
      if (!variant) continue;
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      replace('local-path', new RegExp(escaped, 'gi'), `<LOCAL_PATH_${index + 1}>`);
    }
  }

  for (const { type, pattern } of SECRET_PATTERNS) replace(type, pattern, `<REDACTED_${type.toUpperCase()}>`);

  return {
    text,
    redactions: [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((left, right) => left.type.localeCompare(right.type, 'en')),
  };
}

function safeError(error, knownPaths = []) {
  const sanitized = redactSensitiveText(error instanceof Error ? error.message : String(error), knownPaths);
  return {
    name: error instanceof Error ? error.name : 'Error',
    code: typeof error?.code === 'string' ? error.code : null,
    message: sanitized.text,
    redactions: sanitized.redactions,
  };
}

function sanitizePathComponent(component) {
  const sanitized = redactSensitiveText(component);
  return sanitized.redactions.length > 0 ? '<redacted>' : sanitized.text;
}

export function sanitizeRelativePath(relativePath) {
  return portablePath(relativePath)
    .split('/')
    .filter((component) => component.length > 0 && component !== '.')
    .map(sanitizePathComponent)
    .join('/');
}

export function parseGgufHeaderBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) {
    return { valid: false, reason: 'header-shorter-than-24-bytes' };
  }
  if (buffer.subarray(0, 4).toString('ascii') !== 'GGUF') {
    return { valid: false, reason: 'missing-GGUF-magic' };
  }
  const version = buffer.readUInt32LE(4);
  const tensorCount = buffer.readBigUInt64LE(8);
  const metadataKeyValueCount = buffer.readBigUInt64LE(16);
  return {
    valid: true,
    version,
    tensor_count: tensorCount.toString(),
    metadata_key_value_count: metadataKeyValueCount.toString(),
  };
}

export async function readGgufHeader(filePath) {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(24);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return parseGgufHeaderBuffer(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function inferQuantization(fileName) {
  const match = fileName.match(/(?:^|[-_.])((?:IQ|Q)\d(?:_[A-Z0-9]+)+)(?:[-_.]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

function lmStudioIdentity(relativePath) {
  const components = portablePath(relativePath).split('/');
  const artifact = sanitizePathComponent(components.at(-1));
  const publisher = components.length >= 3 ? sanitizePathComponent(components[0]) : null;
  const repository = components.length >= 3
    ? components.slice(1, -1).map(sanitizePathComponent).join('/')
    : components.length === 2 ? sanitizePathComponent(components[0]) : null;
  const modelKey = publisher && repository ? `${publisher}/${repository}` : repository;
  return {
    publisher,
    repository,
    model_key: modelKey,
    artifact,
  };
}

function shardIdentity(fileName) {
  const match = fileName.match(/^(.*)-(\d{5})-of-(\d{5})\.gguf$/i);
  if (!match) return null;
  return {
    group_name: sanitizePathComponent(match[1]),
    shard_index: Number(match[2]),
    shard_count: Number(match[3]),
  };
}

async function discoverGgufFiles(rootPath) {
  const files = [];
  const ignored = [];
  const errors = [];

  async function walk(directoryPath) {
    let directory;
    try {
      directory = await opendir(directoryPath);
    } catch (error) {
      errors.push({
        operation: 'open-directory',
        path: sanitizeRelativePath(path.relative(rootPath, directoryPath)) || '.',
        error: safeError(error, [rootPath]),
      });
      return;
    }

    const entries = [];
    try {
      for await (const entry of directory) entries.push(entry);
    } catch (error) {
      errors.push({
        operation: 'read-directory',
        path: sanitizeRelativePath(path.relative(rootPath, directoryPath)) || '.',
        error: safeError(error, [rootPath]),
      });
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      const relativePath = sanitizeRelativePath(path.relative(rootPath, entryPath));
      if (entry.isSymbolicLink()) {
        ignored.push({ path: relativePath, reason: 'symbolic-link-not-followed' });
      } else if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.gguf')) {
        files.push(entryPath);
      } else if (!entry.isFile()) {
        ignored.push({ path: relativePath, reason: 'non-regular-entry' });
      }
    }
  }

  await walk(rootPath);
  files.sort((left, right) => portablePath(path.relative(rootPath, left)).localeCompare(
    portablePath(path.relative(rootPath, right)),
    'en',
  ));
  return { files, ignored, errors };
}

function validateRoot(root) {
  if (!root || typeof root !== 'object') throw new TypeError('Root must be an object.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(root.id ?? '')) {
    throw new Error(`Invalid root id: ${root.id ?? '<missing>'}`);
  }
  if (!['lm_studio', 'gguf_directory'].includes(root.kind)) {
    throw new Error(`Unsupported root kind for ${root.id}: ${root.kind}`);
  }
  if (!root.path) throw new Error(`Root ${root.id} has no path.`);
}

export async function inventoryRoot(root) {
  validateRoot(root);
  const rootPath = path.resolve(root.path);
  const base = {
    id: root.id,
    kind: root.kind,
    root_path_disclosure: 'omitted',
  };

  let rootStat;
  try {
    rootStat = await stat(rootPath);
  } catch (error) {
    return {
      ...base,
      status: error?.code === 'ENOENT' ? 'missing' : 'error',
      summary: { gguf_file_count: 0, valid_gguf_header_count: 0, invalid_gguf_header_count: 0, total_bytes: 0, hashed_file_count: 0, ignored_entry_count: 0, error_count: 1 },
      models: [],
      ignored_entries: [],
      errors: [{ operation: 'stat-root', path: '.', error: safeError(error, [rootPath]) }],
    };
  }

  if (!rootStat.isDirectory()) {
    return {
      ...base,
      status: 'error',
      summary: { gguf_file_count: 0, valid_gguf_header_count: 0, invalid_gguf_header_count: 0, total_bytes: 0, hashed_file_count: 0, ignored_entry_count: 0, error_count: 1 },
      models: [],
      ignored_entries: [],
      errors: [{ operation: 'validate-root', path: '.', error: { name: 'Error', code: null, message: 'Root is not a directory.', redactions: [] } }],
    };
  }

  const discovery = await discoverGgufFiles(rootPath);
  const models = [];
  const errors = [...discovery.errors];

  for (const filePath of discovery.files) {
    const relativePath = path.relative(rootPath, filePath);
    const publishedRelativePath = sanitizeRelativePath(relativePath);
    try {
      const fileStat = await stat(filePath);
      const inspected = await inspectGgufArtifact(filePath);
      const fileStatAfter = await stat(filePath);
      if (fileStat.size !== fileStatAfter.size || fileStat.mtimeMs !== fileStatAfter.mtimeMs) {
        throw new Error('Model artifact changed while it was being hashed.');
      }
      const fileName = path.basename(filePath);
      models.push({
        artifact_id: `${root.id}:sha256:${inspected.sha256}`,
        relative_path: publishedRelativePath,
        file_name: sanitizePathComponent(fileName),
        size_bytes: fileStat.size,
        modified_at: fileStat.mtime.toISOString(),
        sha256: inspected.sha256,
        gguf: inspected.gguf,
        quantization_from_filename: inferQuantization(fileName),
        shard: shardIdentity(fileName),
        lm_studio_identity: root.kind === 'lm_studio' ? lmStudioIdentity(relativePath) : null,
      });
    } catch (error) {
      errors.push({
        operation: 'inspect-model',
        path: publishedRelativePath,
        error: safeError(error, [rootPath, filePath]),
      });
    }
  }

  const summary = {
    gguf_file_count: models.length,
    valid_gguf_header_count: models.filter((item) => item.gguf.valid).length,
    invalid_gguf_header_count: models.filter((item) => !item.gguf.valid).length,
    total_bytes: models.reduce((sum, item) => sum + item.size_bytes, 0),
    hashed_file_count: models.filter((item) => item.sha256).length,
    ignored_entry_count: discovery.ignored.length,
    error_count: errors.length,
  };
  return {
    ...base,
    status: errors.length > 0 || summary.invalid_gguf_header_count > 0 ? 'partial' : 'present',
    summary,
    models,
    ignored_entries: discovery.ignored,
    errors,
  };
}

export async function inventoryRoots(roots, options = {}) {
  if (!Array.isArray(roots) || roots.length === 0) throw new Error('At least one model root is required.');
  const ids = new Set();
  for (const root of roots) {
    validateRoot(root);
    if (ids.has(root.id)) throw new Error(`Duplicate root id: ${root.id}`);
    ids.add(root.id);
  }

  const inventories = [];
  for (const root of roots) inventories.push(await inventoryRoot(root));
  const evidencePayload = { roots: inventories };
  return {
    schema_version: 'model-inventory/1.0',
    generated_at: options.generatedAt ?? new Date().toISOString(),
    generator: 'scripts/inventory-models.mjs',
    hash_algorithm: 'sha256',
    privacy: {
      absolute_root_paths_persisted: false,
      symbolic_links_followed: false,
      recognized_secret_patterns_redacted: true,
      application_databases_read: false,
    },
    inventory_sha256: sha256Text(JSON.stringify(evidencePayload)),
    summary: {
      root_count: inventories.length,
      gguf_file_count: inventories.reduce((sum, item) => sum + item.summary.gguf_file_count, 0),
      valid_gguf_header_count: inventories.reduce((sum, item) => sum + (item.summary.valid_gguf_header_count ?? 0), 0),
      invalid_gguf_header_count: inventories.reduce((sum, item) => sum + (item.summary.invalid_gguf_header_count ?? 0), 0),
      total_bytes: inventories.reduce((sum, item) => sum + item.summary.total_bytes, 0),
      hashed_file_count: inventories.reduce((sum, item) => sum + item.summary.hashed_file_count, 0),
      error_count: inventories.reduce((sum, item) => sum + item.summary.error_count, 0),
    },
    roots: inventories,
  };
}
