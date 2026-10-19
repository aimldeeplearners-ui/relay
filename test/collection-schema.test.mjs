import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv from 'ajv';
import { buildOffsetPaginationRequest, buildTestCaseEnvironment, collectRunnableRequests, getOffsetPaginationProgress, getRequestTestCases, getTestCaseVariables, inferOffsetPaginationOnImport, inspectRunReadiness, isRequestPassing } from '../src/shared/collectionRunner.ts';
import { partitionCollectionSecrets, redactCollectionSecrets, removeFormDataFileSelections, restoreCollectionSecrets } from '../src/shared/credentialProtection.ts';
import { buildCurlCommand } from '../src/shared/curlCommand.ts';
import { buildMultipartFormData } from '../src/shared/formData.ts';
import { countJsonArrayAtPointer, extractResponseVariables } from '../src/shared/responseExtraction.ts';
import { evaluateJsonPointerAssertions, evaluateResponseHeaderAssertions, evaluateResponseTimeAssertion } from '../src/shared/responseAssertions.ts';
import { buildOAuth2PasswordGrantRequest, parseOAuth2PasswordGrantResponse } from '../src/shared/oauth2PasswordGrant.ts';
import { serializeRunReportCsv, serializeRunReportHtml } from '../src/shared/runReportFormats.ts';
import { convertOpenApiDocument, importOpenApiFile } from '../src/main/openApiImport.ts';
import { createRequestHistoryEntry, createRequestHistoryReplay, MAX_HISTORY_RESPONSE_BODY_BYTES } from '../src/shared/requestHistory.ts';

const schema = JSON.parse(readFileSync(new URL('../spec/rest-soap-spec.json', import.meta.url), 'utf8'));
const validateCollection = new Ajv({ allErrors: true }).compile(schema);

function readCollection(fileName) {
  return JSON.parse(readFileSync(new URL(`../spec/${fileName}`, import.meta.url), 'utf8'));
}

function countRequests(items) {
  return items.reduce((count, item) => count + (item.request ? 1 : 0) + (item.items ? countRequests(item.items) : 0), 0);
}

test('demo collections match the Relay schema and contain the documented requests', () => {
  const fourRequestCollection = readCollection('demo-multi-request-collection.json');
  const tenRequestCollection = readCollection('demo-ten-request-collection.json');
  const localCrudCollection = readCollection('local-api-crud-collection.json');

  assert.equal(validateCollection(fourRequestCollection), true, JSON.stringify(validateCollection.errors));
  assert.equal(validateCollection(tenRequestCollection), true, JSON.stringify(validateCollection.errors));
  assert.equal(validateCollection(localCrudCollection), true, JSON.stringify(validateCollection.errors));
  assert.equal(countRequests(fourRequestCollection.items), 4);
  assert.equal(countRequests(tenRequestCollection.items), 10);
  assert.equal(countRequests(localCrudCollection.items), 9);
});

test('workspace schema accepts named collections and workspace-root folders', () => {
  const workspace = {
    info: { name: 'Relay workspace', version: '1.0.0' },
    environments: [{ name: 'Demo', values: [{ key: 'baseUrl', value: 'https://example.test', enabled: true }] }],
    items: [
      {
        name: 'Workspace folder',
        type: 'folder',
        items: [{ name: 'Health check', request: { method: 'GET', url: '{{baseUrl}}/health' } }],
      },
      {
          name: 'Sample collection',
          type: 'collection',
          items: [{ name: 'Users', type: 'folder', items: [] }],
      },
    ],
  };

  assert.equal(validateCollection(workspace), true, JSON.stringify(validateCollection.errors));
});

test('schema rejects unsupported collection types and HTTP methods', () => {
  const invalidType = {
    info: { name: 'Bad type', version: '1.0.0' },
    items: [{ name: 'Unknown', type: 'workspace-folder' }],
  };
  const invalidMethod = {
    info: { name: 'Bad method', version: '1.0.0' },
    items: [{ name: 'Request', request: { method: 'CONNECT', url: 'https://example.test' } }],
  };

  assert.equal(validateCollection(invalidType), false);
  assert.equal(validateCollection(invalidMethod), false);
});

test('schema requires collection metadata and request URL/method', () => {
  const missingVersion = { info: { name: 'No version' }, items: [] };
  const missingRequestUrl = {
    info: { name: 'No request URL', version: '1.0.0' },
    items: [{ name: 'Request', request: { method: 'GET' } }],
  };

  assert.equal(validateCollection(missingVersion), false);
  assert.equal(validateCollection(missingRequestUrl), false);
});

test('schema accepts JSON Schema and XPath response assertions', () => {
  const collection = {
    info: { name: 'Assertions', version: '1.0.0' },
    items: [{ name: 'Validate response', request: {
      method: 'GET',
      url: 'https://example.test/data',
      assertions: {
        maxResponseTimeMs: 1000,
        jsonSchema: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } },
        xpathMatches: [{ xpath: '//Status', expectedValue: 'OK' }, { xpath: '//Result' }],
        jsonPointerAssertions: [{ jsonPointer: '/id', operator: 'equals', expectedValue: '42' }],
        responseHeaderAssertions: [{ name: 'Content-Type', operator: 'equals', expectedValue: 'application/json' }],
      },
    } }],
  };

  assert.equal(validateCollection(collection), true, JSON.stringify(validateCollection.errors));
});

test('schema accepts named request data cases with key/value overrides', () => {
  const collection = {
    info: { name: 'Data cases', version: '1.0.0' },
    items: [{ name: 'List records', request: {
      method: 'GET',
      url: 'https://example.test/items/{{recordId}}',
      testCases: [{ name: 'Existing item', values: [{ key: 'recordId', value: '42', enabled: true }] }],
    } }],
  };
  assert.equal(validateCollection(collection), true, JSON.stringify(validateCollection.errors));
});

test('data-case helpers default to one run and build overrides from enabled values', () => {
  assert.deepEqual(getRequestTestCases({ method: 'GET', url: 'https://example.test' }), [{ name: 'Default', values: [] }]);
  const testCase = { name: 'Boundary', values: [
    { key: 'limit', value: '100', enabled: true },
    { key: 'offset', value: '0', enabled: true },
    { key: 'ignored', value: 'value', enabled: false },
  ] };
  assert.deepEqual(getRequestTestCases({ method: 'GET', url: 'https://example.test', testCases: [testCase] }), [testCase]);
  assert.deepEqual(getTestCaseVariables(testCase), { limit: '100', offset: '0' });
  assert.deepEqual(buildTestCaseEnvironment({ limit: '10', baseUrl: 'https://api.example.test' }, { recordId: '42', limit: '20' }, testCase), {
    limit: '100', offset: '0', baseUrl: 'https://api.example.test', recordId: '42',
  });
});

test('run readiness blocks ambiguous extraction from multiple data cases and case counts above the limit', () => {
  const cases = Array.from({ length: 101 }, (_value, index) => ({ name: `Case ${index + 1}`, values: [] }));
  const readiness = inspectRunReadiness([
    { name: 'Create record', request: { method: 'POST', url: 'https://api.example.test/items', testCases: [{ name: 'A', values: [] }, { name: 'B', values: [] }], extractVariables: [{ name: 'recordId', jsonPointer: '/id' }] } },
    { name: 'Too many cases', request: { method: 'GET', url: 'https://api.example.test/items', testCases: cases } },
  ], {});

  assert.deepEqual(readiness.blockers.map(({ message }) => message), [
    'A request with multiple data cases cannot also extract run-scoped variables for later requests.',
    'A request can have at most 100 data cases.',
  ]);
});

test('JSON Pointer assertions check presence and exact scalar values without exposing response values', () => {
  const results = evaluateJsonPointerAssertions(JSON.stringify({ data: { name: 'Relay', active: true }, items: [] }), [
    { jsonPointer: '/data/name', operator: 'equals', expectedValue: 'Relay' },
    { jsonPointer: '/data/active', operator: 'equals', expectedValue: 'true' },
    { jsonPointer: '/items', operator: 'exists' },
    { jsonPointer: '/missing', operator: 'exists' },
    { jsonPointer: '/data/name', operator: 'equals', expectedValue: 'Other' },
  ]);

  assert.deepEqual(results.map(({ passed }) => passed), [true, true, true, false, false]);
  assert.equal(results[4].detail.includes('Relay'), false);
  assert.equal(evaluateJsonPointerAssertions('not json', [{ jsonPointer: '/id', operator: 'exists' }])[0].passed, false);
});

test('response header assertions are case-insensitive for names and compare values exactly', () => {
  const results = evaluateResponseHeaderAssertions({ 'content-type': 'application/json', 'x-trace-id': 'trace-123' }, [
    { name: 'Content-Type', operator: 'exists' },
    { name: 'X-Trace-ID', operator: 'equals', expectedValue: 'trace-123' },
    { name: 'X-Trace-Id', operator: 'equals', expectedValue: 'wrong' },
    { name: 'Location', operator: 'exists' },
  ]);

  assert.deepEqual(results.map(({ passed }) => passed), [true, true, false, false]);
  assert.equal(results[2].detail.includes('trace-123'), false);
});

test('response-time assertion passes at its threshold and fails above it', () => {
  assert.equal(evaluateResponseTimeAssertion(999, 1000).passed, true);
  assert.equal(evaluateResponseTimeAssertion(1000, 1000).passed, true);
  assert.equal(evaluateResponseTimeAssertion(1001, 1000).passed, false);
});

test('run readiness recognizes JSON Pointer and response-header assertions', () => {
  const readiness = inspectRunReadiness([{
    name: 'Get item',
    request: {
      method: 'GET',
      url: 'https://api.example.test/items/1',
      assertions: {
        maxResponseTimeMs: 1000,
        jsonPointerAssertions: [{ jsonPointer: '/id', operator: 'exists' }],
        responseHeaderAssertions: [{ name: 'Content-Type', operator: 'exists' }],
      },
    },
  }], {});

  assert.deepEqual(readiness.blockers, []);
  assert.deepEqual(readiness.warnings, []);
});

test('run readiness blocks response-time thresholds outside the supported range', () => {
  const readiness = inspectRunReadiness([{
    name: 'Slow check',
    request: { method: 'GET', url: 'https://api.example.test/items', assertions: { maxResponseTimeMs: 30001 } },
  }], {});

  assert.equal(readiness.blockers.length, 1);
  assert.match(readiness.blockers[0].message, /Maximum response time/);
});

test('schema accepts the supported OAuth2 password grant configuration', () => {
  const collection = {
    info: { name: 'OAuth2', version: '1.0.0' },
    items: [{ name: 'Authenticated request', request: {
      method: 'GET',
      url: 'https://api.example.test/items',
      auth: { type: 'oauth2', oauth2: {
        grantType: 'password', tokenUrl: 'https://idp.example.test/token', clientId: 'relay', clientSecret: '', username: 'user', password: '',
      } },
    } }],
  };

  assert.equal(validateCollection(collection), true, JSON.stringify(validateCollection.errors));
});

test('collection runner collects requests depth-first in tree order', () => {
  const items = [
    { name: 'First', request: { method: 'GET', url: 'https://example.test/first' } },
    { name: 'Folder', items: [
      { name: 'Second', request: { method: 'POST', url: 'https://example.test/second' } },
      { name: 'Nested', items: [{ name: 'Third', request: { method: 'DELETE', url: 'https://example.test/third' } }] },
    ] },
  ];

  assert.deepEqual(collectRunnableRequests(items).map((request) => request.name), ['First', 'Second', 'Third']);
});

test('collection runner passes successful responses and respects configured assertions', () => {
  assert.equal(isRequestPassing(200, false, []), true);
  assert.equal(isRequestPassing(404, false, []), false);
  assert.equal(isRequestPassing(404, false, [{ label: 'Expected 404', passed: true }], 404), true);
  assert.equal(isRequestPassing(404, false, [{ label: 'Schema valid', passed: true }]), false);
  assert.equal(isRequestPassing(200, false, [{ label: 'Schema valid', passed: true }, { label: 'Expected field', passed: false }]), false);
  assert.equal(isRequestPassing(200, true, []), false);
});

test('history replay snapshots request and environment without mutating the original', () => {
  const request = { method: 'POST', url: '{{baseUrl}}/items', body: { mode: 'json', raw: '{"name":"sample"}' } };
  const environment = { baseUrl: 'https://api.example.test', token: 'session-secret' };
  const response = { status: 201, statusText: 'Created', headers: { 'content-type': 'application/json' }, body: '{"id":1}', durationMs: 25, sizeBytes: 8, tests: [] };
  const entry = createRequestHistoryEntry({
    id: 'history-1',
    requestName: 'Create item',
    method: 'POST',
    url: 'https://api.example.test/items',
    status: 201,
    time: '10:15 AM',
    request,
    response,
    environment,
    environmentName: 'Test',
  });

  request.body.raw = 'changed';
  response.body = 'changed';
  response.headers['content-type'] = 'text/plain';
  environment.baseUrl = 'https://other.example.test';
  assert.equal(entry.request.body.raw, '{"name":"sample"}');
  assert.equal(entry.response.body, '{"id":1}');
  assert.equal(entry.response.headers['content-type'], 'application/json');
  assert.equal(entry.environment.baseUrl, 'https://api.example.test');

  const replay = createRequestHistoryReplay(entry);
  replay.request.body.raw = 'edited replay draft';
  replay.environment.token = 'changed';
  assert.equal(entry.request.body.raw, '{"name":"sample"}');
  assert.equal(entry.environment.token, 'session-secret');
});

test('history response bodies are capped at the UTF-8 byte limit', () => {
  const entry = createRequestHistoryEntry({
    id: 'history-large',
    requestName: 'Large response',
    method: 'GET',
    url: 'https://api.example.test/large',
    status: 200,
    time: '10:16 AM',
    request: { method: 'GET', url: 'https://api.example.test/large' },
    response: { status: 200, statusText: 'OK', headers: {}, body: '€'.repeat(MAX_HISTORY_RESPONSE_BODY_BYTES), durationMs: 10, sizeBytes: MAX_HISTORY_RESPONSE_BODY_BYTES * 3, tests: [] },
    environment: {},
    environmentName: 'Test',
  });

  assert.equal(entry.responseBodyTruncated, true);
  assert.ok(new TextEncoder().encode(entry.response.body).byteLength <= MAX_HISTORY_RESPONSE_BODY_BYTES);
});

test('multipart file fields validate while local selections are omitted from saved and exported copies', () => {
  const collection = {
    info: { name: 'File upload', version: '1.0.0' },
    items: [{ name: 'Upload', request: {
      method: 'POST',
      url: 'https://api.example.test/upload',
      body: { mode: 'formdata', formdata: [{ key: 'attachment', value: '', type: 'file', fileToken: 'session-token', fileName: 'sample.bin' }] },
    } }],
  };

  assert.equal(validateCollection(collection), true, JSON.stringify(validateCollection.errors));
  const saved = partitionCollectionSecrets(collection).collection;
  const exported = removeFormDataFileSelections(collection);
  assert.equal(saved.items[0].request.body.formdata[0].type, 'file');
  assert.equal(saved.items[0].request.body.formdata[0].fileToken, undefined);
  assert.equal(saved.items[0].request.body.formdata[0].fileName, undefined);
  assert.equal(exported.items[0].request.body.formdata[0].fileToken, undefined);
  assert.equal(collection.items[0].request.body.formdata[0].fileToken, 'session-token');
});

test('response extraction resolves nested, array, and escaped JSON Pointer paths', () => {
  const response = JSON.stringify({
    data: { created: { id: 42 } },
    items: [{ token: 'run-token' }],
    'a/b': { '~key': 'escaped' },
  });
  const result = extractResponseVariables(response, [
    { name: 'createdId', jsonPointer: '/data/created/id' },
    { name: 'firstToken', jsonPointer: '/items/0/token' },
    { name: 'escapedValue', jsonPointer: '/a~1b/~0key' },
  ]);

  assert.deepEqual(result.variables, { createdId: '42', firstToken: 'run-token', escapedValue: 'escaped' });
  assert.ok(result.outcomes.every((outcome) => outcome.passed));
});

test('response extraction reports missing pointers and invalid JSON without returning values', () => {
  const missing = extractResponseVariables('{"data":{}}', [
    { name: 'createdId', jsonPointer: '/data/id' },
    { name: 'badPointer', jsonPointer: 'data/id' },
  ]);
  const invalidJson = extractResponseVariables('not json', [{ name: 'createdId', jsonPointer: '/id' }]);

  assert.deepEqual(missing.variables, {});
  assert.deepEqual(missing.outcomes.map((outcome) => outcome.passed), [false, false]);
  assert.deepEqual(invalidJson.variables, {});
  assert.equal(invalidJson.outcomes[0].passed, false);
  assert.equal(extractResponseVariables('{"id":1}', [{ name: ' ', jsonPointer: '/id' }]).outcomes[0].passed, false);
});

test('OAuth2 password grant form is encoded and token responses are validated', () => {
  const request = buildOAuth2PasswordGrantRequest({
    grantType: 'password',
    tokenUrl: 'https://{{IDP_ROUTE}}/realms/noa/token',
    clientId: 'relay client',
    clientSecret: 'client&secret',
    username: 'test user',
    password: 'p@ss word',
    scope: 'profile email',
  }, { IDP_ROUTE: 'idp.example.test' });

  assert.equal(request.tokenUrl, 'https://idp.example.test/realms/noa/token');
  assert.equal(request.body.get('grant_type'), 'password');
  assert.equal(request.body.get('client_secret'), 'client&secret');
  assert.equal(request.body.get('username'), 'test user');
  assert.equal(request.body.get('password'), 'p@ss word');
  assert.equal(request.body.get('scope'), 'profile email');
  assert.equal(parseOAuth2PasswordGrantResponse(200, '{"access_token":"sample-token","token_type":"Bearer","expires_in":3600}').expiresInSeconds, 3600);
  assert.throws(() => parseOAuth2PasswordGrantResponse(401, '{}'), /HTTP 401/);
  assert.throws(() => parseOAuth2PasswordGrantResponse(200, 'not json'), /valid JSON/);
  assert.throws(() => parseOAuth2PasswordGrantResponse(200, '{"token_type":"Bearer"}'), /missing access_token/);
});

test('credential protection separates marked, sensitive-key, and auth values from collection data', () => {
  const collection = {
    info: { name: 'Credentials', version: '1.0.0' },
    environments: [{ name: 'Demo', values: [
      { key: 'baseUrl', value: 'https://example.test' },
      { key: 'bearerToken', value: 'environment-secret' },
      { key: 'privateValue', value: 'explicit-secret', secret: true },
    ] }],
    items: [{ name: 'API', items: [
      { name: 'Read', request: {
        method: 'GET',
        url: 'https://example.test',
        headers: [{ key: 'X-Api-Key', value: 'header-secret' }],
        auth: { type: 'basic', basic: { username: 'account-name', password: 'auth-secret' } },
        body: { mode: 'json', secret: true, raw: '{"clientSecret":"body-secret"}' },
        testCases: [{ name: 'Sensitive case', values: [{ key: 'apiToken', value: 'case-secret' }] }],
      } },
      { name: 'OAuth', request: {
        method: 'GET',
        url: 'https://example.test',
        auth: { type: 'oauth2', oauth2: { grantType: 'password', tokenUrl: 'https://idp.example.test/token', clientId: 'relay', clientSecret: 'oauth-client-secret', username: 'oauth-user', password: 'oauth-password' } },
      } },
    ] }],
  };

  const parts = partitionCollectionSecrets(collection);
  const serialized = JSON.stringify(parts.collection);
  assert.equal(validateCollection(parts.collection), true, JSON.stringify(validateCollection.errors));
  assert.equal(serialized.includes('environment-secret'), false);
  assert.equal(serialized.includes('explicit-secret'), false);
  assert.equal(serialized.includes('header-secret'), false);
  assert.equal(serialized.includes('auth-secret'), false);
  assert.equal(serialized.includes('account-name'), false);
  assert.equal(serialized.includes('body-secret'), false);
  assert.equal(serialized.includes('oauth-client-secret'), false);
  assert.equal(serialized.includes('oauth-user'), false);
  assert.equal(serialized.includes('oauth-password'), false);
  assert.equal(serialized.includes('case-secret'), false);
  assert.equal(serialized.includes('https://example.test'), true);
  assert.equal(parts.collection.environments[0].values[1].secret, true);
  assert.equal(parts.collection.items[0].items[0].request.testCases[0].values[0].secret, true);
  assert.equal(restoreCollectionSecrets(parts.collection, parts.secrets).items[0].items[0].request.testCases[0].values[0].value, 'case-secret');
  assert.deepEqual(restoreCollectionSecrets(parts.collection, parts.secrets).environments[0].values.map(({ value }) => value), [
    'https://example.test', 'environment-secret', 'explicit-secret',
  ]);
  assert.equal(collection.environments[0].values[1].value, 'environment-secret');

  const redacted = redactCollectionSecrets(collection);
  assert.equal(validateCollection(redacted), true, JSON.stringify(validateCollection.errors));
  assert.equal(JSON.stringify(redacted).includes('environment-secret'), false);
  assert.equal(JSON.stringify(redacted).includes('auth-secret'), false);
  assert.equal(JSON.stringify(redacted).includes('body-secret'), false);
  assert.equal(JSON.stringify(redacted).includes('oauth-client-secret'), false);
  assert.equal(JSON.stringify(redacted).includes('oauth-user'), false);
  assert.equal(JSON.stringify(redacted).includes('oauth-password'), false);
  assert.equal(redacted.items[0].items[0].request.auth.basic.password, '');
  assert.equal(restoreCollectionSecrets(parts.collection, parts.secrets).items[0].items[0].request.body.raw, '{"clientSecret":"body-secret"}');
  const restoredOAuth = restoreCollectionSecrets(parts.collection, parts.secrets).items[0].items[1].request.auth.oauth2;
  assert.deepEqual({ clientSecret: restoredOAuth.clientSecret, username: restoredOAuth.username, password: restoredOAuth.password }, {
    clientSecret: 'oauth-client-secret', username: 'oauth-user', password: 'oauth-password',
  });
});


test('run report CSV and HTML formats escape content and omit response payloads', () => {
  const report = {
    collectionName: 'RAN "smoke", suite',
    environmentName: 'Local',
    startedAt: '2026-10-16T10:00:00.000Z',
    completedAt: '2026-10-16T10:00:01.000Z',
    stoppedEarly: false,
    results: [{
      name: '=HYPERLINK("https://example.test") <item>',
      method: 'GET',
      status: 200,
      statusText: 'OK',
      durationMs: 12,
      sizeBytes: 64,
      passed: false,
      error: false,
      assertions: [{ label: 'Missing "name", <required>', passed: false }],
      extractions: [],
      body: 'sensitive response payload',
      headers: { authorization: 'sensitive response header' },
    }],
  };

  const csv = serializeRunReportCsv(report);
  const html = serializeRunReportHtml(report);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"RAN ""smoke"", suite"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""https://example.test"") <item>"'));
  assert.equal(csv.includes('sensitive response payload'), false);
  assert.equal(csv.includes('sensitive response header'), false);
  assert.ok(html.includes('RAN &quot;smoke&quot;, suite'));
  assert.ok(html.includes('=HYPERLINK(&quot;https://example.test&quot;) &lt;item&gt;'));
  assert.ok(html.includes('Missing &quot;name&quot;, &lt;required&gt;'));
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('sensitive response payload'), false);
  assert.equal(html.includes('sensitive response header'), false);
});

test('cURL command includes interpolated URL, headers, Bearer auth, and a safely quoted JSON body', () => {
  const command = buildCurlCommand({
    request: {
      method: 'POST',
      url: '{{baseUrl}}/items',
      queryParams: [{ key: 'search', value: 'relay tester', enabled: true }],
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      auth: { type: 'bearer', bearer: { token: '{{bearerToken}}' } },
      body: { mode: 'json', raw: '{"name":"O\'Brien"}' },
    },
    environment: { baseUrl: 'https://api.example.test', bearerToken: 'test-token' },
  });

  assert.ok(command.startsWith('curl.exe '));
  assert.ok(command.includes("--request 'POST'"));
  assert.ok(command.includes("--url 'https://api.example.test/items?search=relay+tester'"));
  assert.ok(command.includes("'Authorization: Bearer test-token'"));
  assert.ok(command.includes("'Content-Type: application/json'"));
  assert.ok(command.includes("--data-raw '{"));
  assert.ok(command.includes("O''Brien"));
  assert.throws(() => buildCurlCommand({
    request: { method: 'GET', url: 'https://api.example.test', auth: { type: 'oauth2', oauth2: { grantType: 'password', tokenUrl: 'https://idp.example.test/token', clientId: 'id', clientSecret: 'secret', username: 'user', password: 'pass' } } },
    environment: {},
  }), /OAuth2 token is unavailable/);
});

test('multipart form-data combines text and selected files and rejects missing selections', async () => {
  const form = buildMultipartFormData([
    { key: 'description', value: '{{description}}', enabled: true },
    { key: 'attachment', value: '', type: 'file', fileToken: 'file-token', enabled: true },
    { key: 'ignored', value: '', type: 'file', enabled: false },
  ], { description: 'RAN package' }, new Map([
    ['file-token', { blob: new Blob(['safe test payload']), fileName: 'package.bin' }],
  ]));

  assert.equal(form.get('description'), 'RAN package');
  const attachment = form.get('attachment');
  assert.equal(attachment.name, 'package.bin');
  assert.equal(await attachment.text(), 'safe test payload');
  assert.equal(form.has('ignored'), false);
  assert.throws(() => buildMultipartFormData([
    { key: 'attachment', value: '', type: 'file', enabled: true },
  ], {}, new Map()), /Choose a file/);
});

test('cURL command uses a file form field instead of sending the file path as text', () => {
  const command = buildCurlCommand({
    request: { method: 'POST', url: 'https://api.example.test/upload', body: { mode: 'formdata', formdata: [
      { key: 'description', value: 'test', enabled: true },
      { key: 'attachment', value: '', type: 'file', fileToken: 'file-token', enabled: true },
    ] } },
    environment: {},
  }, undefined, new Map([['file-token', { filePath: 'C:\\fixtures\\package.bin' }]]));

  assert.ok(command.includes("--form-string 'description=test'"));
  assert.ok(command.includes("--form 'attachment=@C:\\fixtures\\package.bin'"));
});

test('run readiness blocks enabled file fields without a current-session selection', () => {
  const readiness = inspectRunReadiness([{
    name: 'Upload package',
    request: { method: 'POST', url: 'https://api.example.test/upload', body: { mode: 'formdata', formdata: [{ key: 'attachment', value: '', type: 'file', enabled: true }] } },
  }], {});

  assert.ok(readiness.blockers.some((issue) => /form-data file field/.test(issue.message)));
});

test('run readiness blocks missing variables and reports each variable without exposing its value', () => {
  const requests = [
    { name: 'Read one', request: { method: 'GET', url: 'https://api.example.test/items', headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }] } },
    { name: 'Read two', request: { method: 'GET', url: 'https://api.example.test/items/{{itemId}}', headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }] } },
  ];

  const readiness = inspectRunReadiness(requests, { token: '', itemId: '42' });

  assert.deepEqual(readiness.blockers, [{
    message: 'Environment variable "{{token}}" is missing or blank.',
    requestNames: ['Read one', 'Read two'],
  }]);
  assert.deepEqual(readiness.warnings, [{
    message: 'No response assertions or extractions are configured; HTTP status alone determines pass/fail.',
    requestNames: ['Read one', 'Read two'],
  }]);
});

test('run readiness blocks invalid URLs and ignores disabled key-value rows', () => {
  const readiness = inspectRunReadiness([
    { name: 'Invalid URL', request: { method: 'GET', url: 'not a valid URL', queryParams: [{ key: 'q', value: '{{unused}}', enabled: false }], assertions: { expectedStatusCode: 200 } } },
  ], {});

  assert.deepEqual(readiness.blockers, [{
    message: 'Request URL is invalid after environment interpolation.',
    requestNames: ['Invalid URL'],
  }]);
  assert.deepEqual(readiness.warnings, []);
});

test('run readiness warns before state-changing requests and accepts configured checks', () => {
  const readiness = inspectRunReadiness([
    { name: 'Create item', request: { method: 'POST', url: 'https://api.example.test/items', assertions: { expectedStatusCode: 201 } } },
    { name: 'Delete item', request: { method: 'DELETE', url: 'https://api.example.test/items/42', assertions: { expectedStatusCode: 204 } } },
  ], {});

  assert.deepEqual(readiness.blockers, []);
  assert.deepEqual(readiness.warnings, [{
    message: 'POST, PUT, PATCH, or DELETE requests will be sent; review their effects on the target system.',
    requestNames: ['Create item', 'Delete item'],
  }]);
});

test('run readiness accepts variables extracted by an earlier request', () => {
  const readiness = inspectRunReadiness([
    { name: 'Get token', request: { method: 'POST', url: 'https://idp.example.test/token', extractVariables: [{ name: 'bearerToken', jsonPointer: '/access_token' }], assertions: { expectedStatusCode: 200 } } },
    { name: 'Get data', request: { method: 'GET', url: 'https://api.example.test/data', auth: { type: 'bearer', bearer: { token: '{{bearerToken}}' } }, assertions: { expectedStatusCode: 200 } } },
  ], { bearerToken: '' });

  assert.deepEqual(readiness.blockers, []);
  assert.deepEqual(readiness.warnings, [{
    message: 'POST, PUT, PATCH, or DELETE requests will be sent; review their effects on the target system.',
    requestNames: ['Get token'],
  }]);
});

test('offset pagination updates limit and offset while preserving other query parameters', () => {
  const request = {
    method: 'GET',
    url: 'https://api.example.test/items',
    queryParams: [
      { key: 'limit', value: '25', enabled: true },
      { key: 'offset', value: '0', enabled: true },
      { key: 'filter', value: 'active', enabled: true },
    ],
    pagination: { limitParam: 'limit', offsetParam: 'offset', pageSize: 25, startOffset: 10, maxPages: 4, itemsJsonPointer: '/items' },
  };

  const page = buildOffsetPaginationRequest(request, 2);

  assert.deepEqual(page.queryParams, [
    { key: 'limit', value: '25', enabled: true },
    { key: 'offset', value: '60', enabled: true },
    { key: 'filter', value: 'active', enabled: true },
  ]);
  assert.equal(request.queryParams[1].value, '0');
});

test('import infers pagination from numeric limit and offset parameters recursively', () => {
  const importedItems = [{
    name: 'Collection',
    type: 'collection',
    items: [{
      name: 'List records',
      request: {
        method: 'GET',
        url: 'https://api.example.test/records',
        queryParams: [
          { key: 'Limit', value: '40', enabled: true },
          { key: 'offset', value: '80', enabled: true },
          { key: 'status', value: 'active', enabled: true },
        ],
      },
    }],
  }];

  const inferred = inferOffsetPaginationOnImport(importedItems);

  assert.deepEqual(inferred[0].items[0].request.pagination, {
    limitParam: 'Limit',
    offsetParam: 'offset',
    pageSize: 40,
    startOffset: 80,
    maxPages: 10,
    itemsJsonPointer: '',
  });
  assert.equal(inferred[0].items[0].request.queryParams[2].value, 'active');
});

test('import preserves explicit pagination and skips disabled, ambiguous, or nonnumeric pairs', () => {
  const explicit = { name: 'Explicit', request: {
    method: 'GET', url: 'https://api.example.test/explicit',
    pagination: { limitParam: 'count', offsetParam: 'skip', pageSize: 5, startOffset: 0, maxPages: 2, itemsJsonPointer: '/items' },
    queryParams: [{ key: 'limit', value: '10' }, { key: 'offset', value: '0' }],
  } };
  const disabled = { name: 'Disabled', request: {
    method: 'GET', url: 'https://api.example.test/disabled',
    queryParams: [{ key: 'limit', value: '10', enabled: false }, { key: 'offset', value: '0' }],
  } };
  const ambiguous = { name: 'Ambiguous', request: {
    method: 'GET', url: 'https://api.example.test/ambiguous',
    queryParams: [{ key: 'limit', value: '10' }, { key: 'limit', value: '20' }, { key: 'offset', value: '0' }],
  } };
  const templated = { name: 'Templated', request: {
    method: 'GET', url: 'https://api.example.test/templated',
    queryParams: [{ key: 'limit', value: '{{pageSize}}' }, { key: 'offset', value: '0' }],
  } };

  const inferred = inferOffsetPaginationOnImport([explicit, disabled, ambiguous, templated]);

  assert.equal(inferred[0], explicit);
  assert.equal(inferred[1].request.pagination, undefined);
  assert.equal(inferred[2].request.pagination, undefined);
  assert.equal(inferred[3].request.pagination, undefined);
});

test('pagination reads array lengths from a JSON Pointer and rejects non-arrays', () => {
  assert.equal(countJsonArrayAtPointer('[1,2]', ''), 2);
  assert.equal(countJsonArrayAtPointer('{"data":{"items":[1,2,3]}}', '/data/items'), 3);
  assert.equal(countJsonArrayAtPointer('{"data":{}}', '/data/items'), null);
  assert.equal(countJsonArrayAtPointer('not json', '/items'), null);
});

test('schema accepts bounded offset pagination and readiness rejects invalid pagination settings', () => {
  const collection = {
    info: { name: 'Paginated collection', version: '1.0.0' },
    items: [{ name: 'List items', request: {
      method: 'GET',
      url: 'https://api.example.test/items',
      pagination: { limitParam: 'limit', offsetParam: 'offset', pageSize: 50, startOffset: 0, maxPages: 10, itemsJsonPointer: '/items' },
    } }],
  };
  assert.equal(validateCollection(collection), true, JSON.stringify(validateCollection.errors));

  const invalid = inspectRunReadiness([{
    name: 'List items',
    request: { ...collection.items[0].request, pagination: { ...collection.items[0].request.pagination, pageSize: 0 } },
  }], {});
  assert.equal(invalid.blockers.length, 1);
  assert.match(invalid.blockers[0].message, /Offset pagination settings are invalid/);
});

test('offset pagination continues on full pages and reports possible truncation at the maximum', () => {
  const pagination = { limitParam: 'limit', offsetParam: 'offset', pageSize: 20, startOffset: 0, maxPages: 3, itemsJsonPointer: '/items' };
  assert.deepEqual(getOffsetPaginationProgress(20, pagination, 1), { hasMorePages: true, reachedPageLimit: false });
  assert.deepEqual(getOffsetPaginationProgress(4, pagination, 2), { hasMorePages: false, reachedPageLimit: false });
  assert.deepEqual(getOffsetPaginationProgress(20, pagination, 3), { hasMorePages: false, reachedPageLimit: true });
  assert.deepEqual(getOffsetPaginationProgress(null, pagination, 1), { hasMorePages: false, reachedPageLimit: false });
});

test('OpenAPI YAML import creates Relay requests, variables, auth, bodies, and response schemas', async () => {
  const collection = await importOpenApiFile(fileURLToPath(new URL('./fixtures/openapi-minimal.yaml', import.meta.url)));
  assert.equal(validateCollection(collection), true, JSON.stringify(validateCollection.errors));
  assert.equal(collection.info.name, 'Inventory API');
  assert.equal(collection.environments?.[0].values?.find(({ key }) => key === 'baseUrl')?.value, 'https://inventory.example.test/v1');

  const itemsFolder = collection.items.find((item) => item.name === '/items/{itemId}');
  const getItem = itemsFolder?.items?.find((item) => item.name === 'Get item')?.request;
  assert.equal(getItem?.url, '{{baseUrl}}/items/{{itemId}}');
  assert.equal(getItem?.queryParams?.[0].key, 'expand');
  assert.equal(getItem?.queryParams?.[0].value, 'owner');
  assert.equal(getItem?.auth?.type, 'bearer');
  assert.deepEqual(getItem?.assertions?.expectedStatusCode, 200);
  assert.deepEqual(getItem?.assertions?.jsonSchema?.required, ['id']);

  const createItem = collection.items.find((item) => item.name === '/items')?.items?.[0].request;
  assert.equal(createItem?.method, 'POST');
  assert.equal(createItem?.body?.mode, 'json');
  assert.deepEqual(JSON.parse(createItem?.body?.raw ?? '{}'), { name: 'Sample item' });
});

test('OpenAPI importer rejects an invalid definition', async () => {
  const filePath = fileURLToPath(new URL('../spec/openapi-invalid.yaml', import.meta.url));
  await assert.rejects(importOpenApiFile(filePath));
});

test('Relay collection schema rejects the invalid Relay JSON fixture', () => {
  const collection = readCollection('relay-invalid.json');
  assert.equal(validateCollection(collection), false);
});

test('local OpenAPI sample converts into a valid credential-free CRUD request collection', async () => {
  const collection = await importOpenApiFile(fileURLToPath(new URL('../spec/openapi-local-test-api.yaml', import.meta.url)));
  assert.equal(validateCollection(collection), true, JSON.stringify(validateCollection.errors));
  assert.equal(collection.environments?.[0].values?.find(({ key }) => key === 'baseUrl')?.value, 'http://api.relay.localhost:3000');
  assert.deepEqual(collectRunnableRequests(collection.items).map(({ request }) => request.method), [
    'GET', 'GET', 'POST', 'GET', 'PUT', 'PATCH', 'DELETE',
  ]);
  assert.equal(collection.items.some((item) => JSON.stringify(item).includes('password')), false);
});

test('OpenAPI Swagger 2.0 conversion supports server, query parameters, and API-key security', () => {
  const collection = convertOpenApiDocument({
    swagger: '2.0',
    info: { title: 'Legacy API', version: '2.0' },
    host: 'legacy.example.test',
    basePath: '/api',
    schemes: ['https'],
    securityDefinitions: { apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' } },
    paths: { '/items': { get: {
      operationId: 'listItems',
      security: [{ apiKey: [] }],
      parameters: [{ name: 'limit', in: 'query', type: 'integer', default: 25 }],
      responses: { '200': { description: 'OK', schema: { type: 'array', items: { type: 'object' } } } },
    } } },
  });

  assert.equal(validateCollection(collection), true, JSON.stringify(validateCollection.errors));
  assert.equal(collection.environments?.[0].values?.find(({ key }) => key === 'baseUrl')?.value, 'https://legacy.example.test/api');
  const request = collection.items[0].items?.[0].request;
  assert.equal(request?.url, '{{baseUrl}}/items');
  assert.equal(request?.queryParams?.[0].value, '25');
  assert.equal(request?.auth?.type, 'apikey');
  assert.equal(request?.auth?.apikey?.key, 'X-API-Key');
  assert.equal(request?.auth?.apikey?.in, 'header');
});