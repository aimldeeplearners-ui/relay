import type { AssertionResult, JsonPointerAssertion, ResponseHeaderAssertion } from './api';
import { resolveJsonPointerValue } from './responseExtraction.ts';

function toComparableText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function evaluateJsonPointerAssertions(body: string, assertions: JsonPointerAssertion[]): AssertionResult[] {
  if (!assertions.length) return [];

  let document: unknown;
  try {
    document = JSON.parse(body);
  } catch {
    return assertions.map(({ jsonPointer, operator }) => ({
      label: operator === 'exists' ? `JSON Pointer exists: ${jsonPointer}` : `JSON Pointer equals: ${jsonPointer}`,
      passed: false,
      detail: 'Response body is not valid JSON.',
    }));
  }

  return assertions.map(({ jsonPointer, operator, expectedValue }) => {
    const result = resolveJsonPointerValue(document, jsonPointer);
    const passed = operator === 'exists'
      ? result.found
      : result.found && expectedValue !== undefined && toComparableText(result.value) === expectedValue;
    return {
      label: operator === 'exists' ? `JSON Pointer exists: ${jsonPointer}` : `JSON Pointer equals: ${jsonPointer}`,
      passed,
      ...(!result.found ? { detail: 'No value found at this JSON Pointer.' }
        : operator === 'equals' && !passed ? { detail: 'Value does not match the expected text.' } : {}),
    };
  });
}

export function evaluateResponseHeaderAssertions(
  headers: Record<string, string>,
  assertions: ResponseHeaderAssertion[],
): AssertionResult[] {
  return assertions.map(({ name, operator, expectedValue }) => {
    const actual = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === name.trim().toLowerCase())?.[1];
    const passed = operator === 'exists'
      ? actual !== undefined
      : actual !== undefined && expectedValue !== undefined && actual === expectedValue;
    return {
      label: operator === 'exists' ? `Response header exists: ${name}` : `Response header equals: ${name}`,
      passed,
      ...(actual === undefined ? { detail: 'Response header was not present.' }
        : operator === 'equals' && !passed ? { detail: 'Header value does not match the expected text.' } : {}),
    };
  });
}

export function evaluateResponseTimeAssertion(durationMs: number, maxResponseTimeMs: number): AssertionResult {
  return {
    label: `Response time at most ${maxResponseTimeMs} ms`,
    passed: durationMs <= maxResponseTimeMs,
    detail: `Received ${durationMs} ms`,
  };
}