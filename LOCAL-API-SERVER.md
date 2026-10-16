# Local CRUD API for Relay

Relay includes a dependency-free, in-memory REST API for local request testing. It binds to `127.0.0.1` only and does not expose a service to the network.

## Start

From the project directory, run:

```powershell
npm run api:local
```

The default base URL is `http://api.relay.localhost:3000`. The `.localhost` hostname resolves to the local machine without editing the hosts file or requiring administrator rights. The server prints its URL and available routes when it starts. Press `Ctrl+C` to stop it.

To choose another local FQDN or port:

```powershell
npm run api:local -- --host inventory.relay.localhost --port 3001
```

Update the `baseUrl` value in Relay's **Local API** environment to match. Custom names outside `.localhost` need local DNS or a hosts-file entry pointing to `127.0.0.1`; the server still binds only to loopback.

## Routes

| Method | Path | Result |
|---|---|---|
| GET | `/` | API information and route list, viewable in a browser |
| GET | `/health` | Server status |
| GET | `/api/items` | List items |
| POST | `/api/items` | Create an item; returns `201` and an ID |
| GET | `/api/items/:id` | Get one item |
| PUT | `/api/items/:id` | Replace an item |
| PATCH | `/api/items/:id` | Update supplied fields |
| DELETE | `/api/items/:id` | Delete an item |

The server starts with two sample items. Created, updated, and deleted data lives only in memory and resets when the server stops. Requests and responses use JSON.

## Test in Relay

Import [the Relay-format CRUD collection](spec/local-api-crud-collection.json), select the **Local API** environment, then run the **Items CRUD** collection with **Run selection**. It checks list/get, creates a record, extracts its ID for get/update/delete, then confirms the deleted record returns `404`. This does not require credentials, VPN access, or external network access.