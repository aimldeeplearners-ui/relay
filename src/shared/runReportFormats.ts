import type { CollectionRunReport } from './api';

function csvCell(value: string | number | boolean): string {
  let text = String(value);
  if (/^[\t\r\n ]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function assertionSummary(report: CollectionRunReport['results'][number]['assertions']): string {
  return report.map(({ label, passed }) => `${passed ? 'PASS' : 'FAIL'}: ${label}`).join('; ');
}

function extractionSummary(report: CollectionRunReport['results'][number]['extractions']): string {
  return report.map(({ name, jsonPointer, passed }) => `${passed ? 'PASS' : 'FAIL'}: ${name} (${jsonPointer})`).join('; ');
}

export function serializeRunReportCsv(report: CollectionRunReport): string {
  const columns = [
    'Collection', 'Environment', 'Started At', 'Completed At', 'Stopped Early',
    'Request', 'Method', 'Status', 'Status Text', 'Duration (ms)', 'Response Size (bytes)',
    'Result', 'Transport Error', 'Assertions', 'Extractions',
  ];
  const rows = report.results.map((result) => [
    report.collectionName,
    report.environmentName,
    report.startedAt,
    report.completedAt,
    report.stoppedEarly,
    result.name,
    result.method,
    result.status,
    result.statusText,
    result.durationMs,
    result.sizeBytes,
    result.passed ? 'PASS' : 'FAIL',
    result.error,
    assertionSummary(result.assertions),
    extractionSummary(result.extractions),
  ]);
  return `\uFEFF${[columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function escapeHtml(value: string | number | boolean): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlCell(value: string | number | boolean): string {
  return `<td>${escapeHtml(value)}</td>`;
}

export function serializeRunReportHtml(report: CollectionRunReport): string {
  const rows = report.results.map((result) => {
    const outcome = result.passed ? 'PASS' : 'FAIL';
    const assertions = assertionSummary(result.assertions);
    const extractions = extractionSummary(result.extractions);
    return `<tr class="${result.passed ? 'passed' : 'failed'}">${[
      htmlCell(result.name),
      htmlCell(result.method),
      htmlCell(result.status),
      htmlCell(result.statusText),
      htmlCell(result.durationMs),
      htmlCell(result.sizeBytes),
      htmlCell(outcome),
      htmlCell(result.error),
      htmlCell(assertions),
      htmlCell(extractions),
    ].join('')}</tr>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.collectionName)} run report</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", sans-serif; color: #243238; background: #f2f5f4; }
    body { margin: 0; padding: 28px; }
    main { max-width: 1400px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    .meta { margin: 0 0 18px; color: #5e7074; font-size: 13px; }
    .summary { margin-bottom: 12px; color: #40575b; font-size: 13px; }
    .table-wrap { overflow-x: auto; background: #fff; border: 1px solid #d7e1df; border-radius: 5px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 9px 11px; border-bottom: 1px solid #e6ecea; text-align: left; vertical-align: top; }
    th { position: sticky; top: 0; background: #e8eef0; color: #34494d; white-space: nowrap; }
    td { white-space: pre-wrap; overflow-wrap: anywhere; }
    tr.passed td:nth-child(7) { color: #08765f; font-weight: 700; }
    tr.failed td:nth-child(7) { color: #bf503d; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(report.collectionName)}</h1>
    <p class="meta">Environment: ${escapeHtml(report.environmentName)} · Started: ${escapeHtml(report.startedAt)} · Completed: ${escapeHtml(report.completedAt)}</p>
    <p class="summary">${report.results.filter((result) => result.passed).length} of ${report.results.length} requests passed · Stopped early: ${escapeHtml(report.stoppedEarly)}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Request</th><th>Method</th><th>Status</th><th>Status text</th><th>Duration (ms)</th><th>Response size (bytes)</th><th>Result</th><th>Transport error</th><th>Assertions</th><th>Extractions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="10">No request results.</td></tr>'}</tbody>
    </table></div>
  </main>
</body>
</html>
`;
}