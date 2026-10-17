import type { ApiResponse, HttpMethod, RequestDefinition } from './api';

export const MAX_HISTORY_RESPONSE_BODY_BYTES = 256 * 1024;

export interface RequestHistoryEntry {
  id: string;
  requestName: string;
  method: HttpMethod;
  url: string;
  status: number;
  time: string;
  request: RequestDefinition;
  response: ApiResponse;
  responseBodyTruncated: boolean;
  environment: Record<string, string>;
  environmentName: string;
}

export type RequestHistoryEntryInput = Omit<RequestHistoryEntry, 'responseBodyTruncated'>;

export interface RequestHistoryReplay {
  requestName: string;
  request: RequestDefinition;
  environment: Record<string, string>;
  environmentName: string;
}

export function createRequestHistoryEntry(entry: RequestHistoryEntryInput): RequestHistoryEntry {
  const response = structuredClone(entry.response);
  const responseBody = new TextEncoder().encode(response.body);
  const responseBodyTruncated = responseBody.byteLength > MAX_HISTORY_RESPONSE_BODY_BYTES;
  if (responseBodyTruncated) {
    response.body = new TextDecoder().decode(responseBody.subarray(0, MAX_HISTORY_RESPONSE_BODY_BYTES));
    while (new TextEncoder().encode(response.body).byteLength > MAX_HISTORY_RESPONSE_BODY_BYTES) {
      response.body = response.body.slice(0, -1);
    }
  }

  return {
    ...entry,
    request: structuredClone(entry.request),
    response,
    responseBodyTruncated,
    environment: { ...entry.environment },
  };
}

export function createRequestHistoryReplay(entry: RequestHistoryEntry): RequestHistoryReplay {
  return {
    requestName: entry.requestName,
    request: structuredClone(entry.request),
    environment: { ...entry.environment },
    environmentName: entry.environmentName,
  };
}