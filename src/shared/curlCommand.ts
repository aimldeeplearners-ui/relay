import type { ApiRequestInput, FormDataEntry, KeyValue } from './api';

export interface CurlFormDataFile {
  filePath: string;
}

const variablePattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

function interpolate(value: string, environment: Record<string, string>): string {
  return value.replace(variablePattern, (placeholder, key: string) =>
    Object.hasOwn(environment, key) ? environment[key] : placeholder,
  );
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function enabledEntries(entries: KeyValue[] | undefined, environment: Record<string, string>): [string, string][] {
  return (entries ?? [])
    .filter((entry) => entry.enabled !== false && entry.key.trim())
    .map((entry) => [interpolate(entry.key, environment), interpolate(entry.value, environment)]);
}

function setHeader(headers: Map<string, { name: string; value: string }>, name: string, value: string): void {
  headers.set(name.toLowerCase(), { name, value });
}

export function buildCurlCommand(
  input: ApiRequestInput,
  oauth2AccessToken?: string,
  selectedFiles: ReadonlyMap<string, CurlFormDataFile> = new Map(),
): string {
  const { request, environment } = input;
  const url = new URL(interpolate(request.url, environment));
  for (const [key, value] of enabledEntries(request.queryParams, environment)) url.searchParams.append(key, value);

  const headers = new Map<string, { name: string; value: string }>();
  for (const [name, value] of enabledEntries(request.headers, environment)) setHeader(headers, name, value);

  const auth = request.auth;
  if (auth?.type === 'bearer' && auth.bearer?.token) {
    setHeader(headers, 'Authorization', `Bearer ${interpolate(auth.bearer.token, environment)}`);
  } else if (auth?.type === 'oauth2' && auth.oauth2) {
    if (!oauth2AccessToken) throw new Error('OAuth2 token is unavailable for this cURL command.');
    setHeader(headers, 'Authorization', `Bearer ${oauth2AccessToken}`);
  } else if (auth?.type === 'basic' && auth.basic) {
    const username = interpolate(auth.basic.username, environment);
    const password = interpolate(auth.basic.password, environment);
    setHeader(headers, 'Authorization', `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
  } else if (auth?.type === 'apikey' && auth.apikey) {
    const key = interpolate(auth.apikey.key, environment);
    const value = interpolate(auth.apikey.value, environment);
    if (auth.apikey.in === 'query') url.searchParams.append(key, value);
    else setHeader(headers, key, value);
  }

  const body = request.body;
  const bodyMode = body?.mode ?? 'none';
  const isFormData = bodyMode === 'formdata';
  if (bodyMode === 'json' && !headers.has('content-type')) setHeader(headers, 'Content-Type', 'application/json');
  if (bodyMode === 'xml') setHeader(headers, 'Content-Type', 'text/xml; charset=utf-8');
  if (bodyMode === 'urlencoded' && !headers.has('content-type')) setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');

  const command = [
    'curl.exe',
    '--location',
    '--max-time',
    '30',
    '--request',
    quotePowerShell(request.method),
    '--url',
    quotePowerShell(url.toString()),
  ];

  for (const [name, header] of headers) {
    if (isFormData && name === 'content-type' && header.value.toLowerCase().startsWith('multipart/form-data')) continue;
    command.push('--header', quotePowerShell(`${header.name}: ${header.value}`));
  }

  if (!['GET', 'HEAD'].includes(request.method)) {
    if (bodyMode === 'formdata') {
      for (const entry of (body?.formdata ?? []) as FormDataEntry[]) {
        if (entry.enabled === false || !entry.key.trim()) continue;
        const key = interpolate(entry.key, environment);
        if (entry.type === 'file') {
          const selectedFile = entry.fileToken ? selectedFiles.get(entry.fileToken) : undefined;
          if (!selectedFile) throw new Error('Choose a file for each enabled form-data file field before creating a cURL command.');
          command.push('--form', quotePowerShell(`${key}=@${selectedFile.filePath}`));
        } else {
          command.push('--form-string', quotePowerShell(`${key}=${interpolate(entry.value, environment)}`));
        }
      }
    } else if (bodyMode === 'urlencoded') {
      const parameters = new URLSearchParams();
      for (const [key, value] of enabledEntries(body?.urlencoded, environment)) parameters.append(key, value);
      command.push('--data-raw', quotePowerShell(parameters.toString()));
    } else if (bodyMode !== 'none') {
      command.push('--data-raw', quotePowerShell(interpolate(body?.raw ?? '', environment)));
    }
  }

  return command.join(' ');
}