# Phase 1 Baseline

**Project:** Relay REST/SOAP API Tester  
**Baseline date:** 2026-10-15  
**Status:** Local Windows desktop prototype; not production-certified

This file records the Phase 1 implementation baseline. `FEATURES.md` is the concise user guide, and `ARCHITECTURE.md` describes the code and runtime flow.

## Delivered

- Electron desktop shell with React, TypeScript, Tailwind CSS, a sandboxed preload, context isolation, and Node integration disabled in the renderer.
- REST/SOAP request workspace using the `RestSoapSpecEnterprise v2.0` recursive collection schema.
- Workspace tree with multiple named collections, nested folders, and named request entries. Collections/folders can be created; request entries can be created, renamed, and deleted; collection/folder deletion requires confirmation.
- Request tabs for switching among opened requests. Tabs are session-only; request definitions themselves persist in the workspace.
- Individual HTTP requests for GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS.
- Query parameters, headers, no-auth/Bearer/Basic/API-key auth, and environment-variable interpolation in URLs, parameters, headers, bodies, and auth values.
- Body modes for none, JSON, XML, raw, URL-encoded, and text-only form-data. File upload is not supported.
- One selected environment shared across the workspace. Environments and their key/value variables can be added, renamed, edited, enabled/disabled, and removed (keeping at least one).
- Expected-status assertions, AJV JSON Schema checks, and XPath checks when included in imported request data. The UI currently edits expected status only.
- Response status, headers, body, duration, response size, assertion results, and structured request errors.
- Session-only request history.
- Relay-format JSON import, validated with AJV and appended as a collection at Workspace root or as a nested folder under the selected collection/folder. Environment conflicts are retained with a suffix rather than overwriting existing values.
- Workspace autosave to a per-user JSON file, a selectable save path, and export of the selected workspace/collection/folder as a separate Relay-format JSON copy.
- At the Phase 1 baseline, Node fetch used the Windows system CA store with TLS verification enabled. The current Phase 2 implementation uses Electron `net.fetch` and the platform certificate store.
- A four-request and ten-request JSONPlaceholder sample collection.
- Windows NSIS and portable packaging scripts are configured.

## Verification At Baseline

- `npm run typecheck` passes.
- `npm run build` passes for Electron main, preload, and renderer bundles.
- Both sample collections and a workspace containing collections/folders validate against the runtime schema.
- Public JSONPlaceholder GET/POST/PUT/PATCH/DELETE sample endpoints were manually probed; the service simulates writes and does not persist created data.
- No automated test suite existed at the initial Phase 1 checkpoint. Phase 2 starts by adding schema/fixture tests.

## Known Limits and Risks

- No collection runner, sequential execution, request chaining, or report export. Requests are sent individually.
- OAuth 2.0, WSDL import, SOAP generation, form-data file upload, Postman collection conversion, workspace switching, folder/collection rename, and drag/reordering are not implemented.
- JSON Schema/XPath assertion editors are not in the UI.
- Request tabs and history do not restore after restart.
- In Phase 1, workspace JSON included auth credentials and environment values as plaintext. Phase 2 Step 4 now migrates recognized credentials and protects marked values with OS storage; unmarked raw body text and URL values still require care.
- Executables are unsigned and may trigger Windows SmartScreen.
- The npm security audit has not been verified because npm registry TLS validation failed in this environment. Earlier installation output reported moderate advisories; triage remains open.

## Phase 1 Boundary

The Phase 1 application is a functional local prototype for configuring and sending individual API requests, managing a saved Relay workspace, and inspecting individual responses. It is not a production test-runner or a security-approved distribution.
