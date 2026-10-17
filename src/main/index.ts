import { app, BrowserWindow, clipboard, dialog, ipcMain, net, safeStorage, type OpenDialogOptions } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import collectionSchema from '../../spec/rest-soap-spec.json';
import { partitionCollectionSecrets, redactCollectionSecrets, restoreCollectionSecrets } from '../shared/credentialProtection';
import type { ApiRequestInput, ApiResponse, AssertionResult, CollectionDocument, CollectionImportResult, CollectionRunReport, KeyValue, RunReportFormat } from '../shared/api';
import { serializeRunReportCsv, serializeRunReportHtml } from '../shared/runReportFormats';
import { buildOAuth2PasswordGrantRequest, parseOAuth2PasswordGrantResponse } from '../shared/oauth2PasswordGrant';
import { buildCurlCommand } from '../shared/curlCommand';
import { evaluateJsonPointerAssertions, evaluateResponseHeaderAssertions, evaluateResponseTimeAssertion } from '../shared/responseAssertions';
import { importOpenApiFile } from './openApiImport';

const validateCollection = new Ajv({ allErrors: true }).compile(collectionSchema);

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const protectedCollectionFormat = 'relay-protected-collection';
const oauthTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

interface ProtectedCollectionFile {
  format: typeof protectedCollectionFormat;
  version: 1;
  collection: CollectionDocument;
  encryptedSecrets: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasSecureStorage(): boolean {
  return safeStorage.isEncryptionAvailable()
    && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');
}

function createStoredCollection(collection: CollectionDocument): CollectionDocument | ProtectedCollectionFile {
  const { collection: protectedCollection, secrets } = partitionCollectionSecrets(collection);
  if (!Object.keys(secrets).length) return protectedCollection;
  if (!hasSecureStorage()) {
    throw new Error('OS-protected credential storage is unavailable. Secrets were not saved.');
  }
  return {
    format: protectedCollectionFormat,
    version: 1,
    collection: protectedCollection,
    encryptedSecrets: safeStorage.encryptString(JSON.stringify(secrets)).toString('base64'),
  };
}

async function loadStoredCollection(value: unknown, storagePath: string): Promise<CollectionDocument> {
  if (!isRecord(value) || value.format !== protectedCollectionFormat) {
    if (!validateCollection(value)) throw new Error('Saved collection does not match RestSoapSpecEnterprise v2.0.');
    const collection = value as unknown as CollectionDocument;
    const parts = partitionCollectionSecrets(collection);
    if (!Object.keys(parts.secrets).length) return parts.collection;
    if (!hasSecureStorage()) {
      throw new Error('This collection contains plaintext credentials, but OS-protected credential storage is unavailable. The file was left unchanged.');
    }
    await writeJsonAtomically(storagePath, createStoredCollection(collection));
    return restoreCollectionSecrets(parts.collection, parts.secrets);
  }

  if (value.version !== 1 || typeof value.encryptedSecrets !== 'string' || !validateCollection(value.collection)) {
    throw new Error('Protected collection file is invalid or uses an unsupported version.');
  }
  if (!hasSecureStorage()) throw new Error('OS-protected credential storage is unavailable; this collection cannot be unlocked.');

  const parsedSecrets: unknown = JSON.parse(safeStorage.decryptString(Buffer.from(value.encryptedSecrets, 'base64')));
  if (!isRecord(parsedSecrets) || Object.values(parsedSecrets).some((secret) => typeof secret !== 'string')) {
    throw new Error('Protected collection contains invalid credential data.');
  }
  return restoreCollectionSecrets(value.collection as unknown as CollectionDocument, parsedSecrets as Record<string, string>);
}

function defaultCollectionPath(): string {
  return join(app.getPath('userData'), 'collection.json');
}

async function getCollectionStoragePath(): Promise<string> {
  const settingsPath = join(app.getPath('userData'), 'settings.json');
  try {
    const settings: unknown = JSON.parse(await readFile(settingsPath, 'utf8'));
    if (typeof settings === 'object' && settings !== null && 'collectionPath' in settings
      && typeof settings.collectionPath === 'string' && isAbsolute(settings.collectionPath)) {
      return settings.collectionPath;
    }
    return defaultCollectionPath();
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return defaultCollectionPath();
    throw error;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

async function writeTextAtomically(filePath: string, value: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, value, 'utf8');
  await rename(temporaryPath, filePath);
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: '#f3f5f2',
    title: 'Relay | REST & SOAP workspace',
    webPreferences: {
      preload: join(currentDirectory, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(currentDirectory, '../renderer/index.html'));
  }
}

function interpolate(value: string, environment: Record<string, string>): string {
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (placeholder, key: string) =>
    Object.hasOwn(environment, key) ? environment[key] : placeholder,
  );
}

async function getPasswordGrantAccessToken(
  config: NonNullable<NonNullable<ApiRequestInput['request']['auth']>['oauth2']>,
  environment: Record<string, string>,
): Promise<string> {
  const grantRequest = buildOAuth2PasswordGrantRequest(config, environment);
  const cacheKey = createHash('sha256').update(grantRequest.cacheKeyMaterial).digest('hex');
  const cached = oauthTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken;

  const response = await net.fetch(grantRequest.tokenUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: grantRequest.body,
    signal: AbortSignal.timeout(30_000),
  });
  const token = parseOAuth2PasswordGrantResponse(response.status, await response.text());
  if (token.expiresInSeconds) {
    oauthTokenCache.set(cacheKey, { accessToken: token.accessToken, expiresAt: Date.now() + token.expiresInSeconds * 1000 });
  }
  return token.accessToken;
}

function enabledEntries(entries: KeyValue[] | undefined, environment: Record<string, string>): [string, string][] {
  return (entries ?? [])
    .filter((entry) => entry.enabled !== false && entry.key.trim())
    .map((entry) => [interpolate(entry.key, environment), interpolate(entry.value, environment)]);
}

function buildBody(input: ApiRequestInput): { body?: BodyInit; contentType?: string } {
  const body = input.request.body;
  if (!body || body.mode === 'none') return {};

  if (body.mode === 'urlencoded') {
    const params = new URLSearchParams();
    for (const [key, value] of enabledEntries(body.urlencoded, input.environment)) params.append(key, value);
    return { body: params, contentType: 'application/x-www-form-urlencoded' };
  }

  if (body.mode === 'formdata') {
    const formData = new FormData();
    for (const [key, value] of enabledEntries(body.formdata, input.environment)) formData.append(key, value);
    return { body: formData };
  }

  const raw = interpolate(body.raw ?? '', input.environment);
  const contentType = body.mode === 'json'
    ? 'application/json'
    : body.mode === 'xml'
      ? 'text/xml; charset=utf-8'
      : undefined;
  return { body: raw, contentType };
}

function runAssertions(input: ApiRequestInput, status: number, responseBody: string, responseHeaders: Record<string, string>, durationMs: number): AssertionResult[] {
  const assertions = input.request.assertions;
  if (!assertions) return [];

  const results: AssertionResult[] = [];
  if (assertions.expectedStatusCode !== undefined) {
    results.push({
      label: `Status is ${assertions.expectedStatusCode}`,
      passed: status === assertions.expectedStatusCode,
      detail: `Received ${status}`,
    });
  }
  if (assertions.maxResponseTimeMs !== undefined) {
    results.push(evaluateResponseTimeAssertion(durationMs, assertions.maxResponseTimeMs));
  }

  results.push(...evaluateJsonPointerAssertions(responseBody, assertions.jsonPointerAssertions ?? []));
  results.push(...evaluateResponseHeaderAssertions(responseHeaders, assertions.responseHeaderAssertions ?? []));

  if (assertions.jsonSchema) {
    try {
      const parsedBody: unknown = JSON.parse(responseBody);
      const validator = new Ajv({ allErrors: true });
      const valid = validator.validate(assertions.jsonSchema, parsedBody);
      results.push({
        label: 'JSON schema is valid',
        passed: Boolean(valid),
        detail: valid ? undefined : validator.errorsText(),
      });
    } catch (error) {
      results.push({ label: 'JSON schema is valid', passed: false, detail: error instanceof Error ? error.message : 'Invalid JSON response' });
    }
  }

  if (assertions.xpathMatches?.length) {
    try {
      const document = new DOMParser({ errorHandler: {
        error: () => { throw new Error('Invalid XML response'); },
        fatalError: () => { throw new Error('Invalid XML response'); },
      } })
        .parseFromString(responseBody, 'text/xml');
      for (const assertion of assertions.xpathMatches) {
        const node = xpath.select1(assertion.xpath, document);
        const actualValue = node && typeof node === 'object' && 'textContent' in node ? String(node.textContent ?? '') : String(node ?? '');
        const passed = node !== undefined && (assertion.expectedValue === undefined || actualValue === assertion.expectedValue);
        results.push({
          label: assertion.expectedValue === undefined ? `XPath exists: ${assertion.xpath}` : `XPath matches: ${assertion.xpath}`,
          passed,
          detail: node === undefined ? 'No matching node' : `Received ${actualValue}`,
        });
      }
    } catch (error) {
      results.push({ label: 'XPath assertions', passed: false, detail: error instanceof Error ? error.message : 'Unable to parse XML response' });
    }
  }

  return results;
}

async function executeRequest(input: ApiRequestInput): Promise<ApiResponse> {
  const startedAt = performance.now();
  try {
    const url = new URL(interpolate(input.request.url, input.environment));
    for (const [key, value] of enabledEntries(input.request.queryParams, input.environment)) {
      url.searchParams.append(key, value);
    }

    const headers = new Headers();
    for (const [key, value] of enabledEntries(input.request.headers, input.environment)) headers.set(key, value);

    const auth = input.request.auth;
    if (auth?.type === 'bearer' && auth.bearer?.token) {
      headers.set('authorization', `Bearer ${interpolate(auth.bearer.token, input.environment)}`);
    } else if (auth?.type === 'oauth2' && auth.oauth2) {
      const token = await getPasswordGrantAccessToken(auth.oauth2, input.environment);
      headers.set('authorization', `Bearer ${token}`);
    } else if (auth?.type === 'basic' && auth.basic) {
      const username = interpolate(auth.basic.username, input.environment);
      const password = interpolate(auth.basic.password, input.environment);
      headers.set('authorization', `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
    } else if (auth?.type === 'apikey' && auth.apikey) {
      const key = interpolate(auth.apikey.key, input.environment);
      const value = interpolate(auth.apikey.value, input.environment);
      if (auth.apikey.in === 'query') url.searchParams.append(key, value);
      else headers.set(key, value);
    }

    const requestBody = buildBody(input);
    if (requestBody.contentType && !headers.has('content-type')) headers.set('content-type', requestBody.contentType);
    if (input.request.body?.mode === 'xml') headers.set('content-type', 'text/xml; charset=utf-8');

    const response = await net.fetch(url.toString(), {
      method: input.request.method,
      headers,
      body: ['GET', 'HEAD'].includes(input.request.method) ? undefined : requestBody.body,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const durationMs = Math.round(performance.now() - startedAt);
    const tests = runAssertions(input, response.status, body, responseHeaders, durationMs);

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body,
      durationMs,
      sizeBytes: new TextEncoder().encode(body).byteLength,
      tests,
    };
  } catch (error) {
    return {
      status: 0,
      statusText: 'Request failed',
      headers: {},
      body: '',
      durationMs: Math.round(performance.now() - startedAt),
      sizeBytes: 0,
      tests: [],
      error: error instanceof Error ? error.message : 'An unexpected network error occurred',
    };
  }
}

ipcMain.handle('api:execute', (_event, input: ApiRequestInput) => executeRequest(input));
ipcMain.handle('request:copy-curl', async (event, input: ApiRequestInput) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const confirmation = {
    type: 'warning' as const,
    title: 'Copy cURL command',
    message: 'The cURL command may contain credentials or sensitive request data.',
    detail: 'Anyone with access to your clipboard may be able to read it. Copy the command only to a trusted destination.',
    buttons: ['Copy command', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const choice = owner
    ? await dialog.showMessageBox(owner, confirmation)
    : await dialog.showMessageBox(confirmation);
  if (choice.response !== 0) return { canceled: true };

  try {
    const oauth2 = input.request.auth?.type === 'oauth2' ? input.request.auth.oauth2 : undefined;
    const accessToken = oauth2 ? await getPasswordGrantAccessToken(oauth2, input.environment) : undefined;
    clipboard.writeText(buildCurlCommand(input, accessToken));
    return { copied: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to create the cURL command' };
  }
});
ipcMain.handle('collection:load', async () => {
  try {
    const storagePath = await getCollectionStoragePath();
    const content = await readFile(storagePath, 'utf8');
    const parsed: unknown = JSON.parse(content);
    const collection = await loadStoredCollection(parsed, storagePath);
    return { collection, path: storagePath };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      try {
        return { path: await getCollectionStoragePath() };
      } catch (pathError) {
        return { error: pathError instanceof Error ? pathError.message : 'Unable to read the collection location' };
      }
    }
    return { error: error instanceof Error ? error.message : 'Unable to load the saved collection' };
  }
});
ipcMain.handle('collection:save', async (_event, collection: CollectionDocument) => {
  if (!validateCollection(collection)) {
    const validationErrors = validateCollection.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    return { saved: false, error: `Collection is invalid: ${validationErrors ?? 'schema validation failed'}` };
  }

  try {
    const storagePath = await getCollectionStoragePath();
    await writeJsonAtomically(storagePath, createStoredCollection(collection));
    return { saved: true, path: storagePath };
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error.message : 'Unable to save the collection' };
  }
});
ipcMain.handle('collection:choose-location', async (event, collection: CollectionDocument) => {
  if (!validateCollection(collection)) {
    const validationErrors = validateCollection.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    return { error: `Collection is invalid: ${validationErrors ?? 'schema validation failed'}` };
  }

  try {
    const currentPath = await getCollectionStoragePath();
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Choose where to save the Relay collection',
      defaultPath: currentPath,
      buttonLabel: 'Save collection here',
      filters: [{ name: 'Relay collection', extensions: ['json'] }],
    };
    const selection = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { canceled: true };

    const storagePath = extname(selection.filePath).toLowerCase() === '.json'
      ? selection.filePath
      : `${selection.filePath}.json`;
    const settingsPath = join(app.getPath('userData'), 'settings.json');
    await writeJsonAtomically(storagePath, createStoredCollection(collection));
    await writeJsonAtomically(settingsPath, { collectionPath: storagePath });
    return { path: storagePath };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to change the collection save location' };
  }
});
ipcMain.handle('collection:export', async (event, collection: CollectionDocument, includeSecrets = false) => {
  if (!validateCollection(collection)) {
    const validationErrors = validateCollection.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
    return { error: `Collection is invalid: ${validationErrors ?? 'schema validation failed'}` };
  }

  try {
    const currentPath = await getCollectionStoragePath();
    const safeName = collection.info.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Relay collection';
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Export a copy of the Relay collection',
      defaultPath: join(dirname(currentPath), `${safeName}-export.json`),
      buttonLabel: 'Export copy',
      filters: [{ name: 'Relay collection', extensions: ['json'] }],
    };
    const selection = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { canceled: true };

    const exportPath = extname(selection.filePath).toLowerCase() === '.json'
      ? selection.filePath
      : `${selection.filePath}.json`;
    const resolvedExportPath = resolve(exportPath);
    const resolvedCurrentPath = resolve(currentPath);
    const isSamePath = process.platform === 'win32'
      ? resolvedExportPath.toLowerCase() === resolvedCurrentPath.toLowerCase()
      : resolvedExportPath === resolvedCurrentPath;
    if (isSamePath) return { error: 'Choose a different file from the active autosave collection to export a copy.' };

    await writeJsonAtomically(exportPath, includeSecrets ? collection : redactCollectionSecrets(collection));
    return { exported: true, path: exportPath };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to export the collection' };
  }
});
ipcMain.handle('report:export', async (event, report: CollectionRunReport, requestedFormat: RunReportFormat = 'json') => {
  try {
    const currentPath = await getCollectionStoragePath();
    const safeName = report.collectionName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim() || 'Relay';
    const timestamp = report.startedAt.replace(/[:.]/g, '-');
    const format: RunReportFormat = ['json', 'csv', 'html'].includes(requestedFormat) ? requestedFormat : 'json';
    const extension = format === 'html' ? 'html' : format;
    const formatLabel = format === 'html' ? 'HTML report' : format === 'csv' ? 'CSV report (Excel compatible)' : 'JSON report';
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Export collection run report',
      defaultPath: join(dirname(currentPath), `${safeName}-${timestamp}-report.${extension}`),
      buttonLabel: 'Export report',
      filters: [{ name: formatLabel, extensions: [extension] }],
    };
    const selection = owner
      ? await dialog.showSaveDialog(owner, options)
      : await dialog.showSaveDialog(options);
    if (selection.canceled || !selection.filePath) return { canceled: true };

    const selectedExtension = extname(selection.filePath);
    const reportPath = selectedExtension.toLowerCase() === `.${extension}`
      ? selection.filePath
      : `${selectedExtension ? selection.filePath.slice(0, -selectedExtension.length) : selection.filePath}.${extension}`;
    const sanitizedReport: CollectionRunReport = {
      collectionName: report.collectionName,
      environmentName: report.environmentName,
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      stoppedEarly: report.stoppedEarly,
      results: report.results.map((result) => ({
        name: result.name,
        method: result.method,
        status: result.status,
        statusText: result.statusText,
        durationMs: result.durationMs,
        sizeBytes: result.sizeBytes,
        passed: result.passed,
        error: result.error,
        assertions: result.assertions.map(({ label, passed }) => ({ label, passed })),
        extractions: result.extractions.map(({ name, jsonPointer, passed }) => ({ name, jsonPointer, passed })),
      })),
    };
    if (format === 'csv') await writeTextAtomically(reportPath, serializeRunReportCsv(sanitizedReport));
    else if (format === 'html') await writeTextAtomically(reportPath, serializeRunReportHtml(sanitizedReport));
    else await writeJsonAtomically(reportPath, sanitizedReport);
    return { path: reportPath };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to export the run report' };
  }
});
ipcMain.handle('collection:import', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: 'Import API collection',
    properties: ['openFile'],
    filters: [{ name: 'JSON collection', extensions: ['json'] }],
  };
  const selection = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };

  try {
    const content = await readFile(selection.filePaths[0], 'utf8');
    const parsed: unknown = JSON.parse(content);
    if (!validateCollection(parsed)) {
      const validationErrors = validateCollection.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
      return { error: `Collection does not match RestSoapSpecEnterprise v2.0: ${validationErrors ?? 'invalid collection structure'}` };
    }
    return { collection: parsed as unknown as CollectionDocument };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to read this collection file' };
  }
});

ipcMain.handle('openapi:import', async (event): Promise<CollectionImportResult> => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: 'Import OpenAPI definition',
    properties: ['openFile'],
    filters: [{ name: 'OpenAPI definition', extensions: ['json', 'yaml', 'yml'] }],
  };
  const selection = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };

  try {
    const collection = await importOpenApiFile(selection.filePaths[0]);
    if (!validateCollection(collection)) {
      const validationErrors = validateCollection.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ');
      return { error: `Generated collection does not match Relay's collection schema: ${validationErrors ?? 'invalid collection structure'}` };
    }
    return { collection };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to import this OpenAPI definition' };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});