export interface ResponseExtractionRule {
  name: string;
  jsonPointer: string;
}

export interface ResponseExtractionOutcome {
  name: string;
  jsonPointer: string;
  passed: boolean;
}

export interface ResponseExtractionResult {
  variables: Record<string, string>;
  outcomes: ResponseExtractionOutcome[];
}

function decodePointerToken(token: string): string | undefined {
  if (/~(?![01])/.test(token)) return undefined;
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveJsonPointer(document: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === '') return { found: true, value: document };
  if (!pointer.startsWith('/')) return { found: false };

  let value: unknown = document;
  for (const encodedToken of pointer.slice(1).split('/')) {
    const token = decodePointerToken(encodedToken);
    if (token === undefined || value === null || typeof value !== 'object') return { found: false };

    if (Array.isArray(value)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return { found: false };
      const index = Number(token);
      if (index >= value.length) return { found: false };
      value = value[index];
    } else {
      if (!Object.hasOwn(value, token)) return { found: false };
      value = (value as Record<string, unknown>)[token];
    }
  }

  return { found: true, value };
}

export function countJsonArrayAtPointer(body: string, pointer: string): number | null {
  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return null;
  }

  const result = resolveJsonPointer(document, pointer);
  return result.found && Array.isArray(result.value) ? result.value.length : null;
}

function toRunVariable(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function extractResponseVariables(body: string, rules: ResponseExtractionRule[]): ResponseExtractionResult {
  if (rules.length === 0) return { variables: {}, outcomes: [] };

  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return {
      variables: {},
      outcomes: rules.map(({ name, jsonPointer }) => ({ name, jsonPointer, passed: false })),
    };
  }

  const variables: Record<string, string> = {};
  const outcomes = rules.map(({ name, jsonPointer }) => {
    if (!name.trim()) return { name, jsonPointer, passed: false };
    const result = resolveJsonPointer(document, jsonPointer);
    if (!result.found) return { name, jsonPointer, passed: false };
    variables[name] = toRunVariable(result.value);
    return { name, jsonPointer, passed: true };
  });

  return { variables, outcomes };
}
