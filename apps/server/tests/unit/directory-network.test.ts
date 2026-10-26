import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

const originalFetch = globalThis.fetch;
const oldResolver = process.env.DNS_OVER_HTTPS_URL;
let httpCalls = 0, dnsCalls = 0;
let redirect = '';
let rebinding = false;
let pinnedAddress = '', tlsName = '';
mock.module('node:https', () => ({
  request: (_url: URL, options: { servername: string; lookup: (host: string, opts: unknown, cb: (error: unknown, ip: string) => void) => void }, callback: (res: EventEmitter) => void) => {
    httpCalls++;
    tlsName = options.servername;
    options.lookup('example.com', {}, (_error, ip) => { pinnedAddress = ip; });
    const request = new EventEmitter() as EventEmitter & { end: () => void; destroy: (error: Error) => void };
    request.destroy = (error) => { request.emit('error', error); request.emit('close'); };
    request.end = () => queueMicrotask(() => {
      const response = Object.assign(new EventEmitter(), { socket: { getPeerCertificate: () => ({ valid_to: 'Jan 1 00:00:00 2030 GMT' }) }, statusCode: redirect ? 302 : 200, headers: { location: redirect || undefined } });
      callback(response);
      response.emit('data', Buffer.from('reviewskits-verification=exact-proof'));
      response.emit('end'); request.emit('close');
    });
    return request;
  },
}));
const { safeHttpsGet, publicAddresses, verifyDomainProof } = await import('../../src/directory/network');
beforeEach(() => {
  httpCalls = 0; dnsCalls = 0; redirect = ''; rebinding = false; pinnedAddress = ''; tlsName = '';
  process.env.DNS_OVER_HTTPS_URL = 'https://resolver.example/dns-query';
  globalThis.fetch = mock(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    dnsCalls++;
    const type = url.searchParams.get('type');
    const data = type === 'TXT' ? '"reviewskits-verification=" "exact-proof"' : type === 'A' ? (rebinding && httpCalls > 0 ? '127.0.0.1' : '1.1.1.1') : '2606:4700:4700::1111';
    return Response.json({ Status: 0, Answer: [{ type: type === 'TXT' ? 16 : type === 'A' ? 1 : 28, data }] });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  if (oldResolver === undefined) delete process.env.DNS_OVER_HTTPS_URL;
  else process.env.DNS_OVER_HTTPS_URL = oldResolver;
  mock.restore();
});
describe('Ownership proof and pinned HTTPS transport', () => {
  test('DNS chunks must contain the exact account-scoped proof', async () => {
    expect(await verifyDomainProof('example.com', 'dns', 'reviewskits-verification=exact-proof')).toBe(true);
    expect(await verifyDomainProof('example.com', 'dns', 'another-account-proof')).toBe(false);
  });
  test('pins the checked public address while preserving the original TLS hostname', async () => {
    const response = await safeHttpsGet('https://example.com');
    expect(response.status).toBe(200);
    expect(pinnedAddress).toBe('1.1.1.1'); expect(tlsName).toBe('example.com');
    expect(response.tlsExpiresAt?.getUTCFullYear()).toBe(2030);
  });
  test('rejects private redirects before opening another connection', async () => {
    redirect = 'https://127.0.0.1/private';
    await expect(safeHttpsGet('https://example.com')).rejects.toThrow();
    expect(httpCalls).toBe(1);
  });
  test('rechecks DNS on each redirect and blocks rebinding to internal addresses', async () => {
    redirect = 'https://example.com/second'; rebinding = true;
    await expect(safeHttpsGet('https://example.com')).rejects.toThrow('Unsafe DNS');
    expect(httpCalls).toBe(1); expect(dnsCalls).toBe(4);
    await expect(publicAddresses('example.com')).rejects.toThrow('Unsafe DNS');
  });
});
