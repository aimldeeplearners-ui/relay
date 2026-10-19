# GitHub Copilot Instructions: REST/SOAP API Tester Project

## 1. Project Overview & Scope
This project is a desktop-based API testing application built with **Electron, React, TypeScript, and Tailwind CSS**. 
- **Core Focus:** Dedicated exclusively to **REST** and **SOAP** APIs.
- **Specification:** Relay-format collection/workspace documents must adhere to **`RestSoapSpecEnterprise v2.0`** (stored in `spec/rest-soap-spec.json`). Swagger/OpenAPI source definitions are converted into this format. Transient UI/history state uses shared TypeScript contracts and is not persisted as a collection document.
- **Forbidden:** Do not introduce support for GraphQL, gRPC, WebSockets, or a collection JavaScript sandbox (`pm.test` scripting). Use declarative validations (JSON Schema and XPath) instead.

---

## 2. Technical Stack & Dependencies
When generating code or suggesting packages, adhere strictly to these libraries:
* **Desktop Framework:** Electron (utilizing secure context isolation and IPC handlers).
* **UI Framework:** React (Functional components with Hooks) + TypeScript + Tailwind CSS.
* **Code Editor:** The current payload editor is a plain text editor; Monaco and CodeMirror are not installed. Do not add an editor dependency unless requested.
* **HTTP / Execution Clients:** 
  * **REST and SOAP:** Use Electron's main-process `net.fetch` dispatcher. It supports JSON, urlencoded, text form-data, and raw modes; SOAP uses the same dispatcher with `Content-Type: text/xml; charset=utf-8` and user-defined `SOAPAction` headers.
* **Validation & Assertions:**
  * **JSON Schema:** **AJV** (Another JSON Schema Validator) for REST response validation.
  * **XPath:** `xpath` and `xmldom` packages for XML node verification in SOAP responses.

---

## 3. Architecture & File Structure Guidelines
* **Main Process (`src/main/index.ts`):** Currently handles HTTP execution, assertion evaluation, schema-validated collection import, local workspace persistence/export, and native file dialogs. Keep filesystem access in this process.
* **Preload (`src/preload/index.ts`):** Exposes the narrow, typed IPC API through `contextBridge`. Never enable raw `nodeIntegration` in the renderer.
* **Renderer (`src/renderer/App.tsx`):** Currently contains the React workspace UI: collection/folder/request tree, request tabs, environment editor, request builder, response viewer, and history.
* **Shared types (`src/shared/api.ts`):** Defines the collection, request, environment, response, and IPC contracts.
* Collection items are recursive. Optional `type` distinguishes `collection` and `folder`; request items carry a `request`. Untyped legacy items remain accepted by the schema.

The product specification describes planned target behavior. Check `FEATURES.md` before assuming a capability is implemented; the current phase supports one API-definition import action for Swagger 2.0 (the predecessor specification) and OpenAPI 3.0, sequential collection runs, session-only request-history response snapshots and unsaved replay drafts, a local session-only body-free Debug Console, rotating metadata-only diagnostic logs, request-level data-driven cases, readiness checks, bounded offset pagination, declarative JSON Pointer extraction/assertions, response-header assertions, response-time thresholds, JSON Schema/XPath assertion editors, confirmed Copy as cURL, and sanitized JSON/CSV/HTML reports, but not third-party collection import or JavaScript scripts.

---

## 4. Coding Style & Implementation Rules
* **TypeScript Strict Mode:** Always use strict typing. Avoid using `any` types wherever possible; define precise interfaces for requests, collections, environments, and response objects matching `RestSoapSpecEnterprise v2.0`.
* **Variable Interpolation:** Replace `{{variable_key}}` occurrences in URLs, headers, bodies, and auth values using the selected environment. During collection runs, run-scoped JSON Pointer extractions may override those values for later requests; never persist extracted values into the saved environment.
* **Credential storage:** Auth values and secret-marked/sensitive-name key/value values are stored with Electron `safeStorage`; raw bodies containing credentials must be marked **Protect at rest**. Collection exports redact secrets unless the user explicitly confirms plaintext export. Never add real credentials to fixtures, tests, or documentation.
* **Current body limitation:** URL-encoded and multipart form-data text/file fields are supported. Selected files are limited to 50 MiB, authorized by a main-process file dialog, and are not persisted; standalone binary bodies are not supported.
* **Error Handling:** Gracefully catch network timeouts, DNS errors, SSL issues, and validation failures, returning structured error objects back to the renderer to display in the UI response drawer.