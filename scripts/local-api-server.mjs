import { createServer } from 'node:http';

const maxBodyBytes = 1024 * 1024;

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const hostname = process.env.RELAY_API_HOST ?? option('host', 'api.relay.localhost');
const port = Number(process.env.RELAY_API_PORT ?? option('port', '3000'));

if (!hostname || /[\s/:]/.test(hostname)) throw new Error('Use a hostname only, for example api.relay.localhost.');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');

const items = new Map([
  [1, { id: 1, name: 'Seed item one', description: 'A sample record for GET testing.' }],
  [2, { id: 2, name: 'Seed item two', description: 'A second sample record.' }],
]);
let nextId = 3;

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error('Request body exceeds the 1 MiB local test limit.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function validText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function handleRequest(request, response) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const method = request.method ?? 'GET';

  if (url.pathname === '/' && method === 'GET') {
    sendJson(response, 200, {
      service: 'Relay local test API',
      status: 'ok',
      endpoints: [
        { method: 'GET', path: '/health', description: 'Health check' },
        { method: 'GET', path: '/api/items', description: 'List items' },
        { method: 'POST', path: '/api/items', description: 'Create an item' },
        { method: 'GET', path: '/api/items/:id', description: 'Get an item' },
        { method: 'PUT', path: '/api/items/:id', description: 'Replace an item' },
        { method: 'PATCH', path: '/api/items/:id', description: 'Update item fields' },
        { method: 'DELETE', path: '/api/items/:id', description: 'Delete an item' },
      ],
      note: 'Use Relay or another HTTP client for POST, PUT, PATCH, and DELETE requests.',
    });
    return;
  }

  if (url.pathname === '/health' && method === 'GET') {
    sendJson(response, 200, { status: 'ok', service: 'Relay local test API' });
    return;
  }

  if (url.pathname === '/api/items') {
    if (method === 'GET') {
      sendJson(response, 200, { items: [...items.values()].sort((left, right) => left.id - right.id), count: items.size });
      return;
    }
    if (method === 'POST') {
      const body = await readJson(request);
      if (!validText(body.name)) {
        sendJson(response, 400, { error: 'Field "name" is required and must be a non-empty string.' });
        return;
      }
      const item = { id: nextId++, name: body.name.trim(), description: typeof body.description === 'string' ? body.description : '' };
      items.set(item.id, item);
      sendJson(response, 201, item, { location: `/api/items/${item.id}` });
      return;
    }
    response.setHeader('allow', 'GET, POST');
    sendJson(response, 405, { error: 'Method not allowed for /api/items.' });
    return;
  }

  const itemMatch = url.pathname.match(/^\/api\/items\/([^/]+)$/);
  if (itemMatch) {
    const id = Number(decodeURIComponent(itemMatch[1]));
    if (!Number.isSafeInteger(id) || id < 1) {
      sendJson(response, 400, { error: 'Item ID must be a positive integer.' });
      return;
    }
    const current = items.get(id);
    if (method === 'GET') {
      if (!current) sendJson(response, 404, { error: `Item ${id} was not found.` });
      else sendJson(response, 200, current);
      return;
    }
    if (method === 'PUT' || method === 'PATCH') {
      if (!current) {
        sendJson(response, 404, { error: `Item ${id} was not found.` });
        return;
      }
      const body = await readJson(request);
      if (method === 'PUT' && !validText(body.name)) {
        sendJson(response, 400, { error: 'Field "name" is required for PUT.' });
        return;
      }
      const updated = {
        id,
        name: body.name === undefined ? current.name : validText(body.name) ? body.name.trim() : current.name,
        description: body.description === undefined ? current.description : String(body.description),
      };
      items.set(id, updated);
      sendJson(response, 200, updated);
      return;
    }
    if (method === 'DELETE') {
      if (!current) {
        sendJson(response, 404, { error: `Item ${id} was not found.` });
        return;
      }
      items.delete(id);
      sendJson(response, 200, { deleted: true, id });
      return;
    }
    response.setHeader('allow', 'GET, PUT, PATCH, DELETE');
    sendJson(response, 405, { error: 'Method not allowed for an item.' });
    return;
  }

  sendJson(response, 404, { error: 'Route not found.', path: url.pathname });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error) => {
    if (!response.headersSent) {
      sendJson(response, error.status ?? 500, { error: error.message ?? 'Internal server error.' });
    } else {
      response.destroy();
    }
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Relay local test API listening at http://${hostname}:${port}`);
  console.log('Bound to 127.0.0.1 only. Data is in memory and resets when the server stops.');
  console.log('Routes: GET /health, GET/POST /api/items, GET/PUT/PATCH/DELETE /api/items/:id');
});

server.on('error', (error) => {
  console.error(`Could not start the local API: ${error.message}`);
  process.exitCode = 1;
});