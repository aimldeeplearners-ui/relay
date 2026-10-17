# Relay User Guide

This guide walks through setting up Relay, sending a request, validating a response, and running a collection. For your first test, use the included local API so you do not need production credentials or an external service.

## 1. Open Relay

Launch the installed Relay app. The default workspace contains demo requests. The Demo environment calls a public example service and requires internet access. Use test data only; do not send secrets or confidential payloads to public demo services.

## 2. Run the Local CRUD Example

The local CRUD example uses a small test API that is separate from the Relay app. If you have the project source, start that API by following [the local API guide](LOCAL-API-SERVER.md). Otherwise, use an API endpoint that is safe for testing.

In Relay:

1. Click **Import Relay collection JSON** beside **COLLECTIONS**.
2. Choose [the local CRUD collection](spec/local-api-crud-collection.json).
3. Select the **Local API** environment in the environment selector.
4. Select **Items CRUD** in the collection tree, then click **Run selection**.
5. Review the readiness panel. The sample has write requests, so choose **Run anyway** to proceed.
6. Review the run report. It checks list/get, creates an item, extracts its ID, updates and deletes it, then verifies the item returns `404`.

When the local API is running, it listens only on your computer at `http://api.relay.localhost:3000`. Its records are held in memory and reset when the server stops.

To test OpenAPI import against the same service, click **Import OpenAPI definition** and choose [the local OpenAPI sample](spec/openapi-local-test-api.yaml). Select the generated **OpenAPI** environment. Start with **Health check** or **List items** using **Send**; the generated Create, Replace, Update, and Delete requests change the local in-memory data. A collection run that includes them asks you to review write requests before continuing.

## 3. Set Up a Request

### Create a collection and request

To start from scratch:

1. In the sidebar beside **COLLECTIONS**, click **New collection** (the layers icon), enter a name, and click **Create**.
2. Select the new collection in the tree. Click **New request** (the file-plus icon) and Relay adds a request named **New request** with method `GET`.
3. Select the request in the tree. Its method and configuration appear in the request builder.

If you already imported a collection, select one of its requests instead.

### Configure and send it

1. Choose an HTTP method and enter the URL. Use an environment placeholder such as `{{baseUrl}}/api/items`; Relay displays the resolved URL below the field.
2. In **Params**, add query parameters. In **Headers**, add request headers. Disable a row to omit it without deleting it.
3. In **Auth**, select No Auth, Bearer Token, Basic Auth, API Key, or OAuth2 Password Grant. Use credentials only with endpoints you trust.
4. In **Body**, select the request body mode. JSON, XML, and raw use the text editor; URL-encoded and form-data use key/value rows. Form-data supports text only, not file uploads.
5. Click **Send** to run one request. Single-request sends do not perform collection-run extraction or pagination.

For SOAP, enter the XML envelope in the XML or raw body editor and add a `SOAPAction` header if the service requires one. Relay sends XML with `text/xml; charset=utf-8`. There is no WSDL importer or SOAP envelope generator.

## 4. Configure Environments and Secrets

The selected environment applies across the workspace. Use the environment selector to switch environments. Click **Manage environments** (the sliders button beside the selector) to add an environment, rename it, or add/edit/remove variables. To add a variable, choose the environment, click **Add variable**, then enter its key and value. Mark a sensitive row **Secret** before entering a credential. Reference variables in URLs, query parameters, headers, body fields, and auth values with `{{key}}` syntax, for example `{{baseUrl}}/api/items`.

Mark sensitive environment, parameter, header, or structured-body values **Secret**. Auth values are protected automatically. For credentials inside a JSON/XML/raw body, enable **Protect at rest**. Relay uses Electron `safeStorage` when the operating system provides it. Encryption is local to the OS account; it is not a shared secrets vault.

## 5. Validate a Response

Open the request's **Tests** tab to configure:

- **Expected status code**, for example `200` or `201`.
- **Maximum response time**, in milliseconds, for example `1000`. The check fails if measured request duration exceeds the threshold. Values range from 1 to 30,000 ms; the request timeout is 30 seconds.
- **JSON Schema** to validate a JSON response's structure and values.
- **XPath checks** to check nodes and optional expected text in an XML response.
- **JSON Pointer checks** to check that a response field exists or exactly equals expected text, for example `/status` equals `active`.
- **Response header checks** to check that a header exists or exactly equals expected text, for example `Content-Type` equals `application/json`. Header names are case-insensitive.
- **Run-scoped variables** to extract values from JSON with a JSON Pointer, such as `/id`.
- **Data-driven cases** to run this request with multiple named variable sets during a collection run. Add a case, give it a unique name, then add key/value overrides such as `region=west` or `limit=0`. Use those keys as `{{region}}` or `{{limit}}` in the request.

During a collection run, later requests can use extracted values as `{{variableName}}`. They override a same-named environment value only for that run and are not saved into the environment. Individual **Send** actions do not extract values.

Each data case runs sequentially and appears as its own result row. Case values override both selected-environment values and earlier extracted values for this request only; they do not carry into later requests. Assertions configured for the request run for every case. More than one data case cannot be combined with response extraction on the same request because that would make downstream values ambiguous. Mark sensitive case values **Secret**; no more than 100 cases are allowed per request.

## 6. Run a Collection

Select a collection or folder and click **Run selection**. Select **Relay workspace** to run all requests. Requests execute sequentially in tree order; **Stop on failure** is enabled by default. While a run is active, use **Stop run** to stop after the current request.

Before execution, Relay checks the active environment and request URLs. Missing or blank variables and invalid URLs block the run. Write methods and requests without response checks require review. Extracted values from earlier requests are allowed; Relay cannot validate those URLs until the preceding response arrives.

The run report lists status, duration, response size, assertions, and extraction results. It omits response bodies, headers, and extracted values. Select JSON, CSV, or HTML and use **Export report** to save it.

## Request History

Requests sent with **Send** appear in **HISTORY** in the sidebar. Select an entry to inspect its previous response in the response pane; this does not send another request. Use **Load request** beside it to load its request and environment snapshot into an unsaved builder draft. Relay marks it **HISTORY REPLAY · NOT SAVED**. Click **Send** to issue it again; the draft will not overwrite the saved request. History stores up to 12 entries (the sidebar displays five), stays in memory for the current session, and clears when Relay closes. Each response body is capped at 256 KiB; the viewer notes when a body is truncated. Responses may contain sensitive data, so history is not persisted or exported. Collection-run requests are not added to history.

## 7. Use Offset Pagination

On Relay-format import, Relay infers pagination for a request with exactly one enabled numeric `limit` and `offset` query parameter. It preserves any explicit pagination configuration, uses those parameter values for page size and starting offset, and sets the maximum to 10 pages. You must provide the response-array JSON Pointer in the request's **Params** tab because response shapes differ between APIs.

For example, if page size is `50` and start offset is `0`, a collection run requests offsets `0`, `50`, `100`, and so on. A response array shorter than the page size ends pagination. If the maximum page count is reached on a full page, Relay marks the result as potentially incomplete. Each page appears separately in the report; Relay does not combine page bodies into one response. Cursor or page-token pagination is not supported.

Pagination is used only in collection runs. The regular **Send** button sends one request.

## 8. Copy as cURL

Click **Copy as cURL** in the request builder. Relay asks for confirmation before putting the command on the clipboard because it may contain credentials or request data. Treat the copied command as sensitive.

## 9. Save, Import, and Export

Relay autosaves the workspace locally after changes. Use the hard-drive button beside **COLLECTIONS** to choose a JSON autosave file; the top-bar save indicator shows status, and hovering over it shows the path. This is separate from export.

To import an existing Relay collection, click **Import Relay collection JSON** (the download-arrow button beside **COLLECTIONS**) and choose a Relay-format JSON file. At the workspace root, it adds a collection; with a collection/folder selected, it adds the imported items under that location. Existing content is preserved; name conflicts are handled by adding a suffix.

To generate requests from an API definition, use the single **Import OpenAPI definition** action (the code-file button beside **COLLECTIONS**) and choose a JSON or YAML file. It accepts Swagger 2.0, the predecessor to the OpenAPI Specification, and OpenAPI 3.0. It creates folders by path, requests by operation, fills path/query/header parameters and supported bodies/auth schemes, and adds a JSON Schema assertion when a 2xx JSON response schema is available. Select the generated **OpenAPI** environment and review `baseUrl`, credentials, examples, and assertions before sending. Local `$ref` files must be in the selected file's directory; remote references and OpenAPI 3.1 are not supported.

To export, select **Relay workspace**, a collection, or a folder, then click the export button beside **COLLECTIONS** (the folder-arrow button). Relay opens a Save dialog for a separate JSON copy of that scope; this does not change the autosave location. Protected values are redacted by default. Including plaintext secrets requires confirmation; only do so for a trusted destination.

## Troubleshooting

- **Test import validation:** For an expected Relay-format validation error, import [relay-invalid.json](spec/relay-invalid.json). For an expected OpenAPI definition error, use **Import OpenAPI definition** and choose [openapi-invalid.yaml](spec/openapi-invalid.yaml). Both should show an error and leave the workspace unchanged.
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