import SwaggerParser from '@apidevtools/swagger-parser';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CollectionDocument, CollectionItem, HttpMethod, KeyValue, RequestDefinition } from '../shared/api';

type RecordValue = Record<string, unknown>;

const supportedMethods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const jsonSchemaKeywords = new Set([
  '$schema', '$id', '$ref', '$defs', 'definitions', 'title', 'description', 'type', 'properties', 'required',
  'items', 'additionalItems', 'additionalProperties', 'patternProperties', 'propertyNames', 'enum', 'const',
  'format', 'default', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength',
  'maxLength', 'pattern', 'minItems', 'maxItems', 'uniqueItems', 'contains', 'minProperties', 'maxProperties',
  'dependencies', 'allOf', 'anyOf', 'oneOf', 'not',
]);

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): RecordValue {
  return isRecord(value) ? value : {};
}

function asRecords(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function stringifyValue(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function exampleFromSchema(schema: unknown): unknown {
  const value = asRecord(schema);
  if (value.example !== undefined) return value.example;
  if (value.default !== undefined) return value.default;
  if (Array.isArray(value.enum) && value.enum.length) return value.enum[0];
  if (value.type === 'object') {
    const properties = asRecord(value.properties);
    return Object.fromEntries(Object.entries(properties).map(([key, property]) => [key, exampleFromSchema(property)]));
  }
  if (value.type === 'array') return [];
  if (value.type === 'integer' || value.type === 'number') return 0;
  if (value.type === 'boolean') return false;
  if (value.type === 'null') return null;
  return '';
}

function toJsonSchema(value: unknown): RecordValue | undefined {
  if (!isRecord(value)) return undefined;
  const result: RecordValue = {};
  for (const [key, child] of Object.entries(value)) {
    if (!jsonSchemaKeywords.has(key)) continue;
    if (key === 'properties' || key === 'patternProperties' || key === 'definitions' || key === '$defs') {
      const entries = asRecord(child);
      result[key] = Object.fromEntries(Object.entries(entries).map(([name, schema]) => [name, toJsonSchema(schema) ?? {}]));
    } else if (key === 'items' || key === 'additionalProperties' || key === 'not' || key === 'contains' || key === 'propertyNames') {
      result[key] = isRecord(child) ? toJsonSchema(child) ?? {} : child;
    } else if (key === 'allOf' || key === 'anyOf' || key === 'oneOf') {
      result[key] = Array.isArray(child) ? child.map((schema) => toJsonSchema(schema) ?? {}) : child;
    } else {
      result[key] = child;
    }
  }
  if (value.nullable === true && typeof value.type === 'string') {
    result.type = [value.type, 'null'];
  }
  return result;
}

function chooseJsonContent(content: unknown): { mediaType: string; media: RecordValue } | undefined {
  const entries = Object.entries(asRecord(content)).filter(([, media]) => isRecord(media));
  const selected = entries.find(([type]) => type.toLowerCase() === 'application/json')
    ?? entries.find(([type]) => type.toLowerCase().endsWith('+json'));
  return selected ? { mediaType: selected[0], media: asRecord(selected[1]) } : undefined;
}

function pickExample(media: RecordValue, schema: unknown): unknown {
  if (media.example !== undefined) return media.example;
  const examples = asRecord(media.examples);
  const firstExample = Object.values(examples).find(isRecord);
  if (firstExample && asRecord(firstExample).value !== undefined) return asRecord(firstExample).value;
  return exampleFromSchema(schema);
}

function parameterValue(parameter: RecordValue): string {
  if (parameter.example !== undefined) return stringifyValue(parameter.example);
  if (parameter.default !== undefined) return stringifyValue(parameter.default);
  if (Array.isArray(parameter.enum) && parameter.enum.length) return stringifyValue(parameter.enum[0]);
  return stringifyValue(exampleFromSchema(parameter.schema ?? parameter));
}

function mergeParameters(pathParameters: unknown, operationParameters: unknown): RecordValue[] {
  const parameters = new Map<string, RecordValue>();
  for (const parameter of [...asRecords(pathParameters), ...asRecords(operationParameters)]) {
    const key = `${asText(parameter.in)}:${asText(parameter.name)}`;
    if (key !== ':') parameters.set(key, parameter);
  }
  return [...parameters.values()];
}

function addEnvironmentValue(values: Map<string, KeyValue>, key: string, value: string, secret = false): void {
  if (key && !values.has(key)) values.set(key, { key, value, enabled: true, ...(secret ? { secret: true } : {}) });
}

function serverConfiguration(api: RecordValue, environment: Map<string, KeyValue>): string {
  let serverUrl = '';
  const server = asRecords(api.servers)[0];
  if (server) {
    const variables = asRecord(server.variables);
    serverUrl = asText(server.url).replace(/\{([^{}]+)\}/g, (_placeholder, name: string) => {
      const variable = asRecord(variables[name]);
      const defaultValue = asText(variable.default, asRecords(variable.enum).map((entry) => asText(entry)).find(Boolean) ?? '');
      return defaultValue;
    });
  } else if (typeof api.host === 'string') {
    const schemes = Array.isArray(api.schemes) ? api.schemes.map((scheme) => asText(scheme)) : [];
    serverUrl = `${schemes[0] || 'https'}://${api.host}${asText(api.basePath, '')}`;
  }
  addEnvironmentValue(environment, 'baseUrl', serverUrl);
  return serverUrl;
}

function securityDefinitions(api: RecordValue): RecordValue {
  return asRecord(api.components ? asRecord(api.components).securitySchemes : api.securityDefinitions);
}

function configureSecurity(
  operation: RecordValue,
  api: RecordValue,
  environment: Map<string, KeyValue>,
): RequestDefinition['auth'] {
  const definitions = securityDefinitions(api);
  const requirements = Array.isArray(operation.security) ? operation.security : asRecords(api.security);
  for (const requirement of requirements) {
    for (const name of Object.keys(asRecord(requirement))) {
      const scheme = asRecord(definitions[name]);
      const variableSuffix = name.replace(/[^a-zA-Z0-9_]/g, '_');
      if (scheme.type === 'http' && asText(scheme.scheme).toLowerCase() === 'bearer') {
        const tokenKey = `security_${variableSuffix}_token`;
        addEnvironmentValue(environment, tokenKey, '', true);
        return { type: 'bearer', bearer: { token: `{{${tokenKey}}}` } };
      }
      if ((scheme.type === 'http' && asText(scheme.scheme).toLowerCase() === 'basic') || scheme.type === 'basic') {
        const usernameKey = `security_${variableSuffix}_username`;
        const passwordKey = `security_${variableSuffix}_password`;
        addEnvironmentValue(environment, usernameKey, '', true);
        addEnvironmentValue(environment, passwordKey, '', true);
        return { type: 'basic', basic: { username: `{{${usernameKey}}}`, password: `{{${passwordKey}}}` } };
      }
      if (scheme.type === 'apiKey' && (scheme.in === 'header' || scheme.in === 'query')) {
        const valueKey = `security_${variableSuffix}_apiKey`;
        addEnvironmentValue(environment, valueKey, '', true);
        return { type: 'apikey', apikey: { key: asText(scheme.name), value: `{{${valueKey}}}`, in: scheme.in } };
      }
      if (scheme.type === 'oauth2') {
        const flows = asRecord(scheme.flows);
        const passwordFlow = asRecord(flows.password);
        const tokenUrl = asText(passwordFlow.tokenUrl, scheme.flow === 'password' ? asText(scheme.tokenUrl) : '');
        if (tokenUrl) {
          const clientIdKey = `security_${variableSuffix}_clientId`;
          const clientSecretKey = `security_${variableSuffix}_clientSecret`;
          const usernameKey = `security_${variableSuffix}_username`;
          const passwordKey = `security_${variableSuffix}_password`;
          addEnvironmentValue(environment, clientIdKey, '', true);
          addEnvironmentValue(environment, clientSecretKey, '', true);
          addEnvironmentValue(environment, usernameKey, '', true);
          addEnvironmentValue(environment, passwordKey, '', true);
          return {
            type: 'oauth2',
            oauth2: {
              grantType: 'password',
              tokenUrl,
              clientId: `{{${clientIdKey}}}`,
              clientSecret: `{{${clientSecretKey}}}`,
              username: `{{${usernameKey}}}`,
              password: `{{${passwordKey}}}`,
            },
          };
        }
      }
    }
  }
  return { type: 'none' };
}

function buildRequestBody(operation: RecordValue, api: RecordValue, parameters: RecordValue[]): RequestDefinition['body'] {
  let contentType = '';
  let media: RecordValue = {};
  let schema: unknown;

  const requestBody = asRecord(operation.requestBody);
  const selectedContent = chooseJsonContent(requestBody.content)
    ?? Object.entries(asRecord(requestBody.content)).map(([type, value]) => ({ mediaType: type, media: asRecord(value) }))[0];
  if (selectedContent) {
    contentType = selectedContent.mediaType.toLowerCase();
    media = selectedContent.media;
    schema = media.schema;
  } else {
    const bodyParameter = parameters.find((parameter) => parameter.in === 'body');
    const formParameters = parameters.filter((parameter) => parameter.in === 'formData');
    if (bodyParameter) schema = bodyParameter.schema;
    else if (formParameters.length) {
      const consumes = Array.isArray(operation.consumes) ? operation.consumes : Array.isArray(api.consumes) ? api.consumes : [];
      contentType = consumes.map((entry) => asText(entry).toLowerCase()).find((type) => type.includes('multipart/form-data')) ?? '';
      const fields = formParameters.map((parameter) => ({
        key: asText(parameter.name),
        value: parameterValue(parameter),
        enabled: true,
      }));
      return { mode: contentType.includes('multipart/form-data') ? 'formdata' : 'urlencoded', ...(contentType.includes('multipart/form-data') ? { formdata: fields } : { urlencoded: fields }) };
    }
    const consumes = Array.isArray(operation.consumes) ? operation.consumes : Array.isArray(api.consumes) ? api.consumes : [];
    contentType ||= consumes.map((entry) => asText(entry).toLowerCase()).find((type) => type.includes('json') || type.includes('xml')) ?? '';
  }

  if (!schema && !Object.keys(media).length) return { mode: 'none' };
  const example = pickExample(media, schema);
  if (contentType.includes('json') || (!contentType && schema)) {
    return { mode: 'json', raw: JSON.stringify(example, null, 2) };
  }
  if (contentType.includes('xml')) return { mode: 'xml', raw: stringifyValue(example) };
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const properties = asRecord(asRecord(schema).properties);
    return { mode: 'urlencoded', urlencoded: Object.entries(properties).map(([key, property]) => ({ key, value: stringifyValue(exampleFromSchema(property)), enabled: true })) };
  }
  if (contentType.includes('multipart/form-data')) {
    const properties = asRecord(asRecord(schema).properties);
    return { mode: 'formdata', formdata: Object.entries(properties).map(([key, property]) => ({ key, value: stringifyValue(exampleFromSchema(property)), enabled: true })) };
  }
  return { mode: 'raw', raw: stringifyValue(example) };
}

function responseAssertions(operation: RecordValue, api: RecordValue): RequestDefinition['assertions'] {
  const responses = asRecord(operation.responses);
  const statusEntry = Object.entries(responses).find(([status]) => /^2\d\d$/.test(status))
    ?? Object.entries(responses).find(([status]) => /^2xx$/i.test(status));
  if (!statusEntry) return undefined;

  const [status, responseValue] = statusEntry;
  const response = asRecord(responseValue);
  let schema: unknown;
  if (isRecord(response.content)) {
    schema = chooseJsonContent(response.content)?.media.schema;
  } else {
    const produces = Array.isArray(operation.produces) ? operation.produces : Array.isArray(api.produces) ? api.produces : [];
    if (!produces.length || produces.some((type) => asText(type).toLowerCase().includes('json'))) schema = response.schema;
  }

  const jsonSchema = toJsonSchema(schema);
  const result: NonNullable<RequestDefinition['assertions']> = {};
  if (/^2\d\d$/.test(status)) result.expectedStatusCode = Number(status);
  if (jsonSchema && Object.keys(jsonSchema).length) result.jsonSchema = jsonSchema;
  return Object.keys(result).length ? result : undefined;
}

export function convertOpenApiDocument(document: unknown): CollectionDocument {
  const api = asRecord(document);
  const openApiVersion = asText(api.openapi);
  const swaggerVersion = asText(api.swagger);
  if (!openApiVersion.startsWith('3.0.') && swaggerVersion !== '2.0') {
    throw new Error('Only Swagger 2.0 and OpenAPI 3.0 definitions are supported.');
  }

  const info = asRecord(api.info);
  const environment = new Map<string, KeyValue>();
  const baseUrl = serverConfiguration(api, environment);
  const paths = asRecord(api.paths);
  const items: CollectionItem[] = [];
  const warnings = new Set<string>();

  for (const [path, pathValue] of Object.entries(paths)) {
    const pathItem = asRecord(pathValue);
    const inheritedParameters = pathItem.parameters;
    const requests: CollectionItem[] = [];
    for (const [methodKey, operationValue] of Object.entries(pathItem)) {
      const method = methodKey.toLowerCase();
      if (!supportedMethods.has(method)) continue;
      const operation = asRecord(operationValue);
      const parameters = mergeParameters(inheritedParameters, operation.parameters);
      const pathParams = parameters.filter((parameter) => parameter.in === 'path');
      for (const parameter of pathParams) addEnvironmentValue(environment, asText(parameter.name), parameterValue(parameter));

      const queryParams: KeyValue[] = [];
      const headers: KeyValue[] = [];
      for (const parameter of parameters) {
        const location = parameter.in;
        const row = { key: asText(parameter.name), value: parameterValue(parameter), enabled: true, description: asText(parameter.description) };
        if (location === 'query' && row.key) queryParams.push(row);
        else if (location === 'header' && row.key && row.key.toLowerCase() !== 'content-type') headers.push(row);
        else if (location === 'cookie') warnings.add('Cookie parameters are not generated; add a Cookie header manually if needed.');
      }

      const relativePath = path.replace(/\{([^{}]+)\}/g, (_match, name: string) => `{{${name}}}`);
      const url = `{{baseUrl}}${relativePath.startsWith('/') ? '' : '/'}${relativePath}`;
      const operationName = asText(operation.summary, asText(operation.operationId, `${method.toUpperCase()} ${path}`));
      const description = asText(operation.description);
      const request: RequestDefinition = {
        method: method.toUpperCase() as HttpMethod,
        url,
        queryParams,
        headers,
        auth: configureSecurity(operation, api, environment),
        body: buildRequestBody(operation, api, parameters),
        assertions: responseAssertions(operation, api),
      };
      requests.push({ name: operationName, description: description || undefined, request });
    }
    if (requests.length) items.push({ name: path, type: 'folder', items: requests });
  }

  if (!items.length) throw new Error('The API definition contains no supported REST operations.');
  const version = openApiVersion || swaggerVersion;
  const description = [
    `Generated from API definition ${version}. Review generated examples and security settings before sending requests.`,
    warnings.size ? [...warnings].join(' ') : '',
    baseUrl ? '' : 'No server URL was defined; set baseUrl in the generated environment.',
  ].filter(Boolean).join(' ');

  return {
    info: { name: asText(info.title, 'Imported API'), version: asText(info.version, '1.0.0'), description },
    environments: [{ name: 'OpenAPI', values: [...environment.values()] }],
    items,
  };
}

export async function importOpenApiFile(filePath: string): Promise<CollectionDocument> {
  const sourceDirectory = resolve(dirname(filePath));
  const document = await SwaggerParser.validate(filePath, {
    resolve: {
      file: {
        canRead: (file) => {
          const path = file.url.startsWith('file:') ? fileURLToPath(file.url) : file.url;
          const relativePath = relative(sourceDirectory, resolve(path));
          return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
        },
      },
      http: false,
    },
    dereference: { circular: false },
  });
  return convertOpenApiDocument(document);
}