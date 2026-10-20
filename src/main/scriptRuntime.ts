import { getQuickJS } from 'quickjs-emscripten';
import type { ApiResponse, AssertionResult, RequestDefinition, RelayRequestScripts } from '../shared/api';

export const MAX_RELAY_SCRIPT_BYTES = 64 * 1024;
export const MAX_SCRIPT_CONTEXT_BYTES = 2 * 1024 * 1024;
export const MAX_SCRIPT_RESPONSE_BYTES = 1024 * 1024;
export const MAX_SCRIPT_MEMORY_BYTES = 16 * 1024 * 1024;
export const RELAY_SCRIPT_TIMEOUT_MS = 100;

export type RelayScriptPhase = keyof RelayRequestScripts;

export interface RelayScriptResult {
  request: RequestDefinition;
  variables: Record<string, string>;
  assertions: AssertionResult[];
  error?: string;
}

interface RelayScriptInput {
  source: string;
  phase: RelayScriptPhase;
  request: RequestDefinition;
  environment: Record<string, string>;
  variables?: Record<string, string>;
  response?: ApiResponse;
}

const quickJsReady = getQuickJS();

function errorName(value: unknown): string {
  if (!value || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string') return 'Error';
  return /^[A-Za-z0-9_.:-]{1,80}$/.test(value.name) ? value.name : 'Error';
}

function jsonValue(context: Awaited<typeof quickJsReady>['newContext'] extends (...args: never[]) => infer T ? T : never, value: unknown) {
  const source = JSON.stringify(value) ?? 'null';
  const result = context.evalCode(`JSON.parse(${JSON.stringify(source)})`);
  if (result.error) {
    result.error.dispose();
    throw new Error('Could not prepare script context.');
  }
  return result.value;
}

function dumpJsonString(context: Awaited<typeof quickJsReady>['newContext'] extends (...args: never[]) => infer T ? T : never, source: string): unknown {
  const result = context.evalCode(source);
  if (result.error) {
    const error = context.dump(result.error);
    result.error.dispose();
    const name = errorName(error);
    throw new Error(name === 'InternalError' ? 'Script exceeded its time or memory limit.' : `Script failed (${name}).`);
  }
  try {
    const value = context.getString(result.value);
    return JSON.parse(value) as unknown;
  } finally {
    result.value.dispose();
  }
}

export async function runRelayScript(input: RelayScriptInput): Promise<RelayScriptResult> {
  const originalRequest = structuredClone(input.request);
  const originalVariables = { ...(input.variables ?? {}) };
  if (!input.source.trim()) return { request: originalRequest, variables: originalVariables, assertions: [] };
  if (new TextEncoder().encode(input.source).byteLength > MAX_RELAY_SCRIPT_BYTES) {
    return { request: originalRequest, variables: originalVariables, assertions: [], error: 'Script exceeds the 64 KiB size limit.' };
  }
  const responseBytes = input.response ? new TextEncoder().encode(input.response.body).byteLength : 0;
  if (responseBytes > MAX_SCRIPT_RESPONSE_BYTES) {
    return { request: originalRequest, variables: originalVariables, assertions: [], error: 'Response body exceeds the 1 MiB script-context limit.' };
  }
  const contextBytes = new TextEncoder().encode(JSON.stringify({
    request: input.request,
    environment: input.environment,
    variables: input.variables ?? {},
    response: input.response ? { ...input.response, body: undefined } : undefined,
  })).byteLength + responseBytes;
  if (contextBytes > MAX_SCRIPT_CONTEXT_BYTES) {
    return { request: originalRequest, variables: originalVariables, assertions: [], error: 'Script context exceeds the 2 MiB limit.' };
  }

  let runtime: Awaited<typeof quickJsReady>['newRuntime'] extends (...args: never[]) => infer T ? T : never;
  let context: ReturnType<typeof runtime.newContext>;
  let deadline = 0;
  try {
    const quickJs = await quickJsReady;
    runtime = quickJs.newRuntime();
    runtime.setMemoryLimit(MAX_SCRIPT_MEMORY_BYTES);
    runtime.setMaxStackSize(512 * 1024);
    runtime.setInterruptHandler(() => deadline > 0 && Date.now() > deadline);
    context = runtime.newContext();
  } catch (error) {
    return { request: originalRequest, variables: originalVariables, assertions: [], error: `Script runtime unavailable (${errorName(error)}).` };
  }

  const variables = { ...originalVariables };
  const assertions: AssertionResult[] = [];
  try {
    const relay = context.newObject();
    const request = jsonValue(context, originalRequest);
    context.setProp(relay, 'request', request);
    request.dispose();

    const environment = context.newObject();
    const environmentGet = context.newFunction('get', (keyHandle) => {
      const key = context.getString(keyHandle);
      return context.newString(variables[key] ?? input.environment[key] ?? '');
    });
    const environmentSet = context.newFunction('set', (keyHandle, valueHandle) => {
      const key = context.getString(keyHandle).trim();
      const value = context.dump(valueHandle);
      if (key && key.length <= 128 && Object.keys(variables).length < 100) {
        variables[key] = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
      }
      return context.newNumber(0);
    });
    context.setProp(environment, 'get', environmentGet);
    context.setProp(environment, 'set', environmentSet);
    environmentGet.dispose();
    environmentSet.dispose();
    context.setProp(relay, 'environment', environment);
    environment.dispose();

    const scriptVariables = context.newObject();
    const variableGet = context.newFunction('get', (keyHandle) => {
      const key = context.getString(keyHandle);
      return context.newString(variables[key] ?? input.environment[key] ?? '');
    });
    const variableSet = context.newFunction('set', (keyHandle, valueHandle) => {
      const key = context.getString(keyHandle).trim();
      const value = context.dump(valueHandle);
      if (key && key.length <= 128 && Object.keys(variables).length < 100) {
        variables[key] = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
      }
      return context.newNumber(0);
    });
    context.setProp(scriptVariables, 'get', variableGet);
    context.setProp(scriptVariables, 'set', variableSet);
    variableGet.dispose();
    variableSet.dispose();
    context.setProp(relay, 'variables', scriptVariables);
    scriptVariables.dispose();

    const assertFunction = context.newFunction('assert', (nameHandle, passedHandle, detailHandle) => {
      const label = context.getString(nameHandle).slice(0, 200) || `Script assertion ${assertions.length + 1}`;
      const passed = Boolean(context.dump(passedHandle));
      const detail = detailHandle ? context.getString(detailHandle).slice(0, 500) : '';
      assertions.push({ label, passed, ...(detail ? { detail } : {}) });
      return context.newNumber(0);
    });
    context.setProp(relay, 'assert', assertFunction);
    assertFunction.dispose();

    if (input.response) {
      const responseData: Record<string, unknown> = {
        status: input.response.status,
        statusText: input.response.statusText,
        headers: input.response.headers,
        body: input.response.body,
        durationMs: input.response.durationMs,
        sizeBytes: input.response.sizeBytes,
        error: input.response.error,
      };
      try {
        responseData.jsonBody = JSON.parse(input.response.body) as unknown;
      } catch {
        responseData.jsonBody = undefined;
      }
      const response = jsonValue(context, responseData);
      context.setProp(relay, 'response', response);
      response.dispose();
    }

    context.setProp(context.global, 'relay', relay);
    relay.dispose();
    deadline = Date.now() + RELAY_SCRIPT_TIMEOUT_MS;
    context.unwrapResult(context.evalCode(input.source, `relay-${input.phase}.js`)).dispose();
    const result = dumpJsonString(context, 'JSON.stringify(relay.request)') as RequestDefinition;
    return { request: result, variables, assertions };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return {
      request: originalRequest,
      variables: originalVariables,
      assertions,
      error: /interrupted|time limit|memory limit/i.test(message)
        ? 'Script exceeded its time or memory limit.'
        : message || `Script failed (${errorName(error)}).`,
    };
  } finally {
    context.dispose();
    runtime.dispose();
  }
}