function pointerValue(root, reference) {
  if (!reference.startsWith('#/')) throw new Error(`Only local JSON pointers are supported: ${reference}`);
  return reference.slice(2).split('/').reduce((value, part) => {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    return value?.[key];
  }, root);
}

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function valueKey(value) {
  if (value === null || typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(valueKey).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${valueKey(value[key])}`).join(',')}}`;
}

function validDateTime(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validUri(value) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol);
  } catch {
    return false;
  }
}

/**
 * Validate the JSON Schema Draft 2020-12 keywords used by this repository's
 * routing manifest contract. It intentionally rejects unsupported external
 * references instead of resolving or downloading them.
 */
export function validateJsonSchema(instance, schema, options = {}) {
  const rootSchema = options.rootSchema ?? schema;
  const errors = [];

  function visit(value, rule, instancePath, schemaPath) {
    if (rule === true) return;
    if (rule === false) {
      errors.push({ instancePath, schemaPath, message: 'is forbidden by the schema' });
      return;
    }
    if (!rule || typeof rule !== 'object') return;

    if (rule.$ref) {
      const target = pointerValue(rootSchema, rule.$ref);
      if (!target) {
        errors.push({ instancePath, schemaPath: `${schemaPath}/$ref`, message: `unresolved reference ${rule.$ref}` });
        return;
      }
      visit(value, target, instancePath, rule.$ref);
    }

    if (rule.const !== undefined && !Object.is(value, rule.const)) {
      errors.push({ instancePath, schemaPath: `${schemaPath}/const`, message: `must equal ${JSON.stringify(rule.const)}` });
    }
    if (rule.enum && !rule.enum.some((item) => Object.is(item, value))) {
      errors.push({ instancePath, schemaPath: `${schemaPath}/enum`, message: 'must equal an allowed value' });
    }
    if (rule.type) {
      const accepted = Array.isArray(rule.type) ? rule.type : [rule.type];
      if (!accepted.some((type) => typeMatches(value, type))) {
        errors.push({ instancePath, schemaPath: `${schemaPath}/type`, message: `must be ${accepted.join(' or ')}` });
        return;
      }
    }

    if (rule.allOf) {
      rule.allOf.forEach((child, index) => visit(value, child, instancePath, `${schemaPath}/allOf/${index}`));
    }
    if (rule.oneOf) {
      let matches = 0;
      for (const child of rule.oneOf) {
        const before = errors.length;
        visit(value, child, instancePath, `${schemaPath}/oneOf`);
        if (errors.length === before) matches += 1;
        else errors.splice(before);
      }
      if (matches !== 1) errors.push({ instancePath, schemaPath: `${schemaPath}/oneOf`, message: `must match exactly one branch (matched ${matches})` });
    }
    if (rule.if) {
      const before = errors.length;
      visit(value, rule.if, instancePath, `${schemaPath}/if`);
      const matched = errors.length === before;
      errors.splice(before);
      if (matched && rule.then) visit(value, rule.then, instancePath, `${schemaPath}/then`);
      if (!matched && rule.else) visit(value, rule.else, instancePath, `${schemaPath}/else`);
    }

    if (typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) errors.push({ instancePath, schemaPath: `${schemaPath}/minLength`, message: `must have at least ${rule.minLength} characters` });
      if (rule.maxLength !== undefined && value.length > rule.maxLength) errors.push({ instancePath, schemaPath: `${schemaPath}/maxLength`, message: `must have at most ${rule.maxLength} characters` });
      if (rule.pattern !== undefined && !(new RegExp(rule.pattern).test(value))) errors.push({ instancePath, schemaPath: `${schemaPath}/pattern`, message: `must match ${rule.pattern}` });
      if (rule.format === 'date-time' && !validDateTime(value)) errors.push({ instancePath, schemaPath: `${schemaPath}/format`, message: 'must be an RFC 3339 date-time' });
      if (rule.format === 'uri' && !validUri(value)) errors.push({ instancePath, schemaPath: `${schemaPath}/format`, message: 'must be an absolute URI' });
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      if (rule.minimum !== undefined && value < rule.minimum) errors.push({ instancePath, schemaPath: `${schemaPath}/minimum`, message: `must be >= ${rule.minimum}` });
      if (rule.maximum !== undefined && value > rule.maximum) errors.push({ instancePath, schemaPath: `${schemaPath}/maximum`, message: `must be <= ${rule.maximum}` });
      if (rule.exclusiveMinimum !== undefined && value <= rule.exclusiveMinimum) errors.push({ instancePath, schemaPath: `${schemaPath}/exclusiveMinimum`, message: `must be > ${rule.exclusiveMinimum}` });
      if (rule.exclusiveMaximum !== undefined && value >= rule.exclusiveMaximum) errors.push({ instancePath, schemaPath: `${schemaPath}/exclusiveMaximum`, message: `must be < ${rule.exclusiveMaximum}` });
    }

    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems) errors.push({ instancePath, schemaPath: `${schemaPath}/minItems`, message: `must contain at least ${rule.minItems} items` });
      if (rule.maxItems !== undefined && value.length > rule.maxItems) errors.push({ instancePath, schemaPath: `${schemaPath}/maxItems`, message: `must contain at most ${rule.maxItems} items` });
      if (rule.uniqueItems) {
        const keys = value.map(valueKey);
        if (new Set(keys).size !== keys.length) errors.push({ instancePath, schemaPath: `${schemaPath}/uniqueItems`, message: 'must contain unique items' });
      }
      if (rule.items) value.forEach((item, index) => visit(item, rule.items, `${instancePath}/${index}`, `${schemaPath}/items`));
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (rule.minProperties !== undefined && keys.length < rule.minProperties) errors.push({ instancePath, schemaPath: `${schemaPath}/minProperties`, message: `must contain at least ${rule.minProperties} properties` });
      for (const required of rule.required ?? []) {
        if (!Object.hasOwn(value, required)) errors.push({ instancePath, schemaPath: `${schemaPath}/required`, message: `must contain property ${required}` });
      }
      for (const [key, child] of Object.entries(rule.properties ?? {})) {
        if (Object.hasOwn(value, key)) visit(value[key], child, `${instancePath}/${key}`, `${schemaPath}/properties/${key}`);
      }
      if (rule.additionalProperties === false) {
        const allowed = new Set(Object.keys(rule.properties ?? {}));
        for (const key of keys) {
          if (!allowed.has(key)) errors.push({ instancePath: `${instancePath}/${key}`, schemaPath: `${schemaPath}/additionalProperties`, message: 'additional property is not allowed' });
        }
      }
    }
  }

  visit(instance, schema, '', '#');
  return { valid: errors.length === 0, errors };
}
