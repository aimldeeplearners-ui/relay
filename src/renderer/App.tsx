import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';
import {
  Activity, AlertCircle, Check, ChevronDown, ChevronRight, Clock3, Cloud,
  Code2, Copy, Download, Ellipsis, Eye, EyeOff, FileCode2, Folder, FolderOpen, Globe2, History,
  FilePlus2, FolderInput, FolderPlus, HardDrive, KeyRound, Layers3, Play, Plus, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Square,
  Trash2, X,
} from 'lucide-react';
import type { ApiResponse, CollectionDocument, CollectionItem, CollectionRunReport, CollectionRunResult, HttpMethod, JsonPointerAssertion, KeyValue, OffsetPaginationConfig, RequestDefinition, RequestTestCase, ResponseHeaderAssertion, RunReportFormat } from '../shared/api';
import { buildOffsetPaginationRequest, buildTestCaseEnvironment, collectRunnableRequests, getOffsetPaginationProgress, getRequestTestCases, inferOffsetPaginationOnImport, inspectRunReadiness, isRequestPassing, type RunReadinessIssue } from '../shared/collectionRunner';
import { isSensitiveCredentialKey } from '../shared/credentialProtection';
import { countJsonArrayAtPointer, extractResponseVariables } from '../shared/responseExtraction';

type RequestTab = 'Params' | 'Headers' | 'Auth' | 'Body' | 'Tests';
type ResponseTab = 'Body' | 'Headers' | 'Tests';
type OAuth2PasswordConfig = NonNullable<NonNullable<RequestDefinition['auth']>['oauth2']>;
type XPathMatchRule = { xpath: string; expectedValue?: string };

const initialRequest: RequestDefinition = {
  method: 'GET',
  url: '{{baseUrl}}/posts/1',
  queryParams: [],
  headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
  auth: { type: 'none' },
  body: { mode: 'none', raw: '' },
  assertions: { expectedStatusCode: 200 },
};

const initialCollection: CollectionDocument = {
  info: { name: 'Relay workspace', version: '1.0.0' },
  environments: [
    { name: 'Local', values: [{ key: 'baseUrl', value: 'http://localhost:3000' }] },
    { name: 'Demo', values: [{ key: 'baseUrl', value: 'https://jsonplaceholder.typicode.com' }] },
  ],
  items: [{
    name: 'Demo APIs',
    type: 'collection',
    items: [{
      name: 'JSONPlaceholder',
      type: 'folder',
      items: [
        { name: 'Get a post', request: initialRequest },
        { name: 'Create a post', request: { ...initialRequest, method: 'POST', url: '{{baseUrl}}/posts', body: { mode: 'json', raw: '{\n  "title": "hello",\n  "body": "from Relay",\n  "userId": 1\n}' }, assertions: { expectedStatusCode: 201 } } },
      ],
    }],
  }],
};

const methods: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const requestTabs: RequestTab[] = ['Params', 'Headers', 'Auth', 'Body', 'Tests'];

function interpolate(value: string, environment: Record<string, string>): string {
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_placeholder, key: string) => environment[key] ?? `{{${key}}}`);
}

function updateEntry(entries: KeyValue[] | undefined, index: number, patch: Partial<KeyValue>): KeyValue[] {
  const next = [...(entries ?? [])];
  next[index] = { ...next[index], ...patch };
  return next;
}

function findFirstRequest(items: CollectionItem[], parentPath = ''): { item: CollectionItem; path: string } | null {
  for (const [index, item] of items.entries()) {
    const path = parentPath ? `${parentPath}.${index}` : `${index}`;
    if (item.request) return { item, path };
    if (item.items) {
      const nestedRequest = findFirstRequest(item.items, path);
      if (nestedRequest) return nestedRequest;
    }
  }
  return null;
}

function findFirstRequestInItem(item: CollectionItem, path: string): { item: CollectionItem; path: string } | null {
  if (item.request) return { item, path };
  return item.items ? findFirstRequest(item.items, path) : null;
}

function getCollectionItemAtPath(items: CollectionItem[], path: string): CollectionItem | undefined {
  if (path === 'workspace') return undefined;
  const indexes = path.split('.').map(Number);
  if (!indexes.length || indexes.some((index) => !Number.isInteger(index) || index < 0)) return undefined;
  let currentItems = items;
  let currentItem: CollectionItem | undefined;
  for (const index of indexes) {
    currentItem = currentItems[index];
    if (!currentItem) return undefined;
    currentItems = currentItem.items ?? [];
  }
  return currentItem;
}

function getCollectionChildrenAtPath(items: CollectionItem[], path: string): CollectionItem[] | undefined {
  if (path === 'workspace') return items;
  return getCollectionItemAtPath(items, path)?.items;
}

function updateCollectionItemAtPath(
  items: CollectionItem[],
  path: string,
  update: (item: CollectionItem) => CollectionItem,
): CollectionItem[] {
  const indexes = path.split('.').map(Number);
  const [index, ...remaining] = indexes;
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return items;
  return items.map((item, itemIndex) => {
    if (itemIndex !== index) return item;
    if (!remaining.length) return update(item);
    const children = item.items ?? [];
    const nextChildren = updateCollectionItemAtPath(children, remaining.join('.'), update);
    return nextChildren === children ? item : { ...item, items: nextChildren };
  });
}

function removeCollectionItemAtPath(items: CollectionItem[], path: string): CollectionItem[] {
  const indexes = path.split('.').map(Number);
  const [index, ...remaining] = indexes;
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return items;
  if (!remaining.length) return items.filter((_item, itemIndex) => itemIndex !== index);
  return items.map((item, itemIndex) => {
    if (itemIndex !== index) return item;
    const children = item.items ?? [];
    const nextChildren = removeCollectionItemAtPath(children, remaining.join('.'));
    return nextChildren === children ? item : { ...item, items: nextChildren };
  });
}

function countRequests(items: CollectionItem[]): number {
  return items.reduce((count, item) => count + Number(Boolean(item.request)) + countRequests(item.items ?? []), 0);
}

function countConfiguredAssertions(request: RequestDefinition): number {
  const assertions = request.assertions;
  return Number(assertions?.expectedStatusCode !== undefined)
    + Number(assertions?.maxResponseTimeMs !== undefined)
    + Number(Boolean(assertions?.jsonSchema))
    + (assertions?.xpathMatches?.length ?? 0)
    + (assertions?.jsonPointerAssertions?.length ?? 0)
    + (assertions?.responseHeaderAssertions?.length ?? 0);
}

function toWorkspaceCollection(imported: CollectionDocument): CollectionDocument {
  if (imported.info.name === 'Relay workspace') {
    return {
      ...imported,
      items: imported.items.map((item) => ({
        ...item,
        type: item.type ?? (item.items ? 'collection' : undefined),
      })),
    };
  }
  return {
    ...imported,
    info: { ...imported.info, name: 'Relay workspace' },
    items: [{ name: imported.info.name, type: 'collection', items: imported.items }],
  };
}

function uniqueName(items: CollectionItem[], baseName: string): string {
  const names = new Set(items.map((item) => item.name));
  let suffix = 1;
  while (names.has(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}

function mergeEnvironments(
  existing: CollectionDocument['environments'],
  incoming: CollectionDocument['environments'],
): { environments: NonNullable<CollectionDocument['environments']>; firstImportedName?: string } {
  const environments = [...(existing ?? [])];
  let firstImportedName: string | undefined;
  for (const [index, environment] of (incoming ?? []).entries()) {
    const existingEnvironment = environments.find((item) => item.name === environment.name);
    if (existingEnvironment && JSON.stringify(existingEnvironment.values ?? []) === JSON.stringify(environment.values ?? [])) {
      if (index === 0) firstImportedName = existingEnvironment.name;
      continue;
    }
    const name = existingEnvironment ? uniqueName(environments, environment.name) : environment.name;
    environments.push({ ...environment, name });
    if (index === 0) firstImportedName = name;
  }
  return { environments, firstImportedName };
}

function App(): JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const savedWidth = Number(window.localStorage.getItem('relay.sidebarWidth'));
      return savedWidth >= 200 && savedWidth <= 420 ? savedWidth : 248;
    } catch {
      return 248;
    }
  });
  const sidebarResizeActive = useRef(false);
  const [request, setRequest] = useState<RequestDefinition>(initialRequest);
  const [collection, setCollection] = useState<CollectionDocument>(initialCollection);
  const [requestTab, setRequestTab] = useState<RequestTab>('Params');
  const [responseTab, setResponseTab] = useState<ResponseTab>('Body');
  const [environmentName, setEnvironmentName] = useState('Demo');
  const [environmentNameDraft, setEnvironmentNameDraft] = useState('Demo');
  const [responsesByPath, setResponsesByPath] = useState<Record<string, ApiResponse>>({});
  const [loading, setLoading] = useState(false);
  const [runReport, setRunReport] = useState<CollectionRunReport | null>(null);
  const [runReportFormat, setRunReportFormat] = useState<RunReportFormat>('json');
  const [readinessReview, setReadinessReview] = useState<{ targetName: string; blockers: RunReadinessIssue[]; warnings: RunReadinessIssue[] } | null>(null);
  const [runProgress, setRunProgress] = useState('');
  const [runBusy, setRunBusy] = useState(false);
  const [stopOnFailure, setStopOnFailure] = useState(true);
  const stopRunRef = useRef(false);
  const [activeRequest, setActiveRequest] = useState('Get a post');
  const [selectedPath, setSelectedPath] = useState('0.0.0');
  const response = responsesByPath[selectedPath] ?? null;
  const [openRequestPaths, setOpenRequestPaths] = useState<string[]>([]);
  const [selectedCollectionPath, setSelectedCollectionPath] = useState('0');
  const [selectedContainerPath, setSelectedContainerPath] = useState('0.0');
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(() => new Set());
  const [newItemKind, setNewItemKind] = useState<'collection' | 'folder' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemParentPath, setNewItemParentPath] = useState('');
  const [collectionError, setCollectionError] = useState('');
  const [collectionNotice, setCollectionNotice] = useState('');
  const [collectionLoaded, setCollectionLoaded] = useState(false);
  const [collectionSaveAllowed, setCollectionSaveAllowed] = useState(false);
  const [collectionPath, setCollectionPath] = useState('');
  const [saveStatus, setSaveStatus] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [environmentEditorOpen, setEnvironmentEditorOpen] = useState(false);
  const [history, setHistory] = useState<{ method: HttpMethod; url: string; status: number; time: string }[]>([]);
  const selectedCollection = selectedCollectionPath === 'workspace' ? undefined : collection.items[Number(selectedCollectionPath)];
  const selectedEnvironment = collection.environments?.find((item) => item.name === environmentName);
  const availableEnvironments = collection.environments?.length ? collection.environments.map((item) => item.name) : ['Local', 'Demo'];
  const environment = selectedEnvironment
    ? Object.fromEntries((selectedEnvironment.values ?? []).filter((item) => item.enabled !== false).map((item) => [item.key, item.value]))
    : { baseUrl: environmentName === 'Local' ? 'http://localhost:3000' : 'https://jsonplaceholder.typicode.com' };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try {
        window.localStorage.setItem('relay.sidebarWidth', String(sidebarWidth));
      } catch {
        // Keep resizing available when local storage is disabled.
      }
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [sidebarWidth]);

  function resizeSidebar(width: number): void {
    setSidebarWidth(Math.max(200, Math.min(420, width)));
  }

  useEffect(() => {
    let active = true;
    void window.relay.loadCollection().then((result) => {
      if (!active) return;
      if (result.collection) {
        const workspace = toWorkspaceCollection(result.collection);
        setCollection(workspace);
        const firstRequest = findFirstRequest(workspace.items);
        if (firstRequest?.item.request) {
          setActiveRequest(firstRequest.item.name);
          setSelectedPath(firstRequest.path);
          setOpenRequestPaths([firstRequest.path]);
          setSelectedCollectionPath(firstRequest.path.split('.')[0]);
          setSelectedContainerPath(firstRequest.path.split('.').slice(0, -1).join('.'));
          setRequest(firstRequest.item.request);
        } else if (workspace.items.length) {
          setSelectedCollectionPath('0');
          setSelectedContainerPath('0');
        }
        if (workspace.environments?.length) setEnvironmentName(workspace.environments[0].name);
      }
      if (result.path) setCollectionPath(result.path);
      if (result.error) {
        setCollectionError(result.error);
        setSaveStatus('error');
      } else {
        setCollectionSaveAllowed(true);
        setSaveStatus('saved');
      }
      setCollectionLoaded(true);
    }).catch((error: unknown) => {
      if (!active) return;
      setCollectionError(error instanceof Error ? error.message : 'Unable to load the saved collection');
      setSaveStatus('error');
      setCollectionLoaded(true);
    });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!collectionLoaded) return;
    setCollection((current) => {
      const items = updateCollectionItemAtPath(current.items, selectedPath, (item) =>
        item.request ? { ...item, request } : item,
      );
      return items === current.items ? current : { ...current, items };
    });
  }, [request, selectedPath, collectionLoaded]);

  useEffect(() => {
    if (!collectionLoaded || !collectionSaveAllowed) return;
    setSaveStatus('saving');
    const timeout = window.setTimeout(() => {
      void window.relay.saveCollection(collection).then((result) => {
        setSaveStatus(result.saved ? 'saved' : 'error');
        if (result.path) setCollectionPath(result.path);
        if (result.error) setCollectionError(`Could not save collection: ${result.error}`);
      }).catch((error: unknown) => {
        setSaveStatus('error');
        setCollectionError(error instanceof Error ? `Could not save collection: ${error.message}` : 'Could not save collection');
      });
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [collection, collectionLoaded, collectionSaveAllowed]);

  function updateRequest(update: (current: RequestDefinition) => RequestDefinition): void {
    setRequest(update);
  }

  function updateOAuth2(patch: Partial<OAuth2PasswordConfig>): void {
    setRequest((current) => ({
      ...current,
      auth: {
        ...current.auth,
        type: 'oauth2',
        oauth2: {
          grantType: 'password',
          tokenUrl: '',
          clientId: '',
          clientSecret: '',
          username: '',
          password: '',
          ...current.auth?.oauth2,
          ...patch,
        },
      },
    }));
  }

  function updateAssertions(update: (current: RequestDefinition) => RequestDefinition): void {
    setRequest(update);
    setResponsesByPath((current) => {
      if (!(selectedPath in current)) return current;
      const next = { ...current };
      delete next[selectedPath];
      return next;
    });
    setRunReport(null);
  }

  function getRequestsToRun(): { name: string; requests: ReturnType<typeof collectRunnableRequests> } | null {
    const currentItems = updateCollectionItemAtPath(collection.items, selectedPath, (item) =>
      item.request ? { ...item, request } : item,
    );
    if (selectedContainerPath === 'workspace') {
      return { name: collection.info.name, requests: collectRunnableRequests(currentItems) };
    }

    const targetPath = activeRequest ? selectedCollectionPath : selectedContainerPath;
    const target = getCollectionItemAtPath(currentItems, targetPath);
    if (!target?.items) return null;
    return { name: target.name, requests: collectRunnableRequests([target]) };
  }

  async function runSelection(skipReadinessCheck = false): Promise<void> {
    const target = getRequestsToRun();
    if (!target?.requests.length || runBusy) return;

    if (!skipReadinessCheck) {
      const readiness = inspectRunReadiness(target.requests, environment);
      if (readiness.blockers.length || readiness.warnings.length) {
        setReadinessReview({ targetName: target.name, ...readiness });
        return;
      }
    }
    setReadinessReview(null);

    stopRunRef.current = false;
    setRunBusy(true);
    setRunProgress('Starting collection run');
    setCollectionError('');
    const startedAt = new Date();
    const results: CollectionRunResult[] = [];
    const runVariables: Record<string, string> = {};
    let stoppedEarly = false;
    let stoppedOnFailure = false;
    setRunReport({
      collectionName: target.name,
      environmentName,
      startedAt: startedAt.toISOString(),
      completedAt: startedAt.toISOString(),
      stoppedEarly: false,
      results: [],
    });

    try {
      for (const [index, entry] of target.requests.entries()) {
        if (stopRunRef.current) {
          stoppedEarly = true;
          break;
        }
        const pagination = entry.request.pagination;
        const maxPages = pagination?.maxPages ?? 1;
        const testCases = getRequestTestCases(entry.request);
        let stopAfterRequest = false;

        for (const [caseIndex, testCase] of testCases.entries()) {
          let pageNumber = 0;
          let continuePages = true;

          while (continuePages && pageNumber < maxPages) {
            if (stopRunRef.current) {
              stoppedEarly = true;
              stopAfterRequest = true;
              break;
            }

            const pageIndex = pageNumber;
            pageNumber += 1;
            const caseLabel = entry.request.testCases?.length ? ` · ${testCase.name}` : '';
            const pageLabel = pagination ? ` · page ${pageNumber} of ${maxPages}` : '';
            setRunProgress(`Running ${index + 1} of ${target.requests.length}: ${entry.name}${caseLabel}${pageLabel}`);
            let responseForRun: ApiResponse;
            try {
              responseForRun = await window.relay.executeRequest({
                request: pagination ? buildOffsetPaginationRequest(entry.request, pageIndex) : entry.request,
                environment: buildTestCaseEnvironment(environment, runVariables, testCase),
              });
            } catch {
              responseForRun = {
                status: 0,
                statusText: 'Request failed',
                headers: {},
                body: '',
                durationMs: 0,
                sizeBytes: 0,
                tests: [],
                error: 'Request failed',
              };
            }

            const extractionResult = responseForRun.error
              ? { variables: {}, outcomes: (entry.request.extractVariables ?? []).map(({ name, jsonPointer }) => ({ name, jsonPointer, passed: false })) }
              : extractResponseVariables(responseForRun.body, entry.request.extractVariables ?? []);
            Object.assign(runVariables, extractionResult.variables);
            const extractionAssertions = extractionResult.outcomes.map(({ name, jsonPointer, passed }) => ({
              label: `Extract ${name} from ${jsonPointer || '(root)'}`,
              passed,
            }));
            const pageItemCount = pagination && !responseForRun.error
              ? countJsonArrayAtPointer(responseForRun.body, pagination.itemsJsonPointer)
              : null;
            const paginationAssertions = pagination ? [{
              label: `Pagination array at ${pagination.itemsJsonPointer || '(root)'}`,
              passed: pageItemCount !== null,
              ...(pageItemCount === null ? { detail: 'Expected a JSON array at the configured pointer.' } : {}),
            }] : [];
            const paginationProgress = pagination
              ? getOffsetPaginationProgress(pageItemCount, pagination, pageNumber)
              : { hasMorePages: false, reachedPageLimit: false };
            if (paginationProgress.reachedPageLimit) {
              paginationAssertions.push({
                label: `Pagination maximum of ${maxPages} pages reached`,
                passed: false,
                detail: 'The last page was full; results may be incomplete.',
              });
            }

            const allAssertions = [...responseForRun.tests, ...extractionAssertions, ...paginationAssertions];
            const passed = isRequestPassing(
              responseForRun.status,
              Boolean(responseForRun.error),
              allAssertions,
              entry.request.assertions?.expectedStatusCode,
            );
            const caseSuffix = entry.request.testCases?.length ? ` · ${testCase.name}` : '';
            const pageSuffix = pagination ? ` (page ${pageNumber})` : '';
            results.push({
              name: `${entry.name}${caseSuffix}${pageSuffix}`,
              method: entry.request.method,
              status: responseForRun.status,
              statusText: responseForRun.statusText,
              durationMs: responseForRun.durationMs,
              sizeBytes: responseForRun.sizeBytes,
              passed,
              error: Boolean(responseForRun.error),
              assertions: allAssertions.map(({ label, passed: assertionPassed }) => ({ label, passed: assertionPassed })),
              extractions: extractionResult.outcomes,
            });
            setRunReport({
              collectionName: target.name,
              environmentName,
              startedAt: startedAt.toISOString(),
              completedAt: new Date().toISOString(),
              stoppedEarly: false,
              results: [...results],
            });

            if (!passed && stopOnFailure) {
              stoppedOnFailure = true;
              stoppedEarly = paginationProgress.hasMorePages || caseIndex < testCases.length - 1 || index < target.requests.length - 1;
              stopAfterRequest = true;
              break;
            }
            if (stopRunRef.current) {
              stoppedEarly = paginationProgress.hasMorePages || caseIndex < testCases.length - 1 || index < target.requests.length - 1;
              stopAfterRequest = true;
              break;
            }
            continuePages = paginationProgress.hasMorePages;
          }
          if (stopAfterRequest) break;
        }
        if (stopAfterRequest) break;
      }
    } finally {
      setRunReport({
        collectionName: target.name,
        environmentName,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        stoppedEarly,
        results,
      });
      setRunProgress(stopRunRef.current ? 'Run stopped' : stoppedOnFailure ? 'Stopped on first failure' : 'Run complete');
      setRunBusy(false);
    }
  }

  function stopCollectionRun(): void {
    stopRunRef.current = true;
    setRunProgress('Stopping after current request');
  }

  async function exportRunReport(): Promise<void> {
    if (!runReport) return;
    const result = await window.relay.exportRunReport(runReport, runReportFormat);
    if (result.error) setCollectionError(result.error);
    else if (result.path) setCollectionNotice(result.path);
  }

  async function copyRequestAsCurl(): Promise<void> {
    setCollectionError('');
    setCollectionNotice('');
    const result = await window.relay.copyAsCurl({ request, environment });
    if (result.error) setCollectionError(`Could not copy cURL command: ${result.error}`);
    else if (result.copied) setCollectionNotice('cURL command copied to clipboard. Treat it as sensitive if it contains credentials.');
  }

  const requestsToRun = getRequestsToRun();
  const runPassedCount = runReport?.results.filter((result) => result.passed).length ?? 0;

  async function sendRequest(): Promise<void> {
    const requestPath = selectedPath;
    const requestToSend = request;
    const environmentToUse = environment;
    setLoading(true);
    setRunReport(null);
    try {
      const result = await window.relay.executeRequest({ request: requestToSend, environment: environmentToUse });
      setResponsesByPath((current) => ({ ...current, [requestPath]: result }));
      setHistory((entries) => [{
        method: requestToSend.method,
        url: interpolate(requestToSend.url, environmentToUse),
        status: result.status,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }, ...entries].slice(0, 12));
    } catch (error) {
      const result = { status: 0, statusText: 'Request failed', headers: {}, body: '', durationMs: 0, sizeBytes: 0, tests: [], error: error instanceof Error ? error.message : 'Unable to send request' };
      setResponsesByPath((current) => ({ ...current, [requestPath]: result }));
    } finally {
      setLoading(false);
    }
  }

  function selectRequest(item: CollectionItem, path: string): void {
    if (!item.request) return;
    setOpenRequestPaths((paths) => paths.includes(path) ? paths : [...paths, path]);
    setActiveRequest(item.name);
    setSelectedPath(path);
    setSelectedCollectionPath(path.split('.')[0]);
    setSelectedContainerPath(path.split('.').slice(0, -1).join('.'));
    setRequest(item.request);
    setRunReport(null);
  }

  function closeRequestTab(path: string): void {
    const pathIndex = openRequestPaths.indexOf(path);
    const remainingPaths = openRequestPaths.filter((itemPath) => itemPath !== path);
    setOpenRequestPaths(remainingPaths);
    if (selectedPath !== path) return;

    const nextPath = remainingPaths[Math.min(pathIndex, remainingPaths.length - 1)];
    const nextItem = nextPath ? getCollectionItemAtPath(collection.items, nextPath) : undefined;
    if (nextPath && nextItem?.request) {
      selectRequest(nextItem, nextPath);
      return;
    }

    setActiveRequest('');
    setSelectedPath(selectedContainerPath);
    setRequest({ method: 'GET', url: 'https://', headers: [], auth: { type: 'none' }, body: { mode: 'none' } });
  }

  function selectContainer(item: CollectionItem, path: string): void {
    if (!item.items) return;
    const collectionPath = path.split('.')[0];
    setSelectedCollectionPath(collectionPath);
    setSelectedContainerPath(path);
    setSelectedPath(path);
    setActiveRequest('');
    setRequest({ method: 'GET', url: 'https://', headers: [], auth: { type: 'none' }, body: { mode: 'none' } });
  }

  function selectWorkspace(): void {
    setSelectedCollectionPath('workspace');
    setSelectedContainerPath('workspace');
    setSelectedPath('workspace');
    setActiveRequest('');
    setRequest({ method: 'GET', url: 'https://', headers: [], auth: { type: 'none' }, body: { mode: 'none' } });
  }

  function toggleContainer(path: string): void {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function deleteRequest(path: string, name: string): void {
    if (countRequests(collection.items) <= 1) return;
    if (!window.confirm(`Delete "${name}" from this collection?`)) return;

    const items = removeCollectionItemAtPath(collection.items, path);
    setResponsesByPath({});
    setOpenRequestPaths([]);
    setCollection((current) => ({ ...current, items }));
    const firstRequest = findFirstRequest(items);
    if (firstRequest?.item.request) selectRequest(firstRequest.item, firstRequest.path);
  }

  function deleteFolder(path: string, item: CollectionItem): void {
    if (!item.items) return;
  setResponsesByPath({});
    const requestsInFolder = countRequests(item.items);
    if (countRequests(collection.items) - requestsInFolder < 1) {
      setCollectionError('The workspace must keep at least one request.');
      return;
    }
    if (!window.confirm(`Delete folder "${item.name}" and everything inside it?`)) return;

    const items = removeCollectionItemAtPath(collection.items, path);
    setOpenRequestPaths([]);
    setCollection((current) => ({ ...current, items }));
    setCollapsedPaths(new Set());
    const firstRequest = findFirstRequest(items);
    if (firstRequest?.item.request) selectRequest(firstRequest.item, firstRequest.path);
    else selectWorkspace();
  }

  function deleteCollection(path: string, item: CollectionItem): void {
    if (item.type === 'folder') return;
    if (!window.confirm(`Delete collection "${item.name}" and all folders and requests inside it?`)) return;

    const items = removeCollectionItemAtPath(collection.items, path);
    setResponsesByPath({});
    setOpenRequestPaths([]);
    setCollection((current) => ({ ...current, items }));
    setCollapsedPaths(new Set());
    const firstRequest = findFirstRequest(items);
    if (firstRequest?.item.request) {
      selectRequest(firstRequest.item, firstRequest.path);
      return;
    }
    if (items.length) {
      selectContainer(items[0], '0');
      return;
    }
    selectWorkspace();
  }

  function createRequest(): void {
    if (selectedContainerPath === 'workspace') return;
    const parentPath = getCollectionChildrenAtPath(collection.items, selectedContainerPath)
      ? selectedContainerPath
      : selectedCollectionPath;
    const parentItems = getCollectionChildrenAtPath(collection.items, parentPath);
    if (!parentItems) return;
    const name = uniqueName(parentItems, 'New request');
    const newRequest: RequestDefinition = {
      method: 'GET',
      url: 'https://',
      headers: [],
      auth: { type: 'none' },
      body: { mode: 'none' },
    };
    const path = `${parentPath}.${parentItems.length}`;
    setCollection((current) => ({
      ...current,
      items: updateCollectionItemAtPath(current.items, parentPath, (item) => ({
        ...item,
        items: [...(item.items ?? []), { name, request: newRequest }],
      })),
    }));
    setSelectedPath(path);
    setOpenRequestPaths((paths) => paths.includes(path) ? paths : [...paths, path]);
    setSelectedCollectionPath(parentPath.split('.')[0]);
    setSelectedContainerPath(parentPath);
    setActiveRequest(name);
    setRequest(newRequest);
  }

  function openNewItemDialog(kind: 'collection' | 'folder'): void {
    const parentPath = kind === 'folder'
      ? (getCollectionChildrenAtPath(collection.items, selectedContainerPath) ? selectedContainerPath : selectedCollectionPath)
      : '';
    const parentItems = kind === 'collection'
      ? collection.items
      : getCollectionChildrenAtPath(collection.items, parentPath) ?? [];
    setNewItemKind(kind);
    setNewItemParentPath(parentPath);
    setNewItemName(uniqueName(parentItems, kind === 'collection' ? 'New collection' : 'New folder'));
  }

  function createNamedItem(): void {
    if (!newItemKind) return;
    const name = newItemName.trim();
    if (!name) return;

    if (newItemKind === 'collection') {
      if (collection.items.some((item) => item.name === name)) {
        setCollectionError(`A collection named "${name}" already exists.`);
        return;
      }
      const path = String(collection.items.length);
      setCollection((current) => ({ ...current, items: [...current.items, { name, type: 'collection', items: [] }] }));
      setSelectedCollectionPath(path);
      setSelectedContainerPath(path);
      setSelectedPath(path);
    } else {
      const parentItems = getCollectionChildrenAtPath(collection.items, newItemParentPath);
      if (!parentItems) return;
      if (parentItems.some((item) => item.name === name)) {
        setCollectionError(`A folder named "${name}" already exists here.`);
        return;
      }
      const path = newItemParentPath === 'workspace'
        ? String(parentItems.length)
        : `${newItemParentPath}.${parentItems.length}`;
      const newFolder: CollectionItem = { name, type: 'folder', items: [] };
      setCollection((current) => newItemParentPath === 'workspace'
        ? { ...current, items: [...current.items, newFolder] }
        : {
          ...current,
          items: updateCollectionItemAtPath(current.items, newItemParentPath, (item) => ({
            ...item,
            items: [...(item.items ?? []), newFolder],
          })),
        });
      setSelectedCollectionPath(path.split('.')[0]);
      setSelectedContainerPath(path);
      setSelectedPath(path);
    }

    setActiveRequest('');
    setRequest({ method: 'GET', url: 'https://', headers: [], auth: { type: 'none' }, body: { mode: 'none' } });
    setCollectionError('');
    setNewItemKind(null);
  }

  function renameActiveRequest(name: string): void {
    setActiveRequest(name);
    setCollection((current) => ({
      ...current,
      items: updateCollectionItemAtPath(current.items, selectedPath, (item) => ({ ...item, name })),
    }));
  }

  function addEnvironment(): void {
    const environmentsInCollection = collection.environments ?? [];
    let suffix = 1;
    while (environmentsInCollection.some((item) => item.name === `Environment ${suffix}`)) suffix += 1;
    const name = `Environment ${suffix}`;
    setCollection((current) => ({
      ...current,
      environments: [...(current.environments ?? []), { name, values: [] }],
    }));
    setEnvironmentName(name);
    setEnvironmentNameDraft(name);
  }

  function renameEnvironment(name: string): void {
    const previousName = environmentName;
    const nextName = name.trim();
    if (!nextName || nextName === previousName) {
      setEnvironmentNameDraft(previousName);
      return;
    }
    if ((collection.environments ?? []).some((item) => item.name === nextName && item.name !== previousName)) {
      setEnvironmentNameDraft(previousName);
      return;
    }
    setCollection((current) => ({
      ...current,
      environments: (current.environments ?? []).map((item) => item.name === previousName ? { ...item, name: nextName } : item),
    }));
    setEnvironmentName(nextName);
    setEnvironmentNameDraft(nextName);
  }

  function updateEnvironmentValues(values: KeyValue[]): void {
    const currentName = environmentName;
    setCollection((current) => ({
      ...current,
      environments: (current.environments ?? []).map((item) => item.name === currentName ? { ...item, values } : item),
    }));
  }

  function deleteCurrentEnvironment(): void {
    const environmentsInCollection = collection.environments ?? [];
    if (environmentsInCollection.length < 2) return;
    const remaining = environmentsInCollection.filter((item) => item.name !== environmentName);
    setCollection((current) => ({
      ...current,
      environments: remaining,
    }));
    setEnvironmentName(remaining[0].name);
    setEnvironmentNameDraft(remaining[0].name);
  }

  async function chooseCollectionLocation(): Promise<void> {
    setCollectionError('');
    const result = await window.relay.chooseCollectionLocation(collection);
    if (result.canceled) return;
    if (result.error || !result.path) {
      setCollectionError(result.error ?? 'Unable to choose a collection save location');
      setSaveStatus('error');
      return;
    }
    setCollectionPath(result.path);
    setCollectionSaveAllowed(true);
    setSaveStatus('saved');
  }

  async function importCollection(source: 'relay' | 'openapi' = 'relay'): Promise<void> {
    setCollectionError('');
    setCollectionNotice('');
    const result = source === 'openapi'
      ? await window.relay.importOpenApiDefinition()
      : await window.relay.importCollection();
    if (result.canceled) return;
    if (result.error || !result.collection) {
      setCollectionError(result.error ?? (source === 'openapi' ? 'Unable to import API definition' : 'Unable to import collection'));
      return;
    }

    setCollectionError('');
    setCollectionSaveAllowed(true);
    const importedWorkspace = toWorkspaceCollection(result.collection);
    importedWorkspace.items = inferOffsetPaginationOnImport(importedWorkspace.items);
    const isWorkspaceExport = result.collection.info.name === 'Relay workspace';
    const mergedEnvironments = mergeEnvironments(collection.environments, importedWorkspace.environments);
    const insertedPaths: string[] = [];
    let nextItems = [...collection.items];

    if (selectedContainerPath === 'workspace') {
      const itemsToAppend = isWorkspaceExport
        ? importedWorkspace.items
        : importedWorkspace.items.slice(0, 1).map((item) => ({ ...item, type: 'collection' as const }));
      for (const item of itemsToAppend) {
        const appendedItem = { ...item, name: uniqueName(nextItems, item.name) };
        insertedPaths.push(String(nextItems.length));
        nextItems = [...nextItems, appendedItem];
      }
    } else {
      let targetPath = selectedContainerPath;
      let targetItems = getCollectionChildrenAtPath(collection.items, targetPath);
      if (!targetItems) {
        targetPath = selectedCollectionPath;
        targetItems = getCollectionChildrenAtPath(collection.items, targetPath);
      }
      if (!targetItems) {
        setCollectionError('Select a collection, folder, or workspace root before importing.');
        return;
      }

      const importedChildren = isWorkspaceExport
        ? importedWorkspace.items
        : importedWorkspace.items[0]?.items ?? [];
      const folderName = uniqueName(targetItems, isWorkspaceExport ? 'Imported workspace' : result.collection.info.name);
      const folderPath = `${targetPath}.${targetItems.length}`;
      const importedFolder: CollectionItem = { name: folderName, type: 'folder', items: importedChildren };
      nextItems = updateCollectionItemAtPath(collection.items, targetPath, (item) => ({
        ...item,
        items: [...(item.items ?? []), importedFolder],
      }));
      insertedPaths.push(folderPath);
    }

    setCollection({ ...collection, items: nextItems, environments: mergedEnvironments.environments });
    if (mergedEnvironments.firstImportedName) {
      setEnvironmentName(mergedEnvironments.firstImportedName);
      setEnvironmentNameDraft(mergedEnvironments.firstImportedName);
    }

    for (const path of insertedPaths) {
      const item = getCollectionItemAtPath(nextItems, path);
      if (!item) continue;
      const firstRequest = findFirstRequestInItem(item, path);
      if (firstRequest) {
        selectRequest(firstRequest.item, firstRequest.path);
        return;
      }
      if (item.items) {
        selectContainer(item, path);
        return;
      }
    }
  }

  async function exportCollection(): Promise<void> {
    setCollectionError('');
    setCollectionNotice('');
    const workspaceWithCurrentRequest: CollectionDocument = {
      ...collection,
      items: updateCollectionItemAtPath(collection.items, selectedPath, (item) =>
        item.request ? { ...item, request } : item,
      ),
    };
    let collectionToExport = workspaceWithCurrentRequest;
    if (selectedContainerPath !== 'workspace') {
      const selectedItem = getCollectionItemAtPath(workspaceWithCurrentRequest.items, selectedContainerPath);
      if (!selectedItem?.items) {
        setCollectionError('Select a collection or folder to export.');
        return;
      }
      collectionToExport = {
        ...workspaceWithCurrentRequest,
        info: { ...workspaceWithCurrentRequest.info, name: selectedItem.name },
        items: selectedItem.items,
      };
    }
    const includeSecrets = window.confirm('Include plaintext credential values in this export? Choose OK to include them, or Cancel to export a redacted copy.');
    const result = await window.relay.exportCollection(collectionToExport, includeSecrets);
    if (result.canceled) return;
    if (result.error || !result.path) {
      setCollectionError(result.error ?? 'Unable to export the collection');
      return;
    }
    setCollectionNotice(result.path);
  }

  const prettyBody = (() => {
    if (!response?.body) return '';
    try { return JSON.stringify(JSON.parse(response.body), null, 2); } catch { return response.body; }
  })();

  return (
    <div className="app-shell" style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      <header className="topbar">
        <div className="brand-mark"><Activity size={18} strokeWidth={2.6} /></div>
        <span className="brand-name">Relay</span>
        <div className="topbar-divider" />
        <div className="workspace-label"><Layers3 size={15} /> Local workspace</div>
        <div className="topbar-spacer" />
        <div className="sync-status" title={collectionPath || 'Collection save location'}><span className={`sync-dot ${saveStatus === 'error' ? 'save-error' : ''}`} />{saveStatus === 'loading' ? 'Loading collection' : saveStatus === 'saving' ? 'Saving locally' : saveStatus === 'saved' ? 'Saved locally' : 'Save failed'}</div>
        <button className="icon-button" title="Settings"><Settings2 size={17} /></button>
        <div className="avatar">JD</div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-topline">
          <span className="eyebrow">WORKSPACE</span>
          <button className="icon-button small" title="Search"><Search size={15} /></button>
        </div>
        <div className="environment-block">
          <label htmlFor="environment-select">Environment</label>
          <div className="environment-controls"><div className="select-wrap"><Globe2 size={15} /><span className="environment-select-value">{environmentName}</span><select id="environment-select" aria-label="Environment" value={availableEnvironments.includes(environmentName) ? environmentName : availableEnvironments[0]} onChange={(event) => { setEnvironmentName(event.target.value); setEnvironmentNameDraft(event.target.value); }}>{availableEnvironments.map((name) => <option key={name}>{name}</option>)}</select><ChevronDown size={13} /></div><button className="icon-button small" title="Manage environments" aria-label="Manage environments" disabled={!collectionLoaded} onClick={() => { setEnvironmentNameDraft(environmentName); setEnvironmentEditorOpen(true); }}><SlidersHorizontal size={15} /></button></div>
        </div>

        <div className="section-heading"><span>COLLECTIONS</span><div className="collection-actions"><button className="icon-button small" title="New collection" aria-label="New collection" disabled={!collectionLoaded} onClick={() => openNewItemDialog('collection')}><Layers3 size={15} /></button><button className="icon-button small" title="New folder in selected location" aria-label="New folder" disabled={!collectionLoaded || !getCollectionChildrenAtPath(collection.items, selectedContainerPath)} onClick={() => openNewItemDialog('folder')}><FolderPlus size={15} /></button><button className="icon-button small" title="New request in selected collection or folder" aria-label="New request" disabled={!collectionLoaded || selectedContainerPath === 'workspace' || !getCollectionChildrenAtPath(collection.items, selectedContainerPath)} onClick={createRequest}><FilePlus2 size={15} /></button><button className="icon-button small" title="Choose workspace autosave location" aria-label="Choose workspace autosave location" disabled={!collectionLoaded} onClick={() => void chooseCollectionLocation()}><HardDrive size={15} /></button><button className="icon-button small" title={selectedContainerPath === 'workspace' ? 'Export workspace copy' : 'Export selected collection or folder'} aria-label="Export selected scope as JSON copy" disabled={!collectionLoaded} onClick={() => void exportCollection()}><FolderInput size={15} /></button><button className="icon-button small" title="Import Relay collection JSON" aria-label="Import Relay collection JSON" disabled={!collectionLoaded} onClick={() => void importCollection()}><Download size={15} /></button><button className="icon-button small" title="Import OpenAPI definition" aria-label="Import OpenAPI definition" disabled={!collectionLoaded} onClick={() => void importCollection('openapi')}><FileCode2 size={15} /></button></div></div>
        <button className={`collection-root workspace-root ${selectedContainerPath === 'workspace' ? 'active-container' : ''}`} onClick={selectWorkspace}><Layers3 size={15} /><span>{collection.info.name}</span></button>
        <CollectionTree items={collection.items} selectedPath={selectedPath} selectedContainerPath={selectedContainerPath} collapsedPaths={collapsedPaths} onToggle={toggleContainer} onSelect={selectRequest} onSelectContainer={selectContainer} onDelete={deleteRequest} onDeleteFolder={deleteFolder} onDeleteCollection={deleteCollection} canDelete={countRequests(collection.items) > 1} />
        {collectionError && <div className="import-error" role="alert">{collectionError}</div>}
        {collectionNotice && <div className="collection-notice" title={collectionNotice}>Exported copy: {collectionNotice}</div>}

        <div className="sidebar-section-heading"><span>HISTORY</span><History size={14} /></div>
        {history.length ? history.slice(0, 5).map((entry, index) => (
          <div className="history-row" key={`${entry.time}-${index}`}><span className={`history-method ${entry.method.toLowerCase()}`}>{entry.method}</span><span className="history-detail"><b>{entry.url.replace(/^https?:\/\//, '')}</b><small>{entry.time} · {entry.status || 'ERR'}</small></span></div>
        )) : <div className="history-empty"><Clock3 size={14} /><span>Requests you send will show up here.</span></div>}

        <div className="sidebar-bottom"><div className="sidebar-help-icon"><Sparkles size={14} /></div><div><strong>Built for clear answers</strong><span>REST &amp; SOAP, without the noise.</span></div></div>
      </aside>

      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={200}
        aria-valuemax={420}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={(event) => {
          sidebarResizeActive.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (sidebarResizeActive.current) resizeSidebar(event.clientX);
        }}
        onPointerUp={(event) => {
          sidebarResizeActive.current = false;
          resizeSidebar(event.clientX);
        }}
        onPointerCancel={() => { sidebarResizeActive.current = false; }}
        onLostPointerCapture={() => { sidebarResizeActive.current = false; }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') resizeSidebar(sidebarWidth - 16);
          else if (event.key === 'ArrowRight') resizeSidebar(sidebarWidth + 16);
          else return;
          event.preventDefault();
        }}
      />

      <main className="main-content">
        <div className="breadcrumb"><span>{collection.info.name}</span><ChevronRight size={13} /><span>{selectedContainerPath === 'workspace' ? 'Workspace root' : selectedCollection?.name ?? 'Collection'}</span>{activeRequest && <><ChevronRight size={13} /><strong>{activeRequest}</strong></>}<button className="icon-button small" title="Request options"><Ellipsis size={16} /></button></div>

        <div className="request-tab-strip" role="tablist" aria-label="Open requests">
          {openRequestPaths.map((path) => {
            const item = getCollectionItemAtPath(collection.items, path);
            if (!item?.request) return null;
            const isActive = selectedPath === path;
            return <div className={`request-tab-item ${isActive ? 'active' : ''}`} key={path}>
              <button className="request-tab-select" role="tab" aria-selected={isActive} onClick={() => selectRequest(item, path)}><span className={`method-mini ${item.request.method.toLowerCase()}`}>{item.request.method}</span><span>{item.name}</span></button>
              <button className="request-tab-close" title={`Close ${item.name}`} aria-label={`Close ${item.name}`} onClick={() => closeRequestTab(path)}><X size={13} /></button>
            </div>;
          })}
          {openRequestPaths.length === 0 && <span className="request-tabs-empty">Open a request from the collection tree</span>}
        </div>

        <section className="request-section">
          <div className="request-title-row"><div><div className="eyebrow request-eyebrow">REQUEST BUILDER</div><input className="request-name-input" aria-label="Request name" value={activeRequest} onChange={(event) => renameActiveRequest(event.target.value)} /></div><div className="request-title-actions"><label className="stop-on-failure"><input type="checkbox" checked={stopOnFailure} disabled={runBusy} onChange={(event) => setStopOnFailure(event.target.checked)} /> Stop on failure</label><button className="runner-button" disabled={!requestsToRun?.requests.length || (runBusy && stopRunRef.current)} onClick={() => runBusy ? stopCollectionRun() : void runSelection()}>{runBusy ? <Square size={13} /> : <Play size={13} />}{runBusy ? 'Stop run' : 'Run selection'}</button><button className="quiet-button" disabled={loading} onClick={() => void copyRequestAsCurl()}><Copy size={14} /> Copy as cURL</button></div></div>
          <div className="url-bar">
            <select className={`method-select method-${request.method.toLowerCase()}`} aria-label="HTTP method" value={request.method} onChange={(event) => updateRequest((current) => ({ ...current, method: event.target.value as HttpMethod }))}>{methods.map((method) => <option key={method}>{method}</option>)}</select>
            <div className="url-input-wrap"><input aria-label="Request URL" value={request.url} onChange={(event) => updateRequest((current) => ({ ...current, url: event.target.value }))} onKeyDown={(event) => { if (event.key === 'Enter') void sendRequest(); }} spellCheck={false} /></div>
            <button className="send-button" onClick={() => void sendRequest()} disabled={loading}><Send size={15} />{loading ? 'Sending' : 'Send'}</button>
          </div>
          {request.url.includes('{{') && <div className="url-preview"><span className="url-preview-label">RESOLVES TO</span><span className="url-preview-value">{interpolate(request.url, environment)}</span></div>}

          <div className="request-tabs" role="tablist" aria-label="Request settings">{requestTabs.map((tab) => <button className={requestTab === tab ? 'tab active' : 'tab'} key={tab} role="tab" aria-selected={requestTab === tab} onClick={() => setRequestTab(tab)}>{tab}{tab === 'Headers' && <span className="tab-count">1</span>}{tab === 'Tests' && <span className="tab-count">{countConfiguredAssertions(request)}</span>}</button>)}</div>

          <div className="request-config">
            {requestTab === 'Params' && <><div className="config-table"><div className="table-caption">Query parameters <button className="text-button" onClick={() => updateRequest((current) => ({ ...current, queryParams: [...(current.queryParams ?? []), { key: '', value: '', enabled: true }] }))}><Plus size={13} /> Add parameter</button></div><KeyValueEditor entries={request.queryParams ?? []} onChange={(entries) => updateRequest((current) => ({ ...current, queryParams: entries }))} emptyLabel="No query parameters" /></div><PaginationEditor request={request} onChange={(pagination) => updateRequest((current) => ({ ...current, pagination }))} /></>}
            {requestTab === 'Headers' && <div className="config-table"><div className="table-caption">Request headers <button className="text-button" onClick={() => updateRequest((current) => ({ ...current, headers: [...(current.headers ?? []), { key: '', value: '', enabled: true }] }))}><Plus size={13} /> Add header</button></div><KeyValueEditor entries={request.headers ?? []} onChange={(entries) => updateRequest((current) => ({ ...current, headers: entries }))} emptyLabel="No headers" /></div>}
            {requestTab === 'Auth' && <div className="auth-panel"><div className="auth-select-row"><KeyRound size={17} /><div><strong>Authorization</strong><span>Credential values are protected with OS storage.</span></div><select aria-label="Authorization type" value={request.auth?.type ?? 'none'} onChange={(event) => setRequest((current) => ({ ...current, auth: { ...current.auth, type: event.target.value as NonNullable<RequestDefinition['auth']>['type'] } }))}><option value="none">No Auth</option><option value="bearer">Bearer Token</option><option value="basic">Basic Auth</option><option value="apikey">API Key</option><option value="oauth2">OAuth2 Password Grant (legacy)</option></select></div>
              {request.auth?.type === 'bearer' && <label className="auth-field">Token<input type="password" value={request.auth.bearer?.token ?? ''} placeholder="{{bearerToken}}" onChange={(event) => setRequest((current) => ({ ...current, auth: { ...current.auth, type: 'bearer', bearer: { token: event.target.value } } }))} /></label>}
              {request.auth?.type === 'basic' && <div className="auth-fields"><label className="auth-field">Username<input value={request.auth.basic?.username ?? ''} onChange={(event) => setRequest((current) => ({ ...current, auth: { ...current.auth, type: 'basic', basic: { username: event.target.value, password: current.auth?.basic?.password ?? '' } } }))} /></label><label className="auth-field">Password<input type="password" value={request.auth.basic?.password ?? ''} onChange={(event) => setRequest((current) => ({ ...current, auth: { ...current.auth, type: 'basic', basic: { username: current.auth?.basic?.username ?? '', password: event.target.value } } }))} /></label></div>}
              {request.auth?.type === 'apikey' && <div className="auth-fields"><label className="auth-field">Key<input value={request.auth.apikey?.key ?? ''} onChange={(event) => setRequest((current) => ({ ...current, auth: { ...current.auth, type: 'apikey', apikey: { key: event.target.value, value: current.auth?.apikey?.value ?? '', in: current.auth?.apikey?.in ?? 'header' } } }))} /></label><label className="auth-field">Value<input type="password" value={request.auth.apikey?.value ?? ''} onChange={(event) => setRequest((current) => ({ ...current, auth: { ...current.auth, type: 'apikey', apikey: { key: current.auth?.apikey?.key ?? '', value: event.target.value, in: current.auth?.apikey?.in ?? 'header' } } }))} /></label><label className="auth-field">Add to<select value={request.auth.apikey?.in ?? 'header'} onChange={(event) => setRequest((current) => ({ ...current, auth: { ...current.auth, type: 'apikey', apikey: { key: current.auth?.apikey?.key ?? '', value: current.auth?.apikey?.value ?? '', in: event.target.value as 'header' | 'query' } } }))}><option value="header">Header</option><option value="query">Query params</option></select></label></div>}
              {request.auth?.type === 'oauth2' && <div className="oauth2-fields"><label className="auth-field">Token URL<input type="url" value={request.auth.oauth2?.tokenUrl ?? ''} placeholder="https://idp.example.com/token" onChange={(event) => updateOAuth2({ tokenUrl: event.target.value })} /></label><div className="auth-fields"><label className="auth-field">Client ID<input value={request.auth.oauth2?.clientId ?? ''} onChange={(event) => updateOAuth2({ clientId: event.target.value })} /></label><label className="auth-field">Client secret<input type="password" value={request.auth.oauth2?.clientSecret ?? ''} onChange={(event) => updateOAuth2({ clientSecret: event.target.value })} /></label></div><div className="auth-fields"><label className="auth-field">Username<input value={request.auth.oauth2?.username ?? ''} onChange={(event) => updateOAuth2({ username: event.target.value })} /></label><label className="auth-field">Password<input type="password" value={request.auth.oauth2?.password ?? ''} onChange={(event) => updateOAuth2({ password: event.target.value })} /></label></div><label className="auth-field">Scope (optional)<input value={request.auth.oauth2?.scope ?? ''} onChange={(event) => updateOAuth2({ scope: event.target.value })} /></label><div className="auth-note">Legacy OAuth2 password grant. Token is fetched automatically and cached in memory until near expiry. Confirm your identity provider still allows this grant.</div></div>}
              <div className="auth-note"><ShieldCheck size={15} /> Environment variables can be used for secrets, e.g. <code>{'{{bearerToken}}'}</code></div></div>}
            {requestTab === 'Body' && <div className="body-editor">
              <div className="body-toolbar"><div className="body-modes">{(['none', 'json', 'xml', 'raw', 'urlencoded', 'formdata'] as const).map((mode) => <button key={mode} className={request.body?.mode === mode ? 'mode active' : 'mode'} onClick={() => updateRequest((current) => ({ ...current, body: { ...(current.body ?? { mode: 'none' }), mode } }))}>{mode === 'json' ? 'JSON' : mode === 'xml' ? 'XML' : mode === 'raw' ? 'Raw' : mode === 'urlencoded' ? 'URL encoded' : mode === 'formdata' ? 'Form-data' : 'None'}</button>)}</div>{request.body?.mode === 'json' || request.body?.mode === 'xml' || request.body?.mode === 'raw' ? <label className="body-secret-toggle" title="Encrypt the complete raw body at rest"><input type="checkbox" checked={request.body?.secret === true} onChange={(event) => updateRequest((current) => ({ ...current, body: { ...(current.body ?? { mode: 'none' }), secret: event.target.checked } }))} /> Protect at rest</label> : null}<span><Code2 size={13} /> {request.body?.mode === 'json' ? 'application/json' : request.body?.mode === 'xml' ? 'text/xml' : request.body?.mode === 'urlencoded' ? 'application/x-www-form-urlencoded' : request.body?.mode === 'formdata' ? 'multipart/form-data' : 'Text'}</span></div>
              {(request.body?.mode === 'urlencoded' || request.body?.mode === 'formdata')
                ? <StructuredBodyEditor body={request.body} onChange={(mode, entries) => updateRequest((current) => ({ ...current, body: { ...(current.body ?? { mode }), [mode]: entries } }))} />
                : <textarea className="code-editor" aria-label="Request body" value={request.body?.raw ?? ''} onChange={(event) => updateRequest((current) => ({ ...current, body: { ...(current.body ?? { mode: 'none' }), raw: event.target.value } }))} spellCheck={false} placeholder="Enter request payload…" disabled={request.body?.mode === 'none'} />}
            </div>}
            {requestTab === 'Tests' && <div className="tests-editor">
              <div className="assertion-heading"><div className="assertion-icon"><ShieldCheck size={16} /></div><div><strong>Response assertions</strong><span>Validate each response automatically.</span></div></div>
              <label className="field-label" htmlFor="expected-status">Expected status code</label>
              <input id="expected-status" className="status-input" type="number" value={request.assertions?.expectedStatusCode ?? ''} placeholder="200" onChange={(event) => updateAssertions((current) => ({ ...current, assertions: { ...current.assertions, expectedStatusCode: event.target.value ? Number(event.target.value) : undefined } }))} />
              <label className="field-label" htmlFor="max-response-time">Maximum response time (ms)</label>
              <input id="max-response-time" className="status-input" type="number" min="1" max="30000" value={request.assertions?.maxResponseTimeMs ?? ''} placeholder="1000" onChange={(event) => updateAssertions((current) => ({ ...current, assertions: { ...current.assertions, maxResponseTimeMs: event.target.value ? Number(event.target.value) : undefined } }))} />
              <div className="body-mode-note">The request fails its check when the measured response time exceeds this limit. Maximum: 30,000 ms.</div>
              <JsonSchemaEditor schema={request.assertions?.jsonSchema} onChange={(jsonSchema) => updateAssertions((current) => ({ ...current, assertions: { ...current.assertions, jsonSchema } }))} />
              <JsonPointerAssertionEditor rules={request.assertions?.jsonPointerAssertions ?? []} onChange={(jsonPointerAssertions) => updateAssertions((current) => ({ ...current, assertions: { ...current.assertions, jsonPointerAssertions } }))} />
              <ResponseHeaderAssertionEditor rules={request.assertions?.responseHeaderAssertions ?? []} onChange={(responseHeaderAssertions) => updateAssertions((current) => ({ ...current, assertions: { ...current.assertions, responseHeaderAssertions } }))} />
              <XPathAssertionEditor rules={request.assertions?.xpathMatches ?? []} onChange={(xpathMatches) => updateAssertions((current) => ({ ...current, assertions: { ...current.assertions, xpathMatches } }))} />
              <ResponseExtractionEditor rules={request.extractVariables ?? []} onChange={(rules) => setRequest((current) => ({ ...current, extractVariables: rules }))} />
              <DataDrivenTestCaseEditor testCases={request.testCases ?? []} onChange={(testCases) => updateRequest((current) => ({ ...current, testCases }))} />
            </div>}
          </div>
        </section>

        {runReport && <section className="run-report-panel" aria-label="Collection run report"><div className="run-report-heading"><div><strong>{runReport.collectionName}</strong><span>{runProgress} · Environment: {runReport.environmentName}</span></div><div className="run-report-actions"><span>{runPassedCount}/{runReport.results.length} passed</span><select className="report-format-select" aria-label="Run report format" value={runReportFormat} onChange={(event) => setRunReportFormat(event.target.value as RunReportFormat)}><option value="json">JSON</option><option value="csv">CSV (Excel)</option><option value="html">HTML</option></select><button className="quiet-button" disabled={!runReport.results.length || runBusy} onClick={() => void exportRunReport()}><Download size={13} /> Export report</button></div></div>{runReport.results.length > 0 && <div className="run-report-results">{runReport.results.map((result, index) => <div className={`run-report-row ${result.passed ? 'passed' : 'failed'}`} key={`${result.name}-${index}`}><span className={`method-mini ${result.method.toLowerCase()}`}>{result.method}</span><strong>{result.name}</strong><span>{result.status || 'ERR'} {result.statusText}</span><span>{result.durationMs} ms</span><span>{formatBytes(result.sizeBytes)}</span><span className="run-result-outcome">{result.passed ? 'PASS' : 'FAIL'}</span><small title={`${result.assertions.length} assertions`}>{result.assertions.filter((item) => item.passed).length}/{result.assertions.length} assertions</small></div>)}</div>}</section>}

        {!runReport && <section className="response-section">
          <div className="response-heading"><div className="response-title"><span className="response-pulse" /><h2>Response</h2>{response && <span className={`status-pill ${response.error ? 'failed' : response.status < 400 ? 'success' : 'failed'}`}>{response.error ? 'Error' : `${response.status} ${response.statusText}`}</span>}</div><div className="response-metrics">{response && !response.error && <><span><Clock3 size={13} /> {response.durationMs} ms</span><span><FileCode2 size={13} /> {formatBytes(response.sizeBytes)}</span></>}</div></div>
          <div className="response-tabs" role="tablist" aria-label="Response views">{(['Body', 'Headers', 'Tests'] as ResponseTab[]).map((tab) => <button key={tab} className={responseTab === tab ? 'response-tab active' : 'response-tab'} role="tab" aria-selected={responseTab === tab} onClick={() => setResponseTab(tab)}>{tab}{tab === 'Tests' && response?.tests.length ? <span className="tab-count">{response.tests.length}</span> : null}</button>)}</div>
          <div className="response-content">
            {!response && <div className="response-placeholder"><div className="placeholder-art"><Cloud size={24} /><span className="placeholder-spark one" /><span className="placeholder-spark two" /></div><strong>Your response will land here</strong><span>Send a request to inspect its body, headers, and test results.</span></div>}
            {response?.error && <div className="error-state"><AlertCircle size={19} /><div><strong>Could not complete request</strong><span>{response.error}</span></div></div>}
            {response && !response.error && responseTab === 'Body' && <pre className="response-code">{prettyBody || <span className="muted-code">No response body</span>}</pre>}
            {response && !response.error && responseTab === 'Headers' && <div className="response-header-list">{Object.entries(response.headers).map(([key, value]) => <div className="response-header" key={key}><span>{key}</span><code>{value}</code></div>)}</div>}
            {response && !response.error && responseTab === 'Tests' && <div className="test-results">{response.tests.length ? response.tests.map((test, index) => <div className="test-result" key={`${test.label}-${index}`}><span className={test.passed ? 'test-icon passed' : 'test-icon failed'}>{test.passed ? <Check size={13} /> : <X size={13} />}</span><div><strong>{test.label}</strong>{test.detail && <span>{test.detail}</span>}</div></div>) : <div className="no-tests"><ShieldCheck size={17} /> No assertions are configured for this request.</div>}</div>}
          </div>
        </section>}
        <footer className="statusbar"><span><span className="status-dot" /> Ready</span><span>REST / SOAP</span><span>Local workspace</span></footer>
        {readinessReview && <div className="environment-backdrop" role="presentation" onMouseDown={() => setReadinessReview(null)}><section className="environment-dialog readiness-dialog" role="dialog" aria-modal="true" aria-labelledby="readiness-dialog-title" onMouseDown={(event) => event.stopPropagation()}><div className="environment-dialog-heading"><div><div className="eyebrow">RUN READINESS</div><h2 id="readiness-dialog-title">Review before running</h2></div><button className="icon-button" title="Close readiness check" aria-label="Close readiness check" onClick={() => setReadinessReview(null)}><X size={17} /></button></div><p className="readiness-intro">{readinessReview.targetName} · Environment: {environmentName}</p>{readinessReview.blockers.length > 0 && <section className="readiness-group blocked"><h3>Must fix before running</h3><ul>{readinessReview.blockers.map((issue, index) => <li key={`${issue.message}-${index}`}><strong>{issue.message}</strong><span>{issue.requestNames.join(', ')}</span></li>)}</ul></section>}{readinessReview.warnings.length > 0 && <section className="readiness-group warnings"><h3>Review these warnings</h3><ul>{readinessReview.warnings.map((issue, index) => <li key={`${issue.message}-${index}`}><strong>{issue.message}</strong><span>{issue.requestNames.join(', ')}</span></li>)}</ul></section>}<div className="environment-dialog-footer">Environment values are never displayed in this check.</div><div className="create-item-actions"><button className="quiet-button" onClick={() => setReadinessReview(null)}>{readinessReview.blockers.length ? 'Back to editor' : 'Cancel'}</button>{!readinessReview.blockers.length && <button className="send-button" onClick={() => void runSelection(true)}>Run anyway</button>}</div></section></div>}
      </main>
      {newItemKind && <div className="environment-backdrop" role="presentation" onMouseDown={() => setNewItemKind(null)}><section className="environment-dialog create-item-dialog" role="dialog" aria-modal="true" aria-labelledby="create-item-title" onMouseDown={(event) => event.stopPropagation()}><div className="environment-dialog-heading"><div><div className="eyebrow">COLLECTIONS</div><h2 id="create-item-title">{newItemKind === 'collection' ? 'New collection' : 'New folder'}</h2></div><button className="icon-button" title="Close" aria-label="Close" onClick={() => setNewItemKind(null)}><X size={17} /></button></div><label className="environment-name-field" htmlFor="new-item-name">Name<input id="new-item-name" autoFocus value={newItemName} onChange={(event) => setNewItemName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createNamedItem(); }} /></label><div className="create-item-actions"><button className="quiet-button" onClick={() => setNewItemKind(null)}>Cancel</button><button className="send-button" onClick={createNamedItem}>Create</button></div></section></div>}
      {environmentEditorOpen && <div className="environment-backdrop" role="presentation" onMouseDown={() => setEnvironmentEditorOpen(false)}><section className="environment-dialog" role="dialog" aria-modal="true" aria-labelledby="environment-dialog-title" onMouseDown={(event) => event.stopPropagation()}><div className="environment-dialog-heading"><div><div className="eyebrow">WORKSPACE</div><h2 id="environment-dialog-title">Environments</h2></div><button className="icon-button" title="Close environments" aria-label="Close environments" onClick={() => setEnvironmentEditorOpen(false)}><X size={17} /></button></div><div className="environment-dialog-toolbar"><select aria-label="Selected environment" value={environmentName} onChange={(event) => { setEnvironmentName(event.target.value); setEnvironmentNameDraft(event.target.value); }}>{(collection.environments ?? []).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select><button className="text-button" onClick={addEnvironment}><Plus size={13} /> Add environment</button><button className="icon-button small" title="Delete environment" aria-label="Delete environment" disabled={(collection.environments?.length ?? 0) < 2} onClick={deleteCurrentEnvironment}><Trash2 size={14} /></button></div><label className="environment-name-field" htmlFor="environment-name">Environment name<input id="environment-name" value={environmentNameDraft} onChange={(event) => setEnvironmentNameDraft(event.target.value)} onBlur={() => renameEnvironment(environmentNameDraft)} /></label><div className="environment-variables"><div className="table-caption">Variables <button className="text-button" onClick={() => updateEnvironmentValues([...(selectedEnvironment?.values ?? []), { key: '', value: '', enabled: true }])}><Plus size={13} /> Add variable</button></div><KeyValueEditor entries={selectedEnvironment?.values ?? []} onChange={updateEnvironmentValues} emptyLabel="No environment variables" /></div><div className="environment-dialog-footer">Changes save automatically on this device.</div></section></div>}
    </div>
  );
}

function KeyValueEditor({ entries, onChange, emptyLabel }: { entries: KeyValue[]; onChange: (entries: KeyValue[]) => void; emptyLabel: string }): JSX.Element {
  const [revealedRows, setRevealedRows] = useState<Set<number>>(() => new Set());

  return <>
    <div className="kv-head"><span title="Enabled" /><span>SECRET</span><span>KEY</span><span>VALUE</span><span /></div>
    {entries.length ? entries.map((entry, index) => {
      const detectedSecret = isSensitiveCredentialKey(entry.key);
      const isSecret = entry.secret === true || detectedSecret;
      const isRevealed = revealedRows.has(index);
      return <div className="kv-row" key={index}>
        <input type="checkbox" checked={entry.enabled !== false} aria-label={`Enable ${entry.key || 'entry'}`} onChange={(event) => onChange(updateEntry(entries, index, { enabled: event.target.checked }))} />
        <input type="checkbox" checked={isSecret} disabled={detectedSecret} title={detectedSecret ? 'Sensitive key names are always protected' : 'Encrypt this value at rest'} aria-label={`Protect ${entry.key || 'value'} at rest`} onChange={(event) => onChange(updateEntry(entries, index, { secret: event.target.checked }))} />
        <input value={entry.key} aria-label="Key" placeholder="Key" onChange={(event) => onChange(updateEntry(entries, index, { key: event.target.value }))} />
        <div className="kv-value"><input type={isSecret && !isRevealed ? 'password' : 'text'} value={entry.value} aria-label="Value" placeholder="Value" onChange={(event) => onChange(updateEntry(entries, index, { value: event.target.value }))} />{isSecret && <button className="secret-reveal" title={isRevealed ? 'Hide value' : 'Reveal value'} aria-label={isRevealed ? 'Hide secret value' : 'Reveal secret value'} onClick={() => setRevealedRows((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next; })}>{isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}</button>}</div>
        <button className="row-remove" title="Remove" onClick={() => onChange(entries.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
      </div>;
    }) : <div className="empty-table">{emptyLabel}</div>}
  </>;
}

function PaginationEditor({ request, onChange }: {
  request: RequestDefinition;
  onChange: (pagination: OffsetPaginationConfig | undefined) => void;
}): JSX.Element {
  const pagination = request.pagination;

  function togglePagination(enabled: boolean): void {
    if (!enabled) {
      onChange(undefined);
      return;
    }
    if (pagination) return;

    const limitEntry = request.queryParams?.find((entry) => entry.key.toLowerCase() === 'limit');
    const offsetEntry = request.queryParams?.find((entry) => entry.key.toLowerCase() === 'offset');
    const limitValue = Number(limitEntry?.value);
    const offsetValue = Number(offsetEntry?.value);
    onChange({
      limitParam: limitEntry?.key || 'limit',
      offsetParam: offsetEntry?.key || 'offset',
      pageSize: Number.isInteger(limitValue) && limitValue > 0 ? Math.min(limitValue, 1000) : 100,
      startOffset: Number.isInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0,
      maxPages: 10,
      itemsJsonPointer: '',
    });
  }

  function updateInteger(field: 'pageSize' | 'startOffset' | 'maxPages', value: string): void {
    if (!pagination || value === '') return;
    const number = Number(value);
    if (!Number.isInteger(number)) return;
    onChange({ ...pagination, [field]: number });
  }

  return <section className="pagination-card" aria-label="Offset pagination">
    <label className="pagination-toggle"><input type="checkbox" checked={Boolean(pagination)} onChange={(event) => togglePagination(event.target.checked)} /> Paginate with limit and offset</label>
    <p>Collection runs only. Fetch pages until the response array is shorter than the page size; configure the JSON Pointer to that array.</p>
    {pagination && <div className="pagination-fields">
      <label>Limit parameter<input value={pagination.limitParam} onChange={(event) => onChange({ ...pagination, limitParam: event.target.value })} /></label>
      <label>Offset parameter<input value={pagination.offsetParam} onChange={(event) => onChange({ ...pagination, offsetParam: event.target.value })} /></label>
      <label>Page size<input type="number" min="1" max="1000" value={pagination.pageSize} onChange={(event) => updateInteger('pageSize', event.target.value)} /></label>
      <label>Starting offset<input type="number" min="0" value={pagination.startOffset} onChange={(event) => updateInteger('startOffset', event.target.value)} /></label>
      <label>Maximum pages<input type="number" min="1" max="100" value={pagination.maxPages} onChange={(event) => updateInteger('maxPages', event.target.value)} /></label>
      <label className="pagination-pointer">Items JSON Pointer<input value={pagination.itemsJsonPointer} placeholder="/items" onChange={(event) => onChange({ ...pagination, itemsJsonPointer: event.target.value })} /></label>
    </div>}
  </section>;
}

function StructuredBodyEditor({
  body,
  onChange,
}: {
  body: NonNullable<RequestDefinition['body']>;
  onChange: (mode: 'urlencoded' | 'formdata', entries: KeyValue[]) => void;
}): JSX.Element {
  const mode = body.mode === 'formdata' ? 'formdata' : 'urlencoded';
  const entries = body[mode] ?? [];
  const label = mode === 'urlencoded' ? 'URL-encoded fields' : 'Form-data fields';

  return <div className="config-table body-fields">
    <div className="table-caption">{label}<button className="text-button" onClick={() => onChange(mode, [...entries, { key: '', value: '', enabled: true }])}><Plus size={13} /> Add field</button></div>
    <KeyValueEditor entries={entries} onChange={(nextEntries) => onChange(mode, nextEntries)} emptyLabel={`No ${mode === 'urlencoded' ? 'URL-encoded' : 'form-data'} fields`} />
    {mode === 'formdata' && <div className="body-mode-note">Text fields are supported; file uploads are not available yet.</div>}
  </div>;
}

function ResponseExtractionEditor({ rules, onChange }: { rules: NonNullable<RequestDefinition['extractVariables']>; onChange: (rules: NonNullable<RequestDefinition['extractVariables']>) => void }): JSX.Element {
  return <div className="extraction-editor"><div className="table-caption">Run-scoped variables <button className="text-button" onClick={() => onChange([...rules, { name: '', jsonPointer: '' }])}><Plus size={13} /> Add extraction</button></div>
    {rules.length ? rules.map((rule, index) => <div className="extraction-row" key={index}><label>Variable<input value={rule.name} placeholder="createdId" onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label><label>JSON Pointer<input value={rule.jsonPointer} placeholder="/id" onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, jsonPointer: event.target.value } : item))} /></label><button className="row-remove" title="Remove extraction" aria-label="Remove extraction" onClick={() => onChange(rules.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button></div>) : <div className="empty-table">No response values are extracted</div>}
    <div className="body-mode-note">During a collection run, later requests can use these values as {'{{variableName}}'}. They are temporary and are not saved into the selected environment.</div>
  </div>;
}

function DataDrivenTestCaseEditor({ testCases, onChange }: {
  testCases: RequestTestCase[];
  onChange: (testCases: RequestTestCase[]) => void;
}): JSX.Element {
  return <section className="assertion-editor-section data-case-editor">
    <div className="table-caption"><span>Data-driven cases</span><button className="text-button" onClick={() => onChange([...testCases, { name: `Case ${testCases.length + 1}`, values: [] }])}><Plus size={13} /> Add case</button></div>
    {testCases.length ? testCases.map((testCase, caseIndex) => <div className="data-case-card" key={caseIndex}>
      <div className="data-case-heading">
        <label className="auth-field">Case name<input value={testCase.name} onChange={(event) => onChange(testCases.map((item, itemIndex) => itemIndex === caseIndex ? { ...item, name: event.target.value } : item))} /></label>
        <button className="row-remove" title="Remove data case" aria-label={`Remove data case ${testCase.name || caseIndex + 1}`} onClick={() => onChange(testCases.filter((_, itemIndex) => itemIndex !== caseIndex))}><X size={14} /></button>
      </div>
      <div className="table-caption">Variable overrides<button className="text-button" onClick={() => onChange(testCases.map((item, itemIndex) => itemIndex === caseIndex ? { ...item, values: [...item.values, { key: '', value: '', enabled: true }] } : item))}><Plus size={13} /> Add value</button></div>
      <KeyValueEditor entries={testCase.values} onChange={(values) => onChange(testCases.map((item, itemIndex) => itemIndex === caseIndex ? { ...item, values } : item))} emptyLabel="No variable overrides" />
    </div>) : <div className="empty-table">No data cases configured; this request runs once.</div>}
    <div className="body-mode-note">Collection runs execute each case sequentially, up to 100. Case values override environment and earlier run-scoped values for this request only. Multiple cases cannot be combined with response extraction on this request.</div>
  </section>;
}

function JsonPointerAssertionEditor({ rules, onChange }: {
  rules: JsonPointerAssertion[];
  onChange: (rules: JsonPointerAssertion[]) => void;
}): JSX.Element {
  return <section className="assertion-editor-section">
    <div className="table-caption"><span>JSON Pointer checks</span><button className="text-button" onClick={() => onChange([...rules, { jsonPointer: '', operator: 'exists' }])}><Plus size={13} /> Add check</button></div>
    {rules.length ? rules.map((rule, index) => <div className="response-assertion-row" key={index}>
      <label className="auth-field">JSON Pointer<input value={rule.jsonPointer} placeholder="/status" onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, jsonPointer: event.target.value } : item))} /></label>
      <label className="auth-field">Check<select value={rule.operator} onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value as JsonPointerAssertion['operator'] } : item))}><option value="exists">Exists</option><option value="equals">Equals</option></select></label>
      {rule.operator === 'equals' && <label className="auth-field">Expected text<input value={rule.expectedValue ?? ''} onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, expectedValue: event.target.value } : item))} /></label>}
      <button className="row-remove" title="Remove JSON Pointer check" aria-label={`Remove JSON Pointer check ${index + 1}`} onClick={() => onChange(rules.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
    </div>) : <div className="empty-table">No JSON Pointer checks configured</div>}
    <div className="body-mode-note">Equals compares the value as text. JSON Pointer uses paths such as `/items/0/id`.</div>
  </section>;
}

function ResponseHeaderAssertionEditor({ rules, onChange }: {
  rules: ResponseHeaderAssertion[];
  onChange: (rules: ResponseHeaderAssertion[]) => void;
}): JSX.Element {
  return <section className="assertion-editor-section">
    <div className="table-caption"><span>Response header checks</span><button className="text-button" onClick={() => onChange([...rules, { name: '', operator: 'exists' }])}><Plus size={13} /> Add check</button></div>
    {rules.length ? rules.map((rule, index) => <div className="response-assertion-row" key={index}>
      <label className="auth-field">Header name<input value={rule.name} placeholder="Content-Type" onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label>
      <label className="auth-field">Check<select value={rule.operator} onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, operator: event.target.value as ResponseHeaderAssertion['operator'] } : item))}><option value="exists">Exists</option><option value="equals">Equals</option></select></label>
      {rule.operator === 'equals' && <label className="auth-field">Expected text<input value={rule.expectedValue ?? ''} onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, expectedValue: event.target.value } : item))} /></label>}
      <button className="row-remove" title="Remove response-header check" aria-label={`Remove response-header check ${index + 1}`} onClick={() => onChange(rules.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
    </div>) : <div className="empty-table">No response-header checks configured</div>}
    <div className="body-mode-note">Header names are matched case-insensitively; values must match exactly.</div>
  </section>;
}

function JsonSchemaEditor({ schema, onChange }: { schema: Record<string, unknown> | undefined; onChange: (schema: Record<string, unknown> | undefined) => void }): JSX.Element {
  const [draft, setDraft] = useState(() => schema ? JSON.stringify(schema, null, 2) : '');
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(schema ? JSON.stringify(schema, null, 2) : '');
    setError('');
  }, [schema]);

  function updateSchema(value: string): void {
    setDraft(value);
    if (!value.trim()) {
      setError('');
      onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('JSON Schema must be a JSON object.');
        return;
      }
      setError('');
      onChange(parsed as Record<string, unknown>);
    } catch {
      setError('Enter valid JSON. The last valid schema remains active until this is corrected.');
    }
  }

  return <section className="assertion-editor-section">
    <div className="table-caption"><span>JSON Schema</span><span className="editor-format-note">JSON response</span></div>
    <textarea className="code-editor assertion-schema-editor" aria-label="JSON Schema assertion" value={draft} onChange={(event) => updateSchema(event.target.value)} spellCheck={false} placeholder={'{\n  "type": "object",\n  "required": ["id"]\n}'} />
    {error ? <div className="assertion-editor-error" role="alert">{error}</div> : <div className="body-mode-note">Leave empty to disable schema validation.</div>}
  </section>;
}

function XPathAssertionEditor({ rules, onChange }: { rules: XPathMatchRule[]; onChange: (rules: XPathMatchRule[]) => void }): JSX.Element {
  return <section className="assertion-editor-section">
    <div className="table-caption"><span>XPath checks</span><button className="text-button" onClick={() => onChange([...rules, { xpath: '' }])}><Plus size={13} /> Add XPath</button></div>
    {rules.length ? rules.map((rule, index) => <div className="xpath-rule" key={index}>
      <label className="auth-field">XPath<input value={rule.xpath} placeholder="//Status" onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, xpath: event.target.value } : item))} /></label>
      <label className="auth-field">Expected value (optional)<input value={rule.expectedValue ?? ''} placeholder="Success" onChange={(event) => onChange(rules.map((item, itemIndex) => itemIndex === index ? { ...item, expectedValue: event.target.value || undefined } : item))} /></label>
      <button className="row-remove" title="Remove XPath check" aria-label={`Remove XPath check ${index + 1}`} onClick={() => onChange(rules.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
    </div>) : <div className="body-mode-note">No XPath checks configured.</div>}
    <div className="body-mode-note">Use XPath for XML responses. An empty expected value checks that the node exists.</div>
  </section>;
}

function CollectionTree({
  items,
  selectedPath,
  selectedContainerPath,
  collapsedPaths,
  onToggle,
  onSelect,
  onSelectContainer,
  onDelete,
  onDeleteFolder,
  onDeleteCollection,
  canDelete,
  parentPath = '',
}: {
  items: CollectionItem[];
  selectedPath: string;
  selectedContainerPath: string;
  collapsedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (item: CollectionItem, path: string) => void;
  onSelectContainer: (item: CollectionItem, path: string) => void;
  onDelete: (path: string, name: string) => void;
  onDeleteFolder: (path: string, item: CollectionItem) => void;
  onDeleteCollection: (path: string, item: CollectionItem) => void;
  canDelete: boolean;
  parentPath?: string;
}): JSX.Element {
  return <div className={parentPath ? 'collection-children nested' : 'collection-children'}>
    {items.map((item, index) => {
      const path = parentPath ? `${parentPath}.${index}` : `${index}`;
      if (item.items) {
        const isCollection = parentPath === '' && item.type !== 'folder';
        const isExpanded = !collapsedPaths.has(path);
        return <div className={isCollection ? 'collection-group' : 'folder-group'} key={path}>
          <div className={`${isCollection ? 'collection-group-row' : 'folder-select-row'} ${selectedContainerPath === path ? 'active-container' : ''}`}>
            <button className={`tree-toggle ${isExpanded ? '' : 'collapsed'}`} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${item.name}`} aria-expanded={isExpanded} onClick={() => onToggle(path)}><ChevronDown size={13} /></button>
            <button className="tree-label" onClick={() => onSelectContainer(item, path)}>{isCollection ? <FolderOpen size={15} className="folder-icon" /> : <Folder size={14} />}<span>{item.name}</span></button>
            {isCollection
              ? <button className="collection-delete" title={`Delete collection ${item.name}`} aria-label={`Delete collection ${item.name}`} onClick={() => onDeleteCollection(path, item)}><Trash2 size={13} /></button>
              : <button className="folder-delete" title={`Delete folder ${item.name}`} aria-label={`Delete folder ${item.name}`} onClick={() => onDeleteFolder(path, item)}><Trash2 size={13} /></button>}
          </div>
          {isExpanded && <CollectionTree items={item.items} selectedPath={selectedPath} selectedContainerPath={selectedContainerPath} collapsedPaths={collapsedPaths} onToggle={onToggle} onSelect={onSelect} onSelectContainer={onSelectContainer} onDelete={onDelete} onDeleteFolder={onDeleteFolder} onDeleteCollection={onDeleteCollection} canDelete={canDelete} parentPath={path} />}
        </div>;
      }
      if (!item.request) return null;
      return <div className={`request-entry ${selectedPath === path ? 'selected' : ''}`} key={path}>
        <button className="request-row" onClick={() => onSelect(item, path)}>
          <span className={`method-mini ${item.request.method.toLowerCase()}`}>{item.request.method}</span><span>{item.name}</span>
        </button>
        <button className="request-delete" title={canDelete ? `Delete ${item.name}` : 'Keep at least one request'} aria-label={canDelete ? `Delete ${item.name}` : 'At least one request must remain'} disabled={!canDelete} onClick={() => onDelete(path, item.name)}><Trash2 size={13} /></button>
      </div>;
    })}
  </div>;
}

function formatBytes(size: number): string {
  return size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
}

export default App;