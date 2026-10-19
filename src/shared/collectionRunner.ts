import type { AssertionResult, CollectionItem, KeyValue, RequestDefinition, RequestTestCase } from './api';
export type { CollectionRunReport, CollectionRunResult } from './api';

export interface CollectionRunTarget {
  name: string;
  path: string;
  request: RequestDefinition;
}

export interface RunReadinessIssue {
  message: string;
  requestNames: string[];
}

export interface RunReadinessReport {
  blockers: RunReadinessIssue[];
  warnings: RunReadinessIssue[];
}

export function getRequestTestCases(request: RequestDefinition): RequestTestCase[] {
  return request.testCases?.length ? request.testCases : [{ name: 'Default', values: [] }];
}

export function getTestCaseVariables(testCase: RequestTestCase): Record<string, string> {
  return Object.fromEntries(testCase.values
    .filter((entry) => entry.enabled !== false && entry.key.trim())
    .map((entry) => [entry.key.trim(), entry.value]));
}

export function buildTestCaseEnvironment(
  environment: Record<string, string>,
  runVariables: Record<string, string>,
  testCase: RequestTestCase,
): Record<string, string> {
  return { ...environment, ...runVariables, ...getTestCaseVariables(testCase) };
}

export function buildOffsetPaginationRequest(request: RequestDefinition, pageIndex: number): RequestDefinition {
  const pagination = request.pagination;
  if (!pagination) return request;

  let queryParams = [...(request.queryParams ?? [])];
  const setParameter = (key: string, value: string): void => {
    let found = false;
    queryParams = queryParams.map((entry) => {
      if (entry.key !== key) return entry;
      if (found) return { ...entry, enabled: false };
      found = true;
      return { ...entry, value, enabled: true };
    });
    if (!found) queryParams.push({ key, value, enabled: true });
  };

  setParameter(pagination.limitParam, String(pagination.pageSize));
  setParameter(pagination.offsetParam, String(pagination.startOffset + pageIndex * pagination.pageSize));
  return { ...request, queryParams };
}

export function inferOffsetPaginationOnImport(items: CollectionItem[]): CollectionItem[] {
  return items.map((item) => {
    const children = item.items ? inferOffsetPaginationOnImport(item.items) : item.items;
    const request = item.request;
    if (!request || request.pagination) {
      return children === item.items ? item : { ...item, items: children };
    }

    const enabledParams = (request.queryParams ?? []).filter((entry) => entry.enabled !== false && entry.key.trim());
    const limits = enabledParams.filter((entry) => entry.key.trim().toLowerCase() === 'limit');
    const offsets = enabledParams.filter((entry) => entry.key.trim().toLowerCase() === 'offset');
    if (limits.length !== 1 || offsets.length !== 1 || limits[0].key.trim().toLowerCase() === offsets[0].key.trim().toLowerCase()) {
      return children === item.items ? item : { ...item, items: children };
    }

    const pageSizeText = limits[0].value.trim();
    const startOffsetText = offsets[0].value.trim();
    if (!/^\d+$/.test(pageSizeText) || !/^\d+$/.test(startOffsetText)) {
      return children === item.items ? item : { ...item, items: children };
    }
    const pageSize = Number(pageSizeText);
    const startOffset = Number(startOffsetText);
    if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000
      || !Number.isSafeInteger(startOffset) || startOffset > 1_000_000_000) {
      return children === item.items ? item : { ...item, items: children };
    }

    return {
      ...item,
      items: children,
      request: {
        ...request,
        pagination: {
          limitParam: limits[0].key.trim(),
          offsetParam: offsets[0].key.trim(),
          pageSize,
          startOffset,
          maxPages: 10,
          itemsJsonPointer: '',
        },
      },
    };
  });
}

export function getOffsetPaginationProgress(
  itemCount: number | null,
  pagination: NonNullable<RequestDefinition['pagination']>,
  completedPage: number,
): { hasMorePages: boolean; reachedPageLimit: boolean } {
  const fullPage = itemCount !== null && itemCount >= pagination.pageSize;
  return {
    hasMorePages: fullPage && completedPage < pagination.maxPages,
    reachedPageLimit: fullPage && completedPage >= pagination.maxPages,
  };
}

const variablePattern = /\{\{\s*([^{}]+?)\s*\}\}/g;

function collectVariables(value: unknown, variables: Set<string>): void {
  if (typeof value === 'string') {
    for (const match of value.matchAll(variablePattern)) variables.add(match[1].trim());
  } else if (Array.isArray(value)) {
    for (const item of value) collectVariables(item, variables);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectVariables(item, variables);
  }
}

function collectEnabledEntryVariables(entries: KeyValue[] | undefined, variables: Set<string>): void {
  for (const entry of entries ?? []) {
    if (entry.enabled === false || !entry.key.trim()) continue;
    collectVariables(entry.key, variables);
    collectVariables(entry.value, variables);
  }
}

function requestVariables(request: RequestDefinition): Set<string> {
  const variables = new Set<string>();
  collectVariables(request.url, variables);
  collectEnabledEntryVariables(request.queryParams, variables);
  collectEnabledEntryVariables(request.headers, variables);

  const auth = request.auth;
  if (auth?.type === 'bearer') collectVariables(auth.bearer, variables);
  else if (auth?.type === 'basic') collectVariables(auth.basic, variables);
  else if (auth?.type === 'apikey') collectVariables(auth.apikey, variables);
  else if (auth?.type === 'oauth2') collectVariables(auth.oauth2, variables);

  const body = request.body;
  if (body?.mode === 'urlencoded') collectEnabledEntryVariables(body.urlencoded, variables);
  else if (body?.mode === 'formdata') collectEnabledEntryVariables(body.formdata, variables);
  else if (body && body.mode !== 'none') collectVariables(body.raw, variables);
  for (const testCase of request.testCases ?? []) collectEnabledEntryVariables(testCase.values, variables);
  return variables;
}

function interpolate(value: string, environment: Record<string, string>): string {
  return value.replace(variablePattern, (placeholder, name: string) =>
    Object.hasOwn(environment, name.trim()) ? environment[name.trim()] : placeholder,
  );
}

export function inspectRunReadiness(
  requests: CollectionRunTarget[],
  environment: Record<string, string>,
): RunReadinessReport {
  const missingVariables = new Map<string, Set<string>>();
  const invalidUrls: string[] = [];
  const runtimeDependentUrls: string[] = [];
  const writeMethodRequests: string[] = [];
  const requestsWithoutChecks: string[] = [];
  const invalidPagination: string[] = [];
  const invalidResponseTimeLimits: string[] = [];
  const invalidTestCases: string[] = [];
  const missingFormDataFiles: string[] = [];
  const ambiguousTestCaseExtractions: string[] = [];
  const tooManyTestCases: string[] = [];
  const runVariables = new Set<string>();

  for (const { name, request } of requests) {
    if (request.body?.mode === 'formdata' && request.body.formdata?.some((entry) =>
      entry.enabled !== false && entry.key.trim() && entry.type === 'file' && !entry.fileToken,
    )) missingFormDataFiles.push(name);

    const testCaseNames = new Set<string>();
    if ((request.testCases?.length ?? 0) > 100) tooManyTestCases.push(name);
    for (const testCase of request.testCases ?? []) {
      const caseName = testCase.name.trim();
      const variableNames = new Set<string>();
      let hasDuplicateVariable = false;
      for (const value of testCase.values) {
        if (value.enabled === false || !value.key.trim()) continue;
        const variableName = value.key.trim();
        if (variableNames.has(variableName)) hasDuplicateVariable = true;
        variableNames.add(variableName);
      }
      if (!caseName || testCaseNames.has(caseName) || hasDuplicateVariable) invalidTestCases.push(name);
      testCaseNames.add(caseName);
    }
    if ((request.testCases?.length ?? 0) > 1 && request.extractVariables?.length) {
      ambiguousTestCaseExtractions.push(name);
    }

    const maxResponseTimeMs = request.assertions?.maxResponseTimeMs;
    if (maxResponseTimeMs !== undefined && (!Number.isInteger(maxResponseTimeMs) || maxResponseTimeMs < 1 || maxResponseTimeMs > 30_000)) {
      invalidResponseTimeLimits.push(name);
    }

    const pagination = request.pagination;
    if (pagination && (
      !pagination.limitParam.trim()
      || !pagination.offsetParam.trim()
      || pagination.limitParam === pagination.offsetParam
      || !Number.isInteger(pagination.pageSize)
      || pagination.pageSize < 1
      || pagination.pageSize > 1000
      || !Number.isInteger(pagination.startOffset)
      || pagination.startOffset < 0
      || pagination.startOffset > 1_000_000_000
      || !Number.isInteger(pagination.maxPages)
      || pagination.maxPages < 1
      || pagination.maxPages > 100
      || (pagination.itemsJsonPointer !== '' && (!pagination.itemsJsonPointer.startsWith('/') || /~(?![01])/.test(pagination.itemsJsonPointer)))
    )) invalidPagination.push(name);

    for (const variable of requestVariables(request)) {
      if (runVariables.has(variable)) continue;
      if (Object.hasOwn(environment, variable) && environment[variable].trim()) continue;
      const names = missingVariables.get(variable) ?? new Set<string>();
      names.add(name);
      missingVariables.set(variable, names);
    }

    const urlVariables = new Set<string>();
    collectVariables(request.url, urlVariables);
    const hasMissingUrlVariable = [...urlVariables].some((variable) =>
      !runVariables.has(variable) && (!Object.hasOwn(environment, variable) || !environment[variable].trim()),
    );
    if (!hasMissingUrlVariable) {
      if ([...urlVariables].some((variable) => runVariables.has(variable))) {
        runtimeDependentUrls.push(name);
      } else {
        try {
          new URL(interpolate(request.url, environment));
        } catch {
          invalidUrls.push(name);
        }
      }
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) writeMethodRequests.push(name);
    const assertions = request.assertions;
    const hasResponseChecks = assertions?.expectedStatusCode !== undefined
      || assertions?.maxResponseTimeMs !== undefined
      || Boolean(assertions?.jsonSchema)
      || Boolean(assertions?.xpathMatches?.length)
      || Boolean(assertions?.jsonPointerAssertions?.length)
      || Boolean(assertions?.responseHeaderAssertions?.length)
      || Boolean(request.extractVariables?.length);
    if (!hasResponseChecks) requestsWithoutChecks.push(name);
    for (const extraction of request.extractVariables ?? []) {
      if (extraction.name.trim()) runVariables.add(extraction.name);
    }
  }

  const blockers: RunReadinessIssue[] = [...missingVariables].map(([variable, names]) => ({
    message: `Environment variable "{{${variable}}}" is missing or blank.`,
    requestNames: [...names],
  }));
  for (const name of invalidUrls) {
    blockers.push({ message: 'Request URL is invalid after environment interpolation.', requestNames: [name] });
  }
  if (invalidPagination.length) {
    blockers.push({ message: 'Offset pagination settings are invalid; check parameter names, limits, and the JSON Pointer.', requestNames: invalidPagination });
  }
  if (invalidResponseTimeLimits.length) {
    blockers.push({ message: 'Maximum response time must be an integer between 1 and 30,000 milliseconds.', requestNames: invalidResponseTimeLimits });
  }
  if (invalidTestCases.length) {
    blockers.push({ message: 'Data cases need unique non-empty names and unique enabled variable keys.', requestNames: [...new Set(invalidTestCases)] });
  }
  if (missingFormDataFiles.length) {
    blockers.push({ message: 'Choose a file for each enabled form-data file field before running.', requestNames: missingFormDataFiles });
  }
  if (ambiguousTestCaseExtractions.length) {
    blockers.push({ message: 'A request with multiple data cases cannot also extract run-scoped variables for later requests.', requestNames: ambiguousTestCaseExtractions });
  }
  if (tooManyTestCases.length) {
    blockers.push({ message: 'A request can have at most 100 data cases.', requestNames: tooManyTestCases });
  }

  const warnings: RunReadinessIssue[] = [];
  for (const name of runtimeDependentUrls) {
    warnings.push({
      message: 'URL includes a value extracted during the run; its final form cannot be checked before the preceding response.',
      requestNames: [name],
    });
  }
  if (writeMethodRequests.length) {
    warnings.push({
      message: 'POST, PUT, PATCH, or DELETE requests will be sent; review their effects on the target system.',
      requestNames: writeMethodRequests,
    });
  }
  if (requestsWithoutChecks.length) {
    warnings.push({
      message: 'No response assertions or extractions are configured; HTTP status alone determines pass/fail.',
      requestNames: requestsWithoutChecks,
    });
  }

  return { blockers, warnings };
}

export function collectRunnableRequests(items: CollectionItem[], parentPath = ''): CollectionRunTarget[] {
  const requests: CollectionRunTarget[] = [];
  for (const [index, item] of items.entries()) {
    const path = parentPath ? `${parentPath}.${index}` : `${index}`;
    if (item.request) requests.push({ name: item.name, path, request: item.request });
    if (item.items) requests.push(...collectRunnableRequests(item.items, path));
  }
  return requests;
}

export function isRequestPassing(status: number, error: boolean, assertions: AssertionResult[], expectedStatusCode?: number): boolean {
  if (error) return false;
  if (expectedStatusCode === undefined && (status < 200 || status >= 400)) return false;
  if (assertions.length) return assertions.every((assertion) => assertion.passed);
  return status >= 200 && status < 400;
}

