export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface KeyValue {
  key: string;
  value: string;
  enabled?: boolean;
  secret?: boolean;
  description?: string;
}

export interface CollectionItem {
  name: string;
  type?: 'collection' | 'folder';
  description?: string;
  items?: CollectionItem[];
  request?: RequestDefinition;
}

export interface CollectionDocument {
  info: { name: string; version: string; description?: string };
  environments?: { name: string; values?: KeyValue[] }[];
  items: CollectionItem[];
}

export interface OffsetPaginationConfig {
  limitParam: string;
  offsetParam: string;
  pageSize: number;
  startOffset: number;
  maxPages: number;
  itemsJsonPointer: string;
}

export type ResponseValueOperator = 'exists' | 'equals';

export interface JsonPointerAssertion {
  jsonPointer: string;
  operator: ResponseValueOperator;
  expectedValue?: string;
}

export interface ResponseHeaderAssertion {
  name: string;
  operator: ResponseValueOperator;
  expectedValue?: string;
}

export interface CollectionImportResult {
  collection?: CollectionDocument;
  canceled?: boolean;
  error?: string;
}

export interface CollectionLoadResult {
  collection?: CollectionDocument;
  path?: string;
  error?: string;
}

export interface CollectionSaveResult {
  saved: boolean;
  path?: string;
  error?: string;
}

export interface CollectionLocationResult {
  canceled?: boolean;
  path?: string;
  error?: string;
}

export interface CollectionExportResult {
  canceled?: boolean;
  exported?: boolean;
  path?: string;
  error?: string;
}

export interface RequestDefinition {
  method: HttpMethod;
  url: string;
  queryParams?: KeyValue[];
  pagination?: OffsetPaginationConfig;
  headers?: KeyValue[];
  extractVariables?: { name: string; jsonPointer: string }[];
  auth?: {
    type: 'none' | 'bearer' | 'basic' | 'apikey' | 'oauth2';
    bearer?: { token: string };
    basic?: { username: string; password: string };
    apikey?: { key: string; value: string; in: 'header' | 'query' };
    oauth2?: {
      grantType: 'password';
      tokenUrl: string;
      clientId: string;
      clientSecret: string;
      username: string;
      password: string;
      scope?: string;
    };
  };
  body?: {
    mode: 'json' | 'xml' | 'raw' | 'urlencoded' | 'formdata' | 'none';
    secret?: boolean;
    raw?: string;
    urlencoded?: KeyValue[];
    formdata?: KeyValue[];
  };
  assertions?: {
    expectedStatusCode?: number;
    maxResponseTimeMs?: number;
    jsonSchema?: Record<string, unknown>;
    xpathMatches?: { xpath: string; expectedValue?: string }[];
    jsonPointerAssertions?: JsonPointerAssertion[];
    responseHeaderAssertions?: ResponseHeaderAssertion[];
  };
}

export interface ApiRequestInput {
  request: RequestDefinition;
  environment: Record<string, string>;
}

export interface AssertionResult {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface CollectionRunResult {
  name: string;
  method: HttpMethod;
  status: number;
  statusText: string;
  durationMs: number;
  sizeBytes: number;
  passed: boolean;
  error: boolean;
  assertions: { label: string; passed: boolean }[];
  extractions: { name: string; jsonPointer: string; passed: boolean }[];
}

export interface CollectionRunReport {
  collectionName: string;
  environmentName: string;
  startedAt: string;
  completedAt: string;
  stoppedEarly: boolean;
  results: CollectionRunResult[];
}

export type RunReportFormat = 'json' | 'csv' | 'html';

export interface RunReportExportResult {
  canceled?: boolean;
  path?: string;
  error?: string;
}

export interface CurlCopyResult {
  canceled?: boolean;
  copied?: boolean;
  error?: string;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  sizeBytes: number;
  tests: AssertionResult[];
  error?: string;
}

export interface RelayApi {
  executeRequest(input: ApiRequestInput): Promise<ApiResponse>;
  importCollection(): Promise<CollectionImportResult>;
  loadCollection(): Promise<CollectionLoadResult>;
  saveCollection(collection: CollectionDocument): Promise<CollectionSaveResult>;
  chooseCollectionLocation(collection: CollectionDocument): Promise<CollectionLocationResult>;
  exportCollection(collection: CollectionDocument, includeSecrets?: boolean): Promise<CollectionExportResult>;
  exportRunReport(report: CollectionRunReport, format?: RunReportFormat): Promise<RunReportExportResult>;
  copyAsCurl(input: ApiRequestInput): Promise<CurlCopyResult>;
}