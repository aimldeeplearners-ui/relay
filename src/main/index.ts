import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, safeStorage, shell, type OpenDialogOptions } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import collectionSchema from '../../spec/rest-soap-spec.json';
import { partitionCollectionSecrets, redactCollectionSecrets, removeFormDataFileSelections, restoreCollectionSecrets } from '../shared/credentialProtection';
import type { ApiRequestInput, ApiResponse, AssertionResult, CollectionDocument, CollectionImportResult, CollectionRunReport, KeyValue, RunReportFormat } from '../shared/api';
import { serializeRunReportCsv, serializeRunReportHtml } from '../shared/runReportFormats';
import { buildOAuth2PasswordGrantRequest, parseOAuth2PasswordGrantResponse } from '../shared/oauth2PasswordGrant';
import { buildCurlCommand } from '../shared/curlCommand';
import { buildMultipartFormData, MAX_FORM_DATA_FILE_BYTES, type SelectedFormDataFile } from '../shared/formData';
import { runRelayScript } from './scriptRuntime';
import { evaluateJsonPointerAssertions, evaluateResponseHeaderAssertions, evaluateResponseTimeAssertion } from '../shared/responseAssertions';
import { importOpenApiFile } from './openApiImport';
import { DIAGNOSTIC_LOG_FILE_NAME, getDiagnosticErrorDetails, getDiagnosticLogDirectory, writeDiagnosticLog } from './diagnosticLogger';

const validateCollection = new Ajv({ allErrors: true }).compile(collectionSchema);

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const protectedCollectionFormat = 'relay-protected-collection';
const oauthTokenCache = new Map<string, { accessToken: string; expiresAt: number }>();
const selectedFormDataFiles = new Map<string, { filePath: string; fileName: string }>();

function logDiagnostic(level: 'info' | 'warn' | 'error', event: string, details: Record<string, unknown> = {}): void {
  try {
    writeDiagnosticLog(getDiagnosticLogDirectory(app.getPath('userData')), level, event, details);
  } catch {
    // Diagnostics must not interrupt application behavior.
  }
}

async function openDiagnosticLogFolder(): Promise<void> {
  const directory = getDiagnosticLogDirectory(app.getPath('userData'));
  const error = await shell.openPath(directory);
  if (error) {
    logDiagnostic('warn', 'diagnostics.folder_open_failed', { errorName: 'ShellOpenPathError' });
    try {
      shell.showItemInFolder(join(directory, DIAGNOSTIC_LOG_FILE_NAME));
    } catch {
      logDiagnostic('warn', 'diagnostics.folder_reveal_failed', { errorName: 'ShellRevealError' });
    }
  }
}

function createApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { role: 'close' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Open Diagnostic Logs', click: () => { void openDiagnosticLogFolder(); } },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Relay',
          click: () => {
            void dialog.showMessageBox({ type: 'info', title: 'About Relay', message: `Relay ${app.getVersion()}` });
          },
        },
      ],
    },
  ]));
}
process.on('uncaughtExceptionMonitor', (error) => {
  logDiagnostic('error', 'main.uncaught_exception', getDiagnosticErrorDetails(error));
});

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
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    logDiagnostic('error', 'storage.json_write_failed', getDiagnosticErrorDetails(error));
    throw error;
  }
}

async function writeTextAtomically(filePath: string, value: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, value, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    logDiagnostic('error', 'storage.text_write_failed', getDiagnosticErrorDetails(error));
    throw error;
  }
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

  window.webContents.on('render-process-gone', (_event, details) => {
    logDiagnostic('error', 'renderer.process_gone', { reason: details.reason, exitCode: details.exitCode });
  });
  window.webContents.on('did-fail-load', (_event, errorCode) => {
    if (errorCode !== -3) logDiagnostic('error', 'renderer.load_failed', { errorCode });
  });
  window.on('unresponsive', () => logDiagnostic('warn', 'renderer.unresponsive'));

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

async function buildBody(input: ApiRequestInput): Promise<{ body?: BodyInit; contentType?: string }> {
  const body = input.request.body;
  if (!body || body.mode === 'none') return {};

  if (body.mode === 'urlencoded') {
    const params = new URLSearchParams();
    for (const [key, value] of enabledEntries(body.urlencoded, input.environment)) params.append(key, value);
    return { body: params, contentType: 'application/x-www-form-urlencoded' };
  }

  if (body.mode === 'formdata') {
    const files = new Map<string, SelectedFormDataFile>();
    for (const entry of body.formdata ?? []) {
      if (entry.enabled === false || !entry.key.trim() || entry.type !== 'file') continue;
      const selectedFile = entry.fileToken ? selectedFormDataFiles.get(entry.fileToken) : undefined;
      if (!selectedFile) throw new Error('Choose the form-data file again before sending. File selections last only for this Relay session.');
      const fileInfo = await stat(selectedFile.filePath);
      if (!fileInfo.isFile()) throw new Error('The selected form-data file is no longer available. Choose it again.');
      if (fileInfo.size > MAX_FORM_DATA_FILE_BYTES) throw new Error('Form-data files must be 50 MiB or smaller.');
      const fileBytes = new Uint8Array(await readFile(selectedFile.filePath));
      const blob = new Blob([fileBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
      files.set(entry.fileToken as string, { blob, fileName: selectedFile.fileName });
    }
    return { body: buildMultipartFormData(body.formdata ?? [], input.environment, files) };
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
    let scriptedRequest = structuredClone(input.request);
    let scriptVariables = { ...(input.scriptVariables ?? {}) };
    const scriptScopes = input.scriptScopes ?? (scriptedRequest.scripts ? [scriptedRequest.scripts] : []);
    const scriptAssertions: AssertionResult[] = [];

    for (const scope of scriptScopes) {
      const source = scope.preRequest ?? '';
      if (!source.trim()) continue;
      const result = await runRelayScript({
        source,
        phase: 'preRequest',
        request: scriptedRequest,
        environment: input.environment,
        variables: scriptVariables,
      });
      scriptVariables = result.variables;
      scriptAssertions.push(...result.assertions);
      if (result.error || result.assertions.some((assertion) => !assertion.passed)) {
        const detail = result.error ?? 'A pre-request script assertion failed.';
        return {
          status: 0,
          statusText: 'Pre-request script failed',
          headers: {},
          body: '',
          durationMs: Math.round(performance.now() - startedAt),
          sizeBytes: 0,
          tests: [...scriptAssertions, ...(result.error ? [{ label: 'Pre-request script', passed: false, detail }] : [])],
          scriptVariables,
          error: detail,
        };
      }
      scriptedRequest = result.request;
    }

    const scriptEnvironment = { ...input.environment, ...scriptVariables };
    const scriptedInput: ApiRequestInput = { ...input, request: scriptedRequest, environment: scriptEnvironment };
    const url = new URL(interpolate(scriptedRequest.url, scriptEnvironment));
    for (const [key, value] of enabledEntries(scriptedRequest.queryParams, scriptEnvironment)) {
      url.searchParams.append(key, value);
    }

    const headers = new Headers();
    for (const [key, value] of enabledEntries(scriptedRequest.headers, scriptEnvironment)) headers.set(key, value);

    const auth = scriptedRequest.auth;
    if (auth?.type === 'bearer' && auth.bearer?.token) {
      headers.set('authorization', `Bearer ${interpolate(auth.bearer.token, scriptEnvironment)}`);
    } else if (auth?.type === 'oauth2' && auth.oauth2) {
      const token = await getPasswordGrantAccessToken(auth.oauth2, scriptEnvironment);
      headers.set('authorization', `Bearer ${token}`);
    } else if (auth?.type === 'basic' && auth.basic) {
      const username = interpolate(auth.basic.username, scriptEnvironment);
      const password = interpolate(auth.basic.password, scriptEnvironment);
      headers.set('authorization', `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`);
    } else if (auth?.type === 'apikey' && auth.apikey) {
      const key = interpolate(auth.apikey.key, scriptEnvironment);
      const value = interpolate(auth.apikey.value, scriptEnvironment);
      if (auth.apikey.in === 'query') url.searchParams.append(key, value);
      else headers.set(key, value);
    }

    const requestBody = await buildBody(scriptedInput);
    if (scriptedRequest.body?.mode === 'formdata') headers.delete('content-type');
    if (requestBody.contentType && !headers.has('content-type')) headers.set('content-type', requestBody.contentType);
    if (scriptedRequest.body?.mode === 'xml') headers.set('content-type', 'text/xml; charset=utf-8');

    const response = await net.fetch(url.toString(), {
      method: scriptedRequest.method,
      headers,
      body: ['GET', 'HEAD'].includes(scriptedRequest.method) ? undefined : requestBody.body,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    const responseHeaders = Object.fromEntries(response.headers.entries());
    const durationMs = Math.round(performance.now() - startedAt);
    const tests = [...scriptAssertions, ...runAssertions(scriptedInput, response.status, body, responseHeaders, durationMs)];
    const scriptResponse: ApiResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body,
      durationMs,
      sizeBytes: new TextEncoder().encode(body).byteLength,
      tests,
    };

    for (const scope of scriptScopes) {
      const source = scope.postResponse ?? '';
      if (!source.trim()) continue;
      const result = await runRelayScript({
        source,
        phase: 'postResponse',
        request: scriptedRequest,
        environment: scriptEnvironment,
        variables: scriptVariables,
        response: scriptResponse,
      });
      scriptVariables = result.variables;
      tests.push(...result.assertions);
      if (result.error) tests.push({ label: 'Post-response script', passed: false, detail: result.error });
      scriptResponse.tests = tests;
    }

    return {
      ...scriptResponse,
      tests,
      executedMethod: scriptedRequest.method,
      ...(Object.keys(scriptVariables).length ? { scriptVariables } : {}),
    };
  } catch (error) {
    logDiagnostic('warn', 'request.execution_failed', { method: input.request.method, ...getDiagnosticErrorDetails(error) });
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

ipcMain.handle('formdata:choose-file', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const options: OpenDialogOptions = {
    title: 'Choose a form-data file',
    properties: ['openFile'],
  };
  const selection = owner
    ? await dialog.showOpenDialog(owner, options)
    : await dialog.showOpenDialog(options);
  if (selection.canceled || !selection.filePaths[0]) return { canceled: true };

  try {
    const filePath = selection.filePaths[0];
    const fileInfo = await stat(filePath);
    if (!fileInfo.isFile()) return { error: 'Choose a file, not a folder.' };
    if (fileInfo.size > MAX_FORM_DATA_FILE_BYTES) return { error: 'Form-data files must be 50 MiB or smaller.' };
    const fileToken = randomUUID();
    const fileName = basename(filePath);
    selectedFormDataFiles.set(fileToken, { filePath, fileName });
    return { fileToken, fileName };
  } catch (error) {
    logDiagnostic('warn', 'formdata.file_select_failed', getDiagnosticErrorDetails(error));
    return { error: error instanceof Error ? error.message : 'Unable to read the selected file.' };
  }
});

ipcMain.handle('api:execute', (_event, input: ApiRequestInput) => executeRequest(input));
ipcMain.on('diagnostics:renderer-error', (_event, errorName: unknown) => {
  const safeName = typeof errorName === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(errorName) ? errorName : 'Error';
  logDiagnostic('error', 'renderer.javascript_error', { errorName: safeName });
});
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
    const formDataFiles = new Map([...selectedFormDataFiles].map(([fileToken, file]) => [fileToken, { filePath: file.filePath }]));
    clipboard.writeText(buildCurlCommand(input, accessToken, formDataFiles));
    return { copied: true };
  } catch (error) {
    logDiagnostic('warn', 'request.curl_copy_failed', getDiagnosticErrorDetails(error));
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
        logDiagnostic('error', 'collection.path_read_failed', getDiagnosticErrorDetails(pathError));
        return { error: pathError instanceof Error ? pathError.message : 'Unable to read the collection location' };
      }
    }
    logDiagnostic('error', 'collection.load_failed', getDiagnosticErrorDetails(error));
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
    logDiagnostic('error', 'collection.save_failed', getDiagnosticErrorDetails(error));
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
    logDiagnostic('error', 'collection.location_change_failed', getDiagnosticErrorDetails(error));
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

    const exportCollection = includeSecrets ? removeFormDataFileSelections(collection) : redactCollectionSecrets(collection);
    await writeJsonAtomically(exportPath, exportCollection);
    return { exported: true, path: exportPath };
  } catch (error) {
    logDiagnostic('error', 'collection.export_failed', getDiagnosticErrorDetails(error));
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
    logDiagnostic('error', 'report.export_failed', getDiagnosticErrorDetails(error));
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
    logDiagnostic('warn', 'collection.import_failed', getDiagnosticErrorDetails(error));
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
    logDiagnostic('warn', 'openapi.import_failed', getDiagnosticErrorDetails(error));
    return { error: error instanceof Error ? error.message : 'Unable to import this OpenAPI definition' };
  }
});

app.whenReady().then(() => {
  logDiagnostic('info', 'app.starting', { version: app.getVersion(), platform: process.platform });
  createApplicationMenu();
  createWindow();
  logDiagnostic('info', 'app.ready', { version: app.getVersion(), platform: process.platform });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error: unknown) => {
  logDiagnostic('error', 'app.startup_failed', getDiagnosticErrorDetails(error));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});