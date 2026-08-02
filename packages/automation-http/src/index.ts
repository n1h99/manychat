import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

import {
  externalHttpRequestConfigSchema,
  type ExternalHttpRequestConfig,
} from '@omnicus/automation-core';

export type ExternalHttpOutcome = 'PERMANENT_FAILURE' | 'RETRYABLE_FAILURE' | 'UNKNOWN';

export class ExternalHttpError extends Error {
  constructor(
    readonly outcome: ExternalHttpOutcome,
    readonly safeCode: string,
  ) {
    super(safeCode);
    this.name = 'ExternalHttpError';
  }
}

export interface ExternalHttpExecutionResult {
  contentType: string | null;
  data: unknown;
  mappedVariables: Record<string, unknown>;
  mappingKeys: string[];
  outcome: 'failure' | 'success';
  sizeBytes: number;
  statusCode: number;
}

export interface ExternalHttpExecutionInput {
  config: ExternalHttpRequestConfig;
  idempotencyKey: string;
  secretFor(secretId: string): Promise<string>;
  variables: Readonly<Record<string, unknown>>;
}

interface ResolvedTarget {
  address: string;
  family: 4 | 6;
  url: URL;
}

interface TransportResult {
  body: Buffer;
  contentType: string | null;
  statusCode: number;
}

const maximumRequestBytes = 256 * 1024;
const maximumResponseBytes = 5 * 1024 * 1024;
const maximumRedirects = 3;
const exactTemplate = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/;
const templateExpression = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const blockedHeaders = new Set([
  'connection',
  'content-length',
  'forwarded',
  'host',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);
const secretOnlyHeaders = new Set(['authorization', 'cookie', 'x-api-key']);
const dangerousPathSegments = new Set(['__proto__', 'constructor', 'prototype']);
// Keep address families separate: Node's BlockList maps IPv4 checks into IPv6,
// so an IPv4-mapped IPv6 guard on a shared list would reject every public IPv4 address.
const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4');

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6');

export async function executeExternalHttpRequest(
  input: ExternalHttpExecutionInput,
): Promise<ExternalHttpExecutionResult> {
  const parsed = externalHttpRequestConfigSchema.safeParse(input.config);
  if (!parsed.success)
    throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_config_invalid');
  const request = await compileRequest(parsed.data, input);
  const response = await transport(request, parsed.data.timeoutMs);
  const data = parseResponse(response.body, response.contentType);
  const mappedVariables: Record<string, unknown> = {};
  let mappingFailed = false;
  for (const mapping of parsed.data.mappings) {
    const source = valueAt({ response: { data, status: response.statusCode } }, mapping.sourcePath);
    const value = source === undefined ? mapping.defaultValue : source;
    if (value === undefined && mapping.required) {
      mappingFailed = true;
      continue;
    }
    if (value !== undefined) {
      try {
        setAt(mappedVariables, mapping.targetPath, convertValue(value, mapping.type));
      } catch {
        mappingFailed = true;
      }
    }
  }
  const statusSucceeded =
    response.statusCode >= parsed.data.successStatusMinimum &&
    response.statusCode <= parsed.data.successStatusMaximum;
  return {
    contentType: response.contentType,
    data,
    mappedVariables,
    mappingKeys: parsed.data.mappings.map((mapping) => mapping.targetPath),
    outcome: statusSucceeded && !mappingFailed ? 'success' : 'failure',
    sizeBytes: response.body.byteLength,
    statusCode: response.statusCode,
  };
}

export async function assertSafeExternalHttpUrl(url: string): Promise<void> {
  await resolveTarget(url);
}

async function compileRequest(
  config: ExternalHttpRequestConfig,
  input: ExternalHttpExecutionInput,
): Promise<{
  body?: Buffer;
  headers: Record<string, string>;
  method: ExternalHttpRequestConfig['method'];
  url: string;
}> {
  const urlText = renderScalar(config.url, input.variables, 2_048);
  const url = new URL(urlText);
  for (const query of config.query)
    url.searchParams.append(query.name, renderScalar(query.value, input.variables, 8_192));
  const headers: Record<string, string> = { 'Idempotency-Key': input.idempotencyKey };
  for (const header of config.headers) {
    const normalized = header.name.toLowerCase();
    if (blockedHeaders.has(normalized) || normalized.startsWith('x-forwarded-'))
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_header_forbidden');
    if (secretOnlyHeaders.has(normalized) && !header.secretId)
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_secret_reference_required');
    const value = header.secretId
      ? await input.secretFor(header.secretId)
      : renderScalar(header.value ?? '', input.variables, 16_384);
    if (/\r|\n/.test(value))
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_header_forbidden');
    headers[header.name] = value;
  }
  const body = compileBody(config, input.variables);
  if (body) {
    if (body.byteLength > maximumRequestBytes)
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_request_too_large');
    headers['Content-Type'] = config.contentType;
  }
  return { ...(body ? { body } : {}), headers, method: config.method, url: url.toString() };
}

function compileBody(
  config: ExternalHttpRequestConfig,
  variables: Readonly<Record<string, unknown>>,
): Buffer | undefined {
  if (config.body === undefined || config.method === 'GET') return undefined;
  if (config.contentType === 'application/json')
    return Buffer.from(JSON.stringify(renderJsonValue(config.body, variables)), 'utf8');
  if (config.contentType === 'application/x-www-form-urlencoded') {
    if (!config.body || typeof config.body !== 'object' || Array.isArray(config.body))
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_body_invalid');
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(config.body))
      parameters.append(key, renderScalar(String(value), variables, 16_384));
    return Buffer.from(parameters.toString(), 'utf8');
  }
  if (typeof config.body !== 'string')
    throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_body_invalid');
  return Buffer.from(renderScalar(config.body, variables, maximumRequestBytes), 'utf8');
}

function renderJsonValue(value: unknown, variables: Readonly<Record<string, unknown>>): unknown {
  if (typeof value === 'string') {
    const exact = exactTemplate.exec(value);
    if (exact) {
      const resolved = valueAt(variables, exact[1]!);
      if (resolved === undefined)
        throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_variable_missing');
      return resolved;
    }
    return renderScalar(value, variables, 65_536);
  }
  if (Array.isArray(value)) return value.map((item) => renderJsonValue(item, variables));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderJsonValue(item, variables)]),
    );
  return value;
}

function renderScalar(
  template: string,
  variables: Readonly<Record<string, unknown>>,
  maximumLength: number,
): string {
  const output = template.replace(templateExpression, (_match, path: string) => {
    const value = valueAt(variables, path);
    if (value === undefined || value === null)
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_variable_missing');
    if (typeof value === 'object')
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_variable_not_scalar');
    return String(value);
  });
  if (output.length > maximumLength)
    throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_rendered_value_too_large');
  return output;
}

async function transport(
  request: { body?: Buffer; headers: Record<string, string>; method: string; url: string },
  timeoutMs: number,
  redirectCount = 0,
): Promise<TransportResult> {
  const target = await resolveTarget(request.url);
  const response = await requestPinned(target, request, timeoutMs);
  if (
    response.statusCode >= 300 &&
    response.statusCode < 400 &&
    response.location &&
    redirectCount < maximumRedirects
  ) {
    if (request.method !== 'GET' && ![307, 308].includes(response.statusCode))
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_redirect_method_forbidden');
    let redirectUrl: string;
    try {
      redirectUrl = new URL(response.location, target.url).toString();
    } catch {
      throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_redirect_invalid');
    }
    return transport({ ...request, url: redirectUrl }, timeoutMs, redirectCount + 1);
  }
  if (response.statusCode >= 300 && response.statusCode < 400 && response.location)
    throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_redirect_limit');
  return {
    body: response.body,
    contentType: response.contentType,
    statusCode: response.statusCode,
  };
}

async function resolveTarget(urlText: string): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_url_invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_url_forbidden');
  if (url.href.length > 8_192)
    throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_url_too_large');
  let addresses: LookupAddress[];
  try {
    addresses = await dnsLookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new ExternalHttpError('RETRYABLE_FAILURE', 'external_http_dns_unavailable');
  }
  const selected = selectSafeLookupAddress(addresses);
  if (!selected) throw new ExternalHttpError('PERMANENT_FAILURE', 'external_http_target_forbidden');
  return { address: selected.address, family: selected.family === 6 ? 6 : 4, url };
}

export function selectSafeLookupAddress(addresses: LookupAddress[]): LookupAddress | undefined {
  return addresses.find((entry) => !isBlocked(entry.address));
}

function isBlocked(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blockedIpv4Addresses.check(address, 'ipv4');
  if (family === 6) return blockedIpv6Addresses.check(address, 'ipv6');
  return true;
}

function requestPinned(
  target: ResolvedTarget,
  request: { body?: Buffer; headers: Record<string, string>; method: string },
  timeoutMs: number,
): Promise<{
  body: Buffer;
  contentType: string | null;
  location: string | null;
  statusCode: number;
}> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(
        error instanceof ExternalHttpError
          ? error
          : new ExternalHttpError('UNKNOWN', 'external_http_transport_unknown'),
      );
    };
    const outgoing = httpsRequest(
      target.url,
      {
        headers: request.headers,
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all)
            callback(null, [{ address: target.address, family: target.family }]);
          else callback(null, target.address, target.family);
        },
        method: request.method,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const declared = Number(incoming.headers['content-length'] ?? 0);
        if (declared > maximumResponseBytes) {
          incoming.destroy();
          fail(new ExternalHttpError('PERMANENT_FAILURE', 'external_http_response_too_large'));
          return;
        }
        incoming.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > maximumResponseBytes) {
            incoming.destroy();
            fail(new ExternalHttpError('PERMANENT_FAILURE', 'external_http_response_too_large'));
          } else chunks.push(Buffer.from(chunk));
        });
        incoming.on('error', fail);
        incoming.on('end', () => {
          if (settled) return;
          settled = true;
          resolve({
            body: Buffer.concat(chunks),
            contentType: firstHeader(incoming.headers['content-type']),
            location: firstHeader(incoming.headers.location),
            statusCode: incoming.statusCode ?? 0,
          });
        });
      },
    );
    outgoing.setTimeout(timeoutMs, () => {
      outgoing.destroy();
      fail(new ExternalHttpError('UNKNOWN', 'external_http_timeout_unknown'));
    });
    outgoing.on('error', fail);
    if (request.body) outgoing.write(request.body);
    outgoing.end();
  });
}

function parseResponse(body: Buffer, contentType: string | null): unknown {
  const text = body.toString('utf8');
  if (contentType?.toLowerCase().includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
  return text;
}

function valueAt(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    if (dangerousPathSegments.has(part) || !Object.hasOwn(current, part)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, value);
}

function setAt(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (dangerousPathSegments.has(part)) throw new Error('unsafe mapping path');
    const next = current[part];
    if (!next || typeof next !== 'object' || Array.isArray(next)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  const finalPart = parts.at(-1)!;
  if (dangerousPathSegments.has(finalPart)) throw new Error('unsafe mapping path');
  current[finalPart] = value;
}

function convertValue(value: unknown, type: 'boolean' | 'json' | 'number' | 'string'): unknown {
  if (type === 'json') return value;
  if (type === 'string') return typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (type === 'number') {
    const converted = Number(value);
    if (!Number.isFinite(converted)) throw new Error('number conversion failed');
    return converted;
  }
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('boolean conversion failed');
}

function firstHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}
