# Phase 2 Roadmap

**Created:** 2026-10-15  
**Status:** Steps 1-4 complete; Step 5 in progress
**Scope:** Build on the Phase 1 baseline in `PHASE1.md`; do not package an executable until explicitly requested.

## Ordered Plan

### Step 1: Automated Test Foundation — Complete

Add a small automated suite for the most failure-prone Phase 1 contracts:

- Validate the four-request and ten-request fixtures against `spec/rest-soap-spec.json`.
- Validate workspace roots containing typed collections and workspace-level folders.
- Reject invalid collection metadata and unsupported HTTP methods.
- Add a repeatable `npm test` command using Node's built-in test runner and existing AJV dependency.

**Completed:** Added `test/collection-schema.test.mjs` and the `npm test` script. The suite started with eight offline tests and now has twenty-four covering fixtures, workspace shapes, runner ordering/pass-fail, readiness checks, offset pagination and import inference, JSON Pointer extraction, credential protection, OAuth2 helpers, report serialization, and cURL generation.

**Verification:** The current `npm test` suite passes (24 tests); typecheck and production build pass. The tests do not require network access.

### Step 2: Collection Runner and Test Reports — Complete

Run requests from a selected collection in tree order using the selected environment. Show per-request status, duration, response size, assertion outcomes, and transport errors. Support stop-on-failure and continue-on-failure modes. Export a sanitized JSON, CSV, or HTML report.

**Completed:** The renderer runs a selected collection/folder or the workspace sequentially, supports stop-on-failure and manual stop, displays per-request status/duration/assertion results, and exports sanitized JSON, Excel-compatible CSV, or standalone HTML reports. All formats omit response bodies, headers, and extracted values.

**Verification:** Runner ordering and pass/fail logic have unit coverage. Report serializers are tested for CSV quoting, formula safety, HTML escaping, and omission of response payloads. The 24-test suite, typecheck, and production bundle build pass. Full UI/network orchestration tests remain a follow-up.

### Step 3: Request Dependencies and Run-Scoped Variables — Complete

Add declarative response extraction (for example, JSON Pointer paths mapped to run-scoped variable names) so a response value can feed a later request. Keep run variables separate from saved environment secrets and do not execute JavaScript test scripts. Mock APIs may return synthetic POST IDs without persisting the created record; use a persistent test service to validate create-then-update workflows.

**Completed:** Requests can define JSON Pointer extraction rules in the Tests tab. During a collection run, extracted values are overlaid on the selected environment for subsequent requests; they are temporary and omitted from reports. Missing/invalid paths fail the run assertion and respect stop-on-failure.

**Verification:** Coverage includes nested objects, arrays, escaped JSON Pointer keys, missing paths, invalid JSON, and blank variable names. The current twenty-four-test offline suite, typecheck, and production build pass.

### Step 4: Credential Protection

Move secrets out of plaintext collection/environment JSON into OS-protected storage (Windows Credential Manager/DPAPI or Electron `safeStorage`). Add export redaction and explicit controls for including secrets in shared collection copies.

**Completed:** Auth values and secret-marked or sensitive-name key/value rows are removed from saved workspace JSON and stored in an Electron `safeStorage`-encrypted payload. Existing plaintext credentials are migrated atomically on load when OS encryption is available. Raw JSON/XML/text bodies have a **Protect at rest** control. Collection exports redact secrets by default; a confirmation is required to include plaintext values.

**Verification:** Twenty-four offline tests pass, including secret partition/restore/redaction; typecheck and production build pass. Legacy migration and encryption require an available OS credential backend. Shared exports that include secrets are plaintext and must be handled as credentials.

### Step 5: Remaining Request and Assertion Completeness — In progress

The original Step 5 scope was JSON Schema/XPath assertion editors, OAuth2 password grant, Copy as cURL, and request-history replay. The first three are complete, along with run readiness and bounded offset pagination. The remaining Step 5 item is request-history replay; consider other OAuth2 grants or file-upload form-data only if there is a confirmed need. Keep compatibility with `RestSoapSpecEnterprise v2.0` and test every new mode.

**Completed:** The Tests tab edits JSON Schema and XPath response assertions alongside expected status. Invalid schema JSON is reported in the editor and does not replace the last valid schema. Auth supports a per-request OAuth2 password grant, caches tokens in memory until near expiry, and protects its credentials at rest. Copy as cURL generates a PowerShell-compatible command for the current request and requires explicit confirmation before copying credentials or request data to the clipboard. Collection runs now check environment references and URLs before execution, block missing values or invalid URLs, recognize values extracted by earlier requests, require review for write methods or requests without response checks, and support bounded offset pagination with per-page results.

**Remaining:** Implement request-history replay. Other OAuth2 grant types and file uploads remain conditional on a confirmed need.

**Verification:** Twenty-four offline tests pass, including readiness checks, offset pagination and import inference, OAuth2 password-grant encoding/response parsing, JSON Schema/XPath schema acceptance, and cURL command generation; typecheck and production build pass. OAuth2 has not been tested against the private RAN identity provider in this environment.

### Step 6: Release Readiness

Resolve and triage npm audit findings, produce an SBOM and license notices, add integration/UI smoke tests for the primary workflows, and establish trusted code signing/distribution before wider rollout.

## Phase 2 Guardrails

- Keep the product REST/SOAP-only; do not add GraphQL, gRPC, WebSocket, or collection JavaScript sandbox support.
- Continue using the Relay collection schema as the canonical import/export format.
- Do not store real credentials in fixtures or reports.
- Do not generate installer/portable executables as part of ordinary checks; package only when explicitly requested.
