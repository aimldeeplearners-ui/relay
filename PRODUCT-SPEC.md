# PRODUCT SPECIFICATION & AGENT BRIEFING: "REST/SOAP API Tester"

> This document describes target product requirements, not a claim that every feature is implemented in the current Phase 2 prototype. See [FEATURES.md](FEATURES.md) for current capabilities and known limitations.

## 1. Executive Summary & Product Vision
Build a professional-grade desktop application (built with **Electron, React, TypeScript, and Tailwind CSS**) inspired by Postman. The tool is dedicated exclusively to **REST** and **SOAP** APIs. It must support environment switching, a left-side collection workspace tree, full request configuration (params, headers, auth, multi-mode bodies), and an automated validation/assertion engine (JSON Schema for REST, XPath for SOAP) based on the custom **`RestSoapSpecEnterprise v2.0`** format.

## Current Implementation Snapshot (2026-10-16)

The Phase 2 prototype currently supports individual REST/SOAP requests, Relay-format JSON import/export, workspace environments, protected credentials, OAuth2 password-grant auth, JSON Schema/XPath checks, JSON Pointer extraction, sequential collection runs, run-readiness checks, bounded offset pagination, Copy as cURL, and sanitized JSON/CSV/HTML run reports. Offset pagination is opt-in per request; the response-array JSON Pointer must match the API response. See [FEATURES.md](FEATURES.md) for user-facing behavior and [PHASE2.md](PHASE2.md) for verification.

Still planned or unsupported: request-history replay, raw Postman import/conversion, file uploads, cursor/page-token pagination, multiple workspaces, container rename/reordering, and functional Settings. Postman JavaScript scripts and non-REST/SOAP protocols remain out of scope.

---

## 2. Technical Stack Recommendation
* **Desktop Shell:** Electron (with secure context isolation and IPC communication).
* **Frontend UI:** React + TypeScript + Tailwind CSS.
* **Code Editor:** Monaco Editor or CodeMirror for JSON/XML payload editing with syntax highlighting.
* **Network Execution Layer:** Axios or native `fetch` for REST; configured `http/https` dispatcher with custom headers (`Content-Type: text/xml`, `SOAPAction`) for SOAP.
* **Validation Engines:** 
  * **AJV** (Another JSON Schema Validator) for REST response validation.
  * **`xpath`** and **`xmldom`** for SOAP response evaluation.

---

## 3. Data Specification (`RestSoapSpecEnterprise v2.0`)
All collection files imported, exported, and stored by the application must strictly adhere to the canonical AJV schema at [spec/rest-soap-spec.json](spec/rest-soap-spec.json). The example below mirrors that schema; keep it synchronized when the runtime schema changes.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "RestSoapSpecEnterprise",
  "type": "object",
  "properties": {
    "info": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "description": { "type": "string" },
        "version": { "type": "string" }
      },
      "required": ["name", "version"]
    },
    "environments": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "name": { "type": "string" },
          "values": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "key": { "type": "string" },
                "value": { "type": "string" },
                "enabled": { "type": "boolean" },
                "secret": { "type": "boolean" },
                "description": { "type": "string" }
              },
              "required": ["key", "value"]
            }
          }
        }
      }
    },
    "items": {
      "type": "array",
      "items": { "$ref": "#/definitions/CollectionItem" }
    }
  },
  "required": ["info", "items"],
  "definitions": {
    "CollectionItem": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "type": { "type": "string", "enum": ["collection", "folder"] },
        "description": { "type": "string" },
        "items": {
          "type": "array",
          "items": { "$ref": "#/definitions/CollectionItem" }
        },
        "request": { "$ref": "#/definitions/Request" }
      },
      "required": ["name"]
    },
    "Request": {
      "type": "object",
      "properties": {
        "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
        "url": { "type": "string" },
        "queryParams": {
          "type": "array",
          "items": { "$ref": "#/definitions/KeyValue" }
        },
        "pagination": {
          "type": "object",
          "properties": {
            "limitParam": { "type": "string", "minLength": 1 },
            "offsetParam": { "type": "string", "minLength": 1 },
            "pageSize": { "type": "integer", "minimum": 1, "maximum": 1000 },
            "startOffset": { "type": "integer", "minimum": 0, "maximum": 1000000000 },
            "maxPages": { "type": "integer", "minimum": 1, "maximum": 100 },
            "itemsJsonPointer": { "type": "string" }
          },
          "required": ["limitParam", "offsetParam", "pageSize", "startOffset", "maxPages", "itemsJsonPointer"],
          "additionalProperties": false
        },
        "headers": {
          "type": "array",
          "items": { "$ref": "#/definitions/KeyValue" }
        },
        "extractVariables": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "jsonPointer": { "type": "string" }
            },
            "required": ["name", "jsonPointer"]
          }
        },
        "auth": {
          "type": "object",
          "properties": {
            "type": { "type": "string", "enum": ["none", "bearer", "basic", "apikey", "oauth2"] },
            "bearer": {
              "type": "object",
              "properties": { "token": { "type": "string" } }
            },
            "basic": {
              "type": "object",
              "properties": { "username": { "type": "string" }, "password": { "type": "string" } }
            },
            "apikey": {
              "type": "object",
              "properties": { "key": { "type": "string" }, "value": { "type": "string" }, "in": { "type": "string", "enum": ["header", "query"] } }
            },
            "oauth2": {
              "type": "object",
              "properties": {
                "grantType": { "type": "string", "enum": ["password"] },
                "tokenUrl": { "type": "string" },
                "clientId": { "type": "string" },
                "clientSecret": { "type": "string" },
                "username": { "type": "string" },
                "password": { "type": "string" },
                "scope": { "type": "string" }
              },
              "required": ["grantType", "tokenUrl", "clientId", "clientSecret", "username", "password"]
            }
          }
        },
        "body": {
          "type": "object",
          "properties": {
            "mode": { "type": "string", "enum": ["json", "xml", "raw", "urlencoded", "formdata", "none"] },
            "secret": { "type": "boolean" },
            "raw": { "type": "string" },
            "urlencoded": { "type": "array", "items": { "$ref": "#/definitions/KeyValue" } },
            "formdata": { "type": "array", "items": { "$ref": "#/definitions/KeyValue" } }
          }
        },
        "assertions": {
          "type": "object",
          "properties": {
            "expectedStatusCode": { "type": "integer" },
            "jsonSchema": { "type": "object" },
            "xpathMatches": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "xpath": { "type": "string" },
                  "expectedValue": { "type": "string" }
                },
                "required": ["xpath"]
              }
            }
          }
        }
      },
      "required": ["method", "url"]
    },
    "KeyValue": {
      "type": "object",
      "properties": {
        "key": { "type": "string" },
        "value": { "type": "string" },
        "enabled": { "type": "boolean" },
        "secret": { "type": "boolean" },
        "description": { "type": "string" }
      },
      "required": ["key", "value"]
    }
  }
}
```

---

## 4. Detailed UI & Functional Requirements

### A. Left Sidebar Workspace
* **Collections Tree:** Hierarchical folders and requests with support for create, rename, delete, and drag-and-drop ordering.
* **Import / Export Actions:** Import valid collections via JSON files from disk and export current collections back out.
* **Environment Dropdown:** Select active environment variables (`{{domain}}`, `{{bearerToken}}`, etc.) to apply globally across all request runs.
* **History Tab:** Automatically record executed requests with timestamps, HTTP methods, target URLs, and response status codes.

### B. Main Request Builder Pane
* **URL Bar:** HTTP Method Selector (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`), URL input with live environment variable interpolation, and a prominent **Send** button.
* **Copy as cURL:** Generate a PowerShell-compatible `curl.exe` command for the active request. Require confirmation before copying it because it can contain credentials or request data.
* **Request Configuration Tabs:**
  * **Params:** Key-value table for URL query parameters that auto-sync and append to the URL query string. Optional offset pagination configures limit/offset names, page size, start offset, maximum pages, and a JSON Pointer to the response array.
  * **Headers:** Key-value table for request headers (with quick-select options for `Content-Type`, `Accept`, `Authorization`).
  * **Auth:** Support for `No Auth`, `Bearer Token`, `Basic Auth`, `API Key`, and the legacy OAuth2 password grant.
  * **Body:** Mode toggle (`none`, `json`, `xml`, `raw`, `urlencoded`, `formdata`) with a built-in code editor for payloads.
  * **Tests / Assertions:** Fields to set expected status codes, embed JSON Schema definitions (for REST response validation), or define XPath assertions (for SOAP XML responses).

### C. Response Viewer Pane
* **Status Bar:** Displays returned HTTP status code (color-coded), total round-trip response time in milliseconds, and payload size in bytes.
* **Response Tabs:**
  * **Body:** Formatted syntax-highlighted viewer (JSON tree view / XML viewer).
  * **Headers:** Response headers key-value table.
  * **Test Results:** Clear pass/fail checkmark list verifying status codes, JSON schema compliance, and XPath rules.

---

## 5. Core Execution & Interpolation Engine Rules
1. **Variable Interpolation (`{{key}}`):** Before executing any network call, parse all URLs, headers, bodies, and auth configurations to substitute `{{key}}` markers with active environment variable values.
2. **REST Dispatcher:** Build an HTTP client wrapper handling standard REST verbs, attaching appropriate query parameters, headers, and body payloads (`json`, `urlencoded`, `formdata`, or `raw`).
3. **SOAP Dispatcher:** Force `Content-Type: text/xml; charset=utf-8` and ensure any user-defined `SOAPAction` header is explicitly passed alongside raw XML payload envelopes.
4. **Validation Runner:** Automatically evaluate test assertions after receiving responses:
   - For REST responses with a defined `jsonSchema`, run validation via `AJV`.
   - For SOAP responses with `xpathMatches`, evaluate XML nodes using an XPath engine.
5. **Collection Runs:** Run the selected collection/folder sequentially, support stop-on-failure/manual stop, and pass JSON Pointer-extracted values to later requests as run-scoped variables.
6. **Run Readiness:** Before a collection run, block missing/blank environment values and invalid URLs; require review for write methods and requests without response checks. Do not display environment values in readiness output.
7. **Offset Pagination:** For opted-in requests, update configured limit/offset query parameters page by page, inspect the configured JSON array pointer, stop on a short page, and report a full page at the maximum as potentially incomplete.
8. **Copy as cURL:** Generate a PowerShell-compatible `curl.exe` command for the current request and require user confirmation before copying potentially sensitive data.