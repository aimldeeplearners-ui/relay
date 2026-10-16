import type { RequestDefinition } from './api';

export type OAuth2PasswordConfig = NonNullable<NonNullable<RequestDefinition['auth']>['oauth2']>;

export interface OAuth2PasswordGrantRequest {
  tokenUrl: string;
  body: URLSearchParams;
  cacheKeyMaterial: string;
}

export interface OAuth2PasswordGrantToken {
  accessToken: string;
  expiresInSeconds?: number;
}

function interpolate(value: string, environment: Record<string, string>): string {
  return value.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (placeholder, key: string) => environment[key] ?? placeholder);
}

export function buildOAuth2PasswordGrantRequest(
  config: OAuth2PasswordConfig,
  environment: Record<string, string>,
): OAuth2PasswordGrantRequest {
  const credentials = {
    tokenUrl: interpolate(config.tokenUrl, environment).trim(),
    clientId: interpolate(config.clientId, environment),
    clientSecret: interpolate(config.clientSecret, environment),
    username: interpolate(config.username, environment),
    password: interpolate(config.password, environment),
    scope: interpolate(config.scope ?? '', environment),
  };
  if (!credentials.tokenUrl || !credentials.clientId || !credentials.username || !credentials.password) {
    throw new Error('OAuth2 password grant requires a token URL, client ID, username, and password.');
  }
  if (Object.values(credentials).some((value) => value.includes('{{'))) {
    throw new Error('OAuth2 configuration contains an unresolved environment variable.');
  }

  let tokenUrl: URL;
  try {
    tokenUrl = new URL(credentials.tokenUrl);
  } catch {
    throw new Error('OAuth2 token URL must be a valid absolute URL.');
  }
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(tokenUrl.hostname);
  if (tokenUrl.protocol !== 'https:' && !(tokenUrl.protocol === 'http:' && localHost)) {
    throw new Error('OAuth2 token URLs must use HTTPS (HTTP is allowed only for localhost).');
  }

  const body = new URLSearchParams({
    grant_type: config.grantType,
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    username: credentials.username,
    password: credentials.password,
  });
  if (credentials.scope) body.set('scope', credentials.scope);

  return { tokenUrl: tokenUrl.toString(), body, cacheKeyMaterial: JSON.stringify(credentials) };
}

export function parseOAuth2PasswordGrantResponse(status: number, responseText: string): OAuth2PasswordGrantToken {
  if (status < 200 || status >= 300) throw new Error(`OAuth2 token endpoint responded with HTTP ${status}.`);

  let tokenResponse: unknown;
  try {
    tokenResponse = JSON.parse(responseText);
  } catch {
    throw new Error('OAuth2 token endpoint did not return valid JSON.');
  }
  if (typeof tokenResponse !== 'object' || tokenResponse === null || Array.isArray(tokenResponse)) {
    throw new Error('OAuth2 token endpoint returned an invalid response.');
  }
  const response = tokenResponse as Record<string, unknown>;
  if (typeof response.access_token !== 'string' || !response.access_token) {
    throw new Error('OAuth2 token response is missing access_token.');
  }
  if (typeof response.token_type === 'string' && response.token_type.toLowerCase() !== 'bearer') {
    throw new Error(`OAuth2 token type "${response.token_type}" is not supported; expected Bearer.`);
  }
  const expiresIn = Number(response.expires_in);
  return {
    accessToken: response.access_token,
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expiresInSeconds: expiresIn } : {}),
  };
}