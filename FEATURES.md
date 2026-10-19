# Relay Feature Guide

**Status:** Phase 2 desktop prototype  
**Last reviewed:** 2026-10-17

Relay is a Windows desktop client for sending REST and SOAP HTTP requests, viewing responses, and running supported response assertions. This guide describes the current implementation, including limitations, rather than planned features.

## Quick Start

The app opens with a `Relay workspace` containing a `Demo APIs` collection, a `JSONPlaceholder` folder, and two example requests:

- **Get a post** sends `GET https://jsonplaceholder.typicode.com/posts/1` and expects status `200`.
- **Create a post** sends a JSON `POST` to `https://jsonplaceholder.typicode.com/posts` and expects status `201 Created`. JSONPlaceholder simulates creation and does not persist the post.

JSONPlaceholder simulates writes but does not persist records created by POST. Use the [local CRUD collection](spec/local-api-crud-collection.json) and [local API guide](LOCAL-API-SERVER.md) to test create, response extraction, update, and delete against the stateful local API; its data lasts only until the server stops.

Choose a request in the collection tree, review its method and URL, then click **Send**. The Demo environment requires internet access.

## Collections

- The sidebar hierarchy is workspace, collections, folders, and requests. A workspace can contain multiple collections, and folders can be nested.
- Use the layers button beside **COLLECTIONS** to create and name a collection. Select **Relay workspace** to create a root folder, or select a collection/folder to create a nested folder with the folder-plus button.
- Use the file-plus button to add a request inside the selected collection or folder. Rename it in the request title field; delete it with the trash button in the tree.
- Opened requests appear as tabs above the request builder. Select a tab to switch between requests; closing a tab does not delete its saved request.
- Import a Relay-format JSON collection using the folder-import button. Imported files are validated against `RestSoapSpecEnterprise v2.0`. At Workspace root, import adds a collection; with a collection or folder selected, it adds the import as a nested folder. Existing workspace content is preserved.
- Use the single **Import OpenAPI definition** action for Swagger 2.0, the predecessor specification, or OpenAPI 3.0 JSON/YAML definitions. Relay generates requests, parameters, supported auth/body settings, and JSON Schema checks for supported 2xx JSON responses. Local references are limited to files in the selected definition's directory; remote references and OpenAPI 3.1 are not supported.
- Use the hard-drive button to choose a JSON file path for saving. The entire workspace autosaves there and is restored next launch. The top bar shows the save state and file path on hover.
- Select **Relay workspace** and use the download button to export the entire workspace. Select a collection or folder to export only that collection/folder. Export creates a separate JSON copy and does not change the autosave location.
- Selecting a request loads its method, URL, headers, body, auth configuration, and assertions.
- Sample collections are available: [four-request demo](spec/demo-multi-request-collection.json), [ten-request demo](spec/demo-ten-request-collection.json), and [local CRUD demo](spec/local-api-crud-collection.json).
- Use the sliders button beside the environment dropdown to add, rename, or remove workspace environments and edit their variables. At least one environment is retained.
- Mark environment, parameter, header, or structured body values **Secret** to encrypt them at rest. Names containing `token`, `password`, `secret`, `credential`, or `apiKey` are protected automatically. Bearer, Basic, and API-key auth values are protected automatically. JSON/XML/raw bodies containing credentials can be marked **Protect at rest**.
- Existing plaintext auth values and recognized secret rows are migrated on load when OS encryption is available. If secure storage is unavailable, Relay refuses to save non-empty secrets.
- Collection exports are redacted by default. Confirm to include plaintext credentials only when creating a trusted private copy; treat that export as a secret. URLs and unmarked raw body text are not automatically detected as credentials.
- The selected environment applies across all requests in the workspace. Environment edits autosave with the workspace. Use `{{key}}`, such as `{{baseUrl}}/users`, in URLs, query parameters, headers, bodies, and auth fields.
- Use **Run selection** to execute the selected collection or folder in tree order, or select **Relay workspace** to run all requests. The active environment is used for every request. Stop on failure is enabled by default; you can also stop after the current request.
- On Relay-format import, requests with exactly one enabled numeric `limit` and `offset` query parameter are automatically configured for offset pagination; explicit pagination settings are preserved. Page size and starting offset come from those values, maximum pages defaults to 10, and you set the response-array JSON Pointer in **Params**. Collection runs fetch pages sequentially and show each page in the run report. A short page ends pagination; a full page at the maximum is reported as potentially incomplete. Cursor pagination is not supported.
- Before a run, Relay checks that referenced environment variables are set and request URLs are valid. Missing values and invalid URLs block execution; state-changing requests and requests without response checks require review. The check never displays environment values.
- The run report shows each request's method, status, duration, response-body size, assertion results, and response-extraction outcomes. Choose JSON, Excel-compatible CSV, or standalone HTML when exporting. All formats omit response bodies, headers, and extracted values.

The Relay collection importer accepts Relay JSON. The single OpenAPI importer accepts Swagger 2.0 and OpenAPI 3.0 JSON/YAML definitions; other formats are not converted.

## Request Configuration

### Method and URL

The method selector supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`. The URL field accepts a literal URL or `{{variable}}` placeholders. When placeholders are present, the resolved URL is shown below the field. Press **Enter** in the URL field or click **Send** to execute the request.

### Query Parameters and Headers

The **Params** and **Headers** tabs provide key/value rows. You can add or remove rows and enable or disable each row. Enabled values are interpolated from the selected environment. Query parameters are appended to the URL when the request is sent.

### Authentication

The **Auth** tab currently supports:

- No Auth
- Bearer token
- Basic username/password
- API key in a header or query parameter
- OAuth2 Password Grant (legacy)

The OAuth2 password-grant option is configured per request. It requests an access token from the configured token URL, then sends that request with the token as Bearer authorization. Identical settings share an in-memory token cache until shortly before expiry. Token URLs must use HTTPS, except localhost for local testing. Client secret, username, and password are protected with OS storage and masked in the editor. This is a legacy OAuth flow; authorization-code, client-credentials, device-code, and refresh-token flows are not supported. The flow has not been validated against the private RAN identity provider.

### Request Body

The Body tab presents `none`, `json`, `xml`, `raw`, `urlencoded`, and `formdata` modes.

- `json`, `xml`, and `raw` use the text editor. JSON and XML set their respective content types; XML uses `text/xml; charset=utf-8`.
- Enable **Protect at rest** when the raw body contains credentials; for URL-encoded and form-data modes, mark each sensitive row **Secret**.
- SOAP envelopes can be entered as raw XML. Add a `SOAPAction` header in the Headers tab when the service requires it.
- `urlencoded` provides editable key/value fields. Form-data uses multipart encoding and supports text or selected file parts. Files are limited to 50 MiB each; file contents and selection tokens stay in memory and must be selected again after restarting Relay.
- `GET` and `HEAD` requests are sent without a body.

There is no WSDL import, SOAP envelope generator, or separate SOAP request wizard.

## Responses and Assertions

After a request, the response area can show:

- HTTP status and status text
- Round-trip duration and response-body size
- Response body, response headers, and assertion results in separate tabs
- JSON bodies formatted for display; non-JSON bodies are shown as text
- Network, timeout, and invalid-URL errors as request failures; JSON/XML parsing errors during assertions appear as failed test results

The request engine uses a 30-second timeout. Assertions work as follows:

- Expected status codes can be edited in the **Tests** tab.
- Set a maximum response time in milliseconds in the **Tests** tab. The check passes when duration is at or below the threshold. Values range from 1 to 30,000 ms; the request timeout remains 30 seconds.
- JSON Schema, XPath, JSON Pointer, and response-header assertions can be configured in the **Tests** tab. JSON Pointer checks field presence or exact scalar-text equality; response-header checks match names case-insensitively and can check presence or exact value.
- In **Tests**, add a run-scoped variable name and JSON Pointer such as `/id` to extract a value from a JSON response. Later requests in the collection run can use it as `{{createdId}}`; individual sends do not perform extraction. The value can replace a same-named environment variable for that run. When testing against a mock API, confirm it persists created records before chaining a POST response ID into a later update.
- In **Tests**, add named data-driven cases with key/value overrides. During collection runs, each case runs sequentially with its own report row; override values apply to that request only and can be marked **Secret**. Requests with multiple cases cannot also extract run-scoped variables, and each request is limited to 100 cases.

## Request History

Requests sent individually during the current app session appear in the sidebar with method, URL, time, and status. Select an entry to inspect its previous response in the response pane without sending a request. Use **Load request** beside an entry to load its request and environment snapshot into the builder as an unsaved draft; click **Send** only when you want to run it again. History holds up to 12 entries (five shown) in memory and is cleared when the app closes. Response bodies are capped at 256 KiB per entry; truncated bodies are identified in the viewer. History is not persisted or exported, and collection-run requests are not added to it.

## Current Limitations

- Collections and folders can be created with names, and folders can be nested under the workspace, a collection, or another folder. Collections and folders can be deleted with confirmation, including their contents. Requests can be created inside collections/folders, renamed, and deleted with confirmation. Moving/reordering items is not implemented.
- Standalone binary request bodies and files over 50 MiB are not supported. File selections are session-only; paths, tokens, and file contents are not persisted or exported.
- Response-time, JSON Schema, XPath, JSON Pointer, and response-header assertion rules are saved with the request and run after the response arrives; XPath rules apply to XML responses.
- OAuth2 supports only the legacy password grant configured per request; other grants and refresh tokens are not supported.
- History responses, request/environment snapshots, and replay drafts are session-only and remain in renderer memory; they are not persisted to disk. Response bodies may contain sensitive data.
- Open request tabs are session-only and are not restored when Relay restarts.
- Extracted JSON Pointer values are available only for the current collection run and do not modify saved environments.
- The top bar shows the single local workspace; switching workspaces is not implemented. **Copy as cURL** creates a PowerShell-compatible `curl.exe` command for the current request and asks for confirmation before copying it to the clipboard because it may contain credentials. Settings controls are not wired to actions yet.
- `npm test` runs offline schema/fixture, runner, readiness, offset-pagination, response-extraction/assertion, credential-protection, multipart payload/cURL, OAuth2 helper, and report-format checks; it does not contact the private RAN identity provider or exercise the native file dialog through Electron.

## Data and Network Notes

Requests are sent by the Electron main process to the URL configured by the user or the selected environment. Use test credentials and test data. Do not send secrets or confidential payloads to the public JSONPlaceholder demo service.

By default, workspace data is stored in Relay's per-user application data folder. Non-secret data remains JSON; credential values are encrypted with Electron `safeStorage` and kept alongside the workspace. If you choose another location, the same protection applies. Encryption is tied to the local OS account, so it is not a cross-machine secrets vault. Request history remains session-only. Import appends a collection or nested folder at the selected location without removing existing workspace items.
s