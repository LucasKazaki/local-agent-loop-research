function normalize(value) {
  return String(value ?? '').trim();
}

function embeddedJsonValues(text) {
  const values = [];

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;

    const closing = [text[start] === '{' ? '}' : ']'];
    let inString = false;
    let escaped = false;
    let invalid = false;

    for (let index = start + 1; index < text.length; index += 1) {
      const character = text[index];

      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        closing.push('}');
      } else if (character === '[') {
        closing.push(']');
      } else if (character === '}' || character === ']') {
        if (closing.at(-1) !== character) {
          invalid = true;
          break;
        }
        closing.pop();
        if (closing.length === 0) {
          const candidate = text.slice(start, index + 1);
          try {
            values.push(JSON.parse(candidate));
            start = index;
          } catch {
            invalid = true;
          }
          break;
        }
      }
    }

    if (invalid) continue;
  }

  return values;
}

export function parseJson(text) {
  const value = normalize(text);
  if (!value) return null;

  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  for (const candidate of [value, fenced]) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // A model may wrap an otherwise valid JSON value in short prose.
    }
  }

  const recovered = embeddedJsonValues(value);
  return recovered.length === 1 ? recovered[0] : null;
}

export function isStrictJsonObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

export function parseJsonObject(text) {
  const value = parseJson(text);
  return isStrictJsonObject(value) ? value : null;
}
