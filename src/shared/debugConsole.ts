import type { ApiResponse, HttpMethod, RequestDefinition } from './api';

export const MAX_DEBUG_CONSOLE_ENTRIES = 500;

export type DebugConsoleSource = 'Send' | 'Collection run';

export interface DebugConsoleHeader {
  name: string;
  value: string;
}

export interface DebugConsoleEntry {
  id: string;
  timestamp: string;
  source: DebugConsoleSource;
  requestName: string;
  context?: string;
  method: HttpMethod;
  url: string;
  bodyMode: string;
  requestHeaders: DebugConsoleHeader[];
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  responseHeaders: DebugConsoleHeader[];
  error?: string;
}

interface DebugConsoleInput {
  source: DebugConsoleSource;
  requestName: string;
  context?: string;
  request: RequestDefinition;
  environment: Record<string, string>;
  response: ApiResponse;
  sensitiveValues?: string[];
  timestamp?: string;
}

const variablePattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
const sensitiveNamePattern = /authorization|cookie|token|password|passwd|secret|credential|api[-_]?key|private[-_]?key|signature/i;
const sensitiveParameterPattern = /(?:^|[_-])(authorization|cookie|token|password|passwd|secret|credential|api[-_]?key|private[-_]?key|signature)(?:$|[_-])/i;

function interpolate(value: string, environment: Record<string, string>, sensitiveValues: string[] = []): string {
  return value.replace(variablePattern, (placeholder, key: string) =>
    isSensitiveParameter(key.trim())
      ? '[REDACTED]'
      : Object.hasOwn(environment, key.trim())
        ? redactText(environment[key.trim()], sensitiveValues)
        : placeholder,
  );
}

function redactText(value: string, sensitiveValues: string[] = []): string {
  let redacted = value
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
    .replace(/([?&](?:[^=&#]*(?:token|password|secret|credential|authorization|api[_-]?key|signature)[^=&#]*)=)(?!%5BREDACTED%5D|\[REDACTED\])[^&#\s]*/gi, '$1[REDACTED]');
  const encodedValues = new Set<string>();
  for (const secret of sensitiveValues) {
    if (!secret) continue;
    encodedValues.add(secret);
    try {
      encodedValues.add(encodeURIComponent(secret));
      encodedValues.add(encodeURI(secret));
    } catch {
      // Keep the literal secret redaction if it isn't URI-encodable.
    }
  }
  for (const secret of [...encodedValues].sort((left, right) => right.length - left.length)) {
    redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}

function isSensitiveParameter(name: string): boolean {
  return sensitiveNamePattern.test(name) || sensitiveParameterPattern.test(name);
}

function referencesSensitiveVariable(value: string): boolean {
  return [...value.matchAll(variablePattern)].some(([, key]) => isSensitiveParameter(key.trim()));
}

function resolvedUrl(request: RequestDefinition, environment: Record<string, string>, sensitiveValues: string[]): string {
  const url = new URL(interpolate(request.url, environment, sensitiveValues));
  for (const entry of request.queryParams ?? []) {
    if (entry.enabled !== false && entry.key.trim()) {
      const value = entry.secret || isSensitiveParameter(entry.key)
        ? '[REDACTED]'
        : interpolate(entry.value, environment, sensitiveValues);
      url.searchParams.append(interpolate(entry.key, environment, sensitiveValues), value);
    }
  }
  if (request.auth?.type === 'apikey' && request.auth.apikey?.in === 'query') {
    url.searchParams.append(interpolate(request.auth.apikey.key, environment, sensitiveValues), '[REDACTED]');
  }

  url.username = '';
  url.password = '';
  const query = [...url.searchParams.entries()];
  url.search = '';
  for (const [key, value] of query) url.searchParams.append(key, isSensitiveParameter(key) ? '[REDACTED]' : value);
  return redactText(url.toString(), sensitiveValues);
}

function requestHeaders(request: RequestDefinition, environment: Record<string, string>, sensitiveValues: string[]): DebugConsoleHeader[] {
  const headers = (request.headers ?? [])
    .filter((header) => header.enabled !== false && header.key.trim())
    .map(({ key, value, secret }) => ({
      name: interpolate(key, environment, sensitiveValues),
      value: secret || isSensitiveParameter(key) || referencesSensitiveVariable(value)
        ? '[REDACTED]'
        : redactText(interpolate(value, environment, sensitiveValues), sensitiveValues),
    }));
  const auth = request.auth;
  if (auth?.type === 'bearer' || auth?.type === 'basic' || auth?.type === 'oauth2') {
    headers.push({ name: 'Authorization', value: '[REDACTED]' });
  } else if (auth?.type === 'apikey' && auth.apikey?.in === 'header') {
    const name = interpolate(auth.apikey.key, environment);
    headers.push({ name, value: '[REDACTED]' });
  }
  return headers;
}

function responseHeaders(headers: Record<string, string>): DebugConsoleHeader[] {
  return Object.entries(headers).map(([name, value]) => ({
    name,
    value: isSensitiveParameter(name) ? '[REDACTED]' : redactText(value),
  }));
}

export function createDebugConsoleEntry(input: DebugConsoleInput): DebugConsoleEntry {
  const sensitiveValues = input.sensitiveValues ?? [];
  let url: string;
  try {
    url = resolvedUrl(input.request, input.environment, sensitiveValues);
  } catch {
    url = redactText(interpolate(input.request.url, input.environment, sensitiveValues), sensitiveValues);
  }

  return {
    id: globalThis.crypto.randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    source: input.source,
    requestName: input.requestName,
    ...(input.context ? { context: input.context } : {}),
    method: input.request.method,
    url,
    bodyMode: input.request.body?.mode ?? 'none',
    requestHeaders: requestHeaders(input.request, input.environment, sensitiveValues),
    status: input.response.status,
    statusText: input.response.statusText,
    durationMs: input.response.durationMs,
    sizeBytes: input.response.sizeBytes,
    responseHeaders: responseHeaders(input.response.headers).map((header) => ({ ...header, value: redactText(header.value, sensitiveValues) })),
    ...(input.response.error ? { error: redactText(input.response.error, sensitiveValues) } : {}),
  };
}