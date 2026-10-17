# Relay

Relay is a Windows desktop application for building and testing REST and SOAP HTTP requests. It uses Electron, React, and TypeScript. Collections use Relay's `RestSoapSpecEnterprise v2.0` JSON format.

## Features

- Organize requests in collections and nested folders; switch between workspace environments.
- Configure query parameters, headers, Bearer/Basic/API-key auth, OAuth2 password-grant auth, and JSON, XML, raw, URL-encoded, or text form-data bodies.
- Validate responses with status and response-time thresholds, JSON Schema, XPath, JSON Pointer, or response-header assertions.
- Run collections sequentially, exercise named data-driven cases, extract JSON Pointer values for later requests, check run readiness, and use bounded limit/offset pagination. Imports infer pagination when a request has one enabled numeric `limit`/`offset` pair; the response-array JSON Pointer remains API-specific.
- Copy the active request as a PowerShell-compatible cURL command after confirmation.
- Export sanitized JSON, CSV, or HTML collection-run reports.

Relay imports its own JSON collection format only. Scripted collections, file uploads, cursor pagination, multiple workspaces, and request-history replay are not supported.

## Requirements

- Windows 10 or later.
- Node.js and npm. Node.js 24 is the version used for development and verification.

Dependencies are declared in `package.json` and pinned in `package-lock.json`. `node_modules` is intentionally excluded from Git; on each computer, `npm ci` downloads the locked dependencies from the npm registry and recreates that folder. Internet or access to a configured npm registry is required.

## Run Locally

From the project directory, install dependencies and start the Electron app:

```powershell
npm ci
npm run dev
```

If PowerShell cannot find `node` or `npm`, install Node.js or add its installation directory to `PATH`.

## Test Against the Local API

The included in-memory API runs on loopback and needs no credentials or external network access. In a second PowerShell terminal:

```powershell
npm run api:local
```

Import [the local CRUD collection](spec/local-api-crud-collection.json) into Relay and select the **Local API** environment. The collection checks list/get, creates an item, extracts its ID for follow-up requests, updates and deletes it, and confirms deletion. Data resets when the API server stops. See [LOCAL-API-SERVER.md](LOCAL-API-SERVER.md) for routes and options.

## Checks

From the project directory:

```powershell
npm test
npm run typecheck
npm run build
```

`npm run build` builds the Electron main, preload, and renderer bundles; it does not create an installer.

## Create a Windows Installer

On Windows, from the project directory, run:

```powershell
npm run package:win
```

This builds the app and creates the NSIS installer under `release/`, named `Relay-Setup-<version>.exe` (the current package version is in `package.json`). To create a portable executable instead of an installer, use `npm run package:portable`.

## Data and Security

Workspace data is stored locally. Credential values use Electron `safeStorage` when available; collection exports redact protected values by default. Treat exported commands and any export that includes secrets as sensitive.

Before pushing or publishing this repository, review collection files for internal hostnames, identifiers, or company data. `.gitignore` excludes the original credential-bearing collection export, but ignoring a file does not sanitize it. Never commit real credentials.

## Documentation

- [User guide](USER-GUIDE.md)
- [Build guide](BUILD-GUIDE.md)
- [Feature guide](FEATURES.md)
- [Architecture](ARCHITECTURE.md)
- [Product specification](PRODUCT-SPEC.md)
- [Phase 1 baseline](PHASE1.md)
- [Phase 2 roadmap and verification](PHASE2.md)
- [Local API server guide](LOCAL-API-SERVER.md)
- [Third-party software and license inventory](THIRD-PARTY-SOFTWARE.md)

## License

No project license is currently specified. Confirm the intended repository visibility and distribution terms before public redistribution.