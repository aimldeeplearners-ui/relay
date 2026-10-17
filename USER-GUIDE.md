# Relay User Guide

This guide walks through setting up Relay, sending a request, validating a response, and running a collection. For your first test, use the included local API so you do not need production credentials or an external service.

## 1. Start Relay

From the project folder, install dependencies and start the desktop app:

```powershell
npm ci
npm run dev
```

The default workspace contains demo requests. The Demo environment calls a public example service and requires internet access. Use test data only; do not send secrets or confidential payloads to public demo services.

## 2. Run the Local CRUD Example

Start the local test API in a second PowerShell terminal:

```powershell
npm run api:local
```

In Relay:

1. Click **Import Relay collection JSON** beside **COLLECTIONS**.
2. Choose [the local CRUD collection](spec/local-api-crud-collection.json).
3. Select the **Local API** environment in the environment selector.
4. Select **Items CRUD** in the collection tree, then click **Run selection**.
5. Review the readiness panel. The sample has write requests, so choose **Run anyway** to proceed.
6. Review the run report. It checks list/get, creates an item, extracts its ID, updates and deletes it, then verifies the item returns `404`.

The API listens only on your computer at `http://api.relay.localhost:3000`. Its records are held in memory and reset when the server stops. See [LOCAL-API-SERVER.md](LOCAL-API-SERVER.md) for details.

## 3. Set Up a Request

Select a request in the tree. Its method and configuration appear in the request builder.

1. Choose an HTTP method and enter the URL. Use an environment placeholder such as `{{baseUrl}}/api/items`; Relay displays the resolved URL below the field.
2. In **Params**, add query parameters. In **Headers**, add request headers. Disable a row to omit it without deleting it.
3. In **Auth**, select No Auth, Bearer Token, Basic Auth, API Key, or OAuth2 Password Grant. Use credentials only with endpoints you trust.
4. In **Body**, select the request body mode. JSON, XML, and raw use the text editor; URL-encoded and form-data use key/value rows. Form-data supports text only, not file uploads.
5. Click **Send** to run one request. Single-request sends do not perform collection-run extraction or pagination.

For SOAP, enter the XML envelope in the XML or raw body editor and add a `SOAPAction` header if the service requires one. Relay sends XML with `text/xml; charset=utf-8`. There is no WSDL importer or SOAP envelope generator.

## 4. Configure Environments and Secrets

The selected environment applies across the workspace. Use the environment selector to switch environments and the sliders button beside it to add or edit one. Add key/value pairs such as `baseUrl`; reference them in URLs, query parameters, headers, body fields, and auth values with `{{key}}` syntax.

Mark sensitive environment, parameter, header, or structured-body values **Secret**. Auth values are protected automatically. For credentials inside a JSON/XML/raw body, enable **Protect at rest**. Relay uses Electron `safeStorage` when the operating system provides it. Encryption is local to the OS account; it is not a shared secrets vault.

## 5. Validate a Response

Open the request's **Tests** tab to configure:

- **Expected status code**, for example `200` or `201`.
- **JSON Schema** to validate a JSON response's structure and values.
- **XPath checks** to check nodes and optional expected text in an XML response.
- **Run-scoped variables** to extract values from JSON with a JSON Pointer, such as `/id`.

During a collection run, later requests can use extracted values as `{{variableName}}`. They override a same-named environment value only for that run and are not saved into the environment. Individual **Send** actions do not extract values.

## 6. Run a Collection

Select a collection or folder and click **Run selection**. Select **Relay workspace** to run all requests. Requests execute sequentially in tree order; **Stop on failure** is enabled by default. While a run is active, use **Stop run** to stop after the current request.

Before execution, Relay checks the active environment and request URLs. Missing or blank variables and invalid URLs block the run. Write methods and requests without response checks require review. Extracted values from earlier requests are allowed; Relay cannot validate those URLs until the preceding response arrives.

The run report lists status, duration, response size, assertions, and extraction results. It omits response bodies, headers, and extracted values. Select JSON, CSV, or HTML and use **Export report** to save it.

## 7. Use Offset Pagination

On Relay-format import, Relay infers pagination for a request with exactly one enabled numeric `limit` and `offset` query parameter. It preserves any explicit pagination configuration, uses those parameter values for page size and starting offset, and sets the maximum to 10 pages. You must provide the response-array JSON Pointer in the request's **Params** tab because response shapes differ between APIs.

For example, if page size is `50` and start offset is `0`, a collection run requests offsets `0`, `50`, `100`, and so on. A response array shorter than the page size ends pagination. If the maximum page count is reached on a full page, Relay marks the result as potentially incomplete. Each page appears separately in the report; Relay does not combine page bodies into one response. Cursor or page-token pagination is not supported.

Pagination is used only in collection runs. The regular **Send** button sends one request.

## 8. Copy as cURL

Click **Copy as cURL** in the request builder. Relay asks for confirmation before putting the command on the clipboard because it may contain credentials or request data. Treat the copied command as sensitive.

## 9. Save, Import, and Export

Relay autosaves the workspace locally. Use the hard-drive button beside **COLLECTIONS** to choose a JSON autosave file; the top-bar save indicator shows status, and hovering over it shows the path. This is separate from export.

Use **Import Relay collection JSON** to append a Relay-format collection or workspace. Existing content is preserved; name conflicts are handled by adding a suffix. Other collection formats are not converted.

Select **Relay workspace**, a collection, or a folder and use the export button to save a separate JSON copy of that scope. Protected values are redacted by default. Including plaintext secrets requires confirmation; only do so for a trusted destination.

## Troubleshooting

- **Missing variable:** Choose the intended environment and fill in the named variable. Relay does not display its value in the readiness panel.
- **Invalid URL:** Check the URL and its environment substitutions. URLs need a scheme such as `https://` or `http://`.
- **Pagination is off:** Import inference requires one enabled, numeric `limit` row and one enabled, numeric `offset` row. Check **Params** and enable pagination manually if the API uses a different naming scheme.
- **Pagination stops or fails:** Set **Items JSON Pointer** to the array in the response. A non-array or invalid JSON response cannot be used to determine whether another page exists.
- **Local API connection fails:** Ensure the local API is running in its terminal and the selected **Local API** environment uses `http://api.relay.localhost:3000`.
- **Run asks for review:** Write methods can change data; requests without assertions or extraction rules are evaluated by HTTP status alone. Review the listed requests before continuing.

## More Documentation

- [Feature guide](FEATURES.md)
- [Local API server](LOCAL-API-SERVER.md)
- [Architecture](ARCHITECTURE.md)
- [Product specification](PRODUCT-SPEC.md)
- [Phase 2 roadmap](PHASE2.md)