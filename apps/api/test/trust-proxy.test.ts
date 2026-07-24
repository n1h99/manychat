import { ExpressAdapter } from '@nestjs/platform-express';
import { parseTrustProxy } from '@omnicus/config/server';
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

function requestIp(
  trustProxy: string | undefined,
  remoteAddress: string,
  forwardedFor: string | undefined,
): string {
  const adapter = new ExpressAdapter();
  const express = adapter.getInstance();
  express.set('trust proxy', parseTrustProxy(trustProxy));

  const request = Object.create(express.request) as Request;
  Object.defineProperties(request, {
    headers: {
      value: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    },
    socket: { value: { remoteAddress } },
  });

  return request.ip ?? remoteAddress;
}

describe('trust proxy topology', () => {
  it('uses the direct public address when no proxy is trusted', () => {
    expect(requestIp(undefined, '203.0.113.20', '198.51.100.7')).toBe('203.0.113.20');
  });

  it('does not trust a private source address without explicit configuration', () => {
    expect(requestIp(undefined, '10.10.0.5', '198.51.100.7')).toBe('10.10.0.5');
  });

  it('accepts a forwarded client address from an explicit loopback proxy', () => {
    expect(requestIp('loopback', '127.0.0.1', '198.51.100.7')).toBe('198.51.100.7');
  });

  it('stops at the first untrusted address in a multi-hop chain', () => {
    expect(requestIp('10.10.0.2,10.10.0.3', '10.10.0.2', '203.0.113.9, 10.10.0.3')).toBe(
      '203.0.113.9',
    );
  });
});
