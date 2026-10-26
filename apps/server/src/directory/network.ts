import { resolve4, resolve6, resolveTxt } from 'node:dns/promises';
import { request } from 'node:https';
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { parse } from 'tldts';

async function withDnsTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('DNS lookup timed out.')), 8000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function dnsRecords(host: string, type: 'A' | 'AAAA' | 'TXT'): Promise<string[]> {
  const endpoint = process.env.DNS_OVER_HTTPS_URL;
  if (!endpoint) {
    if (type === 'TXT') return (await withDnsTimeout(resolveTxt(host))).map((parts) => parts.join(''));
    return withDnsTimeout(type === 'A' ? resolve4(host) : resolve6(host));
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('DNS_OVER_HTTPS_URL must use trusted HTTPS.');
  url.searchParams.set('name', host); url.searchParams.set('type', type);
  const response = await fetch(url, { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('The DNS-over-HTTPS resolver is unavailable.');
  const answer = await response.json() as { Status: number; Answer?: { name: string; type: number; data: string }[] };
  if (answer.Status !== 0 && answer.Status !== 3) throw new Error('The DNS resolver returned an error.');
  const expectedType = { A: 1, AAAA: 28, TXT: 16 }[type];
  return (answer.Answer ?? []).filter((a) => a.type === expectedType).map((a) => {
    if (type !== 'TXT') return a.data;
    const chunks = a.data.match(/"(?:[^"\\]|\\.)*"/g);
    return chunks ? chunks.map((part) => JSON.parse(part) as string).join('') : a.data;
  });
}

export function normalizeDomain(input: string): string {
  let url: URL;
  try { url = new URL(input.includes('://') ? input : 'https://' + input); }
  catch { throw new Error('Enter a valid public website domain.'); }
  const domain = domainToASCII(url.hostname.toLowerCase().replace(/\.$/, ''));
  const parsed = parse(domain, { allowPrivateDomains: true });
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port ||
      !domain || isIP(domain) || !parsed.domain || !(parsed.isIcann || parsed.isPrivate) ||
      domain.length > 253) throw new Error('Enter a public domain without credentials or a custom port.');
  return domain;
}

export function isPublicAddress(address: string): boolean {
  try {
    const value = ipaddr.process(address);
    return value.range() === 'unicast';
  } catch { return false; }
}

export function validateTarget(input: string, domain?: string): URL {
  const url = new URL(input);
  const host = normalizeDomain(url.origin);
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      (domain && host !== domain)) throw new Error('Use HTTPS on the verified hostname, without a custom port or credentials.');
  return url;
}

export async function publicAddresses(host: string): Promise<string[]> {
  const answers = await Promise.allSettled([dnsRecords(host, 'A'), dnsRecords(host, 'AAAA')]);
  const addresses = answers.flatMap((a) => a.status === 'fulfilled' ? a.value : []);
  if (!addresses.length) throw new Error('DNS did not return a public address.');
  if (addresses.some((a) => !isPublicAddress(a))) throw new Error('Unsafe DNS destination blocked.');
  return addresses.sort();
}

export type ProbeResponse = {
  status: number; body: string; responseMs: number; tlsExpiresAt: Date | null; addresses: string[];
};

// DNS is resolved and checked once per hop, then pinned in lookup. TLS still
// validates the hostname. Never fall back to an unpinned fetch or proxy route.
export async function safeHttpsGet(input: string, domain?: string, hops = 0): Promise<ProbeResponse> {
  const url = validateTarget(input, domain);
  const addresses = await publicAddresses(url.hostname);
  const address = addresses.find((a) => ipaddr.parse(a).kind() === 'ipv4') ?? addresses[0]!;
  const started = performance.now();
  const response = await new Promise<ProbeResponse & { location?: string }>((resolve, reject) => {
    const req = request(url, {
      method: 'GET', agent: false, servername: url.hostname,
      headers: { 'User-Agent': 'ReviewskitsMonitor/1.0', Accept: 'text/html,text/plain,*/*;q=0.5' },
      lookup: (_host, _options, callback) => callback(null, address, ipaddr.parse(address).kind() === 'ipv4' ? 4 : 6),
    }, (res) => {
      const socket = res.socket as import('node:tls').TLSSocket;
      const expiry = socket.getPeerCertificate?.()?.valid_to;
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 512 * 1024) {
          req.destroy(new Error('Response exceeded the 512 KiB safety limit.'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const parsedExpiry = expiry ? new Date(expiry) : null;
        resolve({
          status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'),
          responseMs: Math.round(performance.now() - started), addresses,
          tlsExpiresAt: parsedExpiry && Number.isFinite(parsedExpiry.getTime()) ? parsedExpiry : null,
          location: res.headers.location,
        });
      });
    });
    const timer = setTimeout(() => req.destroy(new Error('HTTPS request timed out.')), 8000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
  if (response.status >= 300 && response.status < 400) {
    if (!response.location || hops >= 3) throw new Error('Redirect limit exceeded.');
    const target = new URL(response.location, url);
    // Ownership proof and monitoring never escape the verified hostname.
    return safeHttpsGet(target.href, domain ?? url.hostname, hops + 1);
  }
  return response;
}

export async function verifyDomainProof(domain: string, method: 'dns' | 'file', token: string): Promise<boolean> {
  if (method === 'dns') {
    try {
      const records = await dnsRecords('_reviewskits-verify.' + domain, 'TXT');
      return records.some((value) => value.trim() === token);
    } catch (error) {
      if (['ENODATA', 'ENOTFOUND'].includes((error as { code?: string }).code ?? '')) return false;
      throw error;
    }
  }
  const response = await safeHttpsGet('https://' + domain + '/.well-known/reviewskits-verification.txt', domain);
  if (response.status >= 500) throw new Error('Verification host is unavailable.');
  return response.status === 200 && response.body.trim() === token;
}
