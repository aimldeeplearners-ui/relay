import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const DIAGNOSTIC_LOG_FILE_NAME = 'relay-diagnostics.log';
export const MAX_DIAGNOSTIC_LOG_BYTES = 1024 * 1024;
const retainedLogFiles = 3;

export type DiagnosticLogLevel = 'info' | 'warn' | 'error';

export interface DiagnosticLogDetails {
  operation?: string;
  version?: string;
  platform?: string;
  method?: string;
  status?: number;
  errorName?: string;
  errorCode?: string;
  reason?: string;
  exitCode?: number;
}

export interface DiagnosticLogRecord {
  timestamp: string;
  level: DiagnosticLogLevel;
  event: string;
  details: DiagnosticLogDetails;
}

const allowedDetailKeys = new Set<keyof DiagnosticLogDetails>([
  'operation', 'version', 'platform', 'method', 'status', 'errorName', 'errorCode', 'reason', 'exitCode',
]);
const safeTextPattern = /^[A-Za-z0-9_.:-]{1,80}$/;

export function createDiagnosticLogRecord(
  level: DiagnosticLogLevel,
  event: string,
  details: Record<string, unknown> = {},
  timestamp = new Date().toISOString(),
): DiagnosticLogRecord {
  const safeDetails: DiagnosticLogDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (!allowedDetailKeys.has(key as keyof DiagnosticLogDetails)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (key === 'status' || key === 'exitCode') safeDetails[key as 'status' | 'exitCode'] = value;
    } else if (typeof value === 'string' && safeTextPattern.test(value)) {
      safeDetails[key as 'operation' | 'version' | 'platform' | 'method' | 'errorName' | 'errorCode' | 'reason'] = value;
    }
  }

  return {
    timestamp,
    level,
    event: safeTextPattern.test(event) ? event : 'diagnostic.event',
    details: safeDetails,
  };
}

function rotateLogs(filePath: string): void {
  for (let index = retainedLogFiles; index >= 1; index--) {
    const sourcePath = index === 1 ? filePath : `${filePath}.${index - 1}`;
    const targetPath = `${filePath}.${index}`;
    if (!existsSync(sourcePath)) continue;
    if (existsSync(targetPath)) rmSync(targetPath);
    renameSync(sourcePath, targetPath);
  }
}

export function writeDiagnosticLog(
  directory: string,
  level: DiagnosticLogLevel,
  event: string,
  details: Record<string, unknown> = {},
  timestamp?: string,
): void {
  try {
    mkdirSync(directory, { recursive: true });
    const filePath = join(directory, DIAGNOSTIC_LOG_FILE_NAME);
    const line = `${JSON.stringify(createDiagnosticLogRecord(level, event, details, timestamp))}\n`;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    if (lineBytes > MAX_DIAGNOSTIC_LOG_BYTES) return;
    if (existsSync(filePath) && statSync(filePath).size + lineBytes > MAX_DIAGNOSTIC_LOG_BYTES) {
      rotateLogs(filePath);
    }
    appendFileSync(filePath, line, { encoding: 'utf8', mode: 0o600 });
  } catch {
    // Diagnostic logging must never interrupt the app operation being diagnosed.
  }
}

export function getDiagnosticLogDirectory(userDataPath: string): string {
  return join(userDataPath, 'logs');
}

export function getDiagnosticErrorDetails(error: unknown): Pick<DiagnosticLogDetails, 'errorName' | 'errorCode'> {
  if (typeof error !== 'object' || error === null) return { errorName: 'Error' };
  const name = 'name' in error && typeof error.name === 'string' ? error.name : 'Error';
  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  return {
    errorName: safeTextPattern.test(name) ? name : 'Error',
    ...(code && safeTextPattern.test(code) ? { errorCode: code } : {}),
  };
}