import type { CollectionDocument, CollectionItem, KeyValue, RequestDefinition } from './api';

const sensitiveKeyPattern = /authorization|token|password|passwd|secret|credential|api[-_]?key|private[-_]?key/i;
const variableReferencePattern = /^\{\{\s*[^{}]+\s*\}\}$/;

export interface ProtectedCollectionParts {
  collection: CollectionDocument;
  secrets: Record<string, string>;
}

export function isSensitiveCredentialKey(key: string): boolean {
  return sensitiveKeyPattern.test(key);
}

function protectValue(value: string, path: string, secrets: Record<string, string>): string {
  if (!value || variableReferencePattern.test(value)) return value;
  secrets[path] = value;
  return '';
}

function protectEntries(entries: KeyValue[] | undefined, path: string, secrets: Record<string, string>): void {
  for (const [index, entry] of (entries ?? []).entries()) {
    if (!entry.secret && !isSensitiveCredentialKey(entry.key)) continue;
    entry.secret = true;
    entry.value = protectValue(entry.value, `${path}.${index}`, secrets);
  }
}

function protectAuth(request: RequestDefinition, path: string, secrets: Record<string, string>): void {
  const auth = request.auth;
  if (auth?.type === 'bearer' && auth.bearer) {
    auth.bearer.token = protectValue(auth.bearer.token, `${path}.auth.bearer.token`, secrets);
  } else if (auth?.type === 'basic' && auth.basic) {
    auth.basic.username = protectValue(auth.basic.username, `${path}.auth.basic.username`, secrets);
    auth.basic.password = protectValue(auth.basic.password, `${path}.auth.basic.password`, secrets);
  } else if (auth?.type === 'apikey' && auth.apikey) {
    auth.apikey.key = protectValue(auth.apikey.key, `${path}.auth.apikey.key`, secrets);
    auth.apikey.value = protectValue(auth.apikey.value, `${path}.auth.apikey.value`, secrets);
  } else if (auth?.type === 'oauth2' && auth.oauth2) {
    auth.oauth2.clientSecret = protectValue(auth.oauth2.clientSecret, `${path}.auth.oauth2.clientSecret`, secrets);
    auth.oauth2.username = protectValue(auth.oauth2.username, `${path}.auth.oauth2.username`, secrets);
    auth.oauth2.password = protectValue(auth.oauth2.password, `${path}.auth.oauth2.password`, secrets);
  }
}

function protectItems(items: CollectionItem[], parentPath: string, secrets: Record<string, string>): void {
  for (const [index, item] of items.entries()) {
    const path = parentPath ? `${parentPath}.${index}` : String(index);
    if (item.request) {
      protectAuth(item.request, path, secrets);
      protectEntries(item.request.queryParams, `${path}.queryParams`, secrets);
      protectEntries(item.request.headers, `${path}.headers`, secrets);
      for (const [caseIndex, testCase] of (item.request.testCases ?? []).entries()) {
        protectEntries(testCase.values, `${path}.testCases.${caseIndex}.values`, secrets);
      }
      if (item.request.body?.secret && item.request.body.raw !== undefined) {
        item.request.body.raw = protectValue(item.request.body.raw, `${path}.body.raw`, secrets);
      }
      protectEntries(item.request.body?.urlencoded, `${path}.body.urlencoded`, secrets);
      protectEntries(item.request.body?.formdata, `${path}.body.formdata`, secrets);
    }
    if (item.items) protectItems(item.items, path, secrets);
  }
}

export function partitionCollectionSecrets(collection: CollectionDocument): ProtectedCollectionParts {
  const protectedCollection = structuredClone(collection);
  const secrets: Record<string, string> = {};

  for (const [environmentIndex, environment] of (protectedCollection.environments ?? []).entries()) {
    protectEntries(environment.values, `environments.${environmentIndex}.values`, secrets);
  }
  protectItems(protectedCollection.items, '', secrets);

  return { collection: protectedCollection, secrets };
}

function restoreEntries(entries: KeyValue[] | undefined, path: string, secrets: Record<string, string>): void {
  for (const [index, entry] of (entries ?? []).entries()) {
    const secret = secrets[`${path}.${index}`];
    if (secret !== undefined) entry.value = secret;
  }
}

function restoreAuth(request: RequestDefinition, path: string, secrets: Record<string, string>): void {
  const auth = request.auth;
  if (auth?.type === 'bearer' && auth.bearer) {
    auth.bearer.token = secrets[`${path}.auth.bearer.token`] ?? auth.bearer.token;
  } else if (auth?.type === 'basic' && auth.basic) {
    auth.basic.username = secrets[`${path}.auth.basic.username`] ?? auth.basic.username;
    auth.basic.password = secrets[`${path}.auth.basic.password`] ?? auth.basic.password;
  } else if (auth?.type === 'apikey' && auth.apikey) {
    auth.apikey.key = secrets[`${path}.auth.apikey.key`] ?? auth.apikey.key;
    auth.apikey.value = secrets[`${path}.auth.apikey.value`] ?? auth.apikey.value;
  } else if (auth?.type === 'oauth2' && auth.oauth2) {
    auth.oauth2.clientSecret = secrets[`${path}.auth.oauth2.clientSecret`] ?? auth.oauth2.clientSecret;
    auth.oauth2.username = secrets[`${path}.auth.oauth2.username`] ?? auth.oauth2.username;
    auth.oauth2.password = secrets[`${path}.auth.oauth2.password`] ?? auth.oauth2.password;
  }
}

function restoreItems(items: CollectionItem[], parentPath: string, secrets: Record<string, string>): void {
  for (const [index, item] of items.entries()) {
    const path = parentPath ? `${parentPath}.${index}` : String(index);
    if (item.request) {
      restoreAuth(item.request, path, secrets);
      restoreEntries(item.request.queryParams, `${path}.queryParams`, secrets);
      restoreEntries(item.request.headers, `${path}.headers`, secrets);
      for (const [caseIndex, testCase] of (item.request.testCases ?? []).entries()) {
        restoreEntries(testCase.values, `${path}.testCases.${caseIndex}.values`, secrets);
      }
      if (item.request.body?.secret) {
        item.request.body.raw = secrets[`${path}.body.raw`] ?? item.request.body.raw;
      }
      restoreEntries(item.request.body?.urlencoded, `${path}.body.urlencoded`, secrets);
      restoreEntries(item.request.body?.formdata, `${path}.body.formdata`, secrets);
    }
    if (item.items) restoreItems(item.items, path, secrets);
  }
}

export function restoreCollectionSecrets(collection: CollectionDocument, secrets: Record<string, string>): CollectionDocument {
  const restoredCollection = structuredClone(collection);
  for (const [environmentIndex, environment] of (restoredCollection.environments ?? []).entries()) {
    restoreEntries(environment.values, `environments.${environmentIndex}.values`, secrets);
  }
  restoreItems(restoredCollection.items, '', secrets);
  return restoredCollection;
}

export function redactCollectionSecrets(collection: CollectionDocument): CollectionDocument {
  return partitionCollectionSecrets(collection).collection;
}